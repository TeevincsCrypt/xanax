import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "./config.js";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l

export function randomId(prefix: string, length = 14): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Webhook signature: HMAC-SHA256 over `${timestamp}.${body}` with the merchant's secret,
 * sent as `X-Xanax-Signature: sha256=<hex>` alongside `X-Xanax-Timestamp`. Signing the
 * timestamp lets merchants reject replays (Stripe-style).
 */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function verifyWebhook(secret: string, timestamp: number, body: string, signature: string, toleranceSec = 300): boolean {
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSec) return false;
  return safeEqual(signWebhook(secret, timestamp, body), signature);
}

/** Signed, expiring token for a digital download: `<exp>.<hmac>` bound to the order id. */
export function signDownload(orderId: string, ttlSec = 7 * 24 * 3600, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSec;
  const sig = createHmac("sha256", config.signingSecret).update(`dl:${orderId}:${exp}`).digest("base64url");
  return `${exp}.${sig}`;
}

export function verifyDownload(orderId: string, token: string, now = Date.now()): boolean {
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || !sig || exp < Math.floor(now / 1000)) return false;
  const expected = createHmac("sha256", config.signingSecret).update(`dl:${orderId}:${exp}`).digest("base64url");
  return safeEqual(expected, sig);
}

/** Fixed-window in-memory rate limiter. Fine for a single instance. */
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    }
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

/** True for loopback, private, link-local, CGNAT, multicast, reserved and similar ranges. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateIp(mapped[1]!);
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb") ||
      lower.startsWith("ff")
    );
  }
  return true;
}

/**
 * Basic SSRF guard for merchant webhook URLs: https only, no credentials, standard port,
 * and every resolved address must be public. Checked at signup and again before each delivery.
 */
export async function checkWebhookUrl(raw: string): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Webhook URL is not a valid URL" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Webhook URL must use https://" };
  if (url.username || url.password) return { ok: false, error: "Webhook URL must not contain credentials" };
  if (url.port && url.port !== "443") return { ok: false, error: "Webhook URL must use the default https port" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, error: "Webhook URL must point to a public host" };
  }
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    return { ok: false, error: "Webhook host does not resolve" };
  }
  if (addresses.length === 0 || addresses.some(isPrivateIp)) {
    return { ok: false, error: "Webhook URL must resolve to a public IP address" };
  }
  return { ok: true, url };
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
