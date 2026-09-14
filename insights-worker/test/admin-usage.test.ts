import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  AdminUsageInputError,
  buildAdminUsageRange,
  createAdminUsageRepository
} from "../src/admin-usage";

const NOW = new Date("2026-09-14T10:00:00.000Z");
const USER_A = "admin-usage-user-a";
const USER_B = "admin-usage-user-b";
const BUSINESS_A = "admin-usage-business-a";
const BUSINESS_B = "admin-usage-business-b";
const LOCATION_A = "admin-usage-location-a";
const LOCATION_B = "admin-usage-location-b";
const CARD_A = "admin-usage-card-a";
const CARD_B = "admin-usage-card-b";

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM insights_subscription_lifecycle_events"),
    env.DB.prepare("DELETE FROM insights_cancellation_requests"),
    env.DB.prepare("DELETE FROM business_insights_intro_redemptions"),
    env.DB.prepare("DELETE FROM insights_billing_events"),
    env.DB.prepare("DELETE FROM insights_subscriptions"),
    env.DB.prepare("DELETE FROM customer_usage_events"),
    env.DB.prepare("DELETE FROM customer_dashboard_visits"),
    env.DB.prepare("DELETE FROM customer_sessions"),
    env.DB.prepare("DELETE FROM auth_magic_links"),
    env.DB.prepare("DELETE FROM auth_request_limits"),
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

async function seedCustomerData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO businesses (id, name) VALUES (?1, ?2)").bind(BUSINESS_A, "Alpha Barber"),
    env.DB.prepare("INSERT INTO businesses (id, name) VALUES (?1, ?2)").bind(BUSINESS_B, "Beta Cafe"),
    env.DB.prepare(`
      INSERT INTO locations (id, business_id, business_name, business_address, google_place_id, google_review_url)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      LOCATION_A,
      BUSINESS_A,
      "Alpha Barber",
      "1 Alpha Street, Melbourne VIC",
      "ChIJAdminUsageAlpha",
      "https://search.google.com/local/writereview?placeid=ChIJAdminUsageAlpha"
    ),
    env.DB.prepare(`
      INSERT INTO locations (id, business_id, business_name, business_address, google_place_id, google_review_url)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      LOCATION_B,
      BUSINESS_B,
      "Beta Cafe",
      "2 Beta Street, Melbourne VIC",
      "ChIJAdminUsageBeta",
      "https://search.google.com/local/writereview?placeid=ChIJAdminUsageBeta"
    ),
    env.DB.prepare(`
      INSERT INTO cards (id, public_token, location_id, label, placement_type)
      VALUES (?1, ?2, ?3, 'Front Counter', 'counter')
    `).bind(CARD_A, "TNT-ADMINUSAGEA", LOCATION_A),
    env.DB.prepare(`
      INSERT INTO cards (id, public_token, location_id, label, placement_type)
      VALUES (?1, ?2, ?3, 'Register', 'register')
    `).bind(CARD_B, "TNT-ADMINUSAGEB", LOCATION_B),
    env.DB.prepare("INSERT INTO customer_users (id, email, nickname) VALUES (?1, ?2, ?3)")
      .bind(USER_A, "alpha@example.invalid", "Alex"),
    env.DB.prepare("INSERT INTO customer_users (id, email) VALUES (?1, ?2)")
      .bind(USER_B, "beta@example.invalid"),
    env.DB.prepare("INSERT INTO customer_business_access (user_id, business_id) VALUES (?1, ?2)")
      .bind(USER_A, BUSINESS_A),
    env.DB.prepare("INSERT INTO customer_business_access (user_id, business_id) VALUES (?1, ?2)")
      .bind(USER_B, BUSINESS_B),
    env.DB.prepare(`
      INSERT INTO insights_entitlements (location_id, status, source, activated_at, updated_at)
      VALUES (?1, 'active', 'test', ?2, ?2)
    `).bind(LOCATION_A, NOW.toISOString()),
    env.DB.prepare(`
      INSERT INTO insights_entitlements (location_id, status, source, activated_at, deactivated_at, updated_at)
      VALUES (?1, 'inactive', 'test', ?2, ?2, ?2)
    `).bind(LOCATION_B, NOW.toISOString()),
    env.DB.prepare(`
      INSERT INTO insights_subscriptions (
        id, business_id, location_id, provider, billing_email,
        external_setup_reference, first_provider_order_reference, most_recent_provider_order_reference,
        plan_code, status, currency, expected_intro_price_minor, expected_recurring_price_minor,
        started_at, last_paid_at, expected_next_billing_at, current_period_started_at, current_period_ends_at,
        review_required
      ) VALUES (
        ?1, ?2, ?3, 'shopify', ?4,
        'setup-alpha', 'order-alpha-1', 'order-alpha-1',
        'intro', 'active', 'AUD', 199, 699,
        ?5, ?5, ?6, ?5, ?6,
        0
      )
    `).bind(
      "subscription-alpha",
      BUSINESS_A,
      LOCATION_A,
      "billing-alpha@example.invalid",
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z"
    ),
    env.DB.prepare(`
      INSERT INTO customer_dashboard_visits (user_id, location_id, last_visited_at)
      VALUES (?1, ?2, ?3)
    `).bind(USER_A, LOCATION_A, "2026-09-14T09:00:00.000Z")
  ]);

  const usageRows: Array<[string, string, string, string, number, string]> = [
    [USER_A, LOCATION_A, "dashboard_open", "opened", 0, "2026-09-13T14:05:00.000Z"],
    [USER_A, LOCATION_A, "google_summary", "available", 1, "2026-09-13T15:00:00.000Z"],
    [USER_A, LOCATION_A, "google_summary", "rate_limited", 0, "2026-09-13T16:00:00.000Z"],
    [USER_A, LOCATION_A, "google_reviews", "unavailable", 1, "2026-09-13T17:00:00.000Z"],
    [USER_A, LOCATION_A, "google_summary", "available", 1, "2026-09-13T13:59:00.000Z"]
  ];
  for (const [userId, locationId, eventType, outcome, providerCalled, createdAt] of usageRows) {
    await env.DB.prepare(`
      INSERT INTO customer_usage_events (
        id, user_id, location_id, event_type, outcome, provider_called, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `).bind(
      crypto.randomUUID(),
      userId,
      locationId,
      eventType,
      outcome,
      providerCalled,
      createdAt
    ).run();
  }

  for (const tappedAt of [
    "2026-09-13T10:00:00.000Z",
    "2026-09-04T10:00:00.000Z",
    "2026-08-01T10:00:00.000Z"
  ]) {
    await env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
      .bind(crypto.randomUUID(), CARD_A, tappedAt)
      .run();
  }
}

