import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { handleRequest } from "../src/index";
import type { IntroDiscountInput, InsightsPurchaseDependencies, ShopifyDiscountProvider } from "../src/insights-purchase";

const WORKER_ORIGIN = "https://go.tapntrust.com";
const STOREFRONT_ORIGIN = "https://tapntrust.com";
const ADMIN_TOKEN = "test-admin-token-that-is-not-a-production-secret";

class MockDiscountProvider implements ShopifyDiscountProvider {
  readonly calls: IntroDiscountInput[] = [];
  fail = false;

  async createIntroDiscount(input: IntroDiscountInput) {
    this.calls.push(input);
    if (this.fail) throw new Error("provider down");
    return { nodeId: `gid://shopify/DiscountCodeNode/${this.calls.length}`, code: input.code };
  }
}

const discountProvider = new MockDiscountProvider();
const purchaseDependencies: InsightsPurchaseDependencies = { discountProvider };

function unique(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function clearDatabase() {
  discountProvider.calls.length = 0;
  discountProvider.fail = false;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM insights_intro_offers"),
    env.DB.prepare("DELETE FROM insights_subscription_lifecycle_events"),
    env.DB.prepare("DELETE FROM insights_cancellation_requests"),
    env.DB.prepare("UPDATE insights_billing_events SET source_event_id = NULL WHERE source_event_id IS NOT NULL"),
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

async function requestOffer(body: Record<string, unknown>, origin = STOREFRONT_ORIGIN) {
  const ctx = createExecutionContext();
  return handleRequest(
    new Request(`${WORKER_ORIGIN}/api/storefront/insights/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body)
    }),
    env,
    ctx,
    undefined,
    undefined,
    undefined,
    purchaseDependencies
  );
}

async function adminPost(path: string, body: unknown) {
  const ctx = createExecutionContext();
  return handleRequest(
    new Request(`${WORKER_ORIGIN}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
        Origin: WORKER_ORIGIN
      },
      body: JSON.stringify(body)
    }),
    env,
    ctx
  );
}

async function seedRedeemedBusiness(placeId: string) {
  const orderReference = unique("order");
  const setupReference = unique("setup");
  const provision = await adminPost("/api/admin/provisioning/batches", {
    externalOrderReference: orderReference,
    externalSetupReference: setupReference,
    businessMode: "new",
    businessName: "Redeemed Test Business",
    locationMode: "new",
    businessAddress: "1 Test Street, Melbourne VIC",
    googlePlaceId: placeId,
    googleReviewUrl: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`,
    physicalCardCount: 1
  });
  expect([200, 201]).toContain(provision.status);
  const data = await provision.json<{ manifest: { businessId: string; locationId: string } }>();
  const subscriptionId = unique("sub");
  const billingEventId = unique("event");
  const now = "2026-09-13T10:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO insights_subscriptions (
        id, business_id, location_id, provider, billing_email, external_setup_reference,
        first_provider_order_reference, most_recent_provider_order_reference, plan_code, status,
        currency, expected_intro_price_minor, expected_recurring_price_minor, started_at,
        last_paid_at, current_period_started_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'shopify', ?, ?, ?, ?, 'intro', 'active', 'AUD', 199, 999, ?, ?, ?, ?, ?)
    `).bind(subscriptionId, data.manifest.businessId, data.manifest.locationId, "redeemed@example.invalid", setupReference, orderReference, orderReference, now, now, now, now, now),
    env.DB.prepare(`
      INSERT INTO insights_billing_events (
        id, subscription_id, provider, provider_webhook_id, provider_order_reference,
        provider_line_reference, external_order_reference, external_setup_reference,
        billing_email, event_type, plan_code, amount_minor, currency, occurred_at,
        payload_hash, result
      ) VALUES (?, ?, 'shopify', ?, ?, ?, ?, ?, ?, 'payment', 'intro', 199, 'AUD', ?, ?, 'activated')
    `).bind(billingEventId, subscriptionId, unique("webhook"), orderReference, unique("line"), orderReference, setupReference, "redeemed@example.invalid", now, unique("hash")),
  ]);
  await env.DB.prepare(`
    INSERT INTO business_insights_intro_redemptions (
      business_id, subscription_id, provider, provider_order_reference, billing_event_id, redeemed_at
    ) VALUES (?, ?, 'shopify', ?, ?, ?)
  `).bind(data.manifest.businessId, subscriptionId, orderReference, billingEventId, now).run();
}

