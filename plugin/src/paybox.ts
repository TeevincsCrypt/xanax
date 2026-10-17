// PayBox transaction proposal (x402 kind). PayBox validates it, gets the user's approval and pays.
import * as z from "zod/v4";

const KEY = "io.paybox/transactionProposal";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

const x402 = z.object({
  version: z.literal("1"),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
  kind: z.literal("x402"),
  chain: z.literal("eip155:8453"),
  request: z.object({ url: z.url().max(2048), method: z.enum(["GET", "POST"]), body: z.json().optional() }).strict(),
  payment: z.object({ asset: z.string(), maxAmount: z.string().regex(/^[1-9][0-9]{0,19}$/) }).strict(),
}).strict();

export const x402OutputSchema = z.object({ [KEY]: x402 }).strict();

export function proposeX402(input: { url: string; method: "GET" | "POST"; body?: z.infer<ReturnType<typeof z.json>>; maxAmount: string }) {
  const url = new URL(input.url);
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || url.hash) {
    throw new Error("x402 requires HTTPS on port 443 without credentials or fragments.");
  }
  if (Buffer.byteLength(JSON.stringify(input.body ?? null)) > 64 * 1024) throw new Error("x402 JSON body exceeds 64 KiB.");
  const expiresAt = new Date(Date.now() + 240_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const proposal = x402.parse({
    version: "1",
    expiresAt,
    kind: "x402",
    chain: "eip155:8453",
    request: { url: url.toString(), method: input.method, ...(input.body === undefined ? {} : { body: input.body }) },
    payment: { asset: BASE_USDC, maxAmount: input.maxAmount },
  });
  return {
    content: [{ type: "text" as const, text: "Unsigned x402 payment prepared. PayBox must get the user's approval; nothing has been paid." }],
    structuredContent: { [KEY]: proposal },
  };
}

/** "12.5" USD -> USDC atomic units (6 decimals), exact. */
export function usdcAtomic(amount: string): string {
  const m = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(amount);
  if (!m) throw new Error(`Not a USD amount: ${amount}`);
  return BigInt(`${m[1]}${(m[2] ?? "").padEnd(6, "0")}`).toString();
}
