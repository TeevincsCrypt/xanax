import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import { validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { verifyWebhook } from "../src/security.js";

// Webhook hosts resolve to a public IP without real DNS.
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

const { openDb, setDb, products, orders } = await import("../src/db.js");
const { createListing } = await import("../src/listing.js");
const { useFacilitator } = await import("../src/x402.js");
const { createApp } = await import("../src/app.js");

const NETWORK = "eip155:84532";
const MERCHANT = "0x1111111111111111111111111111111111111111";

/** A facilitator that checks amounts/payee and fakes on-chain settlement. */
function fakeFacilitator() {
  const used = new Set<string>();
  const calls = { verify: 0, settle: 0 };
  const client: FacilitatorClient = {
    async getSupported() {
      return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: ["bazaar"], signers: {} };
    },
    async verify(payload, req) {
      calls.verify++;
      const auth = (payload.payload as any).authorization;
      const ok = auth.to.toLowerCase() === req.payTo.toLowerCase() && BigInt(auth.value) === BigInt(req.amount);
      return ok ? { isValid: true, payer: auth.from } : { isValid: false, invalidReason: "invalid_exact_evm_payload_recipient_mismatch" };
    },
    async settle(payload, req) {
      calls.settle++;
      const auth = (payload.payload as any).authorization;
      if (used.has(auth.nonce)) {
        return { success: false, errorReason: "invalid_exact_evm_payload_authorization_nonce_used", transaction: "", network: req.network };
      }
      used.add(auth.nonce);
      return { success: true, transaction: keccak256(auth.nonce), network: req.network, payer: auth.from };
    },
  };
  return { client, calls };
}

const app = createApp();
const appFetch = (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init));

const buyer = privateKeyToAccount(keccak256(toHex("xanax-test-buyer")));
let lastPaymentHeader: string | undefined;
const recordingFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const h = req.headers.get("payment-signature");
  if (h) lastPaymentHeader = h;
  return app.fetch(req);
};
const payingFetch = wrapFetchWithPaymentFromConfig(recordingFetch as typeof fetch, {
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(buyer) }],
});

let fac: ReturnType<typeof fakeFacilitator>;
let coffeeId: string;
let webhookSecret: string;
let dashboardToken: string;
const webhooks: Array<{ headers: Headers; body: string }> = [];

beforeAll(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    webhooks.push({ headers: req.headers, body: await req.text() });
    return new Response("ok", { status: 200 });
  });
});

beforeEach(async () => {
  setDb(openDb(":memory:"));
  fac = fakeFacilitator();
  useFacilitator(fac.client);
  webhooks.length = 0;
  const res = await createListing({
    business_name: "Ada's Roastery",
    product_name: "Single-origin coffee, 250g",
    description: "Freshly roasted.",
    price_usd: "0.50",
    payout_address: MERCHANT,
    webhook_url: "https://hooks.example.com/orders",
    stock: "5",
    required_fields: ["name", "email", "shipping_address"],
  });
  if (!res.ok) throw new Error(res.errors.join(","));
  coffeeId = res.listing.product.id;
  webhookSecret = res.listing.webhookSecret;
  dashboardToken = res.listing.dashboardToken;
});

const BUYER_BODY = { buyer: { name: "Ada Obi", email: "ada@example.com", shipping_address: "12 Admiralty Way, Lekki, Lagos" } };

