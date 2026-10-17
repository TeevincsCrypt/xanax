import { APP_NAME, config } from "../config.js";
import { html, raw, type SafeHtml } from "./html.js";

const CSS = `
:root{--page:#0b0b10;--card:#fff;--ink:#0d0d12;--muted:#6b6f7b;--soft:#f4f5f8;--line:#e9ebf0;
--blue:#2f4bff;--blue-2:#1a2fd8;--cyan:#3cc3f2;--navy:#16206e;--ok:#0f8a4b;--warn:#b25e00;--bad:#c62828;
--r:18px;--font:"Inter Tight","Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--ink);font:16px/1.55 var(--font);-webkit-font-smoothing:antialiased}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
.frame{max-width:1200px;margin:24px auto;background:var(--card);border-radius:30px;overflow:hidden;min-height:calc(100vh - 48px)}
@media (max-width:700px){.frame{margin:0;border-radius:0;min-height:100vh}}
.wrap{padding:0 clamp(16px,4vw,44px)}
header.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:24px clamp(16px,4vw,44px)}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:22px;letter-spacing:-.03em;color:var(--ink)}.brand:hover{text-decoration:none}
.brand svg{width:34px;height:34px}
nav.pills{display:flex;align-items:center;gap:4px;background:var(--soft);border-radius:999px;padding:5px}
nav.pills a{color:#4b4f5c;font-size:14px;font-weight:500;padding:7px 14px;border-radius:999px}nav.pills a:hover{background:#fff;text-decoration:none}
nav.pills a.cta{background:var(--ink);color:#fff;font-weight:600}nav.pills a.cta:hover{background:#26262e}
@media (max-width:640px){nav.pills a.hide-sm{display:none}}
h1{font-size:clamp(40px,6vw,70px);line-height:1;letter-spacing:-.032em;word-spacing:.04em;margin:0 0 20px;font-weight:800}
h2{font-size:clamp(26px,3.4vw,36px);letter-spacing:-.025em;word-spacing:.04em;margin:64px 0 18px;font-weight:800;line-height:1.05}
h3{margin:0 0 6px;font-size:18px;letter-spacing:-.02em}
.lead{font-size:clamp(16px,1.6vw,18px);color:var(--muted);max-width:460px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--blue);background:#eef1ff;border-radius:999px;padding:6px 12px;margin-bottom:20px}
.eyebrow i{width:7px;height:7px;border-radius:50%;background:var(--blue);display:inline-block;box-shadow:0 0 0 4px rgba(47,75,255,.18)}
.card{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:24px}
.card.soft{background:var(--soft);border-color:transparent}
.card.dark{background:var(--ink);color:#e9e9ef;border-color:var(--ink)}.card.dark .muted{color:#9a9cab}.card.dark code{background:#1f1f29;color:#cfd6ff}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--ink);color:#fff;border:0;border-radius:999px;padding:14px 24px;font:600 16px var(--font);cursor:pointer}
.btn:hover{text-decoration:none;background:#26262e}.btn.blue{background:var(--blue)}.btn.blue:hover{background:var(--blue-2)}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}.btn.ghost:hover{background:var(--soft)}
.btn.sm{padding:8px 14px;font-size:14px}
.muted{color:var(--muted)}.small{font-size:14px}.tiny{font-size:12.5px}
.pill{display:inline-block;white-space:nowrap;border-radius:999px;padding:3px 10px;font-size:12.5px;font-weight:600;background:var(--soft);color:var(--muted)}
.pill.ok{background:#e7f6ee;color:var(--ok)}.pill.warn{background:#fdf1e3;color:var(--warn)}.pill.bad{background:#fdeaea;color:var(--bad)}.pill.blue{background:#eef1ff;color:var(--blue)}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13.5px}
code{background:var(--soft);padding:2px 7px;border-radius:7px}
pre{background:var(--soft);padding:16px;border-radius:14px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.copy{display:flex;gap:8px;align-items:stretch}.copy input,.copy textarea{flex:1;min-width:0}
label{display:block;font-weight:600;font-size:14px;margin:18px 0 7px}
input,textarea,select{width:100%;font:inherit;color:var(--ink);background:var(--soft);border:1px solid transparent;border-radius:12px;padding:12px 14px}
input:focus,textarea:focus{outline:none;border-color:var(--blue);background:#fff;box-shadow:0 0 0 4px rgba(47,75,255,.12)}
.row{display:grid;gap:16px;grid-template-columns:1fr 1fr}@media (max-width:640px){.row{grid-template-columns:1fr}}
.checks{display:flex;flex-wrap:wrap;gap:10px}.checks label{display:flex;align-items:center;gap:8px;font-weight:500;margin:0;background:var(--soft);border-radius:999px;padding:8px 14px;cursor:pointer}.checks input{width:auto;accent-color:var(--blue)}
.hint{font-size:13px;color:var(--muted);margin-top:6px}
.alert{border-radius:14px;padding:14px 16px;margin:16px 0;font-size:15px}.alert.bad{background:#fdeaea;color:var(--bad)}.alert.warn{background:#fdf1e3;color:var(--warn)}.alert.ok{background:#e7f6ee;color:var(--ok)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:12.5px;text-transform:uppercase;letter-spacing:.04em}
tr:last-child td{border-bottom:0}.tablewrap{overflow-x:auto}
.price{font-size:24px;font-weight:800;letter-spacing:-.03em}
.tile{aspect-ratio:16/10;border-radius:14px;margin-bottom:14px;display:grid;place-items:center;font-size:64px;font-weight:800;color:#fff;background:linear-gradient(135deg,hsl(var(--h) 85% 62%),hsl(calc(var(--h) + 40) 80% 42%))}
.prod{display:flex;flex-direction:column}.prod img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:14px;margin-bottom:14px;background:var(--soft)}
.prod .foot{margin-top:auto;padding-top:12px;display:flex;justify-content:space-between;align-items:center}
.big{font-size:46px;font-weight:800;letter-spacing:-.04em;line-height:1.1}
.kv{display:grid;grid-template-columns:140px 1fr;gap:10px 14px;font-size:15px}.kv dt{color:var(--muted)}.kv dd{margin:0;word-break:break-all}
@media (max-width:520px){.kv{grid-template-columns:1fr}.kv dt{margin-top:6px}}
.receipt{max-width:640px;margin:16px auto;background:#fff;border:1px solid var(--line);border-radius:24px;padding:clamp(20px,4vw,36px);box-shadow:0 30px 60px -30px rgba(16,26,138,.25)}
.receipt-top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px}
.receipt-amount{font-size:clamp(44px,7vw,64px);font-weight:800;letter-spacing:-.04em;line-height:1}.receipt-amount span{font-size:20px;color:var(--muted);letter-spacing:0}
.receipt-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}
.page-head{padding:12px 0 8px}.page-head h1{font-size:clamp(32px,5vw,52px)}
footer.foot{margin-top:72px;padding:28px clamp(16px,4vw,44px);border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:12px 24px;justify-content:space-between;color:var(--muted);font-size:14px}

/* ---------- hero ---------- */
.hero{display:grid;grid-template-columns:1.05fr 1fr;gap:clamp(20px,4vw,56px);align-items:center;padding-bottom:8px}
@media (max-width:900px){.hero{grid-template-columns:1fr}}
.stage{position:relative;min-height:560px;border-radius:26px;overflow:hidden;
background:radial-gradient(120% 80% at 10% 0%,#e9efff 0%,#b9c9ff 28%,#4f6bff 62%,#1f33e6 100%)}
@media (max-width:900px){.stage{min-height:440px}}
.stage .blob{position:absolute;border-radius:50%;background:#101a8a;filter:blur(.3px)}
.phone{position:absolute;left:12%;top:11%;width:46%;max-width:270px;aspect-ratio:9/18.5;border-radius:38px;background:#0d0e14;
border:7px solid #2440ff;box-shadow:0 0 0 2px #0d1aa8,-14px 30px 40px rgba(6,12,90,.45);transform:rotate(-8deg);padding:22px 14px;color:#fff;overflow:hidden}
.phone .notch{position:absolute;top:8px;left:50%;transform:translateX(-50%);width:64px;height:18px;background:#000;border-radius:12px}
.phone .time{font-size:10px;font-weight:600;opacity:.9}
.phone .title{font-size:clamp(18px,2vw,23px);font-weight:700;letter-spacing:-.03em;line-height:1.05;text-align:center;margin:16px 0 14px}
.rc{border-radius:14px;padding:10px 12px;margin-top:-6px;font-size:10.5px;line-height:1.3;color:#0d0e14;box-shadow:0 -4px 12px rgba(0,0,0,.25);position:relative}
.rc b{display:block;font-size:13px;letter-spacing:-.02em}.rc .ic{position:absolute;right:10px;top:10px;width:18px;height:18px;border-radius:50%;border:2px solid #0d0e14}
.rc.c1{background:#f4f0ec;margin-top:0}.rc.c2{background:#3d63ff;color:#fff}.rc.c2 .ic{border-color:#fff}.rc.c3{background:#f6c6d6}.rc.c4{background:#f5c33b;padding-bottom:26px}
.float{position:absolute;filter:drop-shadow(0 18px 24px rgba(8,14,90,.35));animation:bob 6s ease-in-out infinite}
.float.f2{animation-delay:-2s}.float.f3{animation-delay:-4s}
@keyframes bob{0%,100%{transform:translateY(0) rotate(var(--rot,0deg))}50%{transform:translateY(-10px) rotate(var(--rot,0deg))}}
@media (prefers-reduced-motion:reduce){.float{animation:none}}
@media (max-width:560px){.stage{min-height:400px}.phone{width:58%;left:6%;top:9%}.float svg{width:auto;height:auto;max-width:84px;max-height:84px}}
.dot{position:absolute;width:9px;height:9px;border-radius:50%;background:#1a2fd8}
.copyblock h1 span{color:var(--blue)}
.stats{display:flex;gap:28px;margin-top:40px;flex-wrap:wrap}
.stat{min-width:120px}.stat .n{font-size:clamp(34px,4vw,46px);font-weight:800;letter-spacing:-.04em;line-height:1}.stat .l{font-size:13px;color:var(--muted);margin-top:6px}
.stat .ico{width:22px;height:22px;border-radius:7px;background:var(--soft);display:grid;place-items:center;margin-bottom:12px;font-size:12px}
.vr{width:1px;background:var(--line);align-self:stretch}
.steps3{display:grid;gap:16px;grid-template-columns:repeat(3,1fr)}@media (max-width:820px){.steps3{grid-template-columns:1fr}}
.steps3 .num{width:38px;height:38px;border-radius:12px;background:var(--blue);color:#fff;display:grid;place-items:center;font-weight:800;margin-bottom:16px}
.steps3 .card:nth-child(2) .num{background:var(--cyan)}.steps3 .card:nth-child(3) .num{background:var(--ink)}
.agentlist{list-style:none;padding:0;margin:0;display:grid;gap:14px}.agentlist li{display:grid;grid-template-columns:34px 1fr;gap:12px;align-items:start}
.agentlist .k{width:28px;height:28px;border-radius:9px;background:#2a2a36;display:grid;place-items:center;font-weight:700;font-size:13px;color:#cfd6ff}
`;

