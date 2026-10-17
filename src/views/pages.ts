import { APP_NAME, config, explorerTxUrl } from "../config.js";
import { buyUrl, formatUsd } from "../catalog.js";
import { BUYER_FIELDS, type Merchant, type Order, type Product } from "../db.js";
import { copyField, layout } from "./layout.js";
import { html, raw, type SafeHtml } from "./html.js";

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  shipping_address: "Shipping address",
  note: "Note",
};

/** Stable hue per product name, for the image-less product tile. */
function hue(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function shortHash(h: string) {
  return h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h;
}

export function buyerPrompt(p: Product, merchantName: string): string {
  const needs = p.required_fields.map((f) => FIELD_LABELS[f]!.toLowerCase());
  const tail = needs.length ? ` with my ${needs.join(", ").replace(/, ([^,]*)$/, " and $1")}` : "";
  return `Use PayBox to buy 1 × ${p.name} from ${merchantName}: use_service with method POST on ${buyUrl(p.id)}${tail}.`;
}

const ART = {
  arrow: `<svg width="124" height="124" viewBox="0 0 124 124"><defs><radialGradient id="ga" cx=".35" cy=".3" r=".8"><stop stop-color="#c9ff9a"/><stop offset=".45" stop-color="#3fc24a"/><stop offset="1" stop-color="#0d6b2a"/></radialGradient></defs>
<circle cx="62" cy="62" r="56" fill="url(#ga)"/><circle cx="62" cy="62" r="40" fill="none" stroke="#d9ffc0" stroke-opacity=".55" stroke-width="5"/>
<path d="M44 80 78 46M56 44h24v24" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M44 80 78 46" stroke="#1d2a9a" stroke-width="3" stroke-linecap="round"/></svg>`,
  check: `<svg width="190" height="190" viewBox="0 0 190 190"><defs><radialGradient id="gc" cx=".4" cy=".35" r=".75"><stop stop-color="#fff"/><stop offset="1" stop-color="#dfe4ff"/></radialGradient><radialGradient id="gg" cx=".4" cy=".35" r=".8"><stop stop-color="#9dff86"/><stop offset="1" stop-color="#1f9c3a"/></radialGradient></defs>
<circle cx="95" cy="95" r="88" fill="url(#gc)"/>${Array.from({ length: 34 }, (_, i) => {
    const a = (i * 137.5 * Math.PI) / 180, r = 22 + ((i * 53) % 62);
    const c = ["#1d2a9a", "#3fc24a", "#f5c33b", "#3cc3f2", "#f26b9b"][i % 5];
    return `<circle cx="${(95 + Math.cos(a) * r).toFixed(1)}" cy="${(95 + Math.sin(a) * r).toFixed(1)}" r="${2 + (i % 3)}" fill="${c}" opacity=".8"/>`;
  }).join("")}
<circle cx="95" cy="95" r="58" fill="url(#gg)" opacity=".92"/><circle cx="95" cy="95" r="40" fill="#2440ff" stroke="#c9d3ff" stroke-width="5"/>
<path d="M76 96l13 13 26-28" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
  usdc: `<svg width="128" height="128" viewBox="0 0 128 128"><defs><radialGradient id="gu" cx=".35" cy=".3" r=".85"><stop stop-color="#f1f3f8"/><stop offset=".6" stop-color="#9aa1b5"/><stop offset="1" stop-color="#4e5568"/></radialGradient></defs>
<circle cx="64" cy="64" r="60" fill="url(#gu)"/><circle cx="64" cy="64" r="46" fill="#3a4152" opacity=".55"/>
<circle cx="64" cy="64" r="32" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="50 14" transform="rotate(-60 64 64)"/>
<text x="64" y="78" text-anchor="middle" font-family="Inter Tight,Arial" font-weight="800" font-size="40" fill="#fff">$</text></svg>`,
  ring: `<svg width="150" height="150" viewBox="0 0 150 150"><defs><linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f4f5f8"/><stop offset=".5" stop-color="#9ea4b4"/><stop offset="1" stop-color="#e7e9ef"/></linearGradient></defs>
<ellipse cx="75" cy="75" rx="58" ry="40" fill="none" stroke="url(#gr)" stroke-width="22" transform="rotate(-35 75 75)"/></svg>`,
  yring: `<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="22" fill="none" stroke="#f5c33b" stroke-width="8"/><circle cx="32" cy="32" r="22" fill="none" stroke="#fff3c4" stroke-width="2" stroke-dasharray="20 120"/></svg>`,
  coin402: `<svg width="150" height="150" viewBox="0 0 150 150"><defs><radialGradient id="gb" cx=".35" cy=".3" r=".85"><stop stop-color="#c8d2ff"/><stop offset=".55" stop-color="#6c7fd6"/><stop offset="1" stop-color="#2b367f"/></radialGradient></defs>
<circle cx="75" cy="75" r="68" fill="url(#gb)"/><circle cx="75" cy="75" r="54" fill="none" stroke="#dfe5ff" stroke-opacity=".6" stroke-width="3"/>
<text x="75" y="90" text-anchor="middle" font-family="Inter Tight,Arial" font-weight="800" font-size="40" fill="#eef1ff">402</text></svg>`,
};

function heroStage(): SafeHtml {
  return html`<div class="stage" aria-hidden="true">
  <div class="blob" style="left:-18%;top:30%;width:70%;height:42%;opacity:.9;border-radius:48% 52% 40% 60%;background:#0f1a9a"></div>
  <div class="blob" style="right:-6%;bottom:16%;width:38%;height:22%;background:#0b0f3d;transform:rotate(-24deg)"></div>
  <div class="blob" style="right:6%;bottom:30%;width:22%;height:14%;background:#f5c33b;border-radius:100px 100px 0 0;transform:rotate(-24deg)"></div>
  <div class="blob" style="left:8%;bottom:4%;width:56%;height:10%;background:#0a137a;opacity:.55;filter:blur(6px)"></div>
  <div class="phone"><div class="notch"></div><div class="time">9:41</div>
    <div class="title">Agent<br>Checkout</div>
    <div class="rc c1"><span class="ic"></span><b>402 · Payment required</b>$0.50 · USDC on Base</div>
    <div class="rc c2"><span class="ic"></span><b>Approved with passkey</b>PayBox · use_service</div>
    <div class="rc c3"><span class="ic"></span><b>Settled on-chain</b>Paid to merchant wallet</div>
    <div class="rc c4"><span class="ic"></span><b>Receipt xnx_7k2m…</b>Merchant notified ✓</div>
  </div>
  <div class="float" style="left:44%;top:6%;--rot:-8deg">${raw(ART.arrow)}</div>
  <div class="float f2" style="right:-2%;top:2%;--rot:0deg">${raw(ART.ring)}</div>
  <div class="float f3" style="left:46%;top:34%;--rot:0deg">${raw(ART.check)}</div>
  <div class="float" style="right:2%;top:38%;--rot:12deg">${raw(ART.usdc)}</div>
  <div class="float f2" style="right:24%;top:5%;--rot:0deg">${raw(ART.yring)}</div>
  <div class="float f3" style="left:46%;bottom:2%;--rot:-10deg">${raw(ART.coin402)}</div>
  <span class="dot" style="left:56%;top:4%"></span><span class="dot" style="left:8%;top:62%"></span><span class="dot" style="right:12%;top:30%;width:6px;height:6px"></span>
</div>`;
}

export interface LandingStats {
  products: number;
  orders: number;
  volumeCents: number;
}

export function landingPage(list: Array<Product & { business_name: string }>, stats: LandingStats): string {
  return layout(
    `${APP_NAME}: let AI agents buy from you`,
    html`
<section class="hero">
  ${heroStage()}
  <div class="copyblock">
    <span class="eyebrow"><i></i>Live on ${config.network.testnet ? "Base Sepolia" : "Base"} · Works with PayBox</span>
    <h1>Checkout made simple for <span>AI agents</span></h1>
    <p class="lead">Turn anything you sell into something an agent can buy. No Stripe account, no integration: fill one form, get an x402 link, and get paid in USDC straight to your wallet.</p>
    <p style="margin:28px 0 0;display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="/sell">Start selling, free</a><a class="btn ghost" href="#how">How it works</a></p>
    <div class="stats">
      <div class="stat"><div class="ico">🛍</div><div class="n">${stats.products}</div><div class="l">Products agents can buy</div></div>
      <div class="vr"></div>
      <div class="stat"><div class="ico">⚡</div><div class="n">${stats.orders}</div><div class="l">Orders paid by agents</div></div>
      <div class="vr"></div>
      <div class="stat"><div class="ico">%</div><div class="n">0%</div><div class="l">Platform fee, ever</div></div>
    </div>
  </div>
</section>

<h2 id="how">Three steps. No integration.</h2>
<div class="steps3">
  <div class="card soft"><div class="num">1</div><h3>Describe your product</h3><p class="muted small">Name, price in USD, your Base wallet, and where orders should go: webhook, email or just your dashboard.</p></div>
  <div class="card soft"><div class="num">2</div><h3>Share your agent link</h3><p class="muted small">You get a URL that speaks x402, the internet-native "402 Payment Required" standard, plus a ready-made buyer prompt.</p></div>
  <div class="card soft"><div class="num">3</div><h3>Agents buy, you get paid</h3><p class="muted small">A buyer's agent pays through PayBox. USDC lands in your wallet, you get the order, they get a receipt.</p></div>
</div>

<h2 id="agents">Built for agents</h2>
<div class="card dark">
<ul class="agentlist">
  <li><span class="k">1</span><div><b>Find</b> a product, free: <code>GET ${config.BASE_URL}/api/products?q=coffee</code></div></li>
  <li><span class="k">2</span><div><b>Buy</b> it with PayBox <code>use_service</code>: <code>method: "POST"</code>, <code>url: ${config.BASE_URL}/buy/{id}?qty=1</code>, <code>body: {"buyer": {…}}</code></div></li>
  <li><span class="k">3</span><div><b>Get</b> a JSON receipt: order ID, transaction hash and next steps, or an instant download.</div></li>
</ul>
<p class="small muted" style="margin:18px 0 0">Full instructions at <a href="/llms.txt" style="color:#9fb0ff">/llms.txt</a> · x402 v2 · USDC on ${config.network.testnet ? "Base Sepolia" : "Base"} · Nobody pays for a sold-out item or an incomplete order.</p>
</div>

<h2 id="products">Live products</h2>
${
  list.length === 0
    ? html`<p class="muted">No products yet. <a href="/sell">Be the first.</a></p>`
    : html`<div class="grid">${list.map(
        (p) => html`<div class="card prod">
  ${p.image_url ? html`<img src="${p.image_url}" alt="" loading="lazy" referrerpolicy="no-referrer">` : html`<div class="tile" style="--h:${hue(p.name)}">${p.name.slice(0, 1).toUpperCase()}</div>`}
  <div class="muted small">${p.business_name}</div>
  <h3>${p.name}</h3>
  <p class="muted small" style="margin:0">${p.description.length > 140 ? p.description.slice(0, 140) + "…" : p.description}</p>
  <div class="foot">
    <span class="price">$${formatUsd(p.price_cents)}</span>
    ${p.stock !== null && p.stock <= 0 ? html`<span class="pill bad">Sold out</span>` : p.kind === "digital" ? html`<span class="pill ok">Instant delivery</span>` : html`<span class="pill blue">Ships</span>`}
  </div>
  <p class="tiny muted mono" style="margin:12px 0 0;word-break:break-all">POST ${buyUrl(p.id)}</p>
</div>`,
      )}</div>`
}
`,
  );
}

export interface SellValues {
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
}

export function sellPage(values: SellValues = {}, errors: string[] = []): string {
  const req = new Set(values.required_fields ?? ["name", "email"]);
  return layout(
    `Start selling to agents · ${APP_NAME}`,
    html`
<h1 style="font-size:clamp(28px,5vw,40px)">Sell to AI agents</h1>
<p class="lead">Takes about two minutes. You'll get an agent link, a dashboard, and a signing secret for your webhook.</p>
${errors.length ? html`<div class="alert bad"><b>Please fix:</b><ul style="margin:6px 0 0">${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ""}
<form class="card" method="post" action="/sell" style="margin-top:18px">
  <div class="row">
    <div><label for="business_name">Business name</label><input id="business_name" name="business_name" required maxlength="80" value="${values.business_name ?? ""}" placeholder="Ada's Roastery"></div>
    <div><label for="product_name">Product name</label><input id="product_name" name="product_name" required maxlength="120" value="${values.product_name ?? ""}" placeholder="Single-origin coffee, 250g"></div>
  </div>
  <label for="description">Description</label>
  <textarea id="description" name="description" required maxlength="500" rows="3" placeholder="What the buyer gets. Agents read this.">${values.description ?? ""}</textarea>
  <div class="hint">Up to 500 characters.</div>
  <div class="row">
    <div><label for="price_usd">Price (USD, paid in USDC)</label><input id="price_usd" name="price_usd" required inputmode="decimal" value="${values.price_usd ?? ""}" placeholder="12.00"><div class="hint">$0.01 to $${config.MAX_PRICE_USD}.</div></div>
    <div><label for="stock">Stock (optional)</label><input id="stock" name="stock" inputmode="numeric" value="${values.stock ?? ""}" placeholder="Unlimited"></div>
  </div>
  <label for="image_url">Image URL (optional)</label><input id="image_url" name="image_url" type="url" value="${values.image_url ?? ""}" placeholder="https://…">
  <label for="payout_address">Your Base wallet address</label>
  <input id="payout_address" name="payout_address" required class="mono" value="${values.payout_address ?? ""}" placeholder="0x…" autocomplete="off" spellcheck="false">
  <div class="hint">USDC on Base goes straight here. ${APP_NAME} never holds your money. Double-check it.</div>

  <h3 style="margin-top:26px">How do you want to receive orders?</h3>
  <div class="row">
    <div><label for="webhook_url">Webhook URL</label><input id="webhook_url" name="webhook_url" type="url" value="${values.webhook_url ?? ""}" placeholder="https://your-server.com/orders"><div class="hint">https only. Signed with HMAC-SHA256.</div></div>
    <div><label for="email">Email${config.emailEnabled ? "" : " (for your records)"}</label><input id="email" name="email" type="email" value="${values.email ?? ""}" placeholder="you@business.com"></div>
  </div>
  <div class="hint">At least one of these. Every order also shows up in your dashboard.</div>

  <h3 style="margin-top:26px">What must the buyer provide?</h3>
  <div class="checks">${BUYER_FIELDS.map(
    (f) => html`<label><input type="checkbox" name="required_fields" value="${f}" ${req.has(f) ? raw("checked") : ""}> ${FIELD_LABELS[f]}</label>`,
  )}</div>
  <div class="hint">If the agent leaves out a required field, the request fails <b>before</b> payment, so nobody is charged.</div>

  <h3 style="margin-top:26px">Delivery</h3>
  <div class="checks">
    <label><input type="radio" name="kind" value="physical" ${values.kind !== "digital" ? raw("checked") : ""}> I'll fulfil it myself (goods, services)</label>
    <label><input type="radio" name="kind" value="digital" ${values.kind === "digital" ? raw("checked") : ""}> Instant digital delivery</label>
  </div>
  <label for="delivery_url">Digital: file URL (optional)</label><input id="delivery_url" name="delivery_url" type="url" value="${values.delivery_url ?? ""}" placeholder="https://… (we hand out a signed link that redirects here)">
  <label for="delivery_text">Digital: content (optional)</label><textarea id="delivery_text" name="delivery_text" rows="3" maxlength="20000" placeholder="License key, guide, or any text the buyer gets right after paying.">${values.delivery_text ?? ""}</textarea>

  <p style="margin-top:24px"><button class="btn" type="submit">Create my agent link</button></p>
</form>`,
    { noindex: false },
  );
}

export function sellSuccessPage(args: { product: Product; merchant: Merchant; dashboardUrl: string; webhookSecret: string }): string {
  const { product, merchant, dashboardUrl, webhookSecret } = args;
  return layout(
    `You're live · ${APP_NAME}`,
    html`
<h1 style="font-size:clamp(28px,5vw,40px)">You're live. Agents can buy “${product.name}”.</h1>
<div class="alert warn"><b>Save this page now.</b> Your dashboard link and webhook secret are shown only once; we store just a hash.</div>
<div class="card">
  <label>Agent product URL</label>${copyField("buyurl", buyUrl(product.id))}
  <div class="hint">x402-protected. $${formatUsd(product.price_cents)} per unit, paid in USDC to <span class="mono">${merchant.payout_address}</span>.</div>
  <label>Ready-to-paste prompt for a buyer (Claude, ChatGPT or Grok with PayBox)</label>${copyField("prompt", buyerPrompt(product, merchant.business_name), true)}
  <label>Your private dashboard (save it!)</label>${copyField("dash", dashboardUrl)}
  <label>Webhook signing secret (save it!)</label>${copyField("secret", webhookSecret)}
  <div class="hint">Verify <code>X-Xanax-Signature: sha256=HMAC_SHA256(secret, X-Xanax-Timestamp + "." + raw_body)</code>.</div>
  <p style="margin-top:20px"><a class="btn" href="${dashboardUrl}">Open dashboard</a> <a class="btn ghost" href="/api/products/${product.id}">See the agent view</a></p>
</div>`,
    { noindex: true },
  );
}

function statusPill(o: Order) {
  return o.status === "fulfilled" ? html`<span class="pill ok">Fulfilled</span>` : html`<span class="pill warn">Paid · to fulfil</span>`;
}

function webhookPill(o: Order) {
  const map = { none: ["", "—"], pending: ["warn", "retrying"], delivered: ["ok", "delivered"], failed: ["bad", "failed"] } as const;
  const [cls, label] = map[o.webhook_status];
  return html`<span class="pill ${cls}" title="${o.webhook_last_error ?? ""}">${label}</span>`;
}

export function dashboardPage(args: { merchant: Merchant; products: Product[]; orders: Order[]; token: string; flash?: string }): string {
  const { merchant, products, orders, token, flash } = args;
  const byId = new Map(products.map((p) => [p.id, p]));
  const revenue = orders.reduce((s, o) => s + o.amount_cents, 0);
  return layout(
    `${merchant.business_name} · Dashboard · ${APP_NAME}`,
    html`
<h1 style="font-size:clamp(28px,5vw,40px)">${merchant.business_name}</h1>
<p class="muted small">Payouts to <a class="mono" href="${config.network.explorer}/address/${merchant.payout_address}" target="_blank" rel="noopener">${merchant.payout_address}</a> · Webhook: ${merchant.webhook_url ?? "none"} · Email: ${merchant.email ?? "none"}</p>
${flash ? html`<div class="alert ok">${flash}</div>` : ""}
<div class="grid">
  <div class="card"><div class="muted small">Orders</div><div class="big">${orders.length}</div></div>
  <div class="card"><div class="muted small">Revenue (USDC)</div><div class="big">$${formatUsd(revenue)}</div></div>
  <div class="card"><div class="muted small">To fulfil</div><div class="big">${orders.filter((o) => o.status === "paid").length}</div></div>
</div>

<h2>Products</h2>
<div class="tablewrap card" style="padding:8px 14px"><table>
<tr><th>Product</th><th>Price</th><th>Stock</th><th>Agent URL</th></tr>
${products.map(
  (p) => html`<tr><td><b>${p.name}</b><div class="muted tiny">${p.kind === "digital" ? "Instant digital delivery" : "You fulfil"} · requires: ${p.required_fields.join(", ") || "nothing"}</div></td>
<td>$${formatUsd(p.price_cents)}</td><td>${p.active ? p.stock ?? "∞" : html`<span class="pill bad">Removed</span>`}</td><td class="mono tiny" style="word-break:break-all">${buyUrl(p.id)}</td></tr>`,
)}
</table></div>

<h2>Orders</h2>
${
  orders.length === 0
    ? html`<div class="card muted">No orders yet. Share your agent URL, or paste the buyer prompt into Claude with PayBox connected.</div>`
    : html`<div class="tablewrap card" style="padding:8px 14px"><table>
<tr><th>When</th><th>Order</th><th>Qty × item</th><th>Amount</th><th>Buyer</th><th>Tx</th><th>Webhook</th><th>Status</th></tr>
${orders.map((o) => {
  const p = byId.get(o.product_id);
  return html`<tr>
<td class="tiny">${o.created_at.replace("T", " ").slice(0, 16)} UTC</td>
<td class="mono tiny"><a href="/r/${o.id}">${o.id}</a></td>
<td>${o.quantity} × ${p?.name ?? o.product_id}</td>
<td>$${formatUsd(o.amount_cents)}</td>
<td class="small">${Object.keys(o.buyer).length ? Object.entries(o.buyer).map(([k, v]) => html`<div><span class="muted">${FIELD_LABELS[k] ?? k}:</span> ${v}</div>`) : html`<span class="muted">—</span>`}</td>
<td class="mono tiny"><a href="${explorerTxUrl(o.tx_hash, o.network)}" target="_blank" rel="noopener">${shortHash(o.tx_hash)}</a></td>
<td>${webhookPill(o)}${merchant.webhook_url ? html`<form method="post" action="/m/${token}/orders/${o.id}/resend" style="margin-top:6px"><button class="btn sm ghost" type="submit">Resend</button></form>` : ""}</td>
<td>${statusPill(o)}${o.status === "paid" ? html`<form method="post" action="/m/${token}/orders/${o.id}/fulfil" style="margin-top:6px"><button class="btn sm" type="submit">Mark fulfilled</button></form>` : ""}</td>
</tr>`;
})}
</table></div>`
}
<p class="tiny muted" style="margin-top:20px">This page's URL is your login. Don't share it.</p>`,
    { noindex: true },
  );
}

export function receiptPage(order: Order, product: Product, merchant: Merchant): string {
  return layout(
    `Receipt ${order.id} · ${APP_NAME}`,
    html`
<div class="card" style="max-width:620px;margin:20px auto">
  <span class="pill ok">Paid</span>
  <h1 style="font-size:32px;margin:14px 0 4px">$${formatUsd(order.amount_cents)} <span class="muted" style="font-size:18px">USDC</span></h1>
  <p class="muted" style="margin-top:0">${order.quantity} × ${product.name} from <b>${merchant.business_name}</b></p>
  <dl class="kv">
    <dt>Order</dt><dd class="mono">${order.id}</dd>
    <dt>Date</dt><dd>${order.created_at.replace("T", " ").slice(0, 19)} UTC</dd>
    <dt>Network</dt><dd>${order.network === "base" ? "Base" : "Base Sepolia"}</dd>
    <dt>Transaction</dt><dd class="mono"><a href="${explorerTxUrl(order.tx_hash, order.network)}" target="_blank" rel="noopener">${order.tx_hash}</a></dd>
    <dt>Paid to</dt><dd class="mono">${merchant.payout_address}</dd>
    <dt>Status</dt><dd>${order.status === "fulfilled" ? "Fulfilled" : product.kind === "digital" ? "Delivered" : "Paid, awaiting fulfilment"}</dd>
  </dl>
  <p class="tiny muted" style="margin-top:18px">Paid by an AI agent via x402. Funds went directly to the merchant's wallet. Buyer details are private to the merchant.</p>
</div>`,
    { noindex: true },
  );
}

export function downloadPage(order: Order, product: Product, merchant: Merchant, txtUrl: string): string {
  return layout(
    `${product.name} · ${APP_NAME}`,
    html`
<div class="card" style="max-width:760px;margin:20px auto">
  <span class="pill ok">Delivered</span>
  <h1 style="font-size:30px;margin:12px 0 4px">${product.name}</h1>
  <p class="muted" style="margin-top:0">from ${merchant.business_name} · order <a class="mono" href="/r/${order.id}">${order.id}</a></p>
  <pre style="font-size:15px;line-height:1.6">${product.delivery_text ?? ""}</pre>
  <p><a class="btn sm ghost" href="${txtUrl}">Download as .txt</a></p>
</div>`,
    { noindex: true },
  );
}

export function messagePage(title: string, message: string, status = "bad"): string {
  return layout(`${title} · ${APP_NAME}`, html`<div class="card" style="max-width:620px;margin:40px auto"><span class="pill ${status}">${title}</span><p>${message}</p><p><a href="/">← Home</a></p></div>`, { noindex: true });
}
