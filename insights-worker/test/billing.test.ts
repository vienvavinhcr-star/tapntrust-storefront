import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { decimalMoneyToMinor, SHOPIFY_WEBHOOK_MAX_BODY_BYTES } from "../src/shopify-webhook";
import {
  createShopifyAdminProvider,
  ShopifyAdminProviderError,
  type ShopifyAdminBillingLine,
  type ShopifyAdminProvider
} from "../src/shopify-admin";
import { reserveShopifyWebhookReceipt } from "../src/billing-repository";
import { handleRequest } from "../src/index";

const ORIGIN = "https://go.tapntrust.com";
const ADMIN_TOKEN = "test-admin-token-that-is-not-a-production-secret";
const WEBHOOK_SECRET = "test-shopify-webhook-secret-not-for-production";
const SHOP_DOMAIN = "tapntrust-test.myshopify.com";
const INSIGHTS_VARIANT_ID = "400000000001";
const INTRO_PLAN_ID = "500000000001";
const STANDARD_PLAN_ID = "500000000002";
const REVIEW_URL = "https://search.google.com/local/writereview?placeid=billing-test";

interface ProvisionedTarget {
  businessId: string;
  locationId: string;
  cardToken: string;
}

class MockShopifyAdminProvider implements ShopifyAdminProvider {
  readonly calls: string[] = [];
  readonly orders = new Map<string, ShopifyAdminBillingLine[]>();
  nextFailure: ShopifyAdminProviderError | null = null;

  async getOrderBillingLines(providerOrderReference: string): Promise<ShopifyAdminBillingLine[]> {
    this.calls.push(providerOrderReference);
    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      throw failure;
    }
    return this.orders.get(providerOrderReference) || [];
  }
}

const shopifyAdmin = new MockShopifyAdminProvider();

function unique(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function clearDatabase(): Promise<void> {
  shopifyAdmin.calls.length = 0;
  shopifyAdmin.orders.clear();
  shopifyAdmin.nextFailure = null;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM insights_subscription_lifecycle_events"),
    env.DB.prepare("DELETE FROM insights_cancellation_requests"),
    env.DB.prepare("DELETE FROM business_insights_intro_redemptions"),
    env.DB.prepare("DELETE FROM insights_billing_events WHERE event_type = 'payment_applied'"),
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

async function request(path: string, init?: RequestInit): Promise<{ response: Response; context: ExecutionContext }> {
  const context = createExecutionContext();
  const response = await handleRequest(
    new Request(`${ORIGIN}${path}`, init),
    env,
    context,
    undefined,
    undefined,
    { shopifyAdminProvider: shopifyAdmin }
  );
  return { response, context };
}

async function adminPost(path: string, body: unknown): Promise<Response> {
  return (await request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json",
      Origin: ORIGIN
    },
    body: JSON.stringify(body)
  })).response;
}

async function provisionTarget({
  orderReference,
  setupReference,
  businessId,
  businessName = "Billing Test Business",
  locationSuffix = "one"
}: {
  orderReference: string;
  setupReference: string;
  businessId?: string;
  businessName?: string;
  locationSuffix?: string;
}): Promise<ProvisionedTarget> {
  const response = await adminPost("/api/admin/provisioning/batches", {
    externalOrderReference: orderReference,
    externalSetupReference: setupReference,
    businessMode: businessId ? "existing" : "new",
    ...(businessId ? { businessId } : { businessName }),
    locationMode: "new",
    businessAddress: `${locationSuffix} Billing Street, Melbourne VIC`,
    googlePlaceId: `ChIJ-billing-${locationSuffix}`,
    googleReviewUrl: REVIEW_URL,
    physicalCardCount: 1
  });
  expect([200, 201]).toContain(response.status);
  const payload = await response.json<{
    manifest: { businessId: string; locationId: string; cards: Array<{ publicToken: string }> };
  }>();
  return {
    businessId: payload.manifest.businessId,
    locationId: payload.manifest.locationId,
    cardToken: payload.manifest.cards[0]?.publicToken || ""
  };
}

