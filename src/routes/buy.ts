import { Hono, type Context } from "hono";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { getFacilitatorResponseError } from "@x402/core/server";
import { APP_NAME, config } from "../config.js";
import { parseQty, totalCents, validateBuyer } from "../catalog.js";
import { merchants, orders, products, type Order } from "../db.js";
import { notifyMerchant, sendBuyerReceipt } from "../notify.js";
import { receiptJson, wasNotified } from "../receipt.js";
import { randomId } from "../security.js";
import { ensureInitialized, httpServer, paymentNonce, readPaymentHeader, XanaxAdapter } from "../x402.js";
import { clientIp, limitBuy } from "../limits.js";

export const buy = new Hono();

/** Plain-English explanation of common facilitator rejections. */
function paymentHint(reason: string): string {
  if (reason.includes("insufficient_balance")) return `The paying wallet doesn't have enough USDC on ${config.network.label}. Nothing was charged.`;
  if (reason.includes("nonce_used")) return "This payment authorization was already used. Sign a new payment. Nothing was charged twice.";
  if (reason.includes("expired") || reason.includes("valid_before") || reason.includes("valid_after")) return "The payment authorization expired or isn't valid yet. Retry with a fresh payment.";
  if (reason.includes("network") || reason.includes("recipient") || reason.includes("amount") || reason.includes("No matching")) return "The payment doesn't match these requirements (network, amount or recipient). Re-read the 402 and pay again.";
  return "The payment was rejected. Nothing was charged. Check the error and retry.";
}

function replay(c: Context, order: Order) {
  const product = products.get(order.product_id)!;
  const merchant = merchants.get(order.merchant_id)!;
  return c.json(receiptJson(order, product, merchant, wasNotified(order)), 200);
}

