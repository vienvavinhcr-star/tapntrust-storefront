import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { autoProvisionPaidShopifyOrder } from "../src/shopify-order-provisioning";

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM insights_subscription_lifecycle_events"),
    env.DB.prepare("DELETE FROM insights_cancellation_requests"),
    env.DB.prepare("DELETE FROM business_insights_intro_redemptions"),
    env.DB.prepare("UPDATE insights_billing_events SET source_event_id = NULL WHERE source_event_id IS NOT NULL"),
    env.DB.prepare("DELETE FROM insights_billing_events"),
    env.DB.prepare("DELETE FROM insights_subscriptions"),
    env.DB.prepare("DELETE FROM shopify_webhook_receipts"),
    env.DB.prepare("DELETE FROM customer_dashboard_visits"),
    env.DB.prepare("DELETE FROM customer_sessions"),
    env.DB.prepare("DELETE FROM auth_magic_links"),
    env.DB.prepare("DELETE FROM customer_business_access"),
    env.DB.prepare("DELETE FROM customer_users"),
    env.DB.prepare("DELETE FROM provisioning_batch_cards"),
    env.DB.prepare("DELETE FROM provisioning_batches"),
    env.DB.prepare("DELETE FROM insights_entitlements"),
    env.DB.prepare("DELETE FROM tap_events"),
    env.DB.prepare("DELETE FROM cards"),
    env.DB.prepare("DELETE FROM locations"),
    env.DB.prepare("DELETE FROM businesses")
  ]);
}

async function sign(rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return btoa(String.fromCharCode(...signature));
}

beforeEach(clearDatabase);

describe("Shopify test-order physical card provisioning", () => {
  it("provisions physical cards from a paid test order when the business review link is valid", async () => {
    const setupId = `setup-test-${crypto.randomUUID()}`;
    const payload = {
      id: `order-${crypto.randomUUID()}`,
      name: "#TEST-1019",
      test: true,
      email: "test-owner@example.com",
      contact_email: "test-owner@example.com",
      line_items: [{
        id: `line-${crypto.randomUUID()}`,
        title: "TapNTrust Review Card",
        name: "TapNTrust Review Card - 3 Card",
        variant_title: "3 Card",
        quantity: 1,
        properties: [
          { name: "_Business Name", value: "KFC George Street Sydney" },
          { name: "_Business Address", value: "485 George Street Cnr, Bathurst St, Sydney NSW 2000" },
          { name: "_Google Place ID", value: "ChIJdfj4NjyuEmsR_3_uT0gmNOU" },
          { name: "_Review Link", value: "https://search.google.com/local/writereview?placeid=ChIJdfj4NjyuEmsR_3_uT0gmNOU" },
          { name: "_Business Setup ID", value: setupId },
          { name: "_Item Role", value: "Primary Card Package" }
        ]
      }]
    };

    const raw = JSON.stringify(payload);
    const secret = String(env.SHOPIFY_CLIENT_SECRET || "");
    const shopDomain = String(env.SHOPIFY_SHOP_DOMAIN || "");
    expect(secret).toBeTruthy();
    expect(shopDomain).toBeTruthy();

    const request = new Request("https://go.tapntrust.com/api/shopify/webhooks/orders-paid", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Shop-Domain": shopDomain,
        "X-Shopify-Topic": "orders/paid",
        "X-Shopify-Hmac-Sha256": await sign(raw, secret)
      },
      body: raw
    });

    const batches = await autoProvisionPaidShopifyOrder(request, env, new Date("2026-09-16T00:50:00.000Z"));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      setupId,
      businessName: "KFC George Street Sydney",
      physicalCardCount: 3,
      customerEmail: "test-owner@example.com"
    });
    expect(batches[0]?.programmingUrls).toHaveLength(3);
    expect(batches[0]?.programmingUrls.every((url) => url.startsWith("https://go.tapntrust.com/t/TNT-"))).toBe(true);

    const batch = await env.DB.prepare(`
      SELECT physical_card_count, customer_email
      FROM provisioning_batches
      WHERE external_setup_reference = ?1
      LIMIT 1
    `).bind(setupId).first<{ physical_card_count: number; customer_email: string | null }>();
    expect(batch).toEqual({ physical_card_count: 3, customer_email: "test-owner@example.com" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM cards").first<{ count: number }>())
      .toMatchObject({ count: 3 });
  });
});
