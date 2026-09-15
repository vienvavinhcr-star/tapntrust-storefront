import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { handleRequest } from "../src/index";
import type { InsightsPurchaseDependencies } from "../src/insights-purchase";
import {
  GooglePlacesProviderError,
  type GooglePlacesFailureCode,
  type GooglePlacesProvider
} from "../src/places-provider";

const WORKER_ORIGIN = "https://go.tapntrust.com";
const STOREFRONT_ORIGIN = "https://tapntrust.com";
const ADMIN_TOKEN = "test-admin-token-that-is-not-a-production-secret";
const INTRO_CODE = "TNTI-TEST-INTRO-CODE";

class MockPlacesProvider implements GooglePlacesProvider {
  readonly summaryCalls: string[] = [];
  failCode: GooglePlacesFailureCode | null = null;

  async fetchSummary(placeId: string, _apiKey: string) {
    this.summaryCalls.push(placeId);
    if (this.failCode) throw new GooglePlacesProviderError(this.failCode);
    return {
      rating: 4.8,
      userRatingCount: 100,
      placeUri: `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`
    };
  }

  async fetchReviews(_placeId: string, _apiKey: string) {
    return { reviewsUri: null, reviews: [] };
  }
}

const placesProvider = new MockPlacesProvider();
const purchaseDependencies: InsightsPurchaseDependencies = { placesProvider };

function unique(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function clearDatabase() {
  placesProvider.summaryCalls.length = 0;
  placesProvider.failCode = null;
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
      ) VALUES (?, ?, ?, 'shopify', ?, ?, ?, ?, 'intro', 'active', 'AUD', 199, 699, ?, ?, ?, ?, ?)
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

describe("storefront Insights shared intro offer", () => {
  it("rejects requests from a different origin", async () => {
    const response = await requestOffer({
      action: "quote",
      businessName: "Test",
      googlePlaceId: "ChIJ-test-place",
      reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJ-test-place"
    }, "https://evil.example");
    expect(response.status).toBe(403);
    expect(placesProvider.summaryCalls).toHaveLength(0);
  });

  it("rejects a non-Google review URL before business verification", async () => {
    const response = await requestOffer({
      action: "quote",
      businessName: "Bad Link Business",
      googlePlaceId: "ChIJ-bad-link",
      reviewUrl: "https://example.com/review"
    });
    expect(response.status).toBe(400);
    expect(placesProvider.summaryCalls).toHaveLength(0);
  });

  it("quotes a verified business as intro eligible without exposing the shared code", async () => {
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
    expect(payload.recurringMinor).toBe(699);
    expect(payload.sellingPlanId).toBe(String(env.SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID));
    expect(payload.discountCode).toBeUndefined();
    expect(placesProvider.summaryCalls).toEqual(["ChIJ-new-business"]);
  });

  it("does not issue an intro when Google says the Place ID is invalid or missing", async () => {
    placesProvider.failCode = "not_found";
    const response = await requestOffer({
      action: "issue",
      setupId: unique("setup"),
      businessName: "Fake Business",
      googlePlaceId: "ChIJ-fake-business",
      reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJ-fake-business"
    });
    expect(response.status).toBe(400);
    const row = await env.DB.prepare("SELECT id FROM insights_intro_offers LIMIT 1").first<{ id: string }>();
    expect(row).toBeNull();
  });

  it("fails closed when Google verification is temporarily unavailable", async () => {
    placesProvider.failCode = "timeout";
    const response = await requestOffer({
      action: "issue",
      setupId: unique("setup"),
      businessName: "Verification Timeout Business",
      googlePlaceId: "ChIJ-timeout-business",
      reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJ-timeout-business"
    });
    expect(response.status).toBe(503);
  });

  it("issues the single configured intro code and reuses the reservation without creating Shopify discount rows", async () => {
    const body = {
      action: "issue",
      setupId: unique("setup"),
      businessName: "New Test Business",
      googlePlaceId: "ChIJ-issue-business",
      reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJ-issue-business"
    };
    const first = await requestOffer(body);
    expect(first.status).toBe(200);
    const firstPayload = await first.json<{ discountCode: string; offerId: string; sellingPlanId: string }>();
    expect(firstPayload.discountCode).toBe(INTRO_CODE);
    expect(firstPayload.offerId).toMatch(/^offer_/);
    expect(firstPayload.sellingPlanId).toBe(String(env.SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID));

    const firstRow = await env.DB.prepare(`
      SELECT status, discount_code, shopify_discount_node_id
      FROM insights_intro_offers
      LIMIT 1
    `).first<{ status: string; discount_code: string | null; shopify_discount_node_id: string | null }>();
    expect(firstRow).toEqual({ status: "issued", discount_code: null, shopify_discount_node_id: null });

    const second = await requestOffer(body);
    expect(second.status).toBe(200);
    const secondPayload = await second.json<{ discountCode: string; offerId: string }>();
    expect(secondPayload.discountCode).toBe(INTRO_CODE);
    expect(secondPayload.offerId).toBe(firstPayload.offerId);
  });

  it("returns standard pricing without the shared code after the business consumed its intro", async () => {
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
    expect(payload.firstMonthMinor).toBe(699);
    expect(payload.reason).toBe("intro_already_used");
    expect(payload.sellingPlanId).toBe(String(env.SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID));
    expect(payload.discountCode).toBeUndefined();
  });

  it("quotes a manual business at standard A$6.99 without Google verification", async () => {
    const response = await requestOffer({
      action: "quote",
      businessName: "Manual Business",
      reviewUrl: "https://search.google.com/local/writereview?placeid=manual-test"
    });
    expect(response.status).toBe(200);
    const payload = await response.json<Record<string, unknown>>();
    expect(payload.offerKind).toBe("standard");
    expect(payload.introEligible).toBe(false);
    expect(payload.reason).toBe("manual_unverified");
    expect(payload.firstMonthMinor).toBe(699);
    expect(payload.recurringMinor).toBe(699);
    expect(payload.sellingPlanId).toBe(String(env.SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID));
    expect(payload.discountCode).toBeUndefined();
    expect(placesProvider.summaryCalls).toHaveLength(0);
  });

  it("does not create an intro reservation for a manual business issue request", async () => {
    const response = await requestOffer({
      action: "issue",
      setupId: unique("setup"),
      businessName: "Manual Business",
      reviewUrl: "https://search.google.com/local/writereview?placeid=manual-test"
    });
    expect(response.status).toBe(200);
    const payload = await response.json<Record<string, unknown>>();
    expect(payload.offerKind).toBe("standard");
    expect(payload.reason).toBe("manual_unverified");
    const row = await env.DB.prepare("SELECT id FROM insights_intro_offers LIMIT 1").first<{ id: string }>();
    expect(row).toBeNull();
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