describe("x402 buy flow", () => {
  it("answers an unpaid probe (no body) with a 402 priced from path + query", async () => {
    const res = await appFetch(`https://xanax.test/buy/${coffeeId}?qty=3`, { method: "POST" });
    expect(res.status).toBe(402);
    const pr = decodePaymentRequiredHeader(res.headers.get("payment-required")!);
    expect(pr.x402Version).toBe(2);
    expect(pr.accepts[0]).toMatchObject({ scheme: "exact", network: NETWORK, amount: "1500000", payTo: MERCHANT });
    expect(pr.accepts[0]!.asset.toLowerCase()).toBe("0x036cbd53842c5426634e7929541ec2318f3dcf7e");
    expect(pr.resource.url).toBe(`https://xanax.test/buy/${coffeeId}?qty=3`);
    const bazaar = (pr.extensions as any)?.bazaar;
    expect(bazaar.info.input.method).toBe("POST");
    expect(validateDiscoveryExtension(bazaar).valid).toBe(true);
    const body = await res.json();
    expect(body.accepts).toEqual(pr.accepts);
    expect(body.product.total_usd).toBe("1.50");
    expect(fac.calls.verify).toBe(0);
  });

  it("GET probe works too", async () => {
    const res = await appFetch(`https://xanax.test/buy/${coffeeId}`);
    expect(res.status).toBe(402);
  });

  it("pays, settles, creates one order, notifies the merchant, and returns a receipt", async () => {
    const res = await payingFetch(`https://xanax.test/buy/${coffeeId}?qty=2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BUYER_BODY),
    });
    expect(res.status).toBe(200);
    const receipt = await res.json();
    expect(receipt).toMatchObject({
      status: "paid",
      merchant: "Ada's Roastery",
      item: "Single-origin coffee, 250g",
      quantity: 2,
      amount_usd: "1.00",
      currency: "USDC",
      network: "base-sepolia",
      merchant_notified: true,
    });
    expect(receipt.order_id).toMatch(/^xnx_/);
    expect(receipt.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(receipt.explorer_url).toBe(`https://sepolia.basescan.org/tx/${receipt.tx_hash}`);
    expect(receipt.next_steps).toMatch(/email you provided/);
    expect(decodePaymentResponseHeader(res.headers.get("payment-response")!).transaction).toBe(receipt.tx_hash);

    expect(fac.calls.settle).toBe(1);
    expect(products.get(coffeeId)!.stock).toBe(3);
    const order = orders.get(receipt.order_id)!;
    expect(order.buyer).toEqual(BUYER_BODY.buyer);
    expect(order.payer_address?.toLowerCase()).toBe(buyer.address.toLowerCase());
    expect(order.webhook_status).toBe("delivered");

    expect(webhooks).toHaveLength(1);
    const wh = webhooks[0]!;
    const ts = Number(wh.headers.get("x-xanax-timestamp"));
    expect(verifyWebhook(webhookSecret, ts, wh.body, wh.headers.get("x-xanax-signature")!)).toBe(true);
    const payload = JSON.parse(wh.body);
    expect(payload).toMatchObject({ event: "order.paid", order: { id: receipt.order_id, quantity: 2, amount_usd: "1.00", buyer: BUYER_BODY.buyer } });
  });

  it("rejects a paid request with missing buyer fields BEFORE settling (no charge)", async () => {
    const res = await payingFetch(`https://xanax.test/buy/${coffeeId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buyer: { name: "Ada" } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.charged).toBe(false);
    expect(body.missing_fields).toEqual(["email", "shipping_address"]);
    expect(fac.calls.verify).toBe(0);
    expect(fac.calls.settle).toBe(0);
    expect(products.get(coffeeId)!.stock).toBe(5);
  });

  it("is idempotent: replaying the same payment returns the same order, no second settle", async () => {
    const first = await payingFetch(`https://xanax.test/buy/${coffeeId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BUYER_BODY),
    });
    const r1 = await first.json();
    expect(lastPaymentHeader).toBeTruthy();

    const replay = await appFetch(`https://xanax.test/buy/${coffeeId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": lastPaymentHeader! },
      body: JSON.stringify(BUYER_BODY),
    });
    expect(replay.status).toBe(200);
    const r2 = await replay.json();
    expect(r2.order_id).toBe(r1.order_id);
    expect(fac.calls.settle).toBe(1);
    expect(webhooks).toHaveLength(1);
    expect(products.get(coffeeId)!.stock).toBe(4);
  });

  it("accepts a v2 payment sent in the X-PAYMENT header too", async () => {
    const renaming = (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const h = req.headers.get("payment-signature");
      if (h) {
        req.headers.delete("payment-signature");
        req.headers.set("x-payment", h);
      }
      return app.fetch(req);
    };
    const pay = wrapFetchWithPaymentFromConfig(renaming as typeof fetch, { schemes: [{ network: NETWORK, client: new ExactEvmScheme(buyer) }] });
    const res = await pay(`https://xanax.test/buy/${coffeeId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(BUYER_BODY) });
    expect(res.status).toBe(200);
    expect(fac.calls.settle).toBe(1);
  });

  it("returns 409 (not 402) when sold out", async () => {
    const p = products.get(coffeeId)!;
    products.reserveStock(p.id, 5);
    const res = await appFetch(`https://xanax.test/buy/${coffeeId}`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Sold out/);
  });

  it("rejects bad qty and unknown products without a 402", async () => {
    expect((await appFetch(`https://xanax.test/buy/${coffeeId}?qty=50`, { method: "POST" })).status).toBe(400);
    expect((await appFetch(`https://xanax.test/buy/p_nope`, { method: "POST" })).status).toBe(404);
  });

  it("delivers digital products instantly via a signed link", async () => {
    const res0 = await createListing({
      business_name: "Ada's Roastery",
      product_name: "Lagos street-food guide",
      description: "Guide",
      price_usd: "0.10",
      payout_address: MERCHANT,
      email: "m@example.com",
      kind: "digital",
      delivery_text: "1. Suya\n2. Boli",
    });
    if (!res0.ok) throw new Error("listing");
    const id = res0.listing.product.id;
    const res = await payingFetch(`https://xanax.test/buy/${id}`, { method: "POST" });
    expect(res.status).toBe(200);
    const receipt = await res.json();
    expect(receipt.delivery.type).toBe("download");
    expect(receipt.message).toContain(receipt.delivery.download_url);
    expect(orders.get(receipt.order_id)!.downloaded_at).toBeNull();
    const url = new URL(receipt.delivery.download_url);
    const page = await appFetch(`https://xanax.test${url.pathname}${url.search}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Suya");
    expect(orders.get(receipt.order_id)!.downloaded_at).toBeTruthy();
    const bad = await appFetch(`https://xanax.test${url.pathname}?t=1.bad`);
    expect(bad.status).toBe(403);
  });
});

describe("merchant + agent pages", () => {
  it("lists products for agents with a body schema", async () => {
    const res = await appFetch("https://xanax.test/api/products?q=coffee");
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.products[0]).toMatchObject({ id: coffeeId, merchant: "Ada's Roastery", price_usd: "0.50", in_stock: true });
    expect(body.products[0].buy.url).toBe(`https://xanax.test/buy/${coffeeId}`);
    expect(body.products[0].buy.required_buyer_fields).toEqual(["name", "email", "shipping_address"]);
  });

  it("creates a listing from the /sell form and shows a working dashboard", async () => {
    const form = new URLSearchParams({
      business_name: "Tolu's <b>Bakery</b>",
      product_name: "Chin chin, 500g",
      description: "Crunchy.",
      price_usd: "3",
      payout_address: MERCHANT.toLowerCase(),
      email: "tolu@example.com",
      kind: "physical",
    });
    form.append("required_fields", "name");
    form.append("required_fields", "phone");
    const res = await appFetch("https://xanax.test/sell", { method: "POST", body: form, headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(res.status).toBe(201);
    const page = await res.text();
    expect(page).not.toContain("<b>Bakery</b>");
    const dash = /https:\/\/xanax\.test(\/m\/[A-Za-z0-9_-]+)/.exec(page)![1]!;
    const d = await appFetch(`https://xanax.test${dash}`);
    expect(d.status).toBe(200);
    expect(await d.text()).toContain("Chin chin, 500g");
    expect((await appFetch("https://xanax.test/m/not-a-real-token-at-all-xxxxx")).status).toBe(404);
  });

  it("rejects invalid listings with useful errors", async () => {
    const form = new URLSearchParams({ business_name: "X", product_name: "Y", description: "Z", price_usd: "0", payout_address: "0x123", webhook_url: "http://insecure.example.com" });
    const res = await appFetch("https://xanax.test/sell", { method: "POST", body: form, headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("at least $0.01");
    expect(html).toContain("valid Base");
    expect(html).toContain("https://");
  });

  it("dashboard can mark orders fulfilled", async () => {
    const r = await (await payingFetch(`https://xanax.test/buy/${coffeeId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(BUYER_BODY) })).json();
    const res = await appFetch(`https://xanax.test/m/${dashboardToken}/orders/${r.order_id}/fulfil`, { method: "POST" });
    expect(res.status).toBe(303);
    expect(orders.get(r.order_id)!.status).toBe("fulfilled");
    const receipt = await appFetch(`https://xanax.test/r/${r.order_id}`);
    const html = await receipt.text();
    expect(html).toContain("Fulfilled");
    expect(html).not.toContain("ada@example.com"); // no buyer PII on public receipts
  });

  it("serves llms.txt and the x402 discovery document", async () => {
    const t = await (await appFetch("https://xanax.test/llms.txt")).text();
    expect(t).toContain("use_service");
    expect(t).toContain(`/buy/${coffeeId}`);
    const w = await (await appFetch("https://xanax.test/.well-known/x402")).json();
    expect(w.resources).toContain(`https://xanax.test/buy/${coffeeId}`);
  });
});

describe("admin unseed", () => {
  it("takes demo products off sale but keeps their orders and receipts", async () => {
    const { seedDemo } = await import("../src/seed.js");
    process.env.ADMIN_TOKEN = "";
    const seeded = await seedDemo(MERCHANT);
    const guide = "p_lagosguide";
    const paid = await payingFetch(`https://xanax.test/buy/${guide}`, { method: "POST" });
    const receipt = await paid.json();
    expect(receipt.status, JSON.stringify(receipt).slice(0, 300)).toBe("paid");

    const { unseedDemo } = await import("../src/seed.js");
    const res = unseedDemo();
    expect(res.removed.map((p) => p.id).sort()).toEqual(seeded.products.map((p) => p.id).sort());

    expect((await appFetch(`https://xanax.test/buy/${guide}`, { method: "POST" })).status).toBe(404);
    const list = await (await appFetch("https://xanax.test/api/products")).json();
    expect(list.products.map((p: any) => p.id)).not.toContain(guide);
    expect((await appFetch(`https://xanax.test/r/${receipt.order_id}`)).status).toBe(200);
    expect(unseedDemo().removed).toEqual([]); // idempotent
  });
});
