import { LineCapStyle, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { APP_NAME, config, explorerTxUrl } from "./config.js";
import { formatUsd } from "./catalog.js";
import type { Merchant, Order, Product } from "./db.js";

const INK = rgb(0.05, 0.05, 0.07);
const MUTED = rgb(0.42, 0.44, 0.48);
const LINE = rgb(0.91, 0.92, 0.94);
const BLUE = rgb(0.184, 0.294, 1);
const CYAN = rgb(0.235, 0.765, 0.949);
const NAVY = rgb(0.086, 0.125, 0.431);
const GREEN = rgb(0.059, 0.541, 0.294);
const GREEN_BG = rgb(0.906, 0.965, 0.933);

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  shipping_address: "Shipping address",
  note: "Note",
};

/** Standard PDF fonts only cover WinAnsi; replace anything else so a stray emoji can't break the PDF. */
function clean(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/—/g, "-")) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      // Drop characters the standard font can't draw (emoji etc.).
      out += "";
    }
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of clean(font, text).split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const tryLine = line + word;
      if (font.widthOfTextAtSize(tryLine, size) <= width) {
        line = tryLine;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      // Break words longer than the line (tx hashes, addresses).
      let w = word.trimStart();
      while (font.widthOfTextAtSize(w, size) > width) {
        let n = w.length;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--;
        lines.push(w.slice(0, n));
        w = w.slice(n);
      }
      line = w;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function logo(page: PDFPage, x: number, y: number, size: number) {
  // The Xanax mark on its 48x48 grid; (x, y) is the top-left corner.
  const at = { x, y, scale: size / 48 };
  page.drawSvgPath("M21 24 31.5 6H43L32.5 24Z", { ...at, color: CYAN, borderColor: NAVY, borderWidth: 2.2 });
  page.drawSvgPath("M21 24h11.5L43 6v20L32.5 42H21Z", { ...at, color: BLUE, borderColor: NAVY, borderWidth: 2.2 });
  page.drawSvgPath("M4 29h13M7 33h11M10 37h9M13 41h7", { ...at, borderColor: NAVY, borderWidth: 2.2, borderLineCap: LineCapStyle.Round });
}

export async function receiptPdf(args: { order: Order; product: Product; merchant: Merchant; copy: "buyer" | "seller" }): Promise<Uint8Array> {
  const { order, product, merchant, copy } = args;
  const doc = await PDFDocument.create();
  doc.setTitle(`Receipt ${order.id}`);
  doc.setAuthor(APP_NAME);
  doc.setSubject(`${order.quantity} x ${product.name}`);
  doc.setCreator(APP_NAME);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const W = 420;
  const H = copy === "seller" && Object.keys(order.buyer).length ? 700 : 620;
  const page = doc.addPage([W, H]);
  const M = 32;
  let y = H - 32;

  // Header: mark + wordmark, "Receipt" + copy label.
  logo(page, M, y + 2, 26);
  page.drawText(APP_NAME, { x: M + 32, y: y - 18, size: 16, font: bold, color: INK });
  page.drawText("RECEIPT", { x: W - M - bold.widthOfTextAtSize("RECEIPT", 11), y: y - 10, size: 11, font: bold, color: BLUE });
  const label = copy === "seller" ? "Seller copy" : "Buyer copy";
  page.drawText(label, { x: W - M - regular.widthOfTextAtSize(label, 9), y: y - 23, size: 9, font: regular, color: MUTED });
  y -= 48;

  // Amount block.
  page.drawRectangle({ x: M, y: y - 92, width: W - 2 * M, height: 92, color: rgb(0.957, 0.961, 0.973), borderColor: LINE, borderWidth: 1 });
  page.drawText("Amount paid", { x: M + 16, y: y - 24, size: 9, font: regular, color: MUTED });
  const amount = `$${formatUsd(order.amount_cents)}`;
  page.drawText(amount, { x: M + 16, y: y - 58, size: 30, font: bold, color: INK });
  page.drawText("USDC", { x: M + 22 + bold.widthOfTextAtSize(amount, 30), y: y - 58, size: 12, font: bold, color: MUTED });
  const pill = order.status === "fulfilled" ? "FULFILLED" : product.kind === "digital" ? "DELIVERED" : "PAID";
  const pw = bold.widthOfTextAtSize(pill, 8) + 16;
  page.drawRectangle({ x: W - M - 16 - pw, y: y - 30, width: pw, height: 16, color: GREEN_BG });
  page.drawText(pill, { x: W - M - 8 - pw, y: y - 25, size: 8, font: bold, color: GREEN });
  page.drawText(clean(regular, `${order.quantity} x ${product.name}`).slice(0, 70), { x: M + 16, y: y - 78, size: 10, font: regular, color: INK });
  y -= 112;

  // Detail rows.
  const rows: Array<[string, string, PDFFont?]> = [
    ["Receipt no.", order.id, mono],
    ["Date", `${order.created_at.replace("T", " ").slice(0, 19)} UTC`],
    ["Merchant", merchant.business_name],
    ["Item", product.name],
    ["Quantity", String(order.quantity)],
    ["Unit price", `$${formatUsd(order.unit_price_cents)} USDC`],
    ["Total", `$${formatUsd(order.amount_cents)} USDC`],
    ["Network", order.network === "base" ? "Base (USDC)" : "Base Sepolia (testnet USDC)"],
    ["Paid from", order.payer_address ?? "-", mono],
    ["Paid to", merchant.payout_address, mono],
    ["Transaction", order.tx_hash, mono],
  ];
  const labelW = 92;
  const valueW = W - 2 * M - labelW;
  const drawRows = (list: Array<[string, string, PDFFont?]>) => {
    for (const [k, v, f] of list) {
      const font = f ?? regular;
      const size = f === mono ? 8.5 : 10;
      const lines = wrap(font, v, size, valueW);
      page.drawText(k, { x: M, y, size: 9, font: regular, color: MUTED });
      lines.forEach((ln, i) => page.drawText(ln, { x: M + labelW, y: y - i * 12, size, font, color: INK }));
      y -= Math.max(1, lines.length) * 12 + 8;
      page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.6, color: LINE });
      y -= 6;
    }
  };
  drawRows(rows);

  if (copy === "seller" && Object.keys(order.buyer).length) {
    y -= 6;
    page.drawText("Buyer details", { x: M, y, size: 11, font: bold, color: INK });
    y -= 18;
    drawRows(Object.entries(order.buyer).map(([k, v]) => [FIELD_LABELS[k] ?? k, v] as [string, string]));
  }

  // Footer.
  const foot = [
    `Paid by an AI agent over x402. USDC settled directly to the merchant's wallet; ${APP_NAME} never held the funds.`,
    `Verify on-chain: ${explorerTxUrl(order.tx_hash, order.network)}`,
    `Online receipt: ${config.BASE_URL}/r/${order.id}`,
  ];
  let fy = 64;
  for (const line of foot) {
    for (const ln of wrap(regular, line, 7.5, W - 2 * M)) {
      page.drawText(ln, { x: M, y: fy, size: 7.5, font: regular, color: MUTED });
      fy -= 10;
    }
  }
  page.drawRectangle({ x: 0, y: 0, width: W, height: 6, color: BLUE });

  return doc.save();
}