/** Xanax mark: a card folding into motion. */
export const LOGO_SVG = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs><linearGradient id="xg1" x1="22" y1="6" x2="42" y2="24" gradientUnits="userSpaceOnUse"><stop stop-color="#5fd3f7"/><stop offset="1" stop-color="#2aa6e6"/></linearGradient>
<linearGradient id="xg2" x1="20" y1="24" x2="42" y2="42" gradientUnits="userSpaceOnUse"><stop stop-color="#4b63f5"/><stop offset="1" stop-color="#2f4bff"/></linearGradient></defs>
<path d="M21 24 31.5 6H43L32.5 24Z" fill="url(#xg1)" stroke="#16206e" stroke-width="2.2" stroke-linejoin="round"/>
<path d="M24.5 18.2 34.5 6" stroke="#fff" stroke-width="2.4" opacity=".85"/>
<path d="M21 24h11.5L43 6v20L32.5 42H21Z" fill="url(#xg2)" stroke="#16206e" stroke-width="2.2" stroke-linejoin="round"/>
<path d="M4 29h13M7 33h11M10 37h9M13 41h7" stroke="#16206e" stroke-width="2.2" stroke-linecap="round"/>
</svg>`;

const FAVICON = `data:image/svg+xml,${encodeURIComponent(LOGO_SVG.replace(/url\(#xg1\)/, "#3cc3f2").replace(/url\(#xg2\)/, "#2f4bff"))}`;

const COPY_JS = `document.addEventListener('click',e=>{const b=e.target.closest('[data-copy]');if(!b)return;const el=document.getElementById(b.dataset.copy);navigator.clipboard.writeText(el.value??el.textContent).then(()=>{const t=b.textContent;b.textContent='Copied';setTimeout(()=>b.textContent=t,1200)})})`;

export function layout(title: string, body: SafeHtml, opts: { description?: string; noindex?: boolean } = {}): string {
  return html`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${opts.description ?? `${APP_NAME}: let AI agents buy from your business. Paid in USDC, straight to your wallet.`}">
${opts.noindex ? raw('<meta name="robots" content="noindex">') : ""}
<meta name="theme-color" content="#0b0b10">
<link rel="icon" href="${FAVICON}">
<link rel="alternate" type="text/plain" href="/llms.txt" title="Instructions for AI agents">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&display=swap">
<style>${raw(CSS)}</style>
</head><body>
<div class="frame">
<header class="top"><a class="brand" href="/">${raw(LOGO_SVG)}${APP_NAME}</a>
<nav class="pills"><a class="hide-sm" href="/#how">How it works</a><a class="hide-sm" href="/#agents">For agents</a><a class="hide-sm" href="/#products">Products</a><a href="/account">Account</a><a class="cta" href="/sell">Start selling</a></nav></header>
<main class="wrap">
${body}
</main>
<footer class="foot"><span><b style="color:var(--ink)">${APP_NAME}</b> · Agent checkout over x402 · USDC on ${config.network.testnet ? "Base Sepolia (testnet)" : "Base"} · Works with PayBox</span><span>Funds go straight to merchant wallets. ${APP_NAME} never holds them.</span></footer>
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
