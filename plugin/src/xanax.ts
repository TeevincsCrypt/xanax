// Read-only client for the public Xanax catalog API.
export const BASE_URL = (process.env.XANAX_BASE_URL || "https://xanax-production.up.railway.app").replace(/\/+$/, "");
export const BUYER_FIELDS = ["name", "email", "phone", "shipping_address", "note"] as const;

const TIMEOUT_MS = 7_000;
const MAX_BYTES = 512 * 1024;

export class XanaxError extends Error {}

export interface Product {
  id: string;
  merchant: string;
  name: string;
  description: string;
  type: string;
  price_usd: string;
  network: string;
  in_stock: boolean;
  stock: number | null;
  image_url: string | null;
  product_page: string;
  buy: { url: string; required_buyer_fields: string[] };
}

async function getJson(path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new XanaxError("Xanax did not answer in time. Try again in a moment.");
  }
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new XanaxError("Xanax returned an unexpectedly large response.");
  if (res.status === 404) throw new XanaxError("No Xanax product with that id. Use search_products to find one.");
  if (res.status === 429) throw new XanaxError("Xanax is rate limiting requests. Wait a minute and try again.");
  if (!res.ok) throw new XanaxError(`Xanax returned HTTP ${res.status}.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new XanaxError("Xanax returned a response that is not JSON.");
  }
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Validates one product from the API and pins its buy URL to this Xanax server. */
export function toProduct(raw: unknown): Product {
  const r = (raw ?? {}) as Record<string, unknown>;
  const buy = (r.buy ?? {}) as Record<string, unknown>;
  const id = str(r.id);
  const price = str(r.price_usd);
  const buyUrl = str(buy.url);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !/^\d+(\.\d{1,2})?$/.test(price)) throw new XanaxError("Xanax returned a malformed product.");
  if (buyUrl !== `${BASE_URL}/buy/${id}`) throw new XanaxError("Xanax returned an unexpected buy URL; refusing to pay it.");
  const fields = Array.isArray(buy.required_buyer_fields) ? buy.required_buyer_fields.filter((f): f is string => typeof f === "string") : [];
  return {
    id,
    merchant: str(r.merchant, "Unknown merchant"),
    name: str(r.name, id),
    description: str(r.description),
    type: str(r.type, "physical"),
    price_usd: price,
    network: str(r.network, "base"),
    in_stock: r.in_stock !== false,
    stock: typeof r.stock === "number" ? r.stock : null,
    image_url: typeof r.image_url === "string" ? r.image_url : null,
    product_page: `${BASE_URL}/p/${id}`,
    buy: { url: buyUrl, required_buyer_fields: fields },
  };
}

export async function searchProducts(query: string): Promise<Product[]> {
  const data = (await getJson(`/api/products?q=${encodeURIComponent(query)}`)) as { products?: unknown };
  if (!Array.isArray(data.products)) throw new XanaxError("Xanax returned an unexpected search response.");
  return data.products.map(toProduct);
}

export async function getProduct(id: string): Promise<Product> {
  return toProduct(await getJson(`/api/products/${encodeURIComponent(id)}`));
}
