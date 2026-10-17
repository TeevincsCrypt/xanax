import { config, explorerTxUrl } from "./config.js";
import { formatUsd } from "./catalog.js";
import type { Merchant, Order, Product } from "./db.js";
import { signDownload } from "./security.js";

const DOWNLOAD_TTL_SEC = 7 * 24 * 3600;

export function downloadLink(orderId: string, now = Date.now()): { url: string; expires_at: string } {
  const token = signDownload(orderId, DOWNLOAD_TTL_SEC, now);
  const exp = Number(token.split(".")[0]);
  return { url: `${config.BASE_URL}/d/${orderId}?t=${encodeURIComponent(token)}`, expires_at: new Date(exp * 1000).toISOString() };
}

/** Compact JSON receipt returned to the buyer's agent. Small enough for an LLM to read back verbatim. */
export function receiptJson(order: Order, product: Product, merchant: Merchant, merchantNotified: boolean) {
  const name = merchant.business_name;
  let nextSteps: string;
  let delivery: { type: "download"; download_url: string; expires_at: string } | undefined;

  if (product.kind === "digital") {
    const link = downloadLink(order.id);
    delivery = { type: "download", download_url: link.url, expires_at: link.expires_at };
    nextSteps = `Delivered instantly: open delivery.download_url to get "${product.name}" (link valid for 7 days).`;
  } else if (order.buyer.email) {
    nextSteps = `${name} has your order and will contact you at the email you provided.`;
  } else if (order.buyer.phone) {
    nextSteps = `${name} has your order and will contact you on the phone number you provided.`;
  } else {
    nextSteps = `${name} has your order. Keep order ID ${order.id} for reference.`;
  }
  if (!merchantNotified && product.kind !== "digital") {
    nextSteps += ` (${name} could not be notified instantly; the order is saved in their dashboard and notification will be retried.)`;
  }

  return {
    status: "paid" as const,
    order_id: order.id,
    merchant: name,
    item: product.name,
    quantity: order.quantity,
    amount_usd: formatUsd(order.amount_cents),
    currency: "USDC",
    network: order.network,
    tx_hash: order.tx_hash,
    explorer_url: explorerTxUrl(order.tx_hash),
    merchant_notified: merchantNotified,
    next_steps: nextSteps,
    receipt_url: `${config.BASE_URL}/r/${order.id}`,
    ...(delivery ? { delivery } : {}),
  };
}

export function wasNotified(order: Order): boolean {
  return order.webhook_status === "delivered" || order.email_status === "sent";
}
