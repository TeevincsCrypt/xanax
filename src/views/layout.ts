import { APP_NAME, config } from "../config.js";
import { html, raw, type SafeHtml } from "./html.js";

const CSS = `
:root{--bg:#f7f6f2;--card:#fff;--ink:#16161a;--muted:#62626b;--line:#e4e2db;--accent:#3b5bfd;--accent-ink:#fff;--ok:#0f8a4b;--warn:#b25e00;--bad:#c62828;--code:#f0efe9;
--r:14px;--shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.05)}
@media (prefers-color-scheme:dark){:root{--bg:#0f0f12;--card:#17171c;--ink:#f1f1f3;--muted:#a0a0aa;--line:#2a2a31;--accent:#7b93ff;--accent-ink:#0f0f12;--code:#202027;--shadow:none}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
header.top{display:flex;align-items:center;justify-content:space-between;padding:18px 0}
.brand{font-weight:800;font-size:20px;letter-spacing:-.02em;color:var(--ink)}.brand span{color:var(--accent)}
nav a{margin-left:18px;color:var(--muted);font-size:15px}
h1{font-size:clamp(32px,6vw,54px);line-height:1.05;letter-spacing:-.035em;margin:28px 0 14px}
h2{font-size:24px;letter-spacing:-.02em;margin:36px 0 12px}h3{margin:0 0 6px;font-size:17px}
.lead{font-size:clamp(17px,2.4vw,20px);color:var(--muted);max-width:640px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:22px;box-shadow:var(--shadow)}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.btn{display:inline-block;background:var(--accent);color:var(--accent-ink);border:0;border-radius:999px;padding:12px 22px;font-weight:650;font-size:16px;cursor:pointer}
.btn:hover{text-decoration:none;filter:brightness(1.08)}.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.btn.sm{padding:7px 14px;font-size:14px}
.muted{color:var(--muted)}.small{font-size:14px}.tiny{font-size:12.5px}
.pill{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12.5px;font-weight:600;background:var(--code);color:var(--muted)}
.pill.ok{background:rgba(15,138,75,.12);color:var(--ok)}.pill.warn{background:rgba(178,94,0,.12);color:var(--warn)}.pill.bad{background:rgba(198,40,40,.12);color:var(--bad)}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13.5px}
code{background:var(--code);padding:2px 6px;border-radius:6px}
pre{background:var(--code);padding:14px;border-radius:10px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.copy{display:flex;gap:8px;align-items:stretch}.copy input,.copy textarea{flex:1;min-width:0}
label{display:block;font-weight:600;font-size:14px;margin:16px 0 6px}
input,textarea,select{width:100%;font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:11px 12px}
input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:-1px}
.row{display:grid;gap:14px;grid-template-columns:1fr 1fr}@media (max-width:640px){.row{grid-template-columns:1fr}}
.checks{display:flex;flex-wrap:wrap;gap:8px 18px}.checks label{display:flex;align-items:center;gap:8px;font-weight:500;margin:0}.checks input{width:auto}
.hint{font-size:13px;color:var(--muted);margin-top:5px}
.alert{border-radius:10px;padding:12px 14px;margin:14px 0;font-size:15px}.alert.bad{background:rgba(198,40,40,.1);color:var(--bad)}.alert.warn{background:rgba(178,94,0,.1);color:var(--warn)}.alert.ok{background:rgba(15,138,75,.1);color:var(--ok)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:13px}
.tablewrap{overflow-x:auto}
.steps{counter-reset:s;list-style:none;padding:0}.steps li{counter-increment:s;position:relative;padding:0 0 14px 44px}.steps li:before{content:counter(s);position:absolute;left:0;top:0;width:30px;height:30px;border-radius:50%;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;font-weight:700;font-size:14px}
.price{font-size:22px;font-weight:750;letter-spacing:-.02em}
.tile{aspect-ratio:16/10;border-radius:10px;margin-bottom:12px;display:grid;place-items:center;font-size:64px;font-weight:800;color:#fff;background:linear-gradient(135deg,hsl(var(--h) 70% 55%),hsl(calc(var(--h) + 40) 70% 40%))}
.pill{white-space:nowrap}
.prod img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:10px;margin-bottom:12px;background:var(--code)}
footer{padding:40px 0;color:var(--muted);font-size:14px}
.big{font-size:44px;font-weight:800;letter-spacing:-.03em}
.kv{display:grid;grid-template-columns:140px 1fr;gap:8px 14px;font-size:15px}.kv dt{color:var(--muted)}.kv dd{margin:0;word-break:break-all}
@media (max-width:520px){.kv{grid-template-columns:1fr}.kv dt{margin-top:6px}}
`;

const COPY_JS = `document.addEventListener('click',e=>{const b=e.target.closest('[data-copy]');if(!b)return;const el=document.getElementById(b.dataset.copy);navigator.clipboard.writeText(el.value??el.textContent).then(()=>{const t=b.textContent;b.textContent='Copied';setTimeout(()=>b.textContent=t,1200)})})`;

export function layout(title: string, body: SafeHtml, opts: { description?: string; noindex?: boolean } = {}): string {
  return html`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${opts.description ?? `${APP_NAME}: let AI agents buy from your business. Paid in USDC, straight to your wallet.`}">
${opts.noindex ? raw('<meta name="robots" content="noindex">') : ""}
<link rel="alternate" type="text/plain" href="/llms.txt" title="Instructions for AI agents">
<style>${raw(CSS)}</style>
</head><body>
<div class="wrap">
<header class="top"><a class="brand" href="/">${APP_NAME}<span>.</span></a>
<nav><a href="/#how">How it works</a><a href="/llms.txt">For agents</a><a href="/sell">Sell</a></nav></header>
${body}
<footer>${APP_NAME} · agent checkout over x402 · USDC on ${config.network.testnet ? "Base Sepolia (testnet)" : "Base"} · Works with PayBox · Funds go straight to merchant wallets; ${APP_NAME} never holds them.</footer>
</div>
<script>${raw(COPY_JS)}</script>
</body></html>`.value;
}

export function copyField(id: string, value: string, multiline = false): SafeHtml {
  return html`<div class="copy">${
    multiline
      ? html`<textarea id="${id}" rows="3" readonly>${value}</textarea>`
      : html`<input id="${id}" value="${value}" readonly>`
  }<button type="button" class="btn sm ghost" data-copy="${id}">Copy</button></div>`;
}