beforeEach(clearDatabase);

describe("Phase 4C storefront Insights offer", () => {
  it("rejects requests from a different origin", async () => {
    const response = await requestOffer({
      action: "quote",
      businessName: "Test",
      googlePlaceId: "ChIJ-test-place",
      reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJ-test-place"
    }, "https://evil.example");
    expect(response.status).toBe(403);
  });

  it("quotes a new Google business as intro eligible without creating a discount", async () => {
    const response = await requestOffer({
      action: "quote",
      businessName: "New Test Business",
      googlePlaceId: "ChIJ-new-business",
      reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJ-new-business"
    });
    expect(response.status).toBe(200);
    const payload = await response.json<Record<string, unknown>>();
    expect(payload.offerKind).toBe("intro");
    expect(payload.firstMonthMinor).toBe(199);
    expect(payload.recurringMinor).toBe(999);
    expect(discountProvider.calls).toHaveLength(0);
  });

  it("creates one subscription-only A$8 discount for one billing cycle and reuses it", async () => {
    const body = {
      action: "issue",
      setupId: unique("setup"),
      businessName: "New Test Business",
      googlePlaceId: "ChIJ-issue-business",
      reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJ-issue-business"
    };
    const first = await requestOffer(body);
    expect(first.status).toBe(200);
    const firstPayload = await first.json<{ discountCode: string; offerId: string }>();
    expect(firstPayload.discountCode).toMatch(/^TNTI-/);
    expect(discountProvider.calls).toHaveLength(1);
    expect(discountProvider.calls[0]?.variantId).toBe(String(env.SHOPIFY_INSIGHTS_VARIANT_ID));

    const second = await requestOffer(body);
    expect(second.status).toBe(200);
    const secondPayload = await second.json<{ discountCode: string; offerId: string }>();
    expect(secondPayload.discountCode).toBe(firstPayload.discountCode);
    expect(secondPayload.offerId).toBe(firstPayload.offerId);
    expect(discountProvider.calls).toHaveLength(1);
  });

  it("returns standard pricing for a business that already consumed its intro", async () => {
    const placeId = "ChIJ-redeemed-business";
    await seedRedeemedBusiness(placeId);
    const response = await requestOffer({
      action: "issue",
      setupId: unique("setup"),
      businessName: "Redeemed Test Business",
      googlePlaceId: placeId,
      reviewUrl: `https://search.google.com/local/writereview?placeid=${placeId}`
    });
    expect(response.status).toBe(200);
    const payload = await response.json<Record<string, unknown>>();
    expect(payload.offerKind).toBe("standard");
    expect(payload.introEligible).toBe(false);
    expect(payload.firstMonthMinor).toBe(999);
    expect(discountProvider.calls).toHaveLength(0);
  });

  it("uses a privacy-preserving manual-business identity and can issue an intro", async () => {
    const response = await requestOffer({
      action: "issue",
      setupId: unique("setup"),
      businessName: "Manual Business",
      reviewUrl: "https://search.google.com/local/writereview?placeid=manual-test"
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare("SELECT identity_key FROM insights_intro_offers LIMIT 1").first<{ identity_key: string }>();
    expect(row?.identity_key).toMatch(/^manual:[a-f0-9]{64}$/);
    expect(row?.identity_key).not.toContain("Manual Business");
  });

  it("fails closed when Shopify cannot create the intro discount", async () => {
    discountProvider.fail = true;
    const response = await requestOffer({
      action: "issue",
      setupId: unique("setup"),
      businessName: "Provider Failure Business",
      googlePlaceId: "ChIJ-provider-fail",
      reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJ-provider-fail"
    });
    expect(response.status).toBe(503);
    const row = await env.DB.prepare("SELECT status, discount_code FROM insights_intro_offers LIMIT 1").first<{ status: string; discount_code: string | null }>();
    expect(row?.status).toBe("failed");
    expect(row?.discount_code).toBeNull();
  });

  it("supports CORS preflight only for the configured storefront", async () => {
    const ctx = createExecutionContext();
    const response = await handleRequest(
      new Request(`${WORKER_ORIGIN}/api/storefront/insights/offer`, {
        method: "OPTIONS",
        headers: { Origin: STOREFRONT_ORIGIN }
      }),
      env,
      ctx,
      undefined,
      undefined,
      undefined,
      purchaseDependencies
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(STOREFRONT_ORIGIN);
  });
});