async function handleBuy(c: Context) {
  if (!limitBuy(clientIp(c))) return c.json({ error: "Too many requests, slow down." }, 429);

  const product = products.get(c.req.param("id") ?? "");
  if (!product) return c.json({ error: "Product not found. Search products at /api/products?q=..." }, 404);
  const merchant = merchants.get(product.merchant_id)!;

  const qtyParsed = parseQty(c.req.query("qty"));
  if (!qtyParsed.ok) return c.json({ error: qtyParsed.error }, 400);
  const qty = qtyParsed.qty;

  // Sold out: answer with 409, not 402, so nobody pays for nothing.
  if (product.stock !== null && product.stock < qty) {
    return c.json(
      { error: product.stock <= 0 ? `Sold out: ${product.name} is out of stock.` : `Only ${product.stock} left; lower qty.`, in_stock: product.stock },
      409,
    );
  }

  const adapter = new XanaxAdapter(c);
  const { raw, payload } = readPaymentHeader(adapter);
  const nonce = paymentNonce(payload, raw);
  let buyer: Record<string, string> = {};

  if (raw) {
    // Idempotency: a replayed payment returns the original receipt; never a second order.
    const existing = nonce ? orders.byNonce(nonce) : undefined;
    if (existing) return replay(c, existing);

    // Validate the body BEFORE verify/settle, so a bad request is never charged.
    const body = c.req.method === "POST" ? await adapter.getBody() : undefined;
    const v = validateBuyer(product, body);
    if (!v.ok) return c.json({ error: v.error, missing_fields: v.missing, charged: false }, 400);
    buyer = v.buyer;
  }

  try {
    await ensureInitialized();
  } catch (err) {
    console.error("[x402] facilitator init failed", err);
    return c.json({ error: "Payment facilitator unavailable, try again shortly. You have not been charged." }, 503);
  }

  const server = httpServer();
  const ctx = { adapter, path: c.req.path, method: c.req.method, paymentHeader: raw };
  let result;
  try {
    result = await server.processHTTPRequest(ctx, { appName: APP_NAME, testnet: config.network.testnet });
  } catch (err) {
    const fe = getFacilitatorResponseError(err);
    console.error("[x402] verify failed", fe?.message ?? err);
    return c.json({ error: "Payment verification failed upstream. You have not been charged." }, 502);
  }

  if (result.type === "no-payment-required") return c.json({ error: "unexpected: route not protected" }, 500);

  if (result.type === "payment-error") {
    const { response } = result;
    for (const [k, v] of Object.entries(response.headers)) c.header(k, v);
    if (response.isHtml) return c.html(String(response.body), response.status as 402);
    // Echo the v2 PaymentRequired object in the JSON body too, for clients that read the body.
    let body = (response.body ?? {}) as Record<string, unknown>;
    const header = response.headers["PAYMENT-REQUIRED"];
    if (header) {
      try {
        const pr = decodePaymentRequiredHeader(header);
        // A rejected payment: lead with the reason so an agent (or a human) sees it first.
        const failure = pr.error && pr.error !== "Payment required" ? { error: pr.error, hint: paymentHint(pr.error) } : {};
        body = { ...failure, x402Version: pr.x402Version, ...body, ...failure, accepts: pr.accepts, resource: pr.resource, extensions: pr.extensions };
      } catch {
        /* header is authoritative; body echo is best-effort */
      }
    }
    return c.json(body, response.status as 402);
  }

  // payment-verified: reserve stock, settle, then record the order.
  const { paymentPayload, paymentRequirements, declaredExtensions, beforeHandlerSettlement, cancellationDispatcher } = result;
  if (!products.reserveStock(product.id, qty)) {
    await cancellationDispatcher.cancel({ reason: "handler_failed", responseStatus: 409 }).catch(() => undefined);
    return c.json({ error: "Sold out while processing. You have not been charged." }, 409);
  }

  let settle;
  try {
    settle = await server.processSettlement(paymentPayload, paymentRequirements, declaredExtensions, { request: ctx }, undefined, beforeHandlerSettlement);
  } catch (err) {
    products.releaseStock(product.id, qty);
    const fe = getFacilitatorResponseError(err);
    console.error("[x402] settle threw", fe?.message ?? err);
    return c.json({ error: "Payment settlement failed upstream. You have not been charged." }, 502);
  }

  if (!settle.success) {
    products.releaseStock(product.id, qty);
    // A concurrent duplicate may have won the race with this same payment.
    const existing = nonce ? orders.byNonce(nonce) : undefined;
    if (existing) return replay(c, existing);
    for (const [k, v] of Object.entries(settle.headers)) c.header(k, v);
    console.warn("[x402] settle failed", settle.errorReason, settle.errorMessage);
    return c.json(
      { error: `Payment could not be settled (${settle.errorReason}). You have not been charged.`, ...(settle.response.body as object) },
      settle.response.status as 402,
    );
  }

  const already = orders.byTxHash(settle.transaction);
  if (already) {
    products.releaseStock(product.id, qty);
    return replay(c, already);
  }

  const order: Omit<Order, "created_at"> & { created_at?: string } = {
    id: randomId("xnx"),
    product_id: product.id,
    merchant_id: merchant.id,
    quantity: qty,
    unit_price_cents: product.price_cents,
    amount_cents: totalCents(product.price_cents, qty),
    buyer,
    payer_address: settle.payer ?? null,
    tx_hash: settle.transaction,
    payment_nonce: nonce ?? null,
    network: config.network.label,
    status: "paid",
    webhook_status: merchant.webhook_url ? "pending" : "none",
    webhook_attempts: 0,
    webhook_last_error: null,
    email_status: "none",
    fulfilled_at: null,
  };
  if (!orders.insert(order)) {
    products.releaseStock(product.id, qty);
    const existing = orders.byTxHash(settle.transaction) ?? (nonce ? orders.byNonce(nonce) : undefined);
    if (existing) return replay(c, existing);
  }
  const saved = orders.get(order.id)!;
  console.log(`[order] ${saved.id} ${qty}x ${product.id} $${saved.amount_cents / 100} tx=${saved.tx_hash}`);

  // Notification never blocks the receipt for long: first attempt is bounded, retries run in background.
  const notified = await notifyMerchant(saved, product, merchant).catch(() => false);

  for (const [k, v] of Object.entries(settle.headers)) c.header(k, v);
  const receipt = receiptJson(saved, product, merchant, notified);
  // Buyer's emailed receipt (if they gave an email and Resend is set up); never blocks the response.
  void sendBuyerReceipt(saved, product, merchant, receipt.delivery?.download_url).catch(() => undefined);
  return c.json(receipt, 200);
}

buy.get("/buy/:id", handleBuy);
buy.post("/buy/:id", handleBuy);
