# Demo runbook: a PayBox purchase end to end

Replace `$BASE` with the deployed URL (for example `https://xanax-production.up.railway.app`).

## 0. Prep (once)

The live site has **no demo products**: the fictional "Ada's Roastery" listings were taken off sale (`POST /admin/unseed`). For the demo, create a real listing through the UI, which is also the first shot of the video:

1. Open `$BASE/sell`. Use your own wallet as payout, a https://webhook.site URL as the webhook (it shows the order arriving live), and a small price ($0.10–$0.50).
2. For instant delivery, pick **Instant digital delivery** and paste some content (a guide, a license key).
3. Save the dashboard link and webhook secret from the success page, and copy the agent URL (`$BASE/buy/<id>`).

```bash
curl $BASE/api/products | jq '.products[] | {id, name, price_usd, url: .buy.url}'
curl -i -X POST $BASE/buy/<id>      # expect: HTTP 402 + PAYMENT-REQUIRED header
```

Below, `<id>` is your product id and `<digital-id>` is a digital product's id.

## A. PayBox CLI

```bash
npx @paybox-sh/sdk login          # device-code login, approve with passkey
npx @paybox-sh/sdk connect        # pair a signing key (match the 8 emoji)
npx @paybox-sh/sdk credentials    # note the wallet credential.id (Base USDC)

# Digital product, no body needed:
npx @paybox-sh/sdk use-service --credential <id> --url $BASE/buy/<digital-id> --method POST --wait

# Physical product with buyer details (the CLI supports --method and --body, per `use-service --help`):
npx @paybox-sh/sdk use-service --credential <id> --url "$BASE/buy/<id>?qty=1" --method POST --wait \
  --body '{"buyer":{"name":"Ada Obi","email":"you@example.com","shipping_address":"12 Admiralty Way, Lekki, Lagos"}}'
```

Expected result: `output.value.response = { status: 200, content_type: "application/json", body: { status: "paid", order_id, tx_hash, … } }`.
If it returns `pending_approval`, approve in the PayBox app; `--wait` then finishes it. Otherwise run `paybox request <request_id> --wait`.

## B. Claude.ai with the PayBox connector (the video moment)

Prompt (paste as is):

> Use PayBox to buy 1 × "Single-origin coffee, 250g" from Ada's Roastery. First look it up at $BASE/api/products?q=coffee to get the buy URL and required fields, then call use_service with method POST on that URL and this body: {"buyer": {"name": "Ada Obi", "email": "you@example.com", "shipping_address": "12 Admiralty Way, Lekki, Lagos, Nigeria"}}. Tell me the order ID, amount, transaction link and what happens next.

For the instant-delivery shot:

> Use PayBox to buy the Lagos street-food guide at $BASE/buy/<digital-id> (use_service, method POST) and give me the download link.

Expected tool calls:

1. (optional) web fetch of `$BASE/api/products?q=coffee`
2. `list_credentials`, then pick the Base USDC wallet credential
3. `use_service` with `{ credential_id, url: "$BASE/buy/<id>?qty=1", method: "POST", body: { buyer: {…} } }`
4. Possibly `pending_approval`: approve with passkey on your phone. Then `get_request` until `success`.
5. The agent relays the receipt: `order_id`, `amount_usd`, `explorer_url`, `next_steps`, `receipt_url` (and `delivery.download_url` for the guide).

Then show:

- `$BASE/r/<order_id>`: the public receipt
- the Basescan link: USDC moved straight to the merchant wallet
- the merchant dashboard (`/m/<token>`): the order with buyer details and "webhook delivered"
- webhook.site: the signed `order.paid` payload

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `503 Payment facilitator unavailable` | The facilitator can't be reached, or CDP keys are missing/wrong on mainnet. Check the logs for `[x402] facilitator`. |
| `400 Missing required buyer field(s)` | The body was missing fields. Nothing was charged. Resend with the fields. |
| `409 Sold out` | Stock hit 0. Re-seed, or create a new listing. |
| 402 again after paying | Verify failed (wrong network or amount). Check `X402_NETWORK` matches the wallet's chain. |
| `discover_services` doesn't list Xanax | Expected on day one. It needs Bazaar cataloging plus 10 unique payers in 30 days. Call the URL directly. |
