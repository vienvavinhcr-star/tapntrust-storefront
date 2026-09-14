import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { hashToken, SESSION_COOKIE_NAME } from "../src/auth";
import type { CustomerAuthDependencies } from "../src/customer-auth";
import { handleRequest } from "../src/index";
import { GooglePlacesProviderError, type GooglePlacesProvider } from "../src/places-provider";

const BUSINESS_ID = "business-usage-test";
const LOCATION_ID = "location-usage-test";
const USER_ID = "user-usage-test";
const SESSION_TOKEN = "usage-session-token-abcdefghijklmnopqrstuvwxyz-123456";
const NOW = new Date("2026-09-14T10:00:00.000Z");
const AUTH_ORIGIN = "https://go.tapntrust.com";

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM customer_usage_events"),
    env.DB.prepare("DELETE FROM auth_request_limits"),
    env.DB.prepare("DELETE FROM customer_sessions"),
    env.DB.prepare("DELETE FROM customer_business_access"),
    env.DB.prepare("DELETE FROM customer_users"),
    env.DB.prepare("DELETE FROM insights_entitlements"),
    env.DB.prepare("DELETE FROM cards"),
    env.DB.prepare("DELETE FROM locations"),
    env.DB.prepare("DELETE FROM businesses")
  ]);
}

async function seedCustomer(): Promise<void> {
  const tokenHash = await hashToken(SESSION_TOKEN);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO businesses (id, name) VALUES (?1, ?2)")
      .bind(BUSINESS_ID, "Usage Test Business"),
    env.DB.prepare(`
      INSERT INTO locations (
        id, business_id, business_name, business_address, google_place_id, google_review_url
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      LOCATION_ID,
      BUSINESS_ID,
      "Usage Test Business",
      "1 Test Street, Melbourne VIC",
      "ChIJUsageTracking123",
      "https://search.google.com/local/writereview?placeid=ChIJUsageTracking123"
    ),
    env.DB.prepare("INSERT INTO customer_users (id, email) VALUES (?1, ?2)")
      .bind(USER_ID, "usage-test@example.invalid"),
    env.DB.prepare(`
      INSERT INTO customer_business_access (user_id, business_id)
      VALUES (?1, ?2)
    `).bind(USER_ID, BUSINESS_ID),
    env.DB.prepare(`
      INSERT INTO insights_entitlements (location_id, status, source, activated_at, updated_at)
      VALUES (?1, 'active', 'test', ?2, ?2)
    `).bind(LOCATION_ID, NOW.toISOString()),
    env.DB.prepare(`
      INSERT INTO customer_sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).bind(
      "session-usage-test",
      USER_ID,
      tokenHash,
      "2099-01-01T00:00:00.000Z",
      NOW.toISOString()
    )
  ]);
}

function cookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`;
}

async function customerRequest(
  path: string,
  init: RequestInit = {},
  dependencies: CustomerAuthDependencies = {}
): Promise<Response> {
  const context = createExecutionContext();
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookieHeader());
  const response = await handleRequest(
    new Request(`https://go.tapntrust.com${path}`, { ...init, headers }),
    env,
    context,
    undefined,
    { now: () => NOW, ...dependencies }
  );
  await waitOnExecutionContext(context);
  return response;
}

function placesProvider(overrides: Partial<GooglePlacesProvider> = {}): GooglePlacesProvider {
  return {
    fetchSummary: vi.fn(async () => ({
      rating: 4.9,
      userRatingCount: 123,
      placeUri: "https://www.google.com/maps/place/test"
    })),
    fetchReviews: vi.fn(async () => ({
      reviewsUri: "https://www.google.com/maps/place/test/reviews",
      reviews: []
    })),
    ...overrides
  };
}