function orderFixture({
  orderReference = unique("#order"),
  setupReference = unique("setup"),
  orderId = unique("order-id"),
  lineId = unique("line-id"),
  customerId = unique("customer"),
  variantId = INSIGHTS_VARIANT_ID,
  sellingPlanId = INTRO_PLAN_ID,
  price = "1.99",
  currency = "AUD",
  email = `${unique("billing")}@example.invalid`,
  test = false,
  processedAt = "2026-01-31T10:00:00.000Z",
  properties = []
}: {
  orderReference?: string;
  setupReference?: string | null;
  orderId?: string;
  lineId?: string;
  customerId?: string;
  variantId?: string;
  sellingPlanId?: string | null;
  price?: string;
  currency?: string;
  email?: string | null;
  test?: boolean;
  processedAt?: string;
  properties?: Array<{ name: string; value: string }>;
} = {}): Record<string, unknown> {
  return {
    id: orderId,
    admin_graphql_api_id: `gid://shopify/Order/${orderId}`,
    name: orderReference,
    currency,
    processed_at: processedAt,
    test,
    email,
    contact_email: email,
    customer: email ? {
      id: customerId,
      admin_graphql_api_id: `gid://shopify/Customer/${customerId}`,
      email
    } : null,
    line_items: [{
      id: lineId,
      admin_graphql_api_id: `gid://shopify/LineItem/${lineId}`,
      variant_id: variantId,
      quantity: 1,
      price,
      total_discount: "0.00",
      price_set: { shop_money: { amount: price, currency_code: currency } },
      ...(sellingPlanId ? {
        selling_plan_allocation: { selling_plan: { id: `gid://shopify/SellingPlan/${sellingPlanId}` } }
      } : {}),
      properties: [
        ...(setupReference ? [{ name: "_Business Setup ID", value: setupReference }] : []),
        ...properties
      ]
    }]
  };
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

async function deliver(
  payload: Record<string, unknown> | string,
  {
    webhookId = unique("webhook"),
    eventId = unique("event"),
    shopDomain = SHOP_DOMAIN,
    topic = "orders/paid",
    hmac,
    includeHmac = true,
    authoritativeSellingPlanId,
    authoritativeVariantId
  }: {
    webhookId?: string;
    eventId?: string | null;
    shopDomain?: string;
    topic?: string;
    hmac?: string;
    includeHmac?: boolean;
    authoritativeSellingPlanId?: string | null;
    authoritativeVariantId?: string | null;
  } = {}
): Promise<Response> {
  const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (typeof payload !== "string") {
    const orderReference = String(payload.admin_graphql_api_id ?? payload.id ?? "");
    const lines = Array.isArray(payload.line_items) ? payload.line_items : [];
    shopifyAdmin.orders.set(orderReference, lines.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const line = value as Record<string, unknown>;
      const allocation = line.selling_plan_allocation;
      const sellingPlan = allocation && typeof allocation === "object" && !Array.isArray(allocation)
        ? (allocation as Record<string, unknown>).selling_plan
        : null;
      const defaultPlanId = sellingPlan && typeof sellingPlan === "object" && !Array.isArray(sellingPlan)
        ? (sellingPlan as Record<string, unknown>).id
        : null;
      const lineReference = String(line.admin_graphql_api_id ?? line.id ?? "");
      if (!lineReference) return [];
      return [{
        providerLineReference: lineReference,
        variantId: authoritativeVariantId === undefined
          ? `gid://shopify/ProductVariant/${String(line.variant_id ?? "")}`
          : authoritativeVariantId,
        sellingPlanId: authoritativeSellingPlanId === undefined
          ? (typeof defaultPlanId === "string" ? defaultPlanId : null)
          : authoritativeSellingPlanId,
        sellingPlanName: "Test billing plan",
        providerSubscriptionReference: null
      }];
    }));
  }
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Shopify-Shop-Domain": shopDomain,
    "X-Shopify-Topic": topic,
    "X-Shopify-Webhook-Id": webhookId,
    "X-Shopify-Triggered-At": "2026-01-31T10:00:00.000Z"
  });
  if (eventId) headers.set("X-Shopify-Event-Id", eventId);
  if (includeHmac) headers.set("X-Shopify-Hmac-Sha256", hmac ?? await sign(rawBody));
  return (await request("/api/shopify/webhooks/orders-paid", {
    method: "POST",
    headers,
    body: rawBody
  })).response;
}

