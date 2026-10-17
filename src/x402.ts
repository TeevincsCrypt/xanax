import type { Context } from "hono";
import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import type { FacilitatorClient, HTTPAdapter, HTTPRequestContext, RouteConfig } from "@x402/core/server";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createFacilitatorConfig } from "@coinbase/x402";
import { APP_NAME, config } from "./config.js";
import { buyerBodySchema, centsToPrice, parseQty, totalCents } from "./catalog.js";
import { merchants, products, type Product } from "./db.js";
import { sha256Hex } from "./security.js";

/** Facilitator: public x402.org on testnet, Coinbase CDP on mainnet. One env var (X402_NETWORK) flips it. */
export function makeFacilitator(): FacilitatorClient {
  if (config.X402_NETWORK === "base" && !config.FACILITATOR_URL) {
    if (!config.CDP_API_KEY_ID || !config.CDP_API_KEY_SECRET) {
      throw new Error("X402_NETWORK=base needs CDP_API_KEY_ID and CDP_API_KEY_SECRET (or an explicit FACILITATOR_URL)");
    }
    return new HTTPFacilitatorClient(createFacilitatorConfig(config.CDP_API_KEY_ID, config.CDP_API_KEY_SECRET));
  }
  return new HTTPFacilitatorClient({ url: config.FACILITATOR_URL ?? "https://x402.org/facilitator" });
}

/** Reads the product id from `/buy/:id`. */
export function productIdFromPath(path: string): string | undefined {
  return /^\/buy\/([A-Za-z0-9_-]{1,64})\/?$/.exec(path)?.[1];
}

function productFor(ctx: HTTPRequestContext): Product {
  const id = productIdFromPath(ctx.path);
  const product = id ? products.get(id) : undefined;
  if (!product) throw new Error("unknown product"); // the route handler 404s before we get here
  return product;
}

function qtyFor(ctx: HTTPRequestContext): number {
  const raw = ctx.adapter.getQueryParam?.("qty");
  const parsed = parseQty(Array.isArray(raw) ? raw[0] : raw);
  if (!parsed.ok) throw new Error(parsed.error); // also pre-validated by the handler
  return parsed.qty;
}

export const RECEIPT_EXAMPLE = {
  status: "paid",
  order_id: "xnx_7k2m9q4w8e3r5t",
  merchant: "Ada's Roastery",
  item: "Single-origin coffee, 250g",
  quantity: 1,
  amount_usd: "12.00",
  currency: "USDC",
  network: "base",
  tx_hash: "0x…",
  explorer_url: "https://basescan.org/tx/0x…",
  merchant_notified: true,
  next_steps: "Ada's Roastery has your order and will contact you at the email you provided.",
  receipt_url: "https://example.com/r/xnx_7k2m9q4w8e3r5t",
};

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["paid"] },
    order_id: { type: "string" },
    merchant: { type: "string" },
    item: { type: "string" },
    quantity: { type: "integer" },
    amount_usd: { type: "string" },
    currency: { type: "string" },
    network: { type: "string" },
    tx_hash: { type: "string" },
    explorer_url: { type: "string" },
    merchant_notified: { type: "boolean" },
    next_steps: { type: "string" },
    receipt_url: { type: "string" },
    delivery: {
      type: "object",
      properties: { type: { type: "string" }, download_url: { type: "string" }, expires_at: { type: "string" } },
    },
  },
  required: ["status", "order_id", "merchant", "item", "quantity", "amount_usd", "tx_hash", "receipt_url"],
};

/** Bazaar discovery metadata for `POST /buy/:id`. Body schema lists every optional buyer field. */
export function bazaarExtension() {
  // `method` is filled in per request by bazaarResourceServerExtension (validated in tests/flow.test.ts).
  return declareDiscoveryExtension({
    bodyType: "json",
    input: { buyer: { name: "Ada Obi", email: "ada@example.com", shipping_address: "12 Admiralty Way, Lekki, Lagos" } },
    inputSchema: buyerBodySchema([]),
    pathParams: { id: "p_example" },
    pathParamsSchema: {
      type: "object",
      properties: { id: { type: "string", description: `${APP_NAME} product id from GET /api/products` } },
      required: ["id"],
    },
    output: { example: RECEIPT_EXAMPLE, schema: RECEIPT_SCHEMA },
  });
}

const DESCRIPTION =
  `${APP_NAME} checkout: buy a product from an independent merchant. ` +
  `Find products free at ${config.BASE_URL}/api/products?q=..., then POST /buy/{id}?qty=N ` +
  `with JSON {"buyer":{...}} (required fields are listed per product). Returns an order receipt. ` +
  `USDC goes straight to the merchant's wallet.`;

