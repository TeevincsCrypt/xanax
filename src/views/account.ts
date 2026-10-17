import { APP_NAME, config, explorerTxUrl } from "../config.js";
import { buyUrl, formatUsd } from "../catalog.js";
import type { Merchant, Order, Product, User } from "../db.js";
import { layout } from "./layout.js";
import { downloadLink } from "../receipt.js";
import { html } from "./html.js";

function when(iso: string) {
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

export function loginPage(mode: "login" | "logout", next: string): string {
  if (!config.authEnabled) {
    return layout(
      `Sign in · ${APP_NAME}`,
      html`<div class="receipt"><h1 style="font-size:32px">Sign-in isn't set up yet</h1><p class="muted">The site owner needs to add <code>PRIVY_APP_ID</code>. Your stores still work through their private dashboard links.</p></div>`,
      { noindex: true },
    );
  }
  return layout(
    `${mode === "logout" ? "Signing out" : "Sign in"} · ${APP_NAME}`,
    html`
<div class="receipt" style="text-align:center;max-width:480px">
  <div class="eyebrow" style="margin:0 auto 18px"><i></i>Secured by Privy</div>
  <h1 style="font-size:clamp(30px,5vw,40px)">${mode === "logout" ? "Signing out…" : "Sign in to Xanax"}</h1>
  ${mode === "login" ? html`<p class="muted" style="margin:0 auto 24px;max-width:340px">Keep your stores, sales, purchases and receipts in one place. Email, Google or a wallet.</p>` : ""}
  <div id="privy-root" data-app-id="${config.PRIVY_APP_ID ?? ""}" data-mode="${mode}" data-next="${next}"></div>
  <noscript><p class="muted">Sign-in needs JavaScript.</p></noscript>
</div>
<script type="module" src="/js/auth.js"></script>`,
    { noindex: true },
  );
}

export interface AccountData {
  user: User;
  stores: Array<{ merchant: Merchant; products: Product[]; orders: Order[] }>;
  sales: Array<{ order: Order; product?: Product; merchant: Merchant }>;
  purchases: Array<{ order: Order; product?: Product; merchant?: Merchant }>;
}

export function accountPage(d: AccountData): string {
  const revenue = d.sales.reduce((s, x) => s + x.order.amount_cents, 0);
  const listings = d.stores.reduce((n, s) => n + s.products.filter((p) => p.active).length, 0);
  type Activity = { at: string; text: string; href?: string; tag: string; cls: string };
  const activity: Activity[] = [
    ...d.sales.map((x) => ({
      at: x.order.created_at,
      text: `Sold ${x.order.quantity} × ${x.product?.name ?? "item"} for $${formatUsd(x.order.amount_cents)}`,
      href: `/account/stores/${x.merchant.id}`,
      tag: "Sale",
      cls: "ok",
    })),
    ...d.purchases.map((x) => ({
      at: x.order.created_at,
      text: `Bought ${x.order.quantity} × ${x.product?.name ?? "item"} from ${x.merchant?.business_name ?? "a merchant"} for $${formatUsd(x.order.amount_cents)}`,
      href: `/r/${x.order.id}`,
      tag: "Purchase",
      cls: "blue",
    })),
    ...d.stores.flatMap((s) =>
      s.products.map((p) => ({ at: p.created_at, text: `Listed “${p.name}” at $${formatUsd(p.price_cents)}`, href: `/account/stores/${s.merchant.id}`, tag: "Listing", cls: "" })),
    ),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);

  return layout(
    `Account · ${APP_NAME}`,
    html`
<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap">
  <div><div class="muted small">Signed in as</div><h1 style="margin:4px 0 0">${d.user.email ?? (d.user.wallet ? `${d.user.wallet.slice(0, 6)}…${d.user.wallet.slice(-4)}` : "your account")}</h1></div>
  <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="/sell">New listing</a><a class="btn ghost" href="/logout">Sign out</a></div>
</div>

<div class="grid" style="margin-top:20px">
  <div class="card soft"><div class="muted small">Live listings</div><div class="big">${listings}</div></div>
  <div class="card soft"><div class="muted small">Sales</div><div class="big">${d.sales.length}</div></div>
  <div class="card soft"><div class="muted small">Revenue (USDC)</div><div class="big">$${formatUsd(revenue)}</div></div>
  <div class="card soft"><div class="muted small">Purchases</div><div class="big">${d.purchases.length}</div></div>
</div>

<h2>Your stores</h2>
${
  d.stores.length === 0
    ? html`<div class="card muted">No stores yet. <a href="/sell">Create a listing</a>. Already have one? Open its private dashboard link while signed in and click “Save to my account”.</div>`
    : html`<div class="grid">${d.stores.map(
        (s) => html`<a class="card" href="/account/stores/${s.merchant.id}" style="color:inherit;text-decoration:none">
  <div class="muted small">${s.products.length} product${s.products.length === 1 ? "" : "s"} · ${s.orders.length} order${s.orders.length === 1 ? "" : "s"}</div>
  <h3 style="margin-top:6px">${s.merchant.business_name}</h3>
  <div class="muted tiny mono" style="word-break:break-all">${s.products[0] ? buyUrl(s.products[0].id) : ""}</div>
  <div style="margin-top:12px"><span class="pill blue">Open dashboard →</span></div>
</a>`,
      )}</div>`
}

<h2>Recent activity</h2>
${
  activity.length === 0
    ? html`<div class="card muted">Nothing yet.</div>`
    : html`<div class="tablewrap card" style="padding:8px 14px"><table>${activity.map(
        (a) => html`<tr><td class="tiny muted" style="white-space:nowrap">${when(a.at)}</td><td><span class="pill ${a.cls}">${a.tag}</span></td><td>${a.href ? html`<a href="${a.href}" style="color:inherit">${a.text}</a>` : a.text}</td></tr>`,
      )}</table></div>`
}

<h2>Purchases</h2>
<p class="muted small" style="margin-top:-8px">Orders paid with ${d.user.email ? html`<b>${d.user.email}</b> as the buyer email` : "your email"}${d.user.wallet ? html` or from your wallet <span class="mono">${d.user.wallet.slice(0, 6)}…${d.user.wallet.slice(-4)}</span>` : ""}.</p>
${
  d.purchases.length === 0
    ? html`<div class="card muted">No purchases found yet.</div>`
    : html`<div class="tablewrap card" style="padding:8px 14px"><table>
<tr><th>When</th><th>Item</th><th>Merchant</th><th>Amount</th><th>Receipt</th></tr>
${d.purchases.map(
  (x) => html`<tr><td class="tiny">${when(x.order.created_at)}</td><td>${x.order.quantity} × ${x.product?.name ?? "item"}</td><td>${x.merchant?.business_name ?? ""}</td><td>$${formatUsd(x.order.amount_cents)}</td>
<td>${x.product?.kind === "digital" ? html`<a class="btn sm blue" href="${downloadLink(x.order.id).url}">Download</a> ` : ""}<a class="btn sm ghost" href="/r/${x.order.id}">View</a> <a class="btn sm ghost" href="/r/${x.order.id}.pdf">PDF</a> <a class="tiny" href="${explorerTxUrl(x.order.tx_hash, x.order.network)}" target="_blank" rel="noopener">tx</a></td></tr>`,
)}
</table></div>`
}`,
    { noindex: true },
  );
}