describe("Phase 4D admin usage aggregation", () => {
  beforeEach(async () => {
    await clearDatabase();
    await seedCustomerData();
  });

  it("uses the admin browser timezone for today's boundary", () => {
    const range = buildAdminUsageRange("today", null, "600", NOW);
    expect(range).toEqual({
      period: "today",
      start: "2026-09-13T14:00:00.000Z",
      end: NOW.toISOString(),
      selectedDate: "2026-09-14",
      timezoneOffsetMinutes: 600
    });
  });

  it("rejects malformed offsets, periods, dates and future dates", () => {
    expect(() => buildAdminUsageRange("30d", null, "900", NOW)).toThrow(AdminUsageInputError);
    expect(() => buildAdminUsageRange("year", null, "600", NOW)).toThrow(AdminUsageInputError);
    expect(() => buildAdminUsageRange("30d", "2026-02-30", "600", NOW)).toThrow(AdminUsageInputError);
    expect(() => buildAdminUsageRange("30d", "2026-09-15", "600", NOW)).toThrow(AdminUsageInputError);
  });

  it("returns every customer-location row and separates clicks from provider calls", async () => {
    const range = buildAdminUsageRange("today", null, "600", NOW);
    const snapshot = await createAdminUsageRepository(env.DB).getSnapshot(range, NOW);

    expect(snapshot.totals.customers).toBe(2);
    expect(snapshot.totals.locations).toBe(2);
    expect(snapshot.totals.activeInsightsLocations).toBe(1);
    expect(snapshot.totals.dashboardOpens).toBe(1);
    expect(snapshot.totals.googleSummaryClicks).toBe(2);
    expect(snapshot.totals.googleReviewsClicks).toBe(1);
    expect(snapshot.totals.googleSummaryProviderCalls).toBe(1);
    expect(snapshot.totals.googleReviewsProviderCalls).toBe(1);
    expect(snapshot.totals.totalProviderCalls).toBe(2);
    expect(snapshot.totals.rateLimitedRequests).toBe(1);
    expect(snapshot.totals.providerUnavailableRequests).toBe(1);

    const alpha = snapshot.customers.find((row) => row.userId === USER_A);
    expect(alpha).toMatchObject({
      email: "alpha@example.invalid",
      nickname: "Alex",
      businessName: "Alpha Barber",
      locationId: LOCATION_A,
      cardCount: 1,
      insightsStatus: "active",
      lastDashboardActivityAt: "2026-09-14T09:00:00.000Z",
      usage: {
        dashboardOpens: 1,
        googleSummaryClicks: 2,
        googleReviewsClicks: 1,
        googleSummaryProviderCalls: 1,
        googleReviewsProviderCalls: 1,
        totalProviderCalls: 2,
        rateLimitedRequests: 1,
        providerUnavailableRequests: 1
      },
      reviewOpportunities: {
        sevenDays: 1,
        thirtyDays: 2,
        lifetime: 3
      }
    });
    expect(alpha?.subscription).toMatchObject({
      status: "active",
      planCode: "intro",
      billingEmail: "billing-alpha@example.invalid",
      currency: "AUD",
      expectedRecurringPriceMinor: 699
    });

    const beta = snapshot.customers.find((row) => row.userId === USER_B);
    expect(beta).toMatchObject({
      email: "beta@example.invalid",
      businessName: "Beta Cafe",
      insightsStatus: "inactive",
      usage: {
        dashboardOpens: 0,
        googleSummaryClicks: 0,
        googleReviewsClicks: 0,
        googleSummaryProviderCalls: 0,
        googleReviewsProviderCalls: 0,
        totalProviderCalls: 0,
        rateLimitedRequests: 0,
        providerUnavailableRequests: 0
      }
    });
    expect(beta?.subscription).toBeNull();
  });

  it("supports a full local-calendar-day breakdown without leaking the adjacent day", async () => {
    const range = buildAdminUsageRange("30d", "2026-09-14", "600", NOW);
    const snapshot = await createAdminUsageRepository(env.DB).getSnapshot(range, NOW);
    const alpha = snapshot.customers.find((row) => row.userId === USER_A);

    expect(range.period).toBe("day");
    expect(range.start).toBe("2026-09-13T14:00:00.000Z");
    expect(alpha?.usage.googleSummaryClicks).toBe(2);
    expect(alpha?.usage.googleSummaryProviderCalls).toBe(1);
  });
});
