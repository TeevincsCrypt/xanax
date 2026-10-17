# Xanax PayBox plugin

Agent checkout for small businesses, as a PayBox marketplace plugin. Agents search the products merchants list on [Xanax](https://xanax-production.up.railway.app) and buy them with USDC on Base. The plugin never signs or holds money. `buy_product` returns an unsigned x402 proposal. PayBox gets the user's approval, pays the merchant's wallet directly and hands the merchant's receipt back to the agent.

## Tools

| Tool | What it does | Pays? |
|---|---|---|
| `search_products` | Lists products by keyword, or everything for sale when the query is empty. Each result has its price, type (digital or physical), stock and the buyer details the merchant needs. | No |
| `get_product` | Full details of one product, plus its product page link. | No |
| `buy_product` | Re-reads the live price and stock, checks the required buyer details, refuses totals above `max_price_usd`, then returns an x402 proposal: `POST /buy/<id>?qty=N` with only the buyer fields the merchant asked for. The paid response is the Xanax receipt: order ID, transaction link, PDF receipt and, for digital products, the download link. | Proposal only; PayBox pays after approval |
| `about_xanax` | Explains Xanax, how to start selling at `/sell`, and how to recover a lost receipt or download at `/find`. Search results and buy confirmations also point to these pages, so someone who finds Xanax through the plugin can become a seller. | No |

The buy URL is pinned to the Xanax host. A product whose buy URL points anywhere else is refused.

## Hosted configuration

- Upload `dist/plugin.mjs`.
- Network host: `xanax-production.up.railway.app`.
- Variables: none. `XANAX_BASE_URL` optionally points the plugin at another Xanax deployment, which must then be added as a network host too.

## Build

```bash
npm install
npm run typecheck
npm run build                 # dist/plugin.mjs, deterministic
node scripts/call.mjs --list
node scripts/call.mjs search_products '{"query":""}'
```

`npm test` runs the PayBox starter's checks (type check, two identical builds, MCP sample call from `paybox-plugin.json`) and needs Node.js 24. The files in `scripts/` come from PayBox starter 1.0.2.
