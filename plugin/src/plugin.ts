// Xanax as a PayBox plugin: agents search small-business listings and buy them over x402.
// The plugin never signs or moves money. buy_product returns an unsigned x402 proposal; PayBox
// shows it to the user, gets approval, pays USDC on Base straight to the merchant's wallet and
// hands the merchant's receipt (order ID, tx hash, download link) back to the agent.
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { BUYER_FIELDS, getProduct, searchProducts, XanaxError, type Product } from "./xanax.js";
import { proposeX402, usdcAtomic, x402OutputSchema } from "./paybox.js";

const PROTOCOL_VERSION = "2026-07-28";
const NAME = "xanax";
const VERSION = "1.0.0";

const productId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, "Use the product id from search_products, for example \"p_ab12cd34\".");
const usd = z.string().trim().regex(/^(0|[1-9][0-9]{0,5})(\.[0-9]{1,2})?$/, "Use a plain USD amount such as \"5\" or \"12.50\".");

const summarySchema = z.object({
  id: z.string(),
  name: z.string(),
  merchant: z.string(),
  description: z.string(),
  type: z.string(),
  price_usd: z.string(),
  in_stock: z.boolean(),
  required_buyer_fields: z.array(z.string()),
  product_page: z.string(),
}).strict();

function summary(p: Product) {
  return {
    id: p.id,
    name: p.name,
    merchant: p.merchant,
    description: p.description,
    type: p.type,
    price_usd: p.price_usd,
    in_stock: p.in_stock,
    required_buyer_fields: p.buy.required_buyer_fields,
    product_page: p.product_page,
  };
}

function line(p: Product) {
  const stock = p.in_stock ? "" : " (sold out)";
  const needs = p.buy.required_buyer_fields.length ? ` Needs: ${p.buy.required_buyer_fields.join(", ")}.` : "";
  return `- ${p.name} by ${p.merchant}: $${p.price_usd} USDC, ${p.type}${stock}. id ${p.id}.${needs}`;
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function failure(err: unknown) {
  if (err instanceof XanaxError) return errorResult(err.message);
  const message = err instanceof Error ? err.message : String(err);
  return errorResult(`Xanax could not complete this request: ${message}`);
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function registerSearch(server: McpServer) {
  server.registerTool("search_products", {
    title: "Search Xanax products",
    description: "Find products sold by small businesses on Xanax: digital goods (courses, guides, files) delivered instantly, and physical goods. Leave query empty to list everything for sale. Free; nothing is paid.",
    inputSchema: z.object({
      query: z.string().trim().max(100).describe("Keywords, for example \"beat making\" or \"coffee\". Empty lists all products."),
      max_results: z.number().int().min(1).max(20).optional().describe("How many products to return (default 10)."),
    }).strict(),
    outputSchema: z.object({ count: z.number().int(), products: z.array(summarySchema) }).strict(),
    annotations: readOnly,
  }, async ({ query, max_results }) => {
    try {
      const found = (await searchProducts(query)).slice(0, max_results ?? 10);
      const text = found.length
        ? `${found.length} product${found.length === 1 ? "" : "s"} on Xanax:\n${found.map(line).join("\n")}\nTo buy one, call buy_product with its id.`
        : `No products on Xanax match "${query}". Try fewer keywords, or an empty query to list everything.`;
      return { content: [{ type: "text" as const, text }], structuredContent: { count: found.length, products: found.map(summary) } };
    } catch (err) {
      return failure(err);
    }
  });
}

function registerGet(server: McpServer) {
  server.registerTool("get_product", {
    title: "Get a Xanax product",
    description: "Full details of one Xanax product: price, stock, what the merchant needs from the buyer (for example a shipping address) and the product page link. Free; nothing is paid.",
    inputSchema: z.object({ product_id: productId }).strict(),
    outputSchema: summarySchema.extend({ stock: z.number().int().nullable(), image_url: z.string().nullable(), network: z.string() }).strict(),
    annotations: readOnly,
  }, async ({ product_id }) => {
    try {
      const p = await getProduct(product_id);
      const text = [
        `${p.name} by ${p.merchant}: $${p.price_usd} USDC on ${p.network === "base" ? "Base" : p.network}.`,
        p.description,
        p.in_stock ? (p.stock === null ? "In stock." : `${p.stock} left.`) : "Sold out.",
        p.buy.required_buyer_fields.length ? `The merchant needs: ${p.buy.required_buyer_fields.join(", ")}.` : "No buyer details needed.",
        p.type === "digital" ? "Digital: delivered instantly after payment as a download link." : "Physical: the merchant is notified and fulfils the order.",
        `Product page: ${p.product_page}`,
      ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { ...summary(p), stock: p.stock, image_url: p.image_url, network: p.network },
      };
    } catch (err) {
      return failure(err);
    }
  });
}

const buyerSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.email().max(200).optional(),
  phone: z.string().trim().min(5).max(40).optional(),
  shipping_address: z.string().trim().min(5).max(500).optional(),
  note: z.string().trim().max(500).optional(),
}).strict();

