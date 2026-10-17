import { Hono, type Context } from "hono";
import { APP_NAME, config } from "../config.js";
import { buyUrl, productJson } from "../catalog.js";
import { merchants, orders, products } from "../db.js";
import { safeEqual, verifyDownload } from "../security.js";
import { clientIp, limitApi, limitFind } from "../limits.js";
import { seedDemo, unseedDemo } from "../seed.js";
import { downloadPage, findOrderPage, foundOrderPage, messagePage, receiptPage } from "../views/pages.js";
import { downloadLink } from "../receipt.js";
import { receiptPdf } from "../pdf.js";
import { readUpload } from "../uploads.js";
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

// Public receipt (HTML or PDF): order details, no buyer PII. `/r/<id>.pdf` is the buyer's downloadable copy.
agent.get("/r/:orderId", async (c) => {
  const raw = c.req.param("orderId");
  const isPdf = raw.endsWith(".pdf");
  const order = orders.get(isPdf ? raw.slice(0, -4) : raw);
  if (!order) return c.html(messagePage("Not found", "No receipt with that ID."), 404);
  const product = products.getAny(order.product_id)!;
  const merchant = merchants.get(order.merchant_id)!;
  if (!isPdf) return c.html(receiptPage(order, product, merchant));
  const pdf = await receiptPdf({ order, product, merchant, copy: "buyer" });
  c.header("Content-Type", "application/pdf");
  c.header("Content-Disposition", `attachment; filename="receipt-${order.id}.pdf"`);
  c.header("Cache-Control", "private, max-age=60");
  return c.body(new Uint8Array(pdf));
});

// "Find my order": no account needed. Order ID (a secret only buyer and seller see) plus a second
// factor the buyer knows: the email they gave at checkout, or the wallet that paid.
agent.get("/find", (c) => c.html(findOrderPage({ order: c.req.query("order") })));

agent.post("/find", async (c) => {
  if (!limitFind(clientIp(c))) return c.html(findOrderPage({ error: "Too many attempts. Try again in a few minutes." }), 429);
  const form = await c.req.parseBody();
  const orderId = String(form.order ?? "").trim();
  const contact = String(form.contact ?? "").trim().toLowerCase();
  const order = /^xnx_[a-z0-9]{6,32}$/.test(orderId) ? orders.get(orderId) : undefined;
  const matches =
    order &&
    contact.length > 3 &&
    ((order.buyer.email && order.buyer.email.toLowerCase() === contact) || (order.payer_address && order.payer_address.toLowerCase() === contact));
  if (!order || !matches) {
    return c.html(findOrderPage({ order: orderId, contact, error: "We couldn't find an order with those details. Check the order ID, and use the email you gave at checkout or the wallet address you paid from." }), 404);
  }
  const product = products.getAny(order.product_id)!;
  const merchant = merchants.get(order.merchant_id)!;
  c.header("Cache-Control", "private, no-store");
  return c.html(foundOrderPage(order, product, merchant, product.kind === "digital" ? downloadLink(order.id).url : undefined));
});

// Uploaded product images (public).
agent.get("/u/:id", (c) => {
  const f = readUpload(c.req.param("id"));
  if (!f || f.meta.kind !== "image") return c.text("Not found", 404);
  c.header("Content-Type", f.meta.mime);
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  return c.body(new Uint8Array(f.data));
});

function paidDownload(c: Context) {
  const id = c.req.param("orderId") ?? "";
  const token = c.req.query("t") ?? "";
  const order = orders.get(id);
  if (!order || !verifyDownload(id, token)) return undefined;
  const product = products.getAny(order.product_id);
  if (!product || product.kind !== "digital") return undefined;
  return { id, token, order, product };
}

agent.get("/d/:orderId", (c) => {
  const d = paidDownload(c);
  if (!d) return c.html(messagePage("Link expired", "This download link is invalid or has expired. Contact the merchant with your order ID."), 403);
  const { id, token, order, product } = d;
  c.header("Cache-Control", "private, no-store");
  c.header("Referrer-Policy", "no-referrer");
  orders.markDownloaded(id);
  if (product.delivery_url && !product.delivery_text && !product.delivery_file_id) return c.redirect(product.delivery_url, 302);
  if (c.req.query("format") === "txt") {
    c.header("Content-Disposition", `attachment; filename="${product.id}.txt"`);
    return c.text(product.delivery_text ?? "");
  }
  const t = encodeURIComponent(token);
  const upload = product.delivery_file_id ? readUpload(product.delivery_file_id)?.meta : undefined;
  return c.html(
    downloadPage(order, product, merchants.get(order.merchant_id)!, {
      txt: product.delivery_text ? `/d/${id}?t=${t}&format=txt` : undefined,
      file: upload ? { url: `/d/${id}/file?t=${t}`, name: upload.filename, size: upload.size } : undefined,
    }),
  );
});

// The uploaded digital file itself, only via the signed link.
agent.get("/d/:orderId/file", (c) => {
  const d = paidDownload(c);
  if (!d) return c.html(messagePage("Link expired", "This download link is invalid or has expired."), 403);
  const f = d.product.delivery_file_id ? readUpload(d.product.delivery_file_id) : undefined;
  if (!f) return c.html(messagePage("Not found", "The merchant's file is missing. Contact them with your order ID."), 404);
  orders.markDownloaded(d.id);
  c.header("Content-Type", f.meta.mime);
  c.header("Content-Disposition", `attachment; filename="${f.meta.filename.replace(/"/g, "")}"`);
  c.header("Cache-Control", "private, no-store");
  return c.body(new Uint8Array(f.data));
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
Relay the "message" field to the user verbatim: it has the order ID, the download link (digital) and the PDF receipt link.
Lost it? The buyer can recover the download and receipt at ${config.BASE_URL}/find with the order ID plus their checkout email or paying wallet.

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

function isAdmin(auth: string | undefined): boolean {
  return Boolean(config.ADMIN_TOKEN) && safeEqual(auth ?? "", `Bearer ${config.ADMIN_TOKEN}`);
}

agent.post("/admin/unseed", (c) => {
  if (!isAdmin(c.req.header("authorization"))) return c.json({ error: "unauthorized" }, 401);
  return c.json(unseedDemo());
});

agent.post("/admin/seed", async (c) => {
  if (!isAdmin(c.req.header("authorization"))) return c.json({ error: "unauthorized" }, 401);
  try {
    return c.json(await seedDemo());
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "seed failed" }, 400);
  }
});
