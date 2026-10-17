/**
 * End-to-end x402 purchase with the official client, the way any agent would pay.
 *
 *   BUYER_PRIVATE_KEY=0x... TARGET_URL=https://your-app pnpm test-buy [productId] [qty]
 *
 * Testnet: fund the buyer with Base Sepolia USDC from https://faucet.circle.com (pick Base Sepolia).
 * No ETH needed: the facilitator pays gas for EIP-3009 transfers.
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const target = (process.env.TARGET_URL || process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const key = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) throw new Error("Set BUYER_PRIVATE_KEY (a throwaway wallet with a little USDC)");
const network = process.env.X402_NETWORK === "base" ? "eip155:8453" : "eip155:84532";
const account = privateKeyToAccount(key);

let [productId, qtyArg] = process.argv.slice(2);
const qty = Number(qtyArg ?? 1);

const list = await (await fetch(`${target}/api/products`)).json();
const product = productId ? list.products.find((p: any) => p.id === productId) : list.products.find((p: any) => p.in_stock);
if (!product) throw new Error(`No product ${productId ?? "in stock"} at ${target}`);
console.log(`Buyer ${account.address} on ${network}`);
console.log(`Buying ${qty} x "${product.name}" from ${product.merchant} at $${product.price_usd} each`);

const url = `${product.buy.url}${qty > 1 ? `?qty=${qty}` : ""}`;
const probe = await fetch(url, { method: "POST" });
console.log(`Probe: HTTP ${probe.status}, PAYMENT-REQUIRED header ${probe.headers.get("payment-required") ? "present" : "MISSING"}`);

const body = {
  buyer: {
    name: "Test Buyer",
    email: "buyer@example.com",
    phone: "+234 801 234 5678",
    shipping_address: "12 Admiralty Way, Lekki, Lagos, Nigeria",
    note: "x402 smoke test",
  },
};
const pay = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network, client: new ExactEvmScheme(account) }] });
const res = await pay(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
console.log(`Paid request: HTTP ${res.status}`);
const pr = res.headers.get("payment-response");
if (pr) console.log("PAYMENT-RESPONSE:", decodePaymentResponseHeader(pr));
console.log(JSON.stringify(await res.json().catch(() => null), null, 2));
process.exit(res.ok ? 0 : 1);