describe("Phase 4D customer usage tracking", () => {
  beforeEach(async () => {
    await clearDatabase();
    await seedCustomer();
  });

  it("creates the usage-event schema needed for per-customer daily reporting", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(customer_usage_events)").all<{
      name: string;
      type: string;
    }>();
    expect(columns.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "user_id", type: "TEXT" }),
      expect.objectContaining({ name: "location_id", type: "TEXT" }),
      expect.objectContaining({ name: "event_type", type: "TEXT" }),
      expect.objectContaining({ name: "outcome", type: "TEXT" }),
      expect.objectContaining({ name: "provider_called", type: "INTEGER" }),
      expect.objectContaining({ name: "created_at", type: "TEXT" })
    ]));
  });

  it("records dashboard opens and separates Google clicks from actual provider calls", async () => {
    const provider = placesProvider();

    const visit = await customerRequest(`/api/customer/locations/${LOCATION_ID}/visit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: AUTH_ORIGIN
      },
      body: "{}"
    }, { placesProvider: provider });
    expect(visit.status).toBe(200);

    const summary = await customerRequest(
      `/api/customer/google-place/summary?locationId=${LOCATION_ID}`,
      {},
      { placesProvider: provider }
    );
    expect(summary.status).toBe(200);

    const reviews = await customerRequest(
      `/api/customer/google-place/reviews?locationId=${LOCATION_ID}`,
      {},
      { placesProvider: provider }
    );
    expect(reviews.status).toBe(200);

    const rows = await env.DB.prepare(`
      SELECT event_type, outcome, provider_called
      FROM customer_usage_events
      WHERE user_id = ?1
      ORDER BY event_type ASC
    `).bind(USER_ID).all<{
      event_type: string;
      outcome: string;
      provider_called: number;
    }>();

    expect(rows.results).toEqual(expect.arrayContaining([
      { event_type: "dashboard_open", outcome: "opened", provider_called: 0 },
      { event_type: "google_summary", outcome: "available", provider_called: 1 },
      { event_type: "google_reviews", outcome: "available", provider_called: 1 }
    ]));
    expect(provider.fetchSummary).toHaveBeenCalledTimes(1);
    expect(provider.fetchReviews).toHaveBeenCalledTimes(1);
  });

  it("counts a rate-limited refresh click without counting a second provider call", async () => {
    const provider = placesProvider();

    const first = await customerRequest(
      `/api/customer/google-place/summary?locationId=${LOCATION_ID}`,
      {},
      { placesProvider: provider }
    );
    expect(first.status).toBe(200);

    const second = await customerRequest(
      `/api/customer/google-place/summary?locationId=${LOCATION_ID}`,
      {},
      { placesProvider: provider }
    );
    expect(second.status).toBe(429);

    const totals = await env.DB.prepare(`
      SELECT COUNT(*) AS clicks, SUM(provider_called) AS provider_calls
      FROM customer_usage_events
      WHERE user_id = ?1 AND event_type = 'google_summary'
    `).bind(USER_ID).first<{ clicks: number; provider_calls: number }>();

    expect(Number(totals?.clicks || 0)).toBe(2);
    expect(Number(totals?.provider_calls || 0)).toBe(1);
    expect(provider.fetchSummary).toHaveBeenCalledTimes(1);

    const outcomes = await env.DB.prepare(`
      SELECT outcome, provider_called
      FROM customer_usage_events
      WHERE user_id = ?1 AND event_type = 'google_summary'
      ORDER BY created_at ASC, id ASC
    `).bind(USER_ID).all<{ outcome: string; provider_called: number }>();
    expect(outcomes.results).toEqual(expect.arrayContaining([
      { outcome: "available", provider_called: 1 },
      { outcome: "rate_limited", provider_called: 0 }
    ]));
  });

  it("marks a provider attempt even when Google fails after the request is allowed", async () => {
    const provider = placesProvider({
      fetchSummary: vi.fn(async () => {
        throw new GooglePlacesProviderError("provider_unavailable");
      })
    });

    const response = await customerRequest(
      `/api/customer/google-place/summary?locationId=${LOCATION_ID}`,
      {},
      { placesProvider: provider }
    );
    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`
      SELECT outcome, provider_called
      FROM customer_usage_events
      WHERE user_id = ?1 AND event_type = 'google_summary'
      LIMIT 1
    `).bind(USER_ID).first<{ outcome: string; provider_called: number }>();

    expect(row).toEqual({ outcome: "unavailable", provider_called: 1 });
  });

  it("does not create usage rows for an unauthenticated Google request", async () => {
    const context = createExecutionContext();
    const response = await handleRequest(
      new Request(`https://go.tapntrust.com/api/customer/google-place/summary?locationId=${LOCATION_ID}`),
      env,
      context,
      undefined,
      { now: () => NOW, placesProvider: placesProvider() }
    );
    await waitOnExecutionContext(context);
    expect(response.status).toBe(401);

    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM customer_usage_events")
      .first<{ count: number }>();
    expect(Number(count?.count || 0)).toBe(0);
  });
});
