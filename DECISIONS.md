# Decisions

## Plan (M0)

1. Hono + `@hono/node-server`, TypeScript run directly with `tsx` (no build step to break a deploy).
2. Official x402 v2 packages, pinned at **2.28.0**: `@x402/core`, `@x402/evm` (`exact` scheme), `@x402/hono`, `@x402/extensions/bazaar`, `@x402/fetch` (test client), `@coinbase/x402` (CDP facilitator auth).
3. Paid route `POST|GET /buy/:id?qty=N`: price and payTo are **dynamic functions of path + query** (`DynamicPrice`/`DynamicPayTo`), so the unpaid probe (no body) and the paid fetch agree on the price.
4. We drive `x402HTTPResourceServer` directly instead of `paymentMiddleware`: validate body → verify → reserve stock → settle → write order (keyed by tx hash + payment nonce) → notify → receipt.
5. SQLite via Node 22's built-in `node:sqlite` on a Railway volume (`/data`). No native modules, persists across deploys.
6. Testnet: Base Sepolia + `https://x402.org/facilitator`. Mainnet: Base + CDP facilitator. One env var: `X402_NETWORK`.
7. Merchant UI: server-rendered HTML through an auto-escaping tagged template, with no SPA build.
8. Webhooks are HMAC-signed, retried 3x, and guarded against SSRF. Email via Resend sits behind a flag.
9. Deploy: Railway (Dockerfile + `railway.json`, healthcheck `/health`).
10. Tests: vitest unit tests, plus an end-to-end test that pays with the **official `@x402/fetch` client** against a fake facilitator.

## Why these choices

- **Lower-level x402 server instead of the middleware.** `paymentMiddleware` settles *after* the handler builds its response, so the handler can't put the settlement tx hash in the receipt. It also runs verify before our code sees the body. Calling `processHTTPRequest` and `processSettlement` ourselves lets us (a) reject bad bodies before any verify/settle, so a buyer is never charged for an invalid order, and (b) return the real tx hash in the receipt.
- **Price only from the URL.** PayBox `use_service` probes without the body and sends the body only on the paid re-fetch. Quantity is therefore `?qty=`, capped at 10, and the body only carries buyer details.
- **Body validated before verify.** If a required buyer field is missing, the paid request gets `400 {charged:false}` and the facilitator is never called. This is covered by a test that asserts zero verify/settle calls.
- **Sold out returns 409, not 402.** It's checked before the 402 is built, so nobody can pay for nothing. Stock is reserved atomically (`UPDATE … WHERE stock >= qty`) before settle and released if settle fails.
- **Idempotency.** Orders have `UNIQUE(tx_hash)` and `UNIQUE(payment_nonce)`, where the nonce is the EIP-3009 authorization nonce. A replayed payment header returns the original receipt without calling settle again, and the merchant isn't notified twice (tested).
- **Never custody.** `payTo` is always the merchant's own address. Xanax has no wallet.
- **`merchant_notified` is honest.** The first webhook attempt is awaited, capped at 4s, so the receipt says whether it got through. Retries (2s, 8s, 30s) continue in the background and are recorded on the order.
- **Webhook signature** = `sha256=HMAC(secret, "<timestamp>.<raw body>")`, with `X-Xanax-Timestamp`, Stripe-style, so merchants can reject replays.
- **Webhook secret stored in plaintext; dashboard token stored as a hash.** We must be able to *sign* with the webhook secret, so it can't be one-way hashed. The dashboard token is only ever *compared*, so we keep just its SHA-256.
- **Payment header accepted as `PAYMENT-SIGNATURE` or `X-PAYMENT`.** v2 uses `PAYMENT-SIGNATURE`. PayBox's docs call the header-mode output `x_payment`, so we also accept a v2 payload sent under the v1 header name.
- **402 body echoes the requirements.** v2 puts them in the `PAYMENT-REQUIRED` header. We also include `x402Version`/`accepts`/`resource`/`extensions` in the JSON body for clients that read the body.
- **Resource URL uses `BASE_URL`.** Behind Railway's proxy the request URL can be internal `http://`. The advertised resource must be the public https URL that Bazaar catalogs.
- **Bazaar.** The extension is declared on `POST /buy/:id` with a JSON-schema body, `pathParams` for `id`, and a receipt output schema. `qty` is described in the route description because the SDK's body-method declaration has no `queryParams` field. The enriched extension in a real 402 passes `validateDiscoveryExtension` (tested).
- **Digital delivery.** The receipt includes `delivery.download_url`, an HMAC-signed link bound to the order id that expires after 7 days.
- **USDC addresses** match the `@x402/evm` defaults: Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, Base Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- **Rate limits** are in-memory, per IP: `/buy` 60/min (a purchase is 2 requests), `/sell` 10 per 10 min, `/api` 120/min. Good for a single instance.

## Known gaps / to verify live

- PayBox's exact parsing of the v2 402 can only be confirmed with a real `use_service` call (no PayBox testnet).
- Bazaar cataloging happens only after the CDP facilitator settles a paid request carrying the extension (mainnet).
