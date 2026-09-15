import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { buildAdminAnalyticsRange, createAdminAnalyticsRepository } from "../src/admin-analytics";

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM customer_usage_events"),
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

beforeEach(clearDatabase);

describe("admin CRM analytics", () => {
  it("shows checkout email, card URLs, taps and customer dashboard usage together", async () => {
    const businessId = "biz-crm";
    const locationId = "loc-crm";
    const cardId = "card-crm";
    const userId = "user-crm";
    const now = new Date("2026-09-15T02:00:00.000Z");

    await env.DB.batch([
      env.DB.prepare("INSERT INTO businesses (id, name) VALUES (?1, ?2)").bind(businessId, "Pho Thin Australia"),
      env.DB.prepare(`INSERT INTO locations (id, business_id, business_name, business_address, google_place_id, google_review_url) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
        .bind(locationId, businessId, "Pho Thin Australia", "399 Lonsdale St, Melbourne VIC", "ChIJCRM123", "https://search.google.com/local/writereview?placeid=ChIJCRM123"),
      env.DB.prepare(`INSERT INTO cards (id, public_token, location_id, label, placement_type) VALUES (?1, ?2, ?3, ?4, 'counter')`)
        .bind(cardId, "TNT-CRMTESTCARD12345", locationId, "Front Counter"),
      env.DB.prepare(`INSERT INTO provisioning_batches (id, source, external_order_reference, external_setup_reference, request_fingerprint, business_id, location_id, physical_card_count, customer_email, created_at) VALUES (?1, 'shopify_webhook', '#1001', 'setup-crm', 'fingerprint-crm', ?2, ?3, 1, 'owner@example.com', '2026-09-14T01:00:00.000Z')`)
        .bind("batch-crm", businessId, locationId),
      env.DB.prepare("INSERT INTO provisioning_batch_cards (batch_id, card_id, card_ordinal) VALUES ('batch-crm', ?1, 1)").bind(cardId),
      env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES ('tap-1', ?1, '2026-09-15T01:00:00.000Z')").bind(cardId),
      env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES ('tap-2', ?1, '2026-08-01T01:00:00.000Z')").bind(cardId),
      env.DB.prepare("INSERT INTO customer_users (id, email) VALUES (?1, 'owner@example.com')").bind(userId),
      env.DB.prepare("INSERT INTO customer_business_access (user_id, business_id, role) VALUES (?1, ?2, 'owner')").bind(userId, businessId),
      env.DB.prepare("INSERT INTO insights_entitlements (location_id, status, source, activated_at) VALUES (?1, 'active', 'shopify', '2026-09-14T01:00:00.000Z')").bind(locationId),
      env.DB.prepare(`INSERT INTO customer_usage_events (id, user_id, location_id, event_type, outcome, provider_called, created_at) VALUES ('usage-open', ?1, ?2, 'dashboard_open', 'opened', 0, '2026-09-15T01:10:00.000Z')`).bind(userId, locationId),
      env.DB.prepare(`INSERT INTO customer_usage_events (id, user_id, location_id, event_type, outcome, provider_called, created_at) VALUES ('usage-summary', ?1, ?2, 'google_summary', 'available', 1, '2026-09-15T01:11:00.000Z')`).bind(userId, locationId),
      env.DB.prepare(`INSERT INTO customer_usage_events (id, user_id, location_id, event_type, outcome, provider_called, created_at) VALUES ('usage-reviews', ?1, ?2, 'google_reviews', 'rate_limited', 0, '2026-09-15T01:12:00.000Z')`).bind(userId, locationId)
    ]);

    const range = buildAdminAnalyticsRange(new URL("https://go.tapntrust.com/api/admin/analytics?period=30d&timezoneOffsetMinutes=600"), now);
    const snapshot = await createAdminAnalyticsRepository(env.DB, "https://go.tapntrust.com").getSnapshot(range, now);

    expect(snapshot.totals.customersWithEmail).toBe(1);
    expect(snapshot.totals.cards).toBe(1);
    expect(snapshot.totals.tapsInRange).toBe(1);
    expect(snapshot.totals.lifetimeTaps).toBe(2);
    expect(snapshot.totals.googleProviderCalls).toBe(1);

    const row = snapshot.locations.find((item) => item.locationId === locationId);
    expect(row).toMatchObject({
      customerEmail: "owner@example.com",
      orderReference: "#1001",
      setupReference: "setup-crm",
      cardCount: 1,
      tapsInRange: 1,
      lifetimeTaps: 2,
      insightsStatus: "active",
      dashboardUsage: {
        opens: 1,
        refreshGoogleDataClicks: 1,
        showGoogleReviewsClicks: 1,
        googleProviderCalls: 1,
        rateLimited: 1,
        providerUnavailable: 0
      }
    });
    expect(row?.cards[0]?.programmingUrl).toBe("https://go.tapntrust.com/t/TNT-CRMTESTCARD12345");
  });

  it("keeps card-only customers visible without creating Insights access", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO businesses (id, name) VALUES ('biz-card-only', 'Card Only Cafe')"),
      env.DB.prepare(`INSERT INTO locations (id, business_id, business_name, business_address, google_review_url) VALUES ('loc-card-only', 'biz-card-only', 'Card Only Cafe', 'Melbourne VIC', 'https://search.google.com/local/writereview?placeid=CardOnly')`),
      env.DB.prepare(`INSERT INTO cards (id, public_token, location_id, label, placement_type) VALUES ('card-card-only', 'TNT-CARDONLY12345', 'loc-card-only', 'Counter', 'counter')`),
      env.DB.prepare(`INSERT INTO provisioning_batches (id, source, external_order_reference, external_setup_reference, request_fingerprint, business_id, location_id, physical_card_count, customer_email, created_at) VALUES ('batch-card-only', 'shopify_webhook', '#2002', 'setup-card-only', 'fingerprint-card-only', 'biz-card-only', 'loc-card-only', 1, 'cardonly@example.com', '2026-09-15T00:00:00.000Z')`)
    ]);

    const now = new Date("2026-09-15T02:00:00.000Z");
    const range = buildAdminAnalyticsRange(new URL("https://go.tapntrust.com/api/admin/analytics?period=all"), now);
    const snapshot = await createAdminAnalyticsRepository(env.DB, "https://go.tapntrust.com").getSnapshot(range, now);
    const row = snapshot.locations.find((item) => item.locationId === "loc-card-only");

    expect(row?.customerEmail).toBe("cardonly@example.com");
    expect(row?.insightsStatus).toBe("not_configured");
    expect(row?.subscription).toBeNull();
  });
});
