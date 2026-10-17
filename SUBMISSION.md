# Submission: Xanax (MoonPay Hackathons, Chapter 1, Merchant tools)

**One-liner:** Turn any product into something an AI agent can buy: no Stripe account, no integration, paid in USDC straight to your wallet.

**Live:** `$BASE` · **Repo:** https://github.com/teevincscrypt/xanax

## Demo video script (60–90 s)

| # | Time | Shot | Voiceover |
|---|---|---|---|
| 1 | 0:00–0:07 | Landing page, slow scroll | "AI agents can pay now. But how does a coffee roaster in Lagos sell to one? This is Xanax." |
| 2 | 0:07–0:22 | `/sell`: fill business, product, $0.50, paste wallet, webhook. Submit. | "A merchant fills in one form: product, price, their own Base wallet, and where orders should go." |
| 3 | 0:22–0:28 | Success page: agent URL, copy the buyer prompt | "They get an x402 link, a ready-made prompt, and a private dashboard. No Stripe, no code." |
| 4 | 0:28–0:50 | Claude.ai with PayBox: paste the prompt. Show `use_service` firing, passkey approval on phone. | "A buyer asks Claude to buy it. PayBox hits the link, gets a 402, I approve with my passkey, and it pays in USDC." |
| 5 | 0:50–1:00 | Claude's answer: order ID, amount, next steps. Click the explorer link: Basescan transfer to the merchant. | "Claude gets a real receipt. On-chain, the USDC went straight to the merchant. Xanax never touched it." |
| 6 | 1:00–1:10 | Split: webhook.site signed `order.paid` + dashboard row "webhook delivered" | "The merchant gets a signed webhook with the shipping details, instantly." |
| 7 | 1:10–1:20 | Second prompt: buy the Lagos food guide, then open the download link. | "Digital goods deliver instantly. Pay, and the download is in the receipt." |
| 8 | 1:20–1:28 | Logo + URL | "Xanax. Agent checkout for every small business. Works with PayBox." |

Recording tips: use mainnet with a $0.50 product, approve on the phone in shot, keep the Basescan tab pre-opened, and show the time on screen.

## Launch post for X (≤280 chars)

> Any small business can now sell to AI agents.
>
> Xanax: fill one form, get an x402 link. Agents on PayBox pay in USDC on Base, straight to your wallet. You get a signed webhook, they get a receipt.
>
> No Stripe. No integration. Built for #MoonPayHackathon 🧵

## Thread

1. The problem: agents can pay now (PayBox, x402), but almost no merchants can *accept* an agent payment. Stripe checkouts are built for humans clicking buttons.
2. Xanax: name, price, Base wallet, webhook → a product URL that speaks HTTP 402. That's the whole integration.
3. The buyer says "buy me a bag of coffee from Ada's Roastery." Claude calls PayBox `use_service`, PayBox pays the 402 in USDC, and the agent gets a receipt with order ID and tx hash.
4. Non-custodial by design: the 402's payTo is the merchant's own wallet. Xanax never holds funds.
5. Built so nobody pays for nothing: buyer details are validated before settlement, sold-out returns 409 instead of 402, and replayed payments never create a second order.
6. Digital goods deliver instantly via signed download links. Physical goods trigger an HMAC-signed webhook to the merchant.
7. Try it: $BASE · Code: github.com/teevincscrypt/xanax
