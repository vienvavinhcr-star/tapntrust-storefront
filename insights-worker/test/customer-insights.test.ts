import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { generateOpaqueToken, hashToken, SESSION_COOKIE_NAME } from "../src/auth";
import type { CustomerAuthDependencies } from "../src/customer-auth";
import { handleRequest } from "../src/index";
import type { GooglePlacesProvider } from "../src/places-provider";

const NOW = new Date("2026-09-12T04:30:00.000Z");
const TEST_API_KEY = "test-google-places-key-not-a-production-secret";

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_request_limits"),
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

async function seedTenant(prefix: string, email: string): Promise<{ cookie: string; locationId: string; cardId: string }> {
  const businessId = `${prefix}-business`;
  const locationId = `${prefix}-location`;
  const cardId = `${prefix}-card`;
  const userId = `${prefix}-user`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO businesses (id, name) VALUES (?1, ?2)").bind(businessId, `${prefix} Business`),
    env.DB.prepare(`
      INSERT INTO locations (id, business_id, business_name, business_address, google_place_id, google_review_url)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      locationId,
      businessId,
      `${prefix} Business`,
      `${prefix} Address`,
      `ChIJ${prefix}PlaceId`,
      `https://search.google.com/local/writereview?placeid=ChIJ${prefix}`
    ),
    env.DB.prepare(`
      INSERT INTO cards (id, public_token, location_id, label, placement_type)
      VALUES (?1, ?2, ?3, ?4, 'counter')
    `).bind(cardId, `TNT-${prefix.toUpperCase()}12345`, locationId, `${prefix} Front Counter`),
    env.DB.prepare("INSERT INTO customer_users (id, email) VALUES (?1, ?2)").bind(userId, email),
    env.DB.prepare("INSERT INTO customer_business_access (user_id, business_id) VALUES (?1, ?2)")
      .bind(userId, businessId),
    env.DB.prepare(`
      INSERT INTO insights_entitlements (location_id, status, source, activated_at, updated_at)
      VALUES (?1, 'active', 'test', ?2, ?2)
    `).bind(locationId, NOW.toISOString())
  ]);
  const rawSession = generateOpaqueToken();
  await env.DB.prepare(`
    INSERT INTO customer_sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
  `).bind(
    crypto.randomUUID(),
    userId,
    await hashToken(rawSession),
    new Date(NOW.getTime() + 86_400_000).toISOString(),
    NOW.toISOString()
  ).run();
  return { cookie: `${SESSION_COOKIE_NAME}=${rawSession}`, locationId, cardId };
}

async function addTap(cardId: string, tappedAt: string): Promise<void> {
  await env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
    .bind(crypto.randomUUID(), cardId, tappedAt).run();
}

async function request(
  path: string,
  cookie?: string,
  dependencies: CustomerAuthDependencies = {},
  environment: Env = env
): Promise<Response> {
  return handleRequest(
    new Request(`https://go.tapntrust.com${path}`, { headers: cookie ? { Cookie: cookie } : {} }),
    environment,
    createExecutionContext(),
    undefined,
    { now: () => NOW, ...dependencies }
  );
}

beforeEach(clearDatabase);