async function count(table: string): Promise<number> {
  const allowed = new Set([
    "insights_subscriptions",
    "insights_billing_events",
    "shopify_webhook_receipts",
    "business_insights_intro_redemptions",
    "customer_users",
    "customer_business_access",
    "insights_entitlements",
    "cards",
    "tap_events"
  ]);
  if (!allowed.has(table)) throw new Error("Unsupported test table");
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  return Number(row?.count || 0);
}

beforeEach(clearDatabase);

describe("Shopify Admin billing provider", () => {
  it("queries the authoritative order line with a server-only Admin token", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ input, init });
      return Response.json({
        data: {
          order: {
            id: "gid://shopify/Order/123",
            lineItems: {
              nodes: [{
                id: "gid://shopify/LineItem/456",
                variant: { id: `gid://shopify/ProductVariant/${INSIGHTS_VARIANT_ID}` },
                sellingPlan: {
                  sellingPlanId: `gid://shopify/SellingPlan/${INTRO_PLAN_ID}`,
                  name: "Intro then monthly"
                }
              }],
              pageInfo: { hasNextPage: false, endCursor: null }
            }
          }
        }
      });
    };
    const provider = createShopifyAdminProvider({
      shopDomain: SHOP_DOMAIN,
      accessToken: "test-admin-api-token-not-a-production-secret",
      apiVersion: "2026-07"
    }, fetcher);

    const lines = await provider.getOrderBillingLines("gid://shopify/Order/123");

    expect(lines).toEqual([{
      providerLineReference: "gid://shopify/LineItem/456",
      variantId: `gid://shopify/ProductVariant/${INSIGHTS_VARIANT_ID}`,
      sellingPlanId: `gid://shopify/SellingPlan/${INTRO_PLAN_ID}`,
      sellingPlanName: "Intro then monthly",
      providerSubscriptionReference: null
    }]);
    expect(String(calls[0]?.input)).toBe(`https://${SHOP_DOMAIN}/admin/api/2026-07/graphql.json`);
    expect(new Headers(calls[0]?.init?.headers).get("X-Shopify-Access-Token"))
      .toBe("test-admin-api-token-not-a-production-secret");
    const body = JSON.parse(String(calls[0]?.init?.body)) as { query: string };
    expect(body.query).toContain("sellingPlanId");
    expect(body.query).toContain("variant { id }");
    expect(body.query).not.toContain("SubscriptionContract");
  });

  it("aborts a slow Shopify Admin request before the webhook delivery window is consumed", async () => {
    vi.useFakeTimers();
    try {
      let wasAborted = false;
      const fetcher: typeof fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const signal = init?.signal;
        return await new Promise<Response>((_resolve, reject) => {
          if (!signal) {
            reject(new Error("missing abort signal"));
            return;
          }
          signal.addEventListener("abort", () => {
            wasAborted = true;
            reject(new Error("aborted"));
          }, { once: true });
        });
      };
      const provider = createShopifyAdminProvider({
        shopDomain: SHOP_DOMAIN,
        accessToken: "test-admin-api-token-not-a-production-secret",
        apiVersion: "2026-07"
      }, fetcher);

      const pending = provider.getOrderBillingLines("gid://shopify/Order/123");
      const rejection = expect(pending).rejects.toMatchObject({ code: "request_failed" });
      await vi.advanceTimersByTimeAsync(2500);

      await rejection;
      expect(wasAborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Shopify orders/paid webhook security", () => {
  it("rejects missing and invalid HMAC before processing payload data", async () => {
    const payload = orderFixture();
    const missing = await deliver(payload, { includeHmac: false });
    const invalid = await deliver(payload, { hmac: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" });

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(await count("shopify_webhook_receipts")).toBe(0);
    expect(await count("insights_billing_events")).toBe(0);
  });

  it("verifies the exact raw bytes and accepts a valid signature", async () => {
    const payload = orderFixture({ variantId: "physical-card-only" });
    const exact = JSON.stringify(payload);
    const valid = await deliver(exact);
    const changedBytes = `${exact} `;
    const invalid = await deliver(changedBytes, { hmac: await sign(exact) });

    expect(valid.status).toBe(200);
    expect(invalid.status).toBe(401);
    expect(await count("shopify_webhook_receipts")).toBe(1);
  });

  it("rejects wrong shop, wrong topic, malformed JSON and an oversized body safely", async () => {
    const payload = orderFixture();
    expect((await deliver(payload, { shopDomain: "attacker.myshopify.com" })).status).toBe(403);
    expect((await deliver(payload, { topic: "orders/create" })).status).toBe(403);
    expect((await deliver("{not-json")).status).toBe(400);

    const oversized = await request("/api/shopify/webhooks/orders-paid", {
      method: "POST",
      headers: {
        "Content-Length": String(SHOPIFY_WEBHOOK_MAX_BODY_BYTES + 1),
        "X-Shopify-Hmac-Sha256": "invalid"
      },
      body: "{}"
    });
    expect(oversized.response.status).toBe(413);
    expect(await count("shopify_webhook_receipts")).toBe(0);
  });

  it("allows POST only and never requires browser Origin or customer cookies", async () => {
    const get = await request("/api/shopify/webhooks/orders-paid");
    expect(get.response.status).toBe(405);
    expect(get.response.headers.get("Allow")).toBe("POST");

    const payload = orderFixture({ variantId: "physical-card-only" });
    const response = await deliver(payload);
    expect(response.status).toBe(200);
  });
});

describe("Shopify billing classification and money", () => {
  it("ignores an unrelated physical-card order and never identifies by price alone", async () => {
    const unrelated = await deliver(orderFixture({ variantId: "physical-card-variant", sellingPlanId: null }));
    const priceOnly = await deliver(orderFixture({ sellingPlanId: null }));

    expect(await unrelated.json()).toMatchObject({ result: "ignored" });
    expect(await priceOnly.json()).toMatchObject({ result: "review" });
    expect(await count("insights_subscriptions")).toBe(0);
    expect(await count("insights_billing_events")).toBe(1);
  });

  it("normalizes AUD cents exactly without floating-point money arithmetic", () => {
    expect(decimalMoneyToMinor("1.99")).toBe(199);
    expect(decimalMoneyToMinor("6.99")).toBe(699);
    expect(decimalMoneyToMinor("1.999")).toBeNull();
    expect(decimalMoneyToMinor("not-money")).toBeNull();
  });

  it("flags wrong currency and amount without activating Insights", async () => {
    const wrongCurrency = await deliver(orderFixture({ currency: "USD" }));
    const wrongAmount = await deliver(orderFixture({ price: "2.00" }));

    expect(await wrongCurrency.json()).toMatchObject({ result: "review" });
    expect(await wrongAmount.json()).toMatchObject({ result: "review" });
    expect(await count("insights_subscriptions")).toBe(0);
    expect(await count("insights_entitlements")).toBe(0);
    const events = await env.DB.prepare(`
      SELECT amount_minor, currency, result FROM insights_billing_events ORDER BY created_at
    `).all<{ amount_minor: number; currency: string; result: string }>();
    expect(events.results).toEqual([
      { amount_minor: 199, currency: "USD", result: "anomaly_wrong_currency" },
      { amount_minor: 200, currency: "AUD", result: "anomaly_amount_mismatch" }
    ]);
  });

  it("recognizes intro and standard selling plans independently of price identity", async () => {
    const introOrder = unique("#intro-order");
    const introSetup = unique("intro-setup");
    await provisionTarget({ orderReference: introOrder, setupReference: introSetup });
    const intro = await deliver(orderFixture({ orderReference: introOrder, setupReference: introSetup }));

    const standardOrder = unique("#standard-order");
    const standardSetup = unique("standard-setup");
    await provisionTarget({ orderReference: standardOrder, setupReference: standardSetup, locationSuffix: "standard" });
    const standard = await deliver(orderFixture({
      orderReference: standardOrder,
      setupReference: standardSetup,
      sellingPlanId: STANDARD_PLAN_ID,
      price: "6.99"
    }));

    expect(await intro.json()).toMatchObject({ result: "activated" });
    expect(await standard.json()).toMatchObject({ result: "activated" });
    const plans = await env.DB.prepare(`
      SELECT plan_code, amount_minor FROM insights_billing_events
      WHERE event_type = 'orders_paid' ORDER BY amount_minor
    `).all<{ plan_code: string; amount_minor: number }>();
    expect(plans.results).toEqual([
      { plan_code: "intro", amount_minor: 199 },
      { plan_code: "standard", amount_minor: 699 }
    ]);
  });

  it("never treats a forged private plan property as authoritative subscription proof", async () => {
    const orderReference = unique("#property-plan");
    const setupReference = unique("property-plan-setup");
    await provisionTarget({ orderReference, setupReference });
    const response = await deliver(orderFixture({
      orderReference,
      setupReference,
      sellingPlanId: null,
      properties: [{ name: "_Insights Selling Plan ID", value: INTRO_PLAN_ID }]
    }), { authoritativeSellingPlanId: null });

    expect(await response.json()).toMatchObject({ result: "review" });
    expect(await count("insights_subscriptions")).toBe(0);
    expect(await count("insights_entitlements")).toBe(0);
  });

  it("activates from the authoritative Admin selling plan when the webhook omits its allocation", async () => {
    const orderReference = unique("#admin-plan");
    const setupReference = unique("admin-plan-setup");
    await provisionTarget({ orderReference, setupReference });
    const response = await deliver(orderFixture({
      orderReference,
      setupReference,
      sellingPlanId: null
    }), { authoritativeSellingPlanId: `gid://shopify/SellingPlan/${INTRO_PLAN_ID}` });

    expect(await response.json()).toMatchObject({ result: "activated" });
    expect(shopifyAdmin.calls).toHaveLength(1);
    expect(await count("insights_subscriptions")).toBe(1);
  });

  it("does not activate Shopify test orders", async () => {
    const orderReference = unique("#test-order");
    const setupReference = unique("test-setup");
    await provisionTarget({ orderReference, setupReference });
    const response = await deliver(orderFixture({ orderReference, setupReference, test: true }));

    expect(await response.json()).toMatchObject({ result: "test_ignored" });
    expect(await count("insights_subscriptions")).toBe(0);
    expect(await count("insights_entitlements")).toBe(0);
    expect(shopifyAdmin.calls).toHaveLength(0);
  });

  it("flags A$1.99 on the standard selling plan as an anomaly", async () => {
    const orderReference = unique("#wrong-standard-price");
    const setupReference = unique("wrong-standard-price-setup");
    await provisionTarget({ orderReference, setupReference });
    const response = await deliver(orderFixture({
      orderReference,
      setupReference,
      sellingPlanId: STANDARD_PLAN_ID,
      price: "1.99"
    }));

    expect(await response.json()).toMatchObject({ result: "review" });
    expect(await count("insights_subscriptions")).toBe(0);
    const event = await env.DB.prepare(`
      SELECT result FROM insights_billing_events WHERE event_type = 'orders_paid'
    `).first<{ result: string }>();
    expect(event?.result).toBe("anomaly_amount_mismatch");
  });
});

describe("billing activation, tenant resolution and idempotency", () => {
  it("activates only the location proven by provisioning and ignores arbitrary location properties", async () => {
    const intendedOrder = unique("#intended-order");
    const intendedSetup = unique("intended-setup");
    const intended = await provisionTarget({ orderReference: intendedOrder, setupReference: intendedSetup });
    const other = await provisionTarget({
      orderReference: unique("#other-order"),
      setupReference: unique("other-setup"),
      businessName: "Other Business",
      locationSuffix: "other"
    });
    const response = await deliver(orderFixture({
      orderReference: intendedOrder,
      setupReference: intendedSetup,
      email: "Owner+Billing@Example.Invalid",
      properties: [
        { name: "business_id", value: other.businessId },
        { name: "location_id", value: other.locationId }
      ]
    }));

    expect(await response.json()).toMatchObject({ result: "activated" });
    const subscription = await env.DB.prepare(`
      SELECT business_id, location_id, billing_email FROM insights_subscriptions
    `).first<{ business_id: string; location_id: string; billing_email: string }>();
    expect(subscription).toEqual({
      business_id: intended.businessId,
      location_id: intended.locationId,
      billing_email: "owner+billing@example.invalid"
    });
    const otherEntitlement = await env.DB.prepare(`
      SELECT status FROM insights_entitlements WHERE location_id = ?1
    `).bind(other.locationId).first<{ status: string }>();
    expect(otherEntitlement).toBeNull();
  });

  it("rejects ambiguous cross-business setup resolution", async () => {
    const sharedSetup = unique("shared-setup");
    await provisionTarget({ orderReference: unique("#left"), setupReference: sharedSetup, businessName: "Left" });
    await provisionTarget({ orderReference: unique("#right"), setupReference: sharedSetup, businessName: "Right", locationSuffix: "right" });

    const response = await deliver(orderFixture({
      orderReference: unique("#renewal"),
      setupReference: sharedSetup,
      sellingPlanId: STANDARD_PLAN_ID,
      price: "6.99"
    }));
    expect(await response.json()).toMatchObject({ result: "review" });
    expect(await count("insights_subscriptions")).toBe(0);
    expect(await count("insights_entitlements")).toBe(0);
  });

  it("does not treat a setup reference alone as authority for a new intro order", async () => {
    const setupReference = unique("non-bearer-setup");
    await provisionTarget({
      orderReference: unique("#original-card-order"),
      setupReference,
      businessName: "Protected Business"
    });

    const response = await deliver(orderFixture({
      orderReference: unique("#different-intro-order"),
      setupReference
    }));
    expect(await response.json()).toMatchObject({ result: "pending" });
    expect(await count("insights_subscriptions")).toBe(0);
    expect(await count("customer_business_access")).toBe(0);
    expect(await count("insights_entitlements")).toBe(0);
  });

  it("stores an early payment as pending and reconciles exactly after provisioning", async () => {
    const orderReference = unique("#pending-order");
    const setupReference = unique("pending-setup");
    const email = `${unique("pending")}@example.invalid`;
    const paid = await deliver(orderFixture({ orderReference, setupReference, email }));

    expect(await paid.json()).toMatchObject({ result: "pending" });
    expect(await count("insights_subscriptions")).toBe(0);
    const target = await provisionTarget({ orderReference, setupReference });

    expect(await count("insights_subscriptions")).toBe(1);
    expect(await count("customer_users")).toBe(1);
    expect(await count("customer_business_access")).toBe(1);
    const entitlement = await env.DB.prepare(`
      SELECT location_id, status, source FROM insights_entitlements
    `).first<{ location_id: string; status: string; source: string }>();
    expect(entitlement).toEqual({
      location_id: target.locationId,
      status: "active",
      source: "shopify_orders_paid"
    });
    expect(await count("insights_billing_events")).toBe(2);
  });

  it("deduplicates webhook ID, event ID and provider order/line retries without extending twice", async () => {
    const orderReference = unique("#dedupe-order");
    const setupReference = unique("dedupe-setup");
    await provisionTarget({ orderReference, setupReference });
    const payload = orderFixture({ orderReference, setupReference });
    const webhookId = unique("same-webhook");
    const eventId = unique("same-event");

    const first = await deliver(payload, { webhookId, eventId });
    expect(shopifyAdmin.calls).toHaveLength(1);
    const sameDelivery = await deliver(payload, { webhookId, eventId });
    const sameEvent = await deliver(payload, { webhookId: unique("new-webhook"), eventId });
    expect(shopifyAdmin.calls).toHaveLength(1);
    const sameOrderLine = await deliver(payload, { webhookId: unique("retry-webhook"), eventId: unique("retry-event") });

    expect(await first.json()).toMatchObject({ result: "activated" });
    expect(await sameDelivery.json()).toMatchObject({ result: "duplicate" });
    expect(await sameEvent.json()).toMatchObject({ result: "duplicate" });
    expect(await sameOrderLine.json()).toMatchObject({ result: "duplicate" });
    expect(await count("insights_subscriptions")).toBe(1);
    expect(await count("insights_entitlements")).toBe(1);
    expect(await count("customer_users")).toBe(1);
    expect(await count("customer_business_access")).toBe(1);
    expect(await count("insights_billing_events")).toBe(2);
    const subscription = await env.DB.prepare(`
      SELECT current_period_started_at, current_period_ends_at, expected_next_billing_at
      FROM insights_subscriptions
    `).first<{
      current_period_started_at: string;
      current_period_ends_at: string | null;
      expected_next_billing_at: string | null;
    }>();
    expect(subscription).toEqual({
      current_period_started_at: "2026-01-31T10:00:00.000Z",
      current_period_ends_at: null,
      expected_next_billing_at: null
    });
  });

  it("keeps a transient Shopify Admin lookup failure retryable", async () => {
    const orderReference = unique("#retryable-admin");
    const setupReference = unique("retryable-admin-setup");
    await provisionTarget({ orderReference, setupReference });
    const payload = orderFixture({ orderReference, setupReference });
    const webhookId = unique("retryable-webhook");
    const eventId = unique("retryable-event");
    shopifyAdmin.nextFailure = new ShopifyAdminProviderError("request_failed", 503);

    const failed = await deliver(payload, { webhookId, eventId });
    expect(failed.status).toBe(503);
    expect(await count("insights_subscriptions")).toBe(0);
    expect(await count("insights_billing_events")).toBe(0);
    const receipt = await env.DB.prepare(`
      SELECT processed_at, result FROM shopify_webhook_receipts WHERE webhook_id = ?1
    `).bind(webhookId).first<{ processed_at: string | null; result: string }>();
    expect(receipt).toEqual({ processed_at: null, result: "received" });

    const retried = await deliver(payload, { webhookId, eventId });
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ result: "activated" });
    expect(shopifyAdmin.calls).toHaveLength(2);
    expect(await count("insights_subscriptions")).toBe(1);
  });

  it("deduplicates event IDs within a topic while allowing future topics their own identity", async () => {
    const sharedEventId = unique("topic-event");
    const first = await reserveShopifyWebhookReceipt(env.DB, {
      webhookId: unique("topic-webhook"),
      eventId: sharedEventId,
      topic: "orders/paid",
      shopDomain: SHOP_DOMAIN,
      payloadHash: "a".repeat(64),
      receivedAt: "2026-01-01T00:00:00.000Z"
    });
    const second = await reserveShopifyWebhookReceipt(env.DB, {
      webhookId: unique("topic-webhook"),
      eventId: sharedEventId,
      topic: "subscription_contracts/update",
      shopDomain: SHOP_DOMAIN,
      payloadHash: "b".repeat(64),
      receivedAt: "2026-01-01T00:00:01.000Z"
    });

    expect(first.receiptWebhookId).not.toBe(second.receiptWebhookId);
    expect(await count("shopify_webhook_receipts")).toBe(2);
  });

  it("accepts A$6.99 renewal on the same intro selling plan without a second intro redemption", async () => {
    const originalOrder = unique("#original-order");
    const setupReference = unique("renewal-setup");
    const customerId = unique("renewal-customer");
    await provisionTarget({ orderReference: originalOrder, setupReference });
    await deliver(orderFixture({ orderReference: originalOrder, setupReference, customerId }));

    const renewalOrder = unique("#renewal-order");
    const renewalProviderId = unique("renewal-provider-id");
    const renewal = await deliver(orderFixture({
      orderReference: renewalOrder,
      setupReference,
      orderId: renewalProviderId,
      customerId,
      sellingPlanId: INTRO_PLAN_ID,
      price: "6.99",
      processedAt: "2026-02-28T10:00:00.000Z"
    }));

    expect(await renewal.json()).toMatchObject({ result: "activated" });
    expect(await count("insights_subscriptions")).toBe(1);
    const subscription = await env.DB.prepare(`
      SELECT
        plan_code,
        last_paid_at,
        expected_next_billing_at,
        most_recent_provider_order_reference,
        expected_intro_price_minor,
        expected_recurring_price_minor
      FROM insights_subscriptions
    `).first<{
      plan_code: string;
      last_paid_at: string;
      expected_next_billing_at: string | null;
      most_recent_provider_order_reference: string;
      expected_intro_price_minor: number;
      expected_recurring_price_minor: number;
    }>();
    expect(subscription).toEqual({
      plan_code: "standard",
      last_paid_at: "2026-02-28T10:00:00.000Z",
      expected_next_billing_at: null,
      most_recent_provider_order_reference: `gid://shopify/Order/${renewalProviderId}`,
      expected_intro_price_minor: 199,
      expected_recurring_price_minor: 699
    });
    expect(await count("insights_billing_events")).toBe(4);
    expect(await count("business_insights_intro_redemptions")).toBe(1);
  });

  it("does not misclassify the same intro event as a second redemption after a partial retry", async () => {
    const orderReference = unique("#partial-retry");
    const setupReference = unique("partial-retry-setup");
    const payload = orderFixture({ orderReference, setupReference });
    await provisionTarget({ orderReference, setupReference });
    await deliver(payload);
    await env.DB.prepare("DELETE FROM insights_billing_events WHERE event_type = 'payment_applied'").run();

    const retried = await deliver(payload, {
      webhookId: unique("partial-retry-webhook"),
      eventId: unique("partial-retry-event")
    });
    expect(await retried.json()).toMatchObject({ result: "activated" });
    expect(await count("business_insights_intro_redemptions")).toBe(1);
    const subscription = await env.DB.prepare(`
      SELECT status, review_required FROM insights_subscriptions
    `).first<{ status: string; review_required: number }>();
    expect(subscription).toEqual({ status: "active", review_required: 0 });
  });
});

describe("business-scoped intro redemption and Phase 1 preservation", () => {
  it("records one intro per business, flags a second, and allows another business its own intro", async () => {
    const firstOrder = unique("#first-intro");
    const firstSetup = unique("first-intro-setup");
    const first = await provisionTarget({ orderReference: firstOrder, setupReference: firstSetup });
    expect((await deliver(orderFixture({ orderReference: firstOrder, setupReference: firstSetup }))).status).toBe(200);

    const secondOrder = unique("#second-intro");
    const secondSetup = unique("second-intro-setup");
    await provisionTarget({
      orderReference: secondOrder,
      setupReference: secondSetup,
      businessId: first.businessId,
      locationSuffix: "second-location"
    });
    const second = await deliver(orderFixture({ orderReference: secondOrder, setupReference: secondSetup }));
    expect(await second.json()).toMatchObject({ result: "activated_intro_repeat_review" });

    const otherOrder = unique("#other-intro");
    const otherSetup = unique("other-intro-setup");
    await provisionTarget({ orderReference: otherOrder, setupReference: otherSetup, businessName: "Independent Business", locationSuffix: "independent" });
    expect((await deliver(orderFixture({ orderReference: otherOrder, setupReference: otherSetup }))).status).toBe(200);

    expect(await count("business_insights_intro_redemptions")).toBe(2);
    expect(await count("insights_subscriptions")).toBe(3);
    expect(await count("insights_entitlements")).toBe(3);
    const reviewSubscriptions = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM insights_subscriptions WHERE review_required = 1 AND status = 'review'
    `).first<{ count: number }>();
    expect(Number(reviewSubscriptions?.count || 0)).toBe(1);
  });

  it("preserves historical taps, card token, destination, redirect and tap recording", async () => {
    const orderReference = unique("#history-order");
    const setupReference = unique("history-setup");
    const target = await provisionTarget({ orderReference, setupReference });
    const before = await request(`/t/${target.cardToken}`);
    await waitOnExecutionContext(before.context);
    expect(before.response.status).toBe(302);

    await deliver(orderFixture({ orderReference, setupReference }));
    const after = await request(`/t/${target.cardToken}`);
    await waitOnExecutionContext(after.context);
    expect(after.response.status).toBe(302);
    expect(after.response.headers.get("Location")).toBe(REVIEW_URL);

    const card = await env.DB.prepare(`
      SELECT c.public_token, l.google_review_url
      FROM cards c JOIN locations l ON l.id = c.location_id
      WHERE c.location_id = ?1
    `).bind(target.locationId).first<{ public_token: string; google_review_url: string }>();
    expect(card).toEqual({ public_token: target.cardToken, google_review_url: REVIEW_URL });
    expect(await count("cards")).toBe(1);
    expect(await count("tap_events")).toBe(2);
  });

  it("logs only safe billing categories and never webhook body, email, secret or HMAC", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const orderReference = unique("#safe-log");
    const setupReference = unique("safe-log-setup");
    const email = "private-billing@example.invalid";
    await provisionTarget({ orderReference, setupReference });
    await deliver(orderFixture({ orderReference, setupReference, email }));
    const output = log.mock.calls.flat().join(" ");

    expect(output).toContain("shopify_orders_paid");
    expect(output).not.toContain(email);
    expect(output).not.toContain(WEBHOOK_SECRET);
    expect(output).not.toContain("X-Shopify-Hmac");
    expect(output).not.toContain("line_items");
    log.mockRestore();
  });
});
