import { Hono, type Context } from "hono";
import { currentUser, signIn, signOut } from "../auth.js";
import { config } from "../config.js";
import { merchants, orders, products, type Merchant, type User } from "../db.js";
import { createListing, dashboardUrl, type ListingInput } from "../listing.js";
import { deliverWebhook } from "../notify.js";
import { receiptPdf } from "../pdf.js";
import { sha256Hex } from "../security.js";
import { clientIp, limitDashboard, limitSell } from "../limits.js";
import { dashboardPage, landingPage, messagePage, sellPage, sellSuccessPage } from "../views/pages.js";
import { accountPage, loginPage } from "../views/account.js";

export const merchant = new Hono();

merchant.get("/", (c) => {
  const list = products.search(undefined, 24);
  const { orders: n, volumeCents } = orders.stats();
  return c.html(landingPage(list, { products: products.search(undefined, 1000).length, orders: n, volumeCents }));
});

/** Selling needs an account so every store, order and receipt belongs to someone. (Open only when sign-in isn't configured, e.g. local dev.) */
function sellerOrRedirect(c: Context): { user?: User; redirect?: Response } {
  const user = currentUser(c);
  if (!user && config.authEnabled) return { redirect: c.redirect("/login?next=/sell", 303) };
  return { user };
}

merchant.get("/sell", (c) => {
  const { user, redirect } = sellerOrRedirect(c);
  if (redirect) return redirect;
  return c.html(sellPage(user?.email ? { email: user.email } : {}));
});

merchant.post("/sell", async (c) => {
  if (!limitSell(clientIp(c))) return c.html(messagePage("Slow down", "Too many listings from your network. Try again in a few minutes."), 429);
  const { user, redirect } = sellerOrRedirect(c);
  if (redirect) return redirect;
  const form = await c.req.parseBody({ all: true });
  const one = (k: string) => {
    const v = form[k];
    return typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
  };
  const file = (k: string) => {
    const v = form[k];
    const f = Array.isArray(v) ? v[0] : v;
    return f instanceof File && f.size > 0 ? f : undefined;
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
    image_file: file("image_file"),
    digital_file: file("digital_file"),
    user_id: user?.id,
  };
  const res = await createListing(input);
  if (!res.ok) {
    const { image_file: _i, digital_file: _d, ...values } = input;
    return c.html(sellPage(values, res.errors), 400);
  }
  const { merchant: m, product, dashboardToken, webhookSecret } = res.listing;
  c.header("Cache-Control", "no-store");
  return c.html(sellSuccessPage({ product, merchant: m, dashboardUrl: dashboardUrl(dashboardToken), webhookSecret, signedIn: Boolean(user) }), 201);
});

// ---------- store dashboards: by private link (/m/:token) or as the signed-in owner (/account/stores/:id) ----------

type StoreAccess = { m: Merchant; base: string; user?: User };

function byLink(c: Context): StoreAccess | undefined {
  if (!limitDashboard(clientIp(c))) return undefined;
  const token = c.req.param("token") ?? "";
  if (token.length < 20 || token.length > 100) return undefined;
  const m = merchants.byTokenHash(sha256Hex(token));
  return m ? { m, base: `/m/${token}`, user: currentUser(c) } : undefined;
}

function byOwner(c: Context): StoreAccess | undefined {
  const user = currentUser(c);
  const m = user ? merchants.get(c.req.param("id") ?? "") : undefined;
  return m && user && m.user_id === user.id ? { m, base: `/account/stores/${m.id}`, user } : undefined;
}

const FLASH: Record<string, string> = {
  fulfilled: "Order marked fulfilled.",
  resent: "Webhook re-sent.",
  "resend-failed": "Webhook re-send failed; see the status pill for the error.",
  claimed: "Saved to your account.",
};

