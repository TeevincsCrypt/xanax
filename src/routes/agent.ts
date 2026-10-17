import { Hono } from "hono";
import { APP_NAME, config } from "../config.js";
import { buyUrl, productJson } from "../catalog.js";
import { merchants, orders, products } from "../db.js";
import { safeEqual, verifyDownload } from "../security.js";
import { clientIp, limitApi } from "../limits.js";
import { seedDemo } from "../seed.js";
import { downloadPage, messagePage, receiptPage } from "../views/pages.js";
import { RECEIPT_EXAMPLE } from "../x402.js";

export const agent = new Hono();

agent.use("/api/*", async (c, next) => {
  if (!limitApi(clientIp(c))) return c.json({ error: "Too many requests" }, 429);
  c.header("Access-Control-Allow-Origin", "*");
  await next();
});

agent.get("/api/products", (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const list = products.search(q, 50);
  return c.json({
    query: q,
    count: list.length,
    how_to_buy: `POST the product's buy.url (add ?qty=N for more than one) with JSON body {"buyer": {...}}. Payment is x402 (USDC on ${config.network.label}); with PayBox use use_service, method POST.`,
    products: list.map((p) => productJson(p, p.business_name)),
  });
});

agent.get("/api/products/:id", (c) => {
  const p = products.get(c.req.param("id"));
  if (!p) return c.json({ error: "Product not found" }, 404);
  return c.json(productJson(p, merchants.get(p.merchant_id)!.business_name));
});

agent.get("/r/:orderId", (c) => {
  const order = orders.get(c.req.param("orderId"));
  if (!order) return c.html(messagePage("Not found", "No receipt with that ID."), 404);
  const product = products.byMerchant(order.merchant_id).find((p) => p.id === order.product_id)!;
  const merchant = merchants.get(order.merchant_id)!;
  return c.html(receiptPage(order, product, merchant));
});

agent.get("/d/:orderId", (c) => {
  const id = c.req.param("orderId");
  const token = c.req.query("t") ?? "";
  const order = orders.get(id);
  if (!order || !verifyDownload(id, token)) {
    return c.html(messagePage("Link expired", "This download link is invalid or has expired. Contact the merchant with your order ID."), 403);
  }
  const product = products.byMerchant(order.merchant_id).find((p) => p.id === order.product_id)!;
  if (product.kind !== "digital") return c.html(messagePage("Not found", "Nothing to download for this order."), 404);
  c.header("Cache-Control", "private, no-store");
  c.header("Referrer-Policy", "no-referrer");
  if (product.delivery_url && !product.delivery_text) return c.redirect(product.delivery_url, 302);
  if (c.req.query("format") === "txt") {
    c.header("Content-Disposition", `attachment; filename="${product.id}.txt"`);
    return c.text(product.delivery_text ?? "");
  }
  const merchant = merchants.get(order.merchant_id)!;
  return c.html(downloadPage(order, product, merchant, `/d/${id}?t=${encodeURIComponent(token)}&format=txt`));
});

agent.get("/llms.txt", (c) => {
  const list = products.search(undefined, 20);
  const body = `# ${APP_NAME}

> ${APP_NAME} is agent checkout: independent merchants list products here, and AI agents buy them over x402 (HTTP 402) with USDC on ${config.network.testnet ? "Base Sepolia (testnet)" : "Base"}. Payment goes straight to the merchant's wallet. Works with PayBox.

## How to buy (for agents)

1. Search, free: GET ${config.BASE_URL}/api/products?q=<keywords>
   Each product has: id, merchant, name, description, price_usd, in_stock, and buy.{url, required_buyer_fields, body_schema, body_example}.
2. Buy: POST ${config.BASE_URL}/buy/<id>?qty=<1-${config.MAX_QTY}>
   - Body (JSON): {"buyer": {"name": "...", "email": "...", "phone": "...", "shipping_address": "...", "note": "..."}}. Include every field listed in required_buyer_fields.
   - Price = price_usd x qty. It depends only on the URL, never the body.
   - The first, unpaid request returns 402 with the requirements in the PAYMENT-REQUIRED header (x402 v2, scheme "exact", network ${config.network.caip2}). Pay and retry with the PAYMENT-SIGNATURE header.
   - If a required buyer field is missing, the paid request fails with 400 BEFORE settlement: you are not charged.
   - Sold-out products return 409 instead of 402.
3. With PayBox: call use_service with { credential_id, url: "<buy url>", method: "POST", body: {"buyer": {...}} }. PayBox probes, asks the user to approve if needed, pays and returns our receipt in output.value.response.body.

## Receipt (200 response)

${JSON.stringify(RECEIPT_EXAMPLE, null, 2)}

Digital products also include "delivery": {"type": "download", "download_url": "...", "expires_at": "..."}.
Relay order_id, amount, next_steps and receipt_url to the user.

## Live products

${list.map((p) => `- ${p.name} from ${p.business_name}: $${(p.price_cents / 100).toFixed(2)} USDC. POST ${buyUrl(p.id)} (requires: ${p.required_fields.join(", ") || "nothing"})`).join("\n") || "- (none yet)"}

## Merchants

Sell to agents in 2 minutes: ${config.BASE_URL}/sell
`;
  c.header("Content-Type", "text/plain; charset=utf-8");
  return c.body(body);
});

// Discovery document in the x402scan-style /.well-known/x402 format.
agent.get("/.well-known/x402", (c) =>
  c.json({
    version: 1,
    name: APP_NAME,
    description: `${APP_NAME} agent checkout: buy products from independent merchants over x402.`,
    resources: products.search(undefined, 200).map((p) => buyUrl(p.id)),
    instructions: `${config.BASE_URL}/llms.txt`,
    search: `${config.BASE_URL}/api/products?q=`,
  }),
);

agent.get("/health", (c) => c.json({ ok: true, network: config.network.label }));

agent.post("/admin/seed", async (c) => {
  const auth = c.req.header("authorization") ?? "";
  if (!config.ADMIN_TOKEN || !safeEqual(auth, `Bearer ${config.ADMIN_TOKEN}`)) return c.json({ error: "unauthorized" }, 401);
  try {
    return c.json(await seedDemo());
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "seed failed" }, 400);
  }
});
