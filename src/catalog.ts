import { z } from "zod";
import { config } from "./config.js";
import { BUYER_FIELDS, type BuyerField, type Product } from "./db.js";

/**
 * Parse `qty` from the query string. Price depends only on path + query, never on the body,
 * because PayBox's use_service probes the URL without the body before paying.
 */
export function parseQty(raw: string | undefined | null, max = config.MAX_QTY): { ok: true; qty: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, qty: 1 };
  if (!/^\d+$/.test(raw)) return { ok: false, error: "qty must be a whole number" };
  const qty = Number(raw);
  if (qty < 1) return { ok: false, error: "qty must be at least 1" };
  if (qty > max) return { ok: false, error: `qty must be at most ${max}` };
  return { ok: true, qty };
}

export function totalCents(unitCents: number, qty: number): number {
  return unitCents * qty;
}

/** "$12.50" — exact decimal string from integer cents, the format x402's Money parser expects. */
export function centsToPrice(cents: number): string {
  return `$${formatUsd(cents)}`;
}

export function formatUsd(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Parse a user-entered USD amount like "12", "12.5" or "$12.50" into integer cents. */
export function parseUsdToCents(input: string): number | null {
  const m = /^\s*\$?\s*(\d{1,6})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

const FIELD_SCHEMAS: Record<BuyerField, z.ZodString> = {
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().regex(/^[+()\d\s.-]{5,32}$/, "invalid phone number"),
  shipping_address: z.string().trim().min(5).max(500),
  note: z.string().trim().max(1000),
};

const FIELD_DESCRIPTIONS: Record<BuyerField, string> = {
  name: "Buyer's full name",
  email: "Buyer's email address, for order updates",
  phone: "Buyer's phone number, with country code",
  shipping_address: "Full shipping address, including city and country",
  note: "Free-text note to the merchant",
};

export type BuyerValidation = { ok: true; buyer: Record<string, string> } | { ok: false; error: string; missing: string[] };

/**
 * Validate the paid request's body: `{ buyer: { name?, email?, phone?, shipping_address?, note? } }`.
 * Required fields are per product. Unknown fields are dropped. A missing body is fine when
 * nothing is required.
 */
export function validateBuyer(product: Pick<Product, "required_fields">, body: unknown): BuyerValidation {
  const raw = body && typeof body === "object" && "buyer" in body ? (body as { buyer: unknown }).buyer : undefined;
  const input: Record<string, unknown> = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const missing = product.required_fields.filter((f) => {
    const v = input[f];
    return typeof v !== "string" || v.trim() === "";
  });
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      error: `Missing required buyer field(s): ${missing.join(", ")}. Send them as JSON: {"buyer": {${missing.map((f) => `"${f}": "..."`).join(", ")}}}. You have not been charged.`,
    };
  }

  const buyer: Record<string, string> = {};
  for (const field of BUYER_FIELDS) {
    const v = input[field];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) continue;
    const parsed = FIELD_SCHEMAS[field].safeParse(v);
    if (!parsed.success) {
      return {
        ok: false,
        missing: [],
        error: `Invalid buyer.${field}: ${parsed.error.issues[0]?.message ?? "invalid"}. You have not been charged.`,
      };
    }
    buyer[field] = parsed.data;
  }
  return { ok: true, buyer };
}

/** JSON Schema of the POST body for a product (strict draft 2020-12 compatible). */
export function buyerBodySchema(required: readonly BuyerField[]): Record<string, unknown> {
  const properties = Object.fromEntries(
    BUYER_FIELDS.map((f) => [f, { type: "string", description: FIELD_DESCRIPTIONS[f] + (required.includes(f) ? " (required)" : "") }]),
  );
  const buyer: Record<string, unknown> = { type: "object", properties, additionalProperties: false };
  if (required.length > 0) buyer.required = [...required];
  const schema: Record<string, unknown> = { type: "object", properties: { buyer } };
  if (required.length > 0) schema.required = ["buyer"];
  return schema;
}

export function buyUrl(productId: string, qty?: number): string {
  return `${config.BASE_URL}/buy/${productId}${qty && qty > 1 ? `?qty=${qty}` : ""}`;
}

/** Agent-facing JSON shape for a product (free search + detail endpoints). */
export function productJson(p: Product, businessName: string) {
  const soldOut = p.stock !== null && p.stock <= 0;
  return {
    id: p.id,
    merchant: businessName,
    name: p.name,
    description: p.description,
    type: p.kind,
    price_usd: formatUsd(p.price_cents),
    currency: "USDC",
    network: config.network.label,
    in_stock: !soldOut,
    stock: p.stock,
    image_url: p.image_url,
    buy: {
      method: "POST",
      url: buyUrl(p.id),
      quantity: `Add ?qty=N (1-${config.MAX_QTY}) to buy more than one; total = price_usd x qty.`,
      payment: "x402 (HTTP 402). With PayBox: use_service with method POST, this url, and the body below.",
      required_buyer_fields: p.required_fields,
      body_schema: buyerBodySchema(p.required_fields),
      body_example: { buyer: Object.fromEntries(p.required_fields.map((f) => [f, exampleFor(f)])) },
    },
    product_url: `${config.BASE_URL}/api/products/${p.id}`,
  };
}

function exampleFor(f: BuyerField): string {
  return {
    name: "Ada Obi",
    email: "ada@example.com",
    phone: "+234 801 234 5678",
    shipping_address: "12 Admiralty Way, Lekki, Lagos, Nigeria",
    note: "Please ring the bell",
  }[f];
}
