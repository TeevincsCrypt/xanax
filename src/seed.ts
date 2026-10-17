import { getAddress, isAddress } from "viem";
import { config } from "./config.js";
import { merchants, products } from "./db.js";
import { createListing, dashboardUrl } from "./listing.js";
import { buyUrl } from "./catalog.js";

const GUIDE = `LAGOS STREET-FOOD FIELD GUIDE (2026 edition)
by Ada's Roastery, Lagos

1. Suya (Lekki Phase 1 and Yaba): thin-sliced spiced beef, grilled over charcoal.
   Ask for extra yaji (pepper spice) and onions on the side. Best after 7pm.
2. Boli and groundnut (Ikoyi, Obalende): roasted plantain with roasted peanuts.
   Cheap, filling, everywhere. Pick the darkest, sweetest boli.
3. Agege bread and ewa agoyin (Agege, Surulere): soft sweet bread with mashed
   beans and a dark, smoky pepper sauce. A breakfast institution.
4. Puff-puff (any bus stop): fried dough balls, still warm. Buy in tens.
5. Abacha (Ikeja): Igbo cassava salad with palm-oil dressing, ugba and fish.
6. Asun (Victoria Island bars): peppered smoked goat. Spicy; order a cold drink.
7. Akara (Ikorodu Road, mornings): bean fritters, often with pap (ogi).

Etiquette: carry small notes, say "Abeg" with a smile, and always try the pepper
before you add more.

Your order ID is your license. Enjoy, and come by the roastery for a cup.`;

/**
 * Create the demo merchant (Ada's Roastery, fictional) with a physical and a digital product.
 * Idempotent: does nothing if a merchant with that name already exists.
 */
export const DEMO_MERCHANT = "Ada's Roastery, Lagos";

export async function seedDemo(payoutAddress = process.env.SEED_PAYOUT_ADDRESS) {
  if (!payoutAddress || !isAddress(payoutAddress, { strict: false })) {
    throw new Error("Set SEED_PAYOUT_ADDRESS to the Base wallet that should receive demo payments");
  }
  const payout = getAddress(payoutAddress);
  const testnet = config.network.testnet;
  const existing = products.search(DEMO_MERCHANT, 50).filter((p) => p.business_name === DEMO_MERCHANT);
  if (existing.length > 0) {
    return { created: false as const, products: existing.map((p) => ({ id: p.id, name: p.name, buy_url: buyUrl(p.id) })) };
  }

  const coffee = await createListing(
    {
      business_name: DEMO_MERCHANT,
      product_name: "Single-origin coffee, 250g",
      description:
        "Freshly roasted Nigerian Arabica from the Mambilla Plateau. Notes of cocoa, hibiscus and brown sugar. Whole bean, roasted to order in Lagos and shipped within 2 days.",
      price_usd: "0.50",
      payout_address: payout,
      email: process.env.SEED_EMAIL || "orders@example.com",
      webhook_url: process.env.SEED_WEBHOOK_URL || undefined,
      kind: "physical",
      stock: "25",
      required_fields: ["name", "email", "shipping_address"],
    },
    { skipWebhookDnsCheck: true },
  );
  if (!coffee.ok) throw new Error(coffee.errors.join("; "));

  // Second product under the same merchant: instant digital delivery.
  const guideId = `p_lagosguide`;
  if (!products.get(guideId)) {
    products.insert({
      id: guideId,
      merchant_id: coffee.listing.merchant.id,
      name: "Lagos street-food guide (PDF-style field guide)",
      description: "Seven must-eat Lagos street foods, where to find them and how to order. Delivered instantly after payment.",
      price_cents: testnet ? 10 : 25,
      image_url: null,
      kind: "digital",
      required_fields: [],
      stock: null,
      delivery_text: GUIDE,
      delivery_url: null,
    });
  }

  const m = merchants.get(coffee.listing.merchant.id)!;
  return {
    created: true as const,
    merchant: m.business_name,
    dashboard_url: dashboardUrl(coffee.listing.dashboardToken),
    webhook_secret: coffee.listing.webhookSecret,
    products: [coffee.listing.product, products.get(guideId)!].map((p) => ({ id: p.id, name: p.name, buy_url: buyUrl(p.id) })),
  };
}

/** Take the demo merchant's products off sale (hidden everywhere; past orders and receipts stay). */
export function unseedDemo() {
  return { removed: products.deactivateByMerchantName(DEMO_MERCHANT) };
}