describe("tenant-scoped customer insights", () => {
  it("computes exact period boundaries, card share, trend and all-time values from owned taps", async () => {
    const tenant = await seedTenant("alpha", "alpha@example.invalid");
    const sevenDayStart = new Date(NOW.getTime() - 7 * 86_400_000);
    await addTap(tenant.cardId, new Date(NOW.getTime() - 60 * 60 * 1000).toISOString());
    await addTap(tenant.cardId, sevenDayStart.toISOString());
    await addTap(tenant.cardId, new Date(sevenDayStart.getTime() - 1).toISOString());

    const response = await request(
      `/api/customer/insights?period=7d&locationId=${tenant.locationId}&timezoneOffsetMinutes=600`,
      tenant.cookie
    );
    const data = await response.json<Record<string, any>>();

    expect(response.status).toBe(200);
    expect(data.reviewOpportunities).toBe(2);
    expect(data.previousPeriodOpportunities).toBe(1);
    expect(data.allTimeOpportunities).toBe(3);
    expect(data.activeCardCount).toBe(1);
    expect(data.cards[0]).toMatchObject({ periodTaps: 2, previousPeriodTaps: 1, sharePercent: 100 });
    expect(data.timezoneLabel).toBe("Your browser time (UTC+10:00)");
    expect(JSON.stringify(data)).not.toContain("googlePlaceId");
    expect(JSON.stringify(data)).not.toContain("google_review_url");
  });

  it("rejects another tenant's location and never calls Google with its place ID", async () => {
    const alpha = await seedTenant("alpha", "alpha@example.invalid");
    const beta = await seedTenant("beta", "beta@example.invalid");
    const provider: GooglePlacesProvider = {
      fetchSummary: vi.fn(),
      fetchReviews: vi.fn()
    };

    const insights = await request(
      `/api/customer/insights?locationId=${beta.locationId}`,
      alpha.cookie
    );
    const google = await request(
      `/api/customer/google-place/summary?locationId=${beta.locationId}`,
      alpha.cookie,
      { placesProvider: provider }
    );

    expect(insights.status).toBe(404);
    expect(google.status).toBe(404);
    expect(provider.fetchSummary).not.toHaveBeenCalled();
    expect(provider.fetchReviews).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated analytics and Google requests", async () => {
    expect((await request("/api/customer/insights")).status).toBe(401);
    expect((await request("/api/customer/google-place/summary")).status).toBe(401);
    expect((await request("/api/customer/google-place/reviews")).status).toBe(401);
  });

  it("hides an inactive entitlement without altering cards or tap history", async () => {
    const tenant = await seedTenant("alpha", "alpha@example.invalid");
    await addTap(tenant.cardId, new Date(NOW.getTime() - 1).toISOString());
    await env.DB.prepare("UPDATE insights_entitlements SET status = 'inactive' WHERE location_id = ?1")
      .bind(tenant.locationId).run();

    const hidden = await request("/api/customer/insights", tenant.cookie);
    const card = await env.DB.prepare("SELECT active, public_token FROM cards WHERE id = ?1")
      .bind(tenant.cardId).first<{ active: number; public_token: string }>();
    const taps = await env.DB.prepare("SELECT COUNT(*) AS count FROM tap_events WHERE card_id = ?1")
      .bind(tenant.cardId).first<{ count: number }>();

    expect(hidden.status).toBe(403);
    expect(card?.active).toBe(1);
    expect(card?.public_token).toBe("TNT-ALPHA12345");
    expect(Number(taps?.count)).toBe(1);
  });
});

