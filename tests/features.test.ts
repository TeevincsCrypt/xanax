import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { FacilitatorClient } from "@x402/core/server";

vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

const { openDb, setDb, products, orders, merchants } = await import("../src/db.js");
const { useFacilitator } = await import("../src/x402.js");
const { useVerifier } = await import("../src/auth.js");
const { createApp } = await import("../src/app.js");

const NETWORK = "eip155:84532";
const MERCHANT = "0x1111111111111111111111111111111111111111";
const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);

const facilitator: FacilitatorClient = {
  async getSupported() {
    return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: ["bazaar"], signers: {} };
  },
  async verify(payload) {
    return { isValid: true, payer: (payload.payload as any).authorization.from };
  },
  async settle(payload, req) {
    const auth = (payload.payload as any).authorization;
    return { success: true, transaction: keccak256(auth.nonce), network: req.network, payer: auth.from };
  },
};

const app = createApp();
// Each test request comes from its own IP so per-IP rate limits (e.g. 10 listings / 10 min) don't trip.
let ipCounter = 0;
const req = (path: string, init?: RequestInit) => {
  const r = new Request(`https://xanax.test${path}`, init);
  if (!r.headers.has("x-forwarded-for")) r.headers.set("x-forwarded-for", `10.9.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`);
  return app.fetch(r);
};
const buyer = privateKeyToAccount(keccak256(toHex("xanax-features-buyer")));
const pay = wrapFetchWithPaymentFromConfig(((i: RequestInfo | URL, n?: RequestInit) => app.fetch(new Request(i, n))) as typeof fetch, {
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(buyer) }],
});

// Fake Privy: token "tok:<id>:<email>" verifies as that user.
useVerifier(async (token) => {
  const [, id, email] = token.split(":");
  if (!id) throw new Error("bad token");
  return { userId: `did:privy:${id}`, email: email || null, wallet: null };
});

async function login(id: string, email: string): Promise<string> {
  const res = await req("/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: `tok:${id}:${email}` }) });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!;
  expect(cookie).toMatch(/xnx_session=.*HttpOnly/i);
  return cookie.split(";")[0]!;
}

function sellForm(extra: Record<string, string | Blob> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    business_name: "Tee Studio",
    product_name: "Photo pack",
    description: "Ten photos.",
    price_usd: "0.10",
    payout_address: MERCHANT,
    email: "tee@example.com",
    kind: "digital",
  };
  for (const [k, v] of Object.entries({ ...base, ...extra })) f.append(k, v as string | Blob);
  return f;
}

beforeAll(() => {
  vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));
});

beforeEach(() => {
  setDb(openDb(":memory:"));
  useFacilitator(facilitator);
});

