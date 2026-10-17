import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { buyerBodySchema, centsToPrice, parseQty, parseUsdToCents, totalCents, validateBuyer } from "../src/catalog.js";
import { isPrivateIp, signDownload, signWebhook, verifyDownload, verifyWebhook } from "../src/security.js";
import { bazaarExtension, paymentNonce, productIdFromPath } from "../src/x402.js";
import { html } from "../src/views/html.js";

describe("pricing from path + query", () => {
  it("defaults qty to 1 and caps it", () => {
    expect(parseQty(undefined)).toEqual({ ok: true, qty: 1 });
    expect(parseQty("")).toEqual({ ok: true, qty: 1 });
    expect(parseQty("3")).toEqual({ ok: true, qty: 3 });
    expect(parseQty("10")).toEqual({ ok: true, qty: 10 });
    expect(parseQty("11").ok).toBe(false);
    expect(parseQty("0").ok).toBe(false);
    expect(parseQty("-1").ok).toBe(false);
    expect(parseQty("1.5").ok).toBe(false);
    expect(parseQty("1e2").ok).toBe(false);
  });

  it("computes exact decimal prices from integer cents", () => {
    expect(centsToPrice(totalCents(1200, 1))).toBe("$12.00");
    expect(centsToPrice(totalCents(50, 3))).toBe("$1.50");
    expect(centsToPrice(totalCents(1, 1))).toBe("$0.01");
    expect(centsToPrice(totalCents(1999, 10))).toBe("$199.90");
  });

  it("parses user-entered USD", () => {
    expect(parseUsdToCents("12")).toBe(1200);
    expect(parseUsdToCents("$12.5")).toBe(1250);
    expect(parseUsdToCents(" 0.01 ")).toBe(1);
    expect(parseUsdToCents("12.345")).toBeNull();
    expect(parseUsdToCents("abc")).toBeNull();
    expect(parseUsdToCents("-3")).toBeNull();
  });

  it("extracts product ids from paths only", () => {
    expect(productIdFromPath("/buy/p_abc123")).toBe("p_abc123");
    expect(productIdFromPath("/buy/p_abc123/")).toBe("p_abc123");
    expect(productIdFromPath("/buy/../etc")).toBeUndefined();
  });
});

describe("buyer body validation", () => {
  const product = { required_fields: ["name", "email", "shipping_address"] as const };

  it("reports missing required fields and promises no charge", () => {
    const v = validateBuyer({ required_fields: [...product.required_fields] }, { buyer: { name: "Ada" } });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.missing).toEqual(["email", "shipping_address"]);
      expect(v.error).toMatch(/not been charged/);
    }
  });

  it("treats a missing body as missing fields", () => {
    const v = validateBuyer({ required_fields: ["email"] }, undefined);
    expect(v.ok).toBe(false);
  });

  it("accepts valid input, trims, and drops unknown fields", () => {
    const v = validateBuyer(
      { required_fields: ["name", "email"] },
      { buyer: { name: "  Ada Obi ", email: "ada@example.com", evil: "<script>", phone: "+234 801 234 5678" } },
    );
    expect(v).toEqual({ ok: true, buyer: { name: "Ada Obi", email: "ada@example.com", phone: "+234 801 234 5678" } });
  });

  it("rejects invalid optional fields", () => {
    expect(validateBuyer({ required_fields: [] }, { buyer: { email: "nope" } }).ok).toBe(false);
  });

  it("allows no body when nothing is required", () => {
    expect(validateBuyer({ required_fields: [] }, undefined)).toEqual({ ok: true, buyer: {} });
  });

  it("builds a JSON schema that marks required fields", () => {
    const s = buyerBodySchema(["email"]) as any;
    expect(s.required).toEqual(["buyer"]);
    expect(s.properties.buyer.required).toEqual(["email"]);
    expect(Object.keys(s.properties.buyer.properties)).toEqual(["name", "email", "phone", "shipping_address", "note"]);
  });
});

describe("bazaar discovery extension", () => {
  it("passes the SDK's strict JSON-schema validation", () => {
    const ext = bazaarExtension() as any;
    ext.bazaar.info.input.method = "POST"; // what bazaarResourceServerExtension adds at request time
    const result = validateDiscoveryExtension(ext.bazaar);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("webhook signing", () => {
  it("signs timestamp.body with HMAC-SHA256 and verifies", () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ event: "order.paid", order: { id: "xnx_1" } });
    const sig = signWebhook("whsec_test", ts, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyWebhook("whsec_test", ts, body, sig)).toBe(true);
    expect(verifyWebhook("whsec_other", ts, body, sig)).toBe(false);
    expect(verifyWebhook("whsec_test", ts, body + " ", sig)).toBe(false);
    expect(verifyWebhook("whsec_test", ts - 3600, body, signWebhook("whsec_test", ts - 3600, body))).toBe(false);
  });

  it("matches a known vector", () => {
    // echo -n '1700000000.{"a":1}' | openssl dgst -sha256 -hmac secret
    expect(signWebhook("secret", 1700000000, '{"a":1}')).toBe(
      "sha256=" + createHmac("sha256", "secret").update('1700000000.{"a":1}').digest("hex"),
    );
  });
});

describe("download tokens", () => {
  it("are bound to the order and expire", () => {
    const now = Date.now();
    const t = signDownload("xnx_a", 60, now);
    expect(verifyDownload("xnx_a", t, now)).toBe(true);
    expect(verifyDownload("xnx_b", t, now)).toBe(false);
    expect(verifyDownload("xnx_a", t, now + 61_000)).toBe(false);
    expect(verifyDownload("xnx_a", "123.abc", now)).toBe(false);
  });
});

describe("SSRF guard", () => {
  it("flags private and special addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
});

describe("idempotency key", () => {
  it("uses the EIP-3009 nonce when present", () => {
    const p = { x402Version: 2, accepted: { network: "eip155:84532" }, payload: { authorization: { nonce: "0xabc" }, signature: "0xsig" } } as any;
    expect(paymentNonce(p, "raw")).toBe("eip155:84532:0xabc");
  });
  it("falls back to the signature hash", () => {
    const p = { x402Version: 2, payload: { signature: "0xsig" } } as any;
    expect(paymentNonce(p, "raw")).toMatch(/^sig:[0-9a-f]{64}$/);
  });
});

describe("html escaping", () => {
  it("escapes interpolations by default", () => {
    expect(html`<p>${'<img src=x onerror="alert(1)">'}</p>`.value).toBe("<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
  });
});
