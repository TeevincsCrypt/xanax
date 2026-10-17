import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

export type BuyerField = "name" | "email" | "phone" | "shipping_address" | "note";
export const BUYER_FIELDS: readonly BuyerField[] = ["name", "email", "phone", "shipping_address", "note"];

export type ProductKind = "physical" | "digital";

export interface Merchant {
  id: string;
  business_name: string;
  payout_address: string;
  webhook_url: string | null;
  webhook_secret: string;
  email: string | null;
  dashboard_token_hash: string;
  created_at: string;
}

export interface Product {
  id: string;
  merchant_id: string;
  name: string;
  description: string;
  price_cents: number;
  image_url: string | null;
  kind: ProductKind;
  required_fields: BuyerField[];
  stock: number | null;
  delivery_text: string | null;
  delivery_url: string | null;
  active: number;
  created_at: string;
}

export interface Order {
  id: string;
  product_id: string;
  merchant_id: string;
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
  buyer: Record<string, string>;
  payer_address: string | null;
  tx_hash: string;
  payment_nonce: string | null;
  network: string;
  status: "paid" | "fulfilled";
  webhook_status: "none" | "pending" | "delivered" | "failed";
  webhook_attempts: number;
  webhook_last_error: string | null;
  email_status: "none" | "sent" | "failed";
  created_at: string;
  fulfilled_at: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  payout_address TEXT NOT NULL,
  webhook_url TEXT,
  webhook_secret TEXT NOT NULL,
  email TEXT,
  dashboard_token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  image_url TEXT,
  kind TEXT NOT NULL DEFAULT 'physical',
  required_fields TEXT NOT NULL DEFAULT '[]',
  stock INTEGER,
  delivery_text TEXT,
  delivery_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS products_merchant ON products(merchant_id);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  buyer_json TEXT NOT NULL DEFAULT '{}',
  payer_address TEXT,
  tx_hash TEXT NOT NULL UNIQUE,
  payment_nonce TEXT UNIQUE,
  network TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',
  webhook_status TEXT NOT NULL DEFAULT 'none',
  webhook_attempts INTEGER NOT NULL DEFAULT 0,
  webhook_last_error TEXT,
  email_status TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  fulfilled_at TEXT
);
CREATE INDEX IF NOT EXISTS orders_merchant ON orders(merchant_id, created_at);
`;

function resolvePath(url: string): string {
  if (url === ":memory:" || url === "file::memory:") return ":memory:";
  const path = url.startsWith("file:") ? url.slice("file:".length) : url;
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

export function openDb(url = config.DATABASE_URL): DatabaseSync {
  const db = new DatabaseSync(resolvePath(url));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}

let current: DatabaseSync | undefined;

export function db(): DatabaseSync {
  current ??= openDb();
  return current;
}

/** Swap the database (tests use an in-memory one). */
export function setDb(next: DatabaseSync): void {
  current = next;
}

type Row = Record<string, unknown>;

function toProduct(row: Row | undefined): Product | undefined {
  if (!row) return undefined;
  return { ...(row as unknown as Product), required_fields: JSON.parse(String(row.required_fields)) };
}

function toOrder(row: Row | undefined): Order | undefined {
  if (!row) return undefined;
  const { buyer_json, ...rest } = row;
  return { ...(rest as unknown as Order), buyer: JSON.parse(String(buyer_json)) };
}

export const merchants = {
  insert(m: Omit<Merchant, "created_at">): void {
    db()
      .prepare(
        `INSERT INTO merchants (id, business_name, payout_address, webhook_url, webhook_secret, email, dashboard_token_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(m.id, m.business_name, m.payout_address, m.webhook_url, m.webhook_secret, m.email, m.dashboard_token_hash);
  },
  get(id: string): Merchant | undefined {
    return db().prepare("SELECT * FROM merchants WHERE id = ?").get(id) as Merchant | undefined;
  },
  byTokenHash(hash: string): Merchant | undefined {
    return db().prepare("SELECT * FROM merchants WHERE dashboard_token_hash = ?").get(hash) as Merchant | undefined;
  },
};