describe("uploads", () => {
  it("accepts an image and a digital file, and delivers the file only via the signed link", async () => {
    const form = sellForm({
      image_file: new File([PNG], "cover.png", { type: "image/png" }),
      digital_file: new File(["%PDF-1.4 fake pack"], "pack.pdf", { type: "application/pdf" }),
    });
    const res = await req("/sell", { method: "POST", body: form });
    expect(res.status).toBe(201);
    const product = products.search("Photo pack")[0]!;
    expect(product.image_url).toMatch(/^https:\/\/xanax\.test\/u\/img_/);
    expect(product.delivery_file_id).toMatch(/^f_/);

    const img = await req(new URL(product.image_url!).pathname);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    // Digital files are not public.
    expect((await req(`/u/${product.delivery_file_id}`)).status).toBe(404);

    const paid = await pay(`https://xanax.test/buy/${product.id}`, { method: "POST" });
    const receipt = await paid.json();
    const dl = new URL(receipt.delivery.download_url);
    const page = await req(`${dl.pathname}${dl.search}`);
    expect(await page.text()).toContain("pack.pdf");
    const file = await req(`${dl.pathname}/file${dl.search}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toContain('filename="pack.pdf"');
    expect(await file.text()).toBe("%PDF-1.4 fake pack");
    expect((await req(`${dl.pathname}/file?t=1.bad`)).status).toBe(403);
    expect(orders.get(receipt.order_id)!.downloaded_at).toBeTruthy();
  });

  it("rejects a non-image disguised as an image", async () => {
    const res = await req("/sell", { method: "POST", body: sellForm({ image_file: new File(["<script>"], "x.png", { type: "image/png" }), delivery_text: "hi" }) });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("PNG, JPG, GIF or WebP");
  });
});

describe("receipts", () => {
  it("serves a buyer PDF publicly and a seller PDF (with buyer details) only to the merchant", async () => {
    await req("/sell", { method: "POST", body: sellForm({ delivery_text: "hello" }) });
    const product = products.search("Photo pack")[0]!;
    const r = await (await pay(`https://xanax.test/buy/${product.id}`, { method: "POST" })).json();
    expect(r.receipt_pdf_url).toBe(`https://xanax.test/r/${r.order_id}.pdf`);
    expect(r.message).toContain(r.receipt_pdf_url);

    const pdf = await req(`/r/${r.order_id}.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    const html = await (await req(`/r/${r.order_id}`)).text();
    expect(html).toContain(`/r/${r.order_id}.pdf`);

    const ownerCookie = await login("owner", "tee@example.com");
    const m = merchants.get(product.merchant_id)!;
    merchants.claim(m.id, "did:privy:owner");
    const seller = await req(`/account/stores/${m.id}/orders/${r.order_id}/receipt.pdf`, { headers: { cookie: ownerCookie } });
    expect(seller.status).toBe(200);
    expect(seller.headers.get("content-disposition")).toContain("seller");
    const stranger = await login("stranger", "x@example.com");
    expect((await req(`/account/stores/${m.id}/orders/${r.order_id}/receipt.pdf`, { headers: { cookie: stranger } })).status).toBe(404);
  });
});

describe("accounts", () => {
  it("saves listings made while signed in, and shows sales and purchases", async () => {
    const cookie = await login("tee", "tee@example.com");
    const res = await req("/sell", { method: "POST", body: sellForm({ delivery_text: "hello" }), headers: { cookie } });
    expect(res.status).toBe(201);
    expect(await res.text()).toContain("Saved to your account");
    const product = products.search("Photo pack")[0]!;
    expect(merchants.get(product.merchant_id)!.user_id).toBe("did:privy:tee");

    // A purchase by a buyer who used the same email shows up under Purchases.
    await pay(`https://xanax.test/buy/${product.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buyer: { email: "tee@example.com" } }),
    });
    const account = await (await req("/account", { headers: { cookie } })).text();
    expect(account).toContain("Tee Studio");
    expect(account).toContain("Sold 1");
    expect(account).toContain("Bought 1");

    const dash = await req(`/account/stores/${product.merchant_id}`, { headers: { cookie } });
    expect(dash.status).toBe(200);
    expect(await dash.text()).toContain("Receipt PDF");
  });

  it("lets a signed-in user claim a store from its private link, once", async () => {
    const res = await req("/sell", { method: "POST", body: sellForm({ delivery_text: "hello" }) });
    const dashPath = /https:\/\/xanax\.test(\/m\/[A-Za-z0-9_-]+)/.exec(await res.text())![1]!;
    const a = await login("a", "a@example.com");
    expect(await (await req(dashPath, { headers: { cookie: a } })).text()).toContain("Save to my account");
    const claim = await req(`${dashPath}/claim`, { method: "POST", headers: { cookie: a } });
    expect(claim.status).toBe(303);
    const b = await login("b", "b@example.com");
    expect((await req(`${dashPath}/claim`, { method: "POST", headers: { cookie: b } })).status).toBe(409);
  });

  it("requires sign-in for /account and rejects bad tokens", async () => {
    const res = await req("/account");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?next=/account");
    const bad = await req("/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "nope" }) });
    expect(bad.status).toBe(401);
    const cookie = await login("x", "x@example.com");
    await req("/auth/logout", { method: "POST", headers: { cookie } });
    expect((await req("/account", { headers: { cookie } })).status).toBe(302);
  });
});

describe("digital delivery safety net", () => {
  it("treats a listing with content to deliver as digital even if the radio was left on physical", async () => {
    const res = await req("/sell", { method: "POST", body: sellForm({ kind: "physical", delivery_text: "the goods" }) });
    expect(res.status).toBe(201);
    const product = products.search("Photo pack")[0]!;
    expect(product.kind).toBe("digital");
    const r = await (await pay(`https://xanax.test/buy/${product.id}`, { method: "POST" })).json();
    expect(r.delivery.download_url).toBeTruthy();
    const cookie = await login("tee", "tee@example.com");
    merchants.claim(product.merchant_id, "did:privy:tee");
    expect(await (await req(`/account/stores/${product.merchant_id}`, { headers: { cookie } })).text()).toContain("Copy download link");
  });
});

describe("find my order (no account)", () => {
  it("returns the download and receipt for order ID + checkout email or paying wallet, and nothing otherwise", async () => {
    await req("/sell", { method: "POST", body: sellForm({ delivery_text: "the goods" }) });
    const product = products.search("Photo pack")[0]!;
    const r = await (
      await pay(`https://xanax.test/buy/${product.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ buyer: { email: "Buyer@Example.com" } }) })
    ).json();
    const find = (order: string, contact: string) =>
      req("/find", { method: "POST", body: new URLSearchParams({ order, contact }), headers: { "content-type": "application/x-www-form-urlencoded" } });

    const byEmail = await find(r.order_id, "buyer@example.com");
    expect(byEmail.status).toBe(200);
    const html = await byEmail.text();
    expect(html).toContain("Download your product");
    expect(html).toContain(`/r/${r.order_id}.pdf`);

    expect((await find(r.order_id, buyer.address)).status).toBe(200);
    expect((await find(r.order_id, "someone@else.com")).status).toBe(404);
    expect((await find("xnx_doesnotexist1", "buyer@example.com")).status).toBe(404);
  });

  it("asks the agent to show the links in the buyer prompt", async () => {
    const res = await req("/sell", { method: "POST", body: sellForm({ delivery_text: "the goods" }) });
    expect(await res.text()).toContain("including the download link and the receipt link");
  });
});

describe("human product page", () => {
  it("shows browsers a product page at the agent URL and /p/:id, while agents still get the 402", async () => {
    await req("/sell", { method: "POST", body: sellForm({ delivery_text: "the goods" }) });
    const product = products.search("Photo pack")[0]!;
    const browser = { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (iPhone)" };

    const page = await req(`/buy/${product.id}`, { headers: browser });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Buy it with your AI");
    expect(html).toContain("get_request");
    expect(html).not.toContain("@x402/paywall");

    expect((await req(`/p/${product.id}`, { headers: browser })).status).toBe(200);
    expect((await req(`/buy/${product.id}`)).status).toBe(402);
    expect((await req(`/buy/${product.id}`, { method: "POST", headers: browser })).status).toBe(402);
  });
});

describe("selling requires an account", () => {
  it("sends signed-out visitors to sign in, and lets signed-in sellers list", async () => {
    const { config } = await import("../src/config.js");
    const before = config.authEnabled;
    (config as { authEnabled: boolean }).authEnabled = true;
    try {
      const get = await req("/sell");
      expect(get.status).toBe(303);
      expect(get.headers.get("location")).toBe("/login?next=/sell");
      const post = await req("/sell", { method: "POST", body: sellForm({ delivery_text: "x" }) });
      expect(post.status).toBe(303);
      expect(products.search("Photo pack")).toHaveLength(0);

      const cookie = await login("seller", "seller@example.com");
      expect((await req("/sell", { headers: { cookie } })).status).toBe(200);
      const ok = await req("/sell", { method: "POST", body: sellForm({ delivery_text: "x" }), headers: { cookie } });
      expect(ok.status).toBe(201);
      expect(merchants.get(products.search("Photo pack")[0]!.merchant_id)!.user_id).toBe("did:privy:seller");
    } finally {
      (config as { authEnabled: boolean }).authEnabled = before;
    }
  });
});

describe("marketplace", () => {
  it("shows every live listing to signed-in users and personalises the buy prompt", async () => {
    const { config } = await import("../src/config.js");
    const before = config.authEnabled;
    (config as { authEnabled: boolean }).authEnabled = true;
    try {
      const sellerA = await login("sa", "a@example.com");
      const sellerB = await login("sb", "b@example.com");
      await req("/sell", { method: "POST", body: sellForm({ business_name: "Shop A", product_name: "Alpha guide", delivery_text: "a" }), headers: { cookie: sellerA } });
      await req("/sell", { method: "POST", body: sellForm({ business_name: "Shop B", product_name: "Beta pack", delivery_text: "b" }), headers: { cookie: sellerB } });

      expect((await req("/market")).status).toBe(302); // signed out → sign in

      const buyerCookie = await login("buyer", "buyer@example.com");
      const market = await (await req("/market", { headers: { cookie: buyerCookie } })).text();
      expect(market).toContain("Alpha guide");
      expect(market).toContain("Beta pack");
      const filtered = await (await req("/market?q=beta", { headers: { cookie: buyerCookie } })).text();
      expect(filtered).toContain("Beta pack");
      expect(filtered).not.toContain("Alpha guide");
      expect(await (await req("/market", { headers: { cookie: sellerA } })).text()).toContain("Your listing");

      const alpha = products.search("Alpha guide")[0]!;
      const page = await (await req(`/p/${alpha.id}`, { headers: { cookie: buyerCookie } })).text();
      expect(page).toContain("my email buyer@example.com as buyer.email");
      expect(page).toContain("Account → Purchases");
      // Signed out: generic prompt plus a nudge to sign in.
      const anon = await (await req(`/p/${alpha.id}`)).text();
      expect(anon).not.toContain("buyer@example.com");
      expect(anon).toContain("Sign in");
    } finally {
      (config as { authEnabled: boolean }).authEnabled = before;
    }
  });
});
