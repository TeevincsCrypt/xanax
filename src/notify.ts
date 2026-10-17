import { APP_NAME, config, explorerTxUrl } from "./config.js";
import { formatUsd } from "./catalog.js";
import { orders, type Merchant, type Order, type Product } from "./db.js";
import { checkWebhookUrl, escapeHtml, signWebhook } from "./security.js";
import { receiptPdf } from "./pdf.js";

export function orderPayload(order: Order, product: Product) {
  return {
    id: order.id,
    status: order.status,
    product: { id: product.id, name: product.name, type: product.kind },
    quantity: order.quantity,
    unit_price_usd: formatUsd(order.unit_price_cents),
    amount_usd: formatUsd(order.amount_cents),
    currency: "USDC",
    network: order.network,
    tx_hash: order.tx_hash,
    explorer_url: explorerTxUrl(order.tx_hash, order.network),
    payer: order.payer_address,
    buyer: order.buyer,
    created_at: order.created_at,
    receipt_url: `${config.BASE_URL}/r/${order.id}`,
    receipt_pdf_url: `${config.BASE_URL}/r/${order.id}.pdf`,
  };
}

const BACKOFF_MS = [0, 2_000, 8_000, 30_000]; // 1 try + 3 retries

async function postOnce(merchant: Merchant, body: string, timeoutMs: number): Promise<{ ok: boolean; error?: string }> {
  if (!merchant.webhook_url) return { ok: false, error: "no webhook configured" };
  const check = await checkWebhookUrl(merchant.webhook_url);
  if (!check.ok) return { ok: false, error: check.error };
  const ts = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(check.url, {
      method: "POST",
      redirect: "manual", // a redirect could point somewhere private
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "content-type": "application/json",
        "user-agent": `${APP_NAME}-Webhooks/1.0`,
        "x-xanax-event": "order.paid",
        "x-xanax-timestamp": String(ts),
        "x-xanax-signature": signWebhook(merchant.webhook_secret, ts, body),
      },
      body,
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name : "request failed" };
  }
}

/**
 * Deliver the order.paid webhook. Resolves with the result of the FIRST attempt (so the buyer's
 * receipt can say honestly whether the merchant was notified) and keeps retrying in the background.
 */
export function deliverWebhook(order: Order, product: Product, merchant: Merchant, firstAttemptTimeoutMs = 4_000): Promise<boolean> {
  if (!merchant.webhook_url) return Promise.resolve(false);
  const body = JSON.stringify({ event: "order.paid", order: orderPayload(order, product) });

  return new Promise<boolean>((resolveFirst) => {
    let settled = false;
    const report = (v: boolean) => {
      if (!settled) {
        settled = true;
        resolveFirst(v);
      }
    };
    (async () => {
      let lastError: string | null = null;
      for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
        if (BACKOFF_MS[attempt]) await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        const res = await postOnce(merchant, body, attempt === 0 ? firstAttemptTimeoutMs : 10_000);
        if (res.ok) {
          orders.recordWebhook(order.id, "delivered", attempt + 1, null);
          report(true);
          return;
        }
        lastError = res.error ?? "failed";
        orders.recordWebhook(order.id, attempt === BACKOFF_MS.length - 1 ? "failed" : "pending", attempt + 1, lastError);
        report(false);
      }
      console.warn(`[webhook] order ${order.id}: gave up after ${BACKOFF_MS.length} attempts (${lastError})`);
    })().catch((err) => {
      console.error("[webhook] unexpected error", err);
      report(false);
    });
  });
}

async function sendEmail(args: { to: string; subject: string; text: string; pdf: Uint8Array; filename: string }): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [args.to],
        subject: args.subject,
        text: args.text,
        html: `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0d0d12;max-width:560px">${escapeHtml(args.text)
          .split("\n")
          .map((l) => (l ? `<div>${l.replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#2f4bff">$1</a>')}</div>` : "<br>"))
          .join("")}</div>`,
        attachments: [{ filename: args.filename, content: Buffer.from(args.pdf).toString("base64") }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Seller's copy: order email with the PDF receipt (incl. buyer details) attached, through Resend if configured. */
export async function sendOrderEmail(order: Order, product: Product, merchant: Merchant): Promise<boolean> {
  if (!config.emailEnabled || !merchant.email) return false;
  const p = orderPayload(order, product);
  const buyerLines = Object.entries(order.buyer).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`);
  const text = [
    `New order on ${APP_NAME}: ${order.quantity} x ${product.name}`,
    ``,
    `Order: ${order.id}`,
    `Amount: $${p.amount_usd} USDC, paid to your wallet ${merchant.payout_address}`,
    `Transaction: ${p.explorer_url}`,
    ``,
    `Buyer details:`,
    ...(buyerLines.length ? buyerLines : ["(none provided)"]),
    ``,
    `Your receipt (seller copy) is attached as a PDF.`,
  ].join("\n");
  const pdf = await receiptPdf({ order, product, merchant, copy: "seller" });
  const ok = await sendEmail({ to: merchant.email, subject: `New order: ${order.quantity} x ${product.name} ($${p.amount_usd})`, text, pdf, filename: `receipt-${order.id}-seller.pdf` });
  orders.recordEmail(order.id, ok ? "sent" : "failed");
  return ok;
}

/** Buyer's copy, when the buyer gave an email: receipt PDF attached, plus the download link for digital goods. */
export async function sendBuyerReceipt(order: Order, product: Product, merchant: Merchant, downloadUrl?: string): Promise<boolean> {
  const to = order.buyer.email;
  if (!config.emailEnabled || !to) return false;
  const p = orderPayload(order, product);
  const text = [
    `Thanks for your purchase from ${merchant.business_name}.`,
    ``,
    `${order.quantity} x ${product.name}: $${p.amount_usd} USDC`,
    `Order: ${order.id}`,
    `Transaction: ${p.explorer_url}`,
    ...(downloadUrl ? [``, `Download: ${downloadUrl}`, `(link valid for 7 days)`] : []),
    ``,
    `Your receipt is attached as a PDF. Online copy: ${p.receipt_url}`,
  ].join("\n");
  const pdf = await receiptPdf({ order, product, merchant, copy: "buyer" });
  return sendEmail({ to, subject: `Your receipt from ${merchant.business_name} (${order.id})`, text, pdf, filename: `receipt-${order.id}.pdf` });
}

/** Notify the merchant on every configured channel. Resolves true if any channel succeeded promptly. */
export async function notifyMerchant(order: Order, product: Product, merchant: Merchant): Promise<boolean> {
  const results = await Promise.all([deliverWebhook(order, product, merchant), sendOrderEmail(order, product, merchant)]);
  return results.some(Boolean);
}