function storeRoutes(prefix: string, access: (c: Context) => StoreAccess | undefined) {
  const notFound = (c: Context) => c.html(messagePage("Not found", "That dashboard link isn't valid."), 404);

  merchant.get(prefix, (c) => {
    const a = access(c);
    if (!a) return notFound(c);
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    return c.html(
      dashboardPage({
        merchant: a.m,
        products: products.byMerchant(a.m.id),
        orders: orders.byMerchant(a.m.id),
        base: a.base,
        flash: FLASH[c.req.query("ok") ?? ""],
        claimable: Boolean(a.user && !a.m.user_id),
      }),
    );
  });

  merchant.post(`${prefix}/claim`, (c) => {
    const a = access(c);
    if (!a) return notFound(c);
    if (!a.user) return c.redirect(`/login?next=${encodeURIComponent(a.base)}`, 303);
    if (!merchants.claim(a.m.id, a.user.id)) return c.html(messagePage("Already claimed", "This store belongs to another account."), 409);
    return c.redirect(`/account/stores/${a.m.id}?ok=claimed`, 303);
  });

  merchant.post(`${prefix}/orders/:orderId/fulfil`, (c) => {
    const a = access(c);
    if (!a) return notFound(c);
    orders.markFulfilled(c.req.param("orderId"), a.m.id);
    return c.redirect(`${a.base}?ok=fulfilled`, 303);
  });

  merchant.post(`${prefix}/orders/:orderId/resend`, async (c) => {
    const a = access(c);
    if (!a) return notFound(c);
    const order = orders.get(c.req.param("orderId"));
    if (!order || order.merchant_id !== a.m.id) return c.html(messagePage("Not found", "No such order."), 404);
    const ok = await deliverWebhook(order, products.getAny(order.product_id)!, a.m, 8_000);
    return c.redirect(`${a.base}?ok=${ok ? "resent" : "resend-failed"}`, 303);
  });

  // Seller copy of the receipt, including the buyer's details.
  merchant.get(`${prefix}/orders/:orderId/receipt.pdf`, async (c) => {
    const a = access(c);
    if (!a) return notFound(c);
    const order = orders.get(c.req.param("orderId"));
    if (!order || order.merchant_id !== a.m.id) return c.html(messagePage("Not found", "No such order."), 404);
    const pdf = await receiptPdf({ order, product: products.getAny(order.product_id)!, merchant: a.m, copy: "seller" });
    c.header("Cache-Control", "private, no-store");
    c.header("Content-Type", "application/pdf");
    c.header("Content-Disposition", `attachment; filename="receipt-${order.id}-seller.pdf"`);
    return c.body(new Uint8Array(pdf));
  });
}

storeRoutes("/m/:token", byLink);
storeRoutes("/account/stores/:id", byOwner);

// ---------- accounts (Privy) ----------

function safeNext(raw: string | undefined): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/account";
}

merchant.get("/login", (c) => {
  if (currentUser(c)) return c.redirect(safeNext(c.req.query("next")), 302);
  return c.html(loginPage("login", safeNext(c.req.query("next"))));
});

merchant.get("/logout", (c) => c.html(loginPage("logout", "/")));

merchant.post("/auth/session", async (c) => {
  if (!(c.req.header("content-type") ?? "").includes("application/json")) return c.json({ error: "expected JSON" }, 415);
  const body = (await c.req.json().catch(() => ({}))) as { token?: unknown };
  if (typeof body.token !== "string" || body.token.length > 4096) return c.json({ error: "missing token" }, 400);
  try {
    const user = await signIn(c, body.token);
    return c.json({ ok: true, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.warn("[auth] sign-in rejected:", err instanceof Error ? err.message : err);
    return c.json({ error: "Could not verify your sign-in. Try again." }, 401);
  }
});

merchant.post("/auth/logout", (c) => {
  signOut(c);
  return c.json({ ok: true });
});

merchant.get("/account", (c) => {
  const user = currentUser(c);
  if (!user) return c.redirect("/login?next=/account", 302);
  c.header("Cache-Control", "no-store");
  const stores = merchants.byUser(user.id).map((m) => ({ merchant: m, products: products.byMerchant(m.id), orders: orders.byMerchant(m.id) }));
  const storeById = new Map(stores.map((s) => [s.merchant.id, s]));
  const sales = orders.forMerchants(stores.map((s) => s.merchant.id)).map((order) => ({
    order,
    product: products.getAny(order.product_id),
    merchant: storeById.get(order.merchant_id)!.merchant,
  }));
  const purchases = orders.purchasesBy(user.email, user.wallet ? [user.wallet] : []).map((order) => ({
    order,
    product: products.getAny(order.product_id),
    merchant: merchants.get(order.merchant_id),
  }));
  return c.html(accountPage({ user, stores, sales, purchases }));
});