describe("cost-safe Google Places access", () => {
  it("keeps summary and selected reviews as separate tenant-derived provider calls", async () => {
    const tenant = await seedTenant("alpha", "alpha@example.invalid");
    const provider: GooglePlacesProvider = {
      fetchSummary: vi.fn(async () => ({
        rating: 4.8,
        userRatingCount: 186,
        placeUri: "https://www.google.com/maps/place/alpha"
      })),
      fetchReviews: vi.fn(async () => ({ reviewsUri: null, reviews: [] }))
    };

    const summary = await request(
      `/api/customer/google-place/summary?locationId=${tenant.locationId}`,
      tenant.cookie,
      { placesProvider: provider }
    );
    expect(summary.status).toBe(200);
    expect(provider.fetchSummary).toHaveBeenCalledWith("ChIJalphaPlaceId", TEST_API_KEY);
    expect(provider.fetchReviews).not.toHaveBeenCalled();

    const reviews = await request(
      `/api/customer/google-place/reviews?locationId=${tenant.locationId}`,
      tenant.cookie,
      { placesProvider: provider }
    );
    expect(reviews.status).toBe(200);
    expect(provider.fetchReviews).toHaveBeenCalledWith("ChIJalphaPlaceId", TEST_API_KEY);
  });

  it("rate-limits repeated summary calls before invoking Google again", async () => {
    const tenant = await seedTenant("alpha", "alpha@example.invalid");
    const provider: GooglePlacesProvider = {
      fetchSummary: vi.fn(async () => ({
        rating: 4.8,
        userRatingCount: 186,
        placeUri: "https://www.google.com/maps/place/alpha"
      })),
      fetchReviews: vi.fn()
    };

    const first = await request(
      `/api/customer/google-place/summary?locationId=${tenant.locationId}`,
      tenant.cookie,
      { placesProvider: provider }
    );
    const limited = await request(
      `/api/customer/google-place/summary?locationId=${tenant.locationId}`,
      tenant.cookie,
      { placesProvider: provider }
    );

    expect(first.status).toBe(200);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("30");
    expect(await limited.json()).toEqual({ status: "rate_limited" });
    expect(provider.fetchSummary).toHaveBeenCalledTimes(1);
  });

  it("keeps summary and review rate-limit namespaces independent and persists only hashes", async () => {
    const email = "alpha@example.invalid";
    const tenant = await seedTenant("alpha", email);
    const provider: GooglePlacesProvider = {
      fetchSummary: vi.fn(async () => ({ rating: 4.8, userRatingCount: 186, placeUri: null })),
      fetchReviews: vi.fn(async () => ({ reviewsUri: null, reviews: [] }))
    };

    const summary = await request(
      `/api/customer/google-place/summary?locationId=${tenant.locationId}`,
      tenant.cookie,
      { placesProvider: provider }
    );
    const limitedSummary = await request(
      `/api/customer/google-place/summary?locationId=${tenant.locationId}`,
      tenant.cookie,
      { placesProvider: provider }
    );
    const reviews = await request(
      `/api/customer/google-place/reviews?locationId=${tenant.locationId}`,
      tenant.cookie,
      { placesProvider: provider }
    );
    const rows = await env.DB.prepare(`
      SELECT identifier_hash FROM auth_request_limits ORDER BY identifier_hash
    `).all<{ identifier_hash: string }>();
    const persisted = JSON.stringify(rows.results);

    expect(summary.status).toBe(200);
    expect(limitedSummary.status).toBe(429);
    expect(reviews.status).toBe(200);
    expect(provider.fetchSummary).toHaveBeenCalledTimes(1);
    expect(provider.fetchReviews).toHaveBeenCalledTimes(1);
    expect(rows.results).toHaveLength(2);
    for (const row of rows.results) {
      expect(row.identifier_hash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(persisted).not.toContain(email);
    expect(persisted).not.toContain(tenant.locationId);
    expect(persisted).not.toContain("ChIJalphaPlaceId");
    expect(persisted).not.toContain(TEST_API_KEY);
  });

  it("returns calm provider status while Tapntrust analytics remains available", async () => {
    const tenant = await seedTenant("alpha", "alpha@example.invalid");
    await addTap(tenant.cardId, new Date(NOW.getTime() - 1).toISOString());
    const provider: GooglePlacesProvider = {
      fetchSummary: vi.fn(async () => { throw new Error("secret provider detail"); }),
      fetchReviews: vi.fn()
    };
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const google = await request(
        `/api/customer/google-place/summary?locationId=${tenant.locationId}`,
        tenant.cookie,
        { placesProvider: provider }
      );
      const analytics = await request("/api/customer/insights?period=30d", tenant.cookie);

      expect(await google.json()).toEqual({ status: "unavailable" });
      expect(analytics.status).toBe(200);
      expect((await analytics.json<Record<string, number>>()).reviewOpportunities).toBe(1);
      expect(warning.mock.calls.flat().join(" ")).not.toContain("secret provider detail");
    } finally {
      warning.mockRestore();
    }
  });

  it("adds no Google content snapshot tables to D1", async () => {
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all<{ name: string }>();
    const names = tables.results.map((row) => row.name.toLowerCase());
    expect(names.some((name) => name.includes("google") && (
      name.includes("review") || name.includes("rating") || name.includes("snapshot")
    ))).toBe(false);
  });
});
