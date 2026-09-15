import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { handleRequest } from "../src/index";
import type { ShopifyAdminBillingLine, ShopifyAdminProvider } from "../src/shopify-admin";

const ORIGIN = "https://go.tapntrust.com";
const WEBHOOK_SECRET = "test-shopify-webhook-secret-not-for-production";
const SHOP_DOMAIN = "tapntrust-test.myshopify.com";
const INSIGHTS_VARIANT_ID = "400000000001";
const INTRO_PLAN_ID = "500000000001";
const REVIEW_URL = "https://search.google.com/local/writereview?placeid=auto-provision-test";

class MockShopifyAdminProvider implements ShopifyAdminProvider {
  readonly orders = new Map<string, ShopifyAdminBillingLine[]>();

  async getOrderBillingLines(providerOrderReference: string): Promise<ShopifyAdminBillingLine[]> {
    return this.orders.get(providerOrderReference) || [];
  }
}

const provider = new MockShopifyAdminProvider();

function unique(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function clearDatabase(): Promise<void> {
  provider.orders.clear();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM insights_subscription_lifecycle_events"),
    env.DB.prepare("DELETE FROM insights_cancellation_requests"),
    env.DB.prepare("DELETE FROM business_insights_intro_redemptions"),
    env.DB.prepare("DELETE FROM insights_billing_events"),
    env.DB.prepare("DELETE FROM insights_subscriptions"),
    env.DB.prepare("DELETE FROM shopify_webhook_receipts"),
    env.DB.prepare("DELETE FROM auth_request_limits"),
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

async function sign(rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return btoa(String.fromCharCode(...signature));
}

function businessProperties(setupId: string): Array<{ name: string; value: string }> {
  return [
    { name: "_Business Name", value: "Pho Thin Australia" },
    { name: "_Business Address", value: "Shop 3/399 Lonsdale St, Melbourne VIC 3000" },
    { name: "_Google Place ID", value: "ChIJAutoProvision123" },
    { name: "_Review Link", value: REVIEW_URL },
    { name: "_Review Link Status", value: "Ready" },
    { name: "_Review Link Source", value: "Google Places" },
    { name: "_Business Setup ID", value: setupId },
    { name: "_Item Role", value: "Primary Card Package" }
  ];
}

function paidOrder({
  setupId,
  orderReference,
  orderId,
  email,
  primaryVariantTitle = "5 Card",
  extraQuantity = 0,
  insights = false
}: {
  setupId: string;
  orderReference: string;
  orderId: string;
  email: string;
  primaryVariantTitle?: string;
  extraQuantity?: number;
  insights?: boolean;
}): Record<string, unknown> {
  const primaryLine = {
    id: unique("primary-line"),
    admin_graphql_api_id: `gid://shopify/LineItem/${unique("primary")}`,
    variant_id: "111111111111",
    title: "TapNTrust Review Card",
    variant_title: primaryVariantTitle,
    name: `TapNTrust Review Card - ${primaryVariantTitle}`,
    quantity: 1,
    price: "109.95",
    total_discount: "0.00",
    price_set: { shop_money: { amount: "109.95", currency_code: "AUD" } },
    properties: businessProperties(setupId)
  };
  const lineItems: Record<string, unknown>[] = [primaryLine];

  if (extraQuantity > 0) {
    lineItems.push({
      id: unique("extra-line"),
      admin_graphql_api_id: `gid://shopify/LineItem/${unique("extra")}`,
      variant_id: "222222222222",
      title: "TapNTrust Extra NFC Card",
      variant_title: "Default Title",
      name: "TapNTrust Extra NFC Card",
      quantity: extraQuantity,
      price: "20.99",
      total_discount: "0.00",
      price_set: { shop_money: { amount: "20.99", currency_code: "AUD" } },
      properties: [
        { name: "_Business Setup ID", value: setupId },
        { name: "_Item Role", value: "Extra NFC Card" }
      ]
    });
  }

  if (insights) {
    lineItems.push({
      id: unique("insights-line"),
      admin_graphql_api_id: `gid://shopify/LineItem/${unique("insights")}`,
      variant_id: INSIGHTS_VARIANT_ID,
      title: "TapnTrust Insights",
      variant_title: "Default Title",
      name: "TapnTrust Insights",
      quantity: 1,
      price: "1.99",
      total_discount: "0.00",
      price_set: { shop_money: { amount: "1.99", currency_code: "AUD" } },
      selling_plan_allocation: {
        selling_plan: { id: `gid://shopify/SellingPlan/${INTRO_PLAN_ID}` }
      },
      properties: [
        { name: "_Business Setup ID", value: setupId },
        { name: "_Item Role", value: "TapnTrust Insights" },
        { name: "_Insights Offer", value: "intro" }
      ]
    });
  }

  return {
    id: orderId,
    admin_graphql_api_id: `gid://shopify/Order/${orderId}`,
    name: orderReference,
    currency: "AUD",
    processed_at: "2026-09-15T02:20:00.000Z",
    test: false,
    email,
    contact_email: email,
    customer: {
      id: unique("customer"),
      admin_graphql_api_id: `gid://shopify/Customer/${unique("customer-id")}`,
      email
    },
    line_items: lineItems
  };
}

async function deliver(payload: Record<string, unknown>, webhookId = unique("webhook")): Promise<Response> {
  const raw = JSON.stringify(payload);
  const orderReference = String(payload.admin_graphql_api_id ?? payload.id ?? "");
  const lines = Array.isArray(payload.line_items) ? payload.line_items : [];
  provider.orders.set(orderReference, lines.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const line = value as Record<string, unknown>;
    if (String(line.variant_id || "") !== INSIGHTS_VARIANT_ID) return [];
    return [{
      providerLineReference: String(line.admin_graphql_api_id ?? line.id ?? ""),
      variantId: `gid://shopify/ProductVariant/${INSIGHTS_VARIANT_ID}`,
      sellingPlanId: `gid://shopify/SellingPlan/${INTRO_PLAN_ID}`,
      sellingPlanName: "Intro then monthly",
      providerSubscriptionReference: null
    }];
  }));

  const context = createExecutionContext();
  return handleRequest(
    new Request(`${ORIGIN}/api/shopify/webhooks/orders-paid`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Shop-Domain": SHOP_DOMAIN,
        "X-Shopify-Topic": "orders/paid",
        "X-Shopify-Webhook-Id": webhookId,
        "X-Shopify-Event-Id": unique("event"),
        "X-Shopify-Hmac-Sha256": await sign(raw),
        "X-Shopify-Triggered-At": "2026-09-15T02:20:00.000Z"
      },
      body: raw
    }),
    env,
    context,
    undefined,
    undefined,
    { shopifyAdminProvider: provider }
  );
}

