import { getAddress, isAddress, zeroAddress } from "viem";
import { config } from "./config.js";
import { parseUsdToCents } from "./catalog.js";
import { BUYER_FIELDS, merchants, products, type BuyerField, type Merchant, type Product, type ProductKind } from "./db.js";
import { checkWebhookUrl, randomId, randomSecret, sha256Hex } from "./security.js";
import { imageUrl, MAX_FILE_BYTES, MAX_IMAGE_BYTES, saveUpload, sniffImage } from "./uploads.js";

export interface ListingInput {
  business_name?: string;
  product_name?: string;
  description?: string;
  price_usd?: string;
  image_url?: string;
  payout_address?: string;
  webhook_url?: string;
  email?: string;
  kind?: string;
  delivery_url?: string;
  delivery_text?: string;
  stock?: string;
  required_fields?: string[];
  /** Uploaded product image; wins over image_url. */
  image_file?: File;
  /** Uploaded digital good, delivered through the signed download link. */
  digital_file?: File;
  /** Privy user who owns this store, when created while signed in. */
  user_id?: string;
}

export interface Listing {
  merchant: Merchant;
  product: Product;
  /** Raw dashboard token. Shown once; only its hash is stored. */
  dashboardToken: string;
  /** Webhook signing secret. Shown once. */
  webhookSecret: string;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function httpsUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function validateListing(
  input: ListingInput,
  opts: { skipWebhookDnsCheck?: boolean } = {},
): Promise<{ ok: true; value: Omit<Product, "id" | "merchant_id" | "created_at" | "active"> & { business_name: string; payout_address: string; webhook_url: string | null; email: string | null } } | { ok: false; errors: string[] }> {
  const errors: string[] = [];
  const t = (s?: string) => (s ?? "").trim();

  const business_name = t(input.business_name);
  if (!business_name || business_name.length > 80) errors.push("Business name is required (max 80 characters).");
  const name = t(input.product_name);
  if (!name || name.length > 120) errors.push("Product name is required (max 120 characters).");
  const description = t(input.description);
  if (!description || description.length > 500) errors.push("Description is required (max 500 characters).");

  const price_cents = parseUsdToCents(t(input.price_usd));
  if (price_cents === null) errors.push("Price must be a dollar amount like 12 or 12.50.");
  else if (price_cents < 1) errors.push("Price must be at least $0.01.");
  else if (price_cents > config.MAX_PRICE_USD * 100) errors.push(`Price must be at most $${config.MAX_PRICE_USD}.`);

  const addr = t(input.payout_address);
  let payout_address = "";
  if (!isAddress(addr, { strict: false })) errors.push("Payout wallet must be a valid Base (EVM) address starting with 0x.");
  else if (addr.toLowerCase() === zeroAddress) errors.push("Payout wallet can't be the zero address.");
  else if (/[a-f]/.test(addr.slice(2)) && /[A-F]/.test(addr.slice(2)) && !isAddress(addr, { strict: true }))
    // Mixed case means EIP-55 checksummed; a wrong checksum usually means a typo.
    errors.push("Payout wallet checksum doesn't match. Paste it again from your wallet.");
  else payout_address = getAddress(addr);

  const image_url = t(input.image_url) ? httpsUrl(t(input.image_url)) : null;
  if (t(input.image_url) && !image_url) errors.push("Image URL must be an https:// link.");

  let webhook_url: string | null = null;
  if (t(input.webhook_url)) {
    if (opts.skipWebhookDnsCheck) {
      webhook_url = httpsUrl(t(input.webhook_url));
      if (!webhook_url) errors.push("Webhook URL must use https://");
    } else {
      const check = await checkWebhookUrl(t(input.webhook_url));
      if (check.ok) webhook_url = check.url.toString();
      else errors.push(check.error);
    }
  }
  const email = t(input.email) ? t(input.email).toLowerCase() : null;
  if (email && !EMAIL_RE.test(email)) errors.push("Email address looks invalid.");
  if (!webhook_url && !email && !errors.some((e) => e.startsWith("Webhook"))) {
    errors.push("Add a webhook URL or an email so you hear about orders.");
  }

  const kind: ProductKind = input.kind === "digital" ? "digital" : "physical";
  const delivery_url = t(input.delivery_url) ? httpsUrl(t(input.delivery_url)) : null;
  if (t(input.delivery_url) && !delivery_url) errors.push("Digital file URL must be an https:// link.");
  const delivery_text = t(input.delivery_text) || null;
  if (delivery_text && delivery_text.length > 20_000) errors.push("Digital content is too long (max 20,000 characters).");
  const hasFile = Boolean(input.digital_file && input.digital_file.size > 0);
  if (kind === "digital" && !delivery_url && !delivery_text && !hasFile) errors.push("Digital products need a file, a file link or some content to deliver.");
  if (hasFile && input.digital_file!.size > MAX_FILE_BYTES) errors.push(`Digital file is too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
  if (input.image_file && input.image_file.size > 0) {
    if (input.image_file.size > MAX_IMAGE_BYTES) errors.push(`Image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`);
    else if (!sniffImage(new Uint8Array(await input.image_file.slice(0, 16).arrayBuffer()))) errors.push("Image must be a PNG, JPG, GIF or WebP.");
  }

  let stock: number | null = null;
  if (t(input.stock)) {
    if (!/^\d{1,7}$/.test(t(input.stock))) errors.push("Stock must be a whole number (or leave it empty for unlimited).");
    else stock = Number(t(input.stock));
  }

  const required_fields = [...new Set(input.required_fields ?? [])].filter((f): f is BuyerField =>
    (BUYER_FIELDS as readonly string[]).includes(f),
  );

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      business_name,
      payout_address,
      webhook_url,
      email,
      name,
      description,
      price_cents: price_cents!,
      image_url,
      kind,
      required_fields,
      stock,
      delivery_text,
      delivery_url,
    },
  };
}

export async function createListing(input: ListingInput, opts: { skipWebhookDnsCheck?: boolean } = {}): Promise<{ ok: true; listing: Listing } | { ok: false; errors: string[] }> {
  const v = await validateListing(input, opts);
  if (!v.ok) return v;
  const { business_name, payout_address, webhook_url, email, ...p } = v.value;
  let delivery_file_id: string | null = null;
  if (input.image_file && input.image_file.size > 0) {
    const up = await saveUpload(input.image_file, "image");
    if (!up.ok) return { ok: false, errors: [up.error] };
    p.image_url = imageUrl(up.file.id);
  }
  if (p.kind === "digital" && input.digital_file && input.digital_file.size > 0) {
    const up = await saveUpload(input.digital_file, "digital");
    if (!up.ok) return { ok: false, errors: [up.error] };
    delivery_file_id = up.file.id;
  }
  const dashboardToken = randomSecret(32);
  const webhookSecret = `whsec_${randomSecret(24)}`;
  const merchantId = randomId("m");
  const productId = randomId("p", 10);
  merchants.insert({
    id: merchantId,
    business_name,
    payout_address,
    webhook_url,
    webhook_secret: webhookSecret,
    email,
    dashboard_token_hash: sha256Hex(dashboardToken),
    user_id: input.user_id ?? null,
  });
  products.insert({ id: productId, merchant_id: merchantId, ...p, delivery_file_id });
  return { ok: true, listing: { merchant: merchants.get(merchantId)!, product: products.get(productId)!, dashboardToken, webhookSecret } };
}

export function dashboardUrl(token: string): string {
  return `${config.BASE_URL}/m/${token}`;
}