function registerBuy(server: McpServer) {
  server.registerTool("buy_product", {
    title: "Buy a Xanax product",
    description: "Buy a product from a Xanax merchant with USDC on Base. Checks the live price, stock and required buyer details, refuses totals above max_price_usd, then returns an unsigned x402 payment for PayBox. The user approves it in PayBox; the USDC goes straight to the merchant's wallet. The paid response is the merchant's receipt: order ID, transaction hash, PDF receipt and, for digital products, the download link. Show all of it to the user.",
    inputSchema: z.object({
      product_id: productId,
      quantity: z.number().int().min(1).max(10).optional().describe("How many to buy (default 1)."),
      max_price_usd: usd.describe("The most the user agreed to pay in total, in USD (USDC). The tool refuses if the live total is higher."),
      buyer: buyerSchema.optional().describe("Buyer details. Include every field listed in the product's required_buyer_fields; only those are sent to the merchant."),
    }).strict(),
    outputSchema: x402OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ product_id, quantity = 1, max_price_usd, buyer = {} }) => {
    try {
      const p = await getProduct(product_id);
      if (!p.in_stock) throw new XanaxError(`${p.name} is sold out. Nothing was charged.`);
      if (p.stock !== null && p.stock < quantity) throw new XanaxError(`Only ${p.stock} of ${p.name} left. Lower the quantity.`);
      if (p.network !== "base") throw new XanaxError(`This Xanax server takes payment on ${p.network}, which PayBox plugins cannot pay. Nothing was charged.`);

      const missing = p.buy.required_buyer_fields.filter((f) => !buyer[f as keyof typeof buyer]);
      if (missing.length) {
        throw new XanaxError(`${p.merchant} needs these buyer details before payment: ${missing.join(", ")}. Ask the user, then call buy_product again with them in buyer.`);
      }

      const total = BigInt(usdcAtomic(p.price_usd)) * BigInt(quantity);
      if (total > BigInt(usdcAtomic(max_price_usd))) {
        throw new XanaxError(`The total is $${formatUsdc(total)} USDC, above the $${max_price_usd} the user agreed to. Nothing was charged.`);
      }

      // Send only the fields the merchant asks for.
      const sent = Object.fromEntries(BUYER_FIELDS.filter((f) => p.buy.required_buyer_fields.includes(f) && buyer[f]).map((f) => [f, buyer[f]!]));
      const url = new URL(p.buy.url);
      if (quantity > 1) url.searchParams.set("qty", String(quantity));
      const proposal = proposeX402({
        url: url.toString(),
        method: "POST",
        ...(Object.keys(sent).length ? { body: { buyer: sent } } : {}),
        maxAmount: total.toString(),
      });
      const text = `Ready to pay $${formatUsdc(total)} USDC on Base to ${p.merchant} for ${quantity} x ${p.name}. PayBox will ask the user to approve; the USDC goes straight to the merchant's wallet. After payment, relay the receipt: order ID, transaction link, receipt PDF${p.type === "digital" ? " and the download link" : ""}.`;
      return { ...proposal, content: [{ type: "text" as const, text }] };
    } catch (err) {
      return failure(err);
    }
  });
}

function formatUsdc(atomic: bigint) {
  const whole = atomic / 1_000_000n;
  const cents = (atomic % 1_000_000n) / 10_000n;
  return `${whole}.${cents.toString().padStart(2, "0")}`;
}

function createServer() {
  const server = new McpServer({ name: NAME, version: VERSION }, { supportedProtocolVersions: [PROTOCOL_VERSION] });
  registerSearch(server);
  registerGet(server);
  registerBuy(server);
  return server;
}

serveStdio(createServer, { legacy: "reject" });