beforeEach(clearDatabase);

describe("Shopify paid-order automatic card provisioning", () => {
  it("creates the purchased physical card count, stores checkout email, and tracks taps without Insights access", async () => {
    const setupId = unique("setup");
    const payload = paidOrder({
      setupId,
      orderReference: unique("#order"),
      orderId: unique("order"),
      email: "owner@example.com",
      primaryVariantTitle: "3 Card",
      extraQuantity: 2
    });

    const response = await deliver(payload);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: "ignored" });

    const batch = await env.DB.prepare(`
      SELECT id, physical_card_count, customer_email, location_id
      FROM provisioning_batches
      WHERE external_setup_reference = ?1
      LIMIT 1
    `).bind(setupId).first<{
      id: string;
      physical_card_count: number;
      customer_email: string | null;
      location_id: string;
    }>();
    expect(batch?.physical_card_count).toBe(5);
    expect(batch?.customer_email).toBe("owner@example.com");

    const cards = await env.DB.prepare(`
      SELECT public_token FROM cards WHERE location_id = ?1 ORDER BY created_at, id
    `).bind(batch?.location_id).all<{ public_token: string }>();
    expect(cards.results).toHaveLength(5);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM insights_entitlements").first<{ count: number }>())
      .toMatchObject({ count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM customer_business_access").first<{ count: number }>())
      .toMatchObject({ count: 0 });

    const token = cards.results[0]?.public_token;
    expect(token).toBeTruthy();
    const tapContext = createExecutionContext();
    const tapResponse = await handleRequest(new Request(`${ORIGIN}/t/${token}`), env, tapContext);
    await waitOnExecutionContext(tapContext);
    expect(tapResponse.status).toBe(302);
    expect(tapResponse.headers.get("Location")).toBe(REVIEW_URL);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM tap_events").first<{ count: number }>())
      .toMatchObject({ count: 1 });
  });

  it("activates Insights for the checkout email when the same paid order includes Insights", async () => {
    const setupId = unique("setup");
    const email = "insights-owner@example.com";
    const payload = paidOrder({
      setupId,
      orderReference: unique("#order"),
      orderId: unique("order"),
      email,
      primaryVariantTitle: "5 Card",
      insights: true
    });

    const response = await deliver(payload);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: "activated" });

    const batch = await env.DB.prepare(`
      SELECT business_id, location_id, physical_card_count, customer_email
      FROM provisioning_batches
      WHERE external_setup_reference = ?1
      LIMIT 1
    `).bind(setupId).first<{
      business_id: string;
      location_id: string;
      physical_card_count: number;
      customer_email: string | null;
    }>();
    expect(batch?.physical_card_count).toBe(5);
    expect(batch?.customer_email).toBe(email);

    const entitlement = await env.DB.prepare(`
      SELECT status FROM insights_entitlements WHERE location_id = ?1
    `).bind(batch?.location_id).first<{ status: string }>();
    expect(entitlement?.status).toBe("active");

    const access = await env.DB.prepare(`
      SELECT u.email
      FROM customer_business_access a
      JOIN customer_users u ON u.id = a.user_id
      WHERE a.business_id = ?1
      LIMIT 1
    `).bind(batch?.business_id).first<{ email: string }>();
    expect(access?.email).toBe(email);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM cards").first<{ count: number }>())
      .toMatchObject({ count: 5 });
  });

  it("is idempotent across Shopify webhook retries and never duplicates physical cards", async () => {
    const setupId = unique("setup");
    const payload = paidOrder({
      setupId,
      orderReference: unique("#order"),
      orderId: unique("order"),
      email: "retry-owner@example.com",
      primaryVariantTitle: "5 Card"
    });

    const first = await deliver(payload, unique("webhook"));
    const second = await deliver(payload, unique("webhook"));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const batches = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM provisioning_batches WHERE external_setup_reference = ?1
    `).bind(setupId).first<{ count: number }>();
    expect(Number(batches?.count || 0)).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM cards").first<{ count: number }>())
      .toMatchObject({ count: 5 });
  });

  it("does not provision cards from an invalid webhook signature", async () => {
    const setupId = unique("setup");
    const payload = paidOrder({
      setupId,
      orderReference: unique("#order"),
      orderId: unique("order"),
      email: "invalid@example.com"
    });
    const raw = JSON.stringify(payload);
    const context = createExecutionContext();
    const response = await handleRequest(
      new Request(`${ORIGIN}/api/shopify/webhooks/orders-paid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": SHOP_DOMAIN,
          "X-Shopify-Topic": "orders/paid",
          "X-Shopify-Webhook-Id": unique("webhook"),
          "X-Shopify-Hmac-Sha256": "invalid"
        },
        body: raw
      }),
      env,
      context,
      undefined,
      undefined,
      { shopifyAdminProvider: provider }
    );

    expect(response.status).toBe(401);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM provisioning_batches").first<{ count: number }>())
      .toMatchObject({ count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM cards").first<{ count: number }>())
      .toMatchObject({ count: 0 });
  });
});
