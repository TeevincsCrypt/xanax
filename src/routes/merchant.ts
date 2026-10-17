import { Hono, type Context } from "hono";
import { merchants, orders, products } from "../db.js";
import { createListing, dashboardUrl, type ListingInput } from "../listing.js";
import { deliverWebhook } from "../notify.js";
import { sha256Hex } from "../security.js";
import { clientIp, limitDashboard, limitSell } from "../limits.js";
import { dashboardPage, landingPage, messagePage, sellPage, sellSuccessPage } from "../views/pages.js";

export const merchant = new Hono();

merchant.get("/", (c) => c.html(landingPage(products.search(undefined, 24))));

merchant.get("/sell", (c) => c.html(sellPage()));

merchant.post("/sell", async (c) => {
  if (!limitSell(clientIp(c))) return c.html(messagePage("Slow down", "Too many listings from your network. Try again in a few minutes."), 429);
  const form = await c.req.parseBody({ all: true });
  const one = (k: string) => {
    const v = form[k];
    return typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
  };
  const rf = form.required_fields;
  const input: ListingInput = {
    business_name: one("business_name"),
    product_name: one("product_name"),
    description: one("description"),
    price_usd: one("price_usd"),
    image_url: one("image_url"),
    payout_address: one("payout_address"),
    webhook_url: one("webhook_url"),
    email: one("email"),
    kind: one("kind"),
    delivery_url: one("delivery_url"),
    delivery_text: one("delivery_text"),
    stock: one("stock"),
    required_fields: (Array.isArray(rf) ? rf : rf ? [rf] : []).filter((x): x is string => typeof x === "string"),
  };
  const res = await createListing(input);
  if (!res.ok) return c.html(sellPage(input, res.errors), 400);
  const { merchant: m, product, dashboardToken, webhookSecret } = res.listing;
  c.header("Cache-Control", "no-store");
  return c.html(sellSuccessPage({ product, merchant: m, dashboardUrl: dashboardUrl(dashboardToken), webhookSecret }), 201);
});

function auth(c: Context) {
  if (!limitDashboard(clientIp(c))) return undefined;
  const token = c.req.param("token") ?? "";
  if (token.length < 20 || token.length > 100) return undefined;
  const m = merchants.byTokenHash(sha256Hex(token));
  return m ? { m, token } : undefined;
}

merchant.get("/m/:token", (c) => {
  const a = auth(c);
  if (!a) return c.html(messagePage("Not found", "That dashboard link isn't valid."), 404);
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  const flash = c.req.query("ok");
  return c.html(
    dashboardPage({
      merchant: a.m,
      products: products.byMerchant(a.m.id),
      orders: orders.byMerchant(a.m.id),
      token: a.token,
      flash: flash === "fulfilled" ? "Order marked fulfilled." : flash === "resent" ? "Webhook re-sent." : flash === "resend-failed" ? "Webhook re-send failed; see the status pill for the error." : undefined,
    }),
  );
});

merchant.post("/m/:token/orders/:orderId/fulfil", (c) => {
  const a = auth(c);
  if (!a) return c.html(messagePage("Not found", "That dashboard link isn't valid."), 404);
  orders.markFulfilled(c.req.param("orderId"), a.m.id);
  return c.redirect(`/m/${a.token}?ok=fulfilled`, 303);
});

merchant.post("/m/:token/orders/:orderId/resend", async (c) => {
  const a = auth(c);
  if (!a) return c.html(messagePage("Not found", "That dashboard link isn't valid."), 404);
  const order = orders.get(c.req.param("orderId"));
  if (!order || order.merchant_id !== a.m.id) return c.html(messagePage("Not found", "No such order."), 404);
  const product = products.get(order.product_id) ?? products.byMerchant(a.m.id).find((p) => p.id === order.product_id)!;
  const ok = await deliverWebhook(order, product, a.m, 8_000);
  return c.redirect(`/m/${a.token}?ok=${ok ? "resent" : "resend-failed"}`, 303);
});