function routeConfig(method: "GET" | "POST"): RouteConfig {
  return {
    accepts: {
      scheme: "exact",
      network: config.network.caip2 as `${string}:${string}`,
      // Price and payee come from the URL only (path + ?qty), never the body.
      price: (ctx) => centsToPrice(totalCents(productFor(ctx).price_cents, qtyFor(ctx))),
      payTo: (ctx) => merchants.get(productFor(ctx).merchant_id)!.payout_address,
      maxTimeoutSeconds: 300,
    },
    description: DESCRIPTION,
    mimeType: "application/json",
    serviceName: APP_NAME,
    tags: ["commerce", "checkout", "shopping", "merchant"],
    unpaidResponseBody: (ctx) => ({ contentType: "application/json", body: unpaidBody(ctx) }),
    ...(method === "POST" ? { extensions: bazaarExtension() } : {}),
  };
}

function unpaidBody(ctx: HTTPRequestContext) {
  const p = productFor(ctx);
  const qty = qtyFor(ctx);
  const m = merchants.get(p.merchant_id)!;
  return {
    error: "Payment required",
    product: { id: p.id, merchant: m.business_name, name: p.name, quantity: qty, total_usd: centsToPrice(totalCents(p.price_cents, qty)).slice(1) },
    how_to_pay:
      "x402 v2: requirements are in the PAYMENT-REQUIRED header (also echoed here). With PayBox, call use_service with method POST, this URL and a JSON body.",
    body_schema: buyerBodySchema(p.required_fields),
  };
}

export function createHttpServer(facilitator: FacilitatorClient = makeFacilitator()): x402HTTPResourceServer {
  const resourceServer = new x402ResourceServer(facilitator)
    .register(config.network.caip2 as `${string}:${string}`, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);
  return new x402HTTPResourceServer(resourceServer, {
    "GET /buy/:id": routeConfig("GET"),
    "POST /buy/:id": routeConfig("POST"),
  });
}

let server: x402HTTPResourceServer | undefined;
let init: Promise<void> | null = null;

export function httpServer(): x402HTTPResourceServer {
  server ??= createHttpServer();
  return server;
}

/** Swap the facilitator (tests use a fake one). */
export function useFacilitator(facilitator: FacilitatorClient): void {
  server = createHttpServer(facilitator);
  init = null;
}

/** Sync supported kinds from the facilitator once; retried on the next request if it fails. */
export async function ensureInitialized(): Promise<void> {
  init ??= httpServer().initialize().catch((err) => {
    init = null;
    throw err;
  });
  await init;
}

/**
 * Hono → x402 adapter. Two tweaks over the stock HonoAdapter:
 * - getUrl() uses BASE_URL so the advertised resource URL is the public https one behind a proxy.
 * - a v2 payment sent as `X-PAYMENT` (the v1 header name) is accepted as well as `PAYMENT-SIGNATURE`.
 */
export class XanaxAdapter implements HTTPAdapter {
  constructor(private readonly c: Context) {}
  getHeader(name: string): string | undefined {
    const v = this.c.req.header(name);
    if (v === undefined && name.toLowerCase() === "payment-signature") return this.c.req.header("x-payment");
    return v;
  }
  getMethod() {
    return this.c.req.method;
  }
  getPath() {
    return this.c.req.path;
  }
  getUrl() {
    const u = new URL(this.c.req.url);
    return `${config.BASE_URL}${u.pathname}${u.search}`;
  }
  getAcceptHeader() {
    return this.c.req.header("accept") ?? "";
  }
  getUserAgent() {
    return this.c.req.header("user-agent") ?? "";
  }
  getQueryParams() {
    return Object.fromEntries(Object.entries(this.c.req.queries()).map(([k, v]) => [k, v.length === 1 ? v[0]! : v]));
  }
  getQueryParam(name: string) {
    const v = this.c.req.queries(name);
    if (!v || v.length === 0) return undefined;
    return v.length === 1 ? v[0] : v;
  }
  async getBody() {
    try {
      return await this.c.req.json();
    } catch {
      return undefined;
    }
  }
}

export function readPaymentHeader(adapter: HTTPAdapter): { raw?: string; payload?: PaymentPayload } {
  const raw = adapter.getHeader("payment-signature");
  if (!raw) return {};
  try {
    return { raw, payload: decodePaymentSignatureHeader(raw) };
  } catch {
    return { raw };
  }
}

/**
 * A stable idempotency key for a signed payment: the EIP-3009 / Permit2 nonce if present,
 * otherwise a hash of the signature. The same signed payment can never create two orders.
 */
export function paymentNonce(payload: PaymentPayload | undefined, raw: string | undefined): string | undefined {
  const inner = payload?.payload as Record<string, any> | undefined;
  const nonce = inner?.authorization?.nonce ?? inner?.permit2Authorization?.nonce;
  if (typeof nonce === "string" || typeof nonce === "number") return `${payload?.accepted?.network ?? "?"}:${String(nonce)}`;
  if (typeof inner?.signature === "string") return `sig:${sha256Hex(inner.signature)}`;
  return raw ? `hdr:${sha256Hex(raw)}` : undefined;
}