export const products = {
  insert(p: Omit<Product, "created_at" | "active">): void {
    db()
      .prepare(
        `INSERT INTO products (id, merchant_id, name, description, price_cents, image_url, kind, required_fields, stock, delivery_text, delivery_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.id,
        p.merchant_id,
        p.name,
        p.description,
        p.price_cents,
        p.image_url,
        p.kind,
        JSON.stringify(p.required_fields),
        p.stock,
        p.delivery_text,
        p.delivery_url,
      );
  },
  get(id: string): Product | undefined {
    return toProduct(db().prepare("SELECT * FROM products WHERE id = ? AND active = 1").get(id) as Row | undefined);
  },
  search(q: string | undefined, limit = 50): Array<Product & { business_name: string }> {
    const like = `%${(q ?? "").replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
    const rows = db()
      .prepare(
        `SELECT p.*, m.business_name FROM products p JOIN merchants m ON m.id = p.merchant_id
         WHERE p.active = 1 AND (? = '' OR p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR m.business_name LIKE ? ESCAPE '\\')
         ORDER BY p.created_at DESC LIMIT ?`,
      )
      .all(q ?? "", like, like, like, limit) as Row[];
    return rows.map((r) => toProduct(r) as Product & { business_name: string });
  },
  byMerchant(merchantId: string): Product[] {
    return (db().prepare("SELECT * FROM products WHERE merchant_id = ? ORDER BY created_at").all(merchantId) as Row[]).map(
      (r) => toProduct(r)!,
    );
  },
  /** Hide every product of the merchants with this exact business name. Orders and receipts are kept. */
  deactivateByMerchantName(businessName: string): Array<{ id: string; name: string }> {
    const rows = db()
      .prepare(
        "SELECT p.id, p.name FROM products p JOIN merchants m ON m.id = p.merchant_id WHERE m.business_name = ? AND p.active = 1",
      )
      .all(businessName) as Array<{ id: string; name: string }>;
    db()
      .prepare("UPDATE products SET active = 0 WHERE merchant_id IN (SELECT id FROM merchants WHERE business_name = ?)")
      .run(businessName);
    return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
  },
  /** Atomically take `qty` units of stock. Returns false if not enough. Unlimited stock always succeeds. */
  reserveStock(id: string, qty: number): boolean {
    const res = db()
      .prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND (stock IS NULL OR stock >= ?)")
      .run(qty, id, qty);
    return Number(res.changes) === 1;
  },
  releaseStock(id: string, qty: number): void {
    db().prepare("UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL").run(qty, id);
  },
};

export const orders = {
  /** Insert an order; returns false if one with this tx hash or nonce already exists. */
  insert(o: Pick<
    Order,
    | "id"
    | "product_id"
    | "merchant_id"
    | "quantity"
    | "unit_price_cents"
    | "amount_cents"
    | "buyer"
    | "payer_address"
    | "tx_hash"
    | "payment_nonce"
    | "network"
    | "webhook_status"
  >): boolean {
    const res = db()
      .prepare(
        `INSERT OR IGNORE INTO orders (id, product_id, merchant_id, quantity, unit_price_cents, amount_cents, buyer_json, payer_address, tx_hash, payment_nonce, network, webhook_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        o.id,
        o.product_id,
        o.merchant_id,
        o.quantity,
        o.unit_price_cents,
        o.amount_cents,
        JSON.stringify(o.buyer),
        o.payer_address,
        o.tx_hash,
        o.payment_nonce,
        o.network,
        o.webhook_status,
      );
    return Number(res.changes) === 1;
  },
  get(id: string): Order | undefined {
    return toOrder(db().prepare("SELECT * FROM orders WHERE id = ?").get(id) as Row | undefined);
  },
  byTxHash(txHash: string): Order | undefined {
    return toOrder(db().prepare("SELECT * FROM orders WHERE tx_hash = ?").get(txHash) as Row | undefined);
  },
  byNonce(nonce: string): Order | undefined {
    return toOrder(db().prepare("SELECT * FROM orders WHERE payment_nonce = ?").get(nonce) as Row | undefined);
  },
  byMerchant(merchantId: string, limit = 200): Order[] {
    return (
      db().prepare("SELECT * FROM orders WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?").all(merchantId, limit) as Row[]
    ).map((r) => toOrder(r)!);
  },
  recordWebhook(id: string, status: Order["webhook_status"], attempts: number, error: string | null): void {
    db()
      .prepare("UPDATE orders SET webhook_status = ?, webhook_attempts = ?, webhook_last_error = ? WHERE id = ?")
      .run(status, attempts, error, id);
  },
  recordEmail(id: string, status: Order["email_status"]): void {
    db().prepare("UPDATE orders SET email_status = ? WHERE id = ?").run(status, id);
  },
  stats(): { orders: number; volumeCents: number } {
    const r = db().prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS v FROM orders").get() as { n: number; v: number };
    return { orders: Number(r.n), volumeCents: Number(r.v) };
  },
  markFulfilled(id: string, merchantId: string): boolean {
    const res = db()
      .prepare(
        "UPDATE orders SET status = 'fulfilled', fulfilled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND merchant_id = ? AND status = 'paid'",
      )
      .run(id, merchantId);
    return Number(res.changes) === 1;
  },
};
