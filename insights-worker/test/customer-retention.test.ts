import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { generateOpaqueToken, hashToken, SESSION_COOKIE_NAME } from "../src/auth";
import type { CustomerAuthDependencies } from "../src/customer-auth";
import { buildGoogleMapsListingUrl } from "../src/customer-insights";
import { handleRequest } from "../src/index";
import type { GooglePlacesProvider } from "../src/places-provider";

const AUTH_ORIGIN = "https://go.tapntrust.com";
const FIRST_VISIT = new Date("2026-09-13T01:00:00.000Z");

interface Tenant {
  userId: string;
  businessId: string;
  locationId: string;
  cardId: string;
  cookie: string;
  reviewUrl: string;
}

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM customer_dashboard_visits"),
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

async function seedTenant(prefix: string): Promise<Tenant> {
  const userId = `${prefix}-user`;
  const businessId = `${prefix}-business`;
  const locationId = `${prefix}-location`;
  const cardId = `${prefix}-card`;
  const reviewUrl = `https://search.google.com/local/writereview?placeid=ChIJ${prefix}`;
  const rawSession = generateOpaqueToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO businesses (id, name) VALUES (?1, ?2)")
      .bind(businessId, `${prefix} Group`),
    env.DB.prepare(`
      INSERT INTO locations (
        id, business_id, business_name, business_address, google_place_id, google_review_url
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      locationId,
      businessId,
      `${prefix} Business`,
      `${prefix} Street`,
      `ChIJ${prefix}`,
      reviewUrl
    ),
    env.DB.prepare(`
      INSERT INTO cards (id, public_token, location_id, label, placement_type)
      VALUES (?1, ?2, ?3, ?4, 'counter')
    `).bind(cardId, `TNT-${prefix.toUpperCase()}12345`, locationId, `${prefix} Counter`),
    env.DB.prepare("INSERT INTO customer_users (id, email) VALUES (?1, ?2)")
      .bind(userId, `${prefix}@example.invalid`),
    env.DB.prepare("INSERT INTO customer_business_access (user_id, business_id) VALUES (?1, ?2)")
      .bind(userId, businessId),
    env.DB.prepare(`
      INSERT INTO insights_entitlements (location_id, status, source, activated_at, updated_at)
      VALUES (?1, 'active', 'test', ?2, ?2)
    `).bind(locationId, FIRST_VISIT.toISOString()),
    env.DB.prepare(`
      INSERT INTO customer_sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).bind(
      crypto.randomUUID(),
      userId,
      await hashToken(rawSession),
      new Date(FIRST_VISIT.getTime() + 86_400_000).toISOString(),
      FIRST_VISIT.toISOString()
    )
  ]);
  return {
    userId,
    businessId,
    locationId,
    cardId,
    cookie: `${SESSION_COOKIE_NAME}=${rawSession}`,
    reviewUrl
  };
}

async function request(
  path: string,
  init: RequestInit = {},
  now: Date = FIRST_VISIT,
  dependencies: CustomerAuthDependencies = {}
): Promise<Response> {
  return handleRequest(
    new Request(`${AUTH_ORIGIN}${path}`, init),
    env,
    createExecutionContext(),
    undefined,
    { ...dependencies, now: () => now }
  );
}

function customerMutation(
  path: string,
  tenant: Tenant,
  method: "PATCH" | "POST",
  body: unknown,
  now: Date = FIRST_VISIT,
  origin = AUTH_ORIGIN
): Promise<Response> {
  return request(path, {
    method,
    headers: {
      Cookie: tenant.cookie,
      Origin: origin,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }, now);
}

beforeEach(clearDatabase);

describe("customer retention profile", () => {
  it("stores an optional nickname on only the authenticated customer and supports later edits", async () => {
    const alpha = await seedTenant("alpha");
    const beta = await seedTenant("beta");
    const initial = await request("/api/customer/summary", { headers: { Cookie: alpha.cookie } });
    expect((await initial.json<Record<string, any>>()).profile).toEqual({
      nickname: null,
      nicknamePromptDismissed: false,
      onboardingDismissed: false
    });

    const saved = await customerMutation(
      "/api/customer/profile",
      alpha,
      "PATCH",
      { action: "save_nickname", nickname: "  Justin  " }
    );
    expect(saved.status).toBe(200);
    expect((await saved.json<Record<string, any>>()).profile).toMatchObject({
      nickname: "Justin",
      nicknamePromptDismissed: true
    });

    const edited = await customerMutation(
      "/api/customer/profile",
      alpha,
      "PATCH",
      { action: "save_nickname", nickname: "J" }
    );
    const rows = await env.DB.prepare(`
      SELECT id, nickname FROM customer_users ORDER BY id
    `).all<{ id: string; nickname: string | null }>();
    expect(edited.status).toBe(200);
    expect(rows.results).toEqual([
      { id: alpha.userId, nickname: "J" },
      { id: beta.userId, nickname: null }
    ]);
  });

  it("persists nickname skip and onboarding dismissal without changing authentication", async () => {
    const tenant = await seedTenant("alpha");
    const skipped = await customerMutation(
      "/api/customer/profile",
      tenant,
      "PATCH",
      { action: "skip_nickname" }
    );
    const dismissed = await customerMutation(
      "/api/customer/profile",
      tenant,
      "PATCH",
      { action: "dismiss_onboarding" }
    );
    const summary = await request("/api/customer/summary", { headers: { Cookie: tenant.cookie } });
    const data = await summary.json<Record<string, any>>();

    expect(skipped.status).toBe(200);
    expect(dismissed.status).toBe(200);
    expect(data.profile).toEqual({
      nickname: null,
      nicknamePromptDismissed: true,
      onboardingDismissed: true
    });
    expect(summary.status).toBe(200);
  });

  it("rejects unauthenticated, cross-origin and invalid profile updates", async () => {
    const tenant = await seedTenant("alpha");
    const unauthenticated = await request("/api/customer/profile", {
      method: "PATCH",
      headers: { Origin: AUTH_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_nickname", nickname: "Justin" })
    });
    const crossOrigin = await customerMutation(
      "/api/customer/profile",
      tenant,
      "PATCH",
      { action: "save_nickname", nickname: "Justin" },
      FIRST_VISIT,
      "https://attacker.invalid"
    );
    const invalid = await customerMutation(
      "/api/customer/profile",
      tenant,
      "PATCH",
      { action: "save_nickname", nickname: "x".repeat(41) }
    );

    expect(unauthenticated.status).toBe(401);
    expect(crossOrigin.status).toBe(403);
    expect(invalid.status).toBe(400);
  });
});

describe("location-scoped last visit summary", () => {
  it("records one location marker and reports only new taps since the prior visit", async () => {
    const tenant = await seedTenant("alpha");
    const first = await customerMutation(
      `/api/customer/locations/${tenant.locationId}/visit`,
      tenant,
      "POST",
      {},
      FIRST_VISIT
    );
    expect(await first.json()).toEqual({
      firstVisit: true,
      previousVisitedAt: null,
      newReviewOpportunities: 0,
      strongestCardLabel: null,
      strongestCardOpportunities: 0
    });

    await env.DB.batch([
      env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
        .bind(crypto.randomUUID(), tenant.cardId, "2026-09-13T01:02:00.000Z"),
      env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
        .bind(crypto.randomUUID(), tenant.cardId, "2026-09-13T01:03:00.000Z"),
      env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
        .bind(crypto.randomUUID(), tenant.cardId, "2026-09-13T01:10:00.000Z")
    ]);
    const secondAt = new Date("2026-09-13T01:10:00.000Z");
    const second = await customerMutation(
      `/api/customer/locations/${tenant.locationId}/visit`,
      tenant,
      "POST",
      {},
      secondAt
    );
    expect(await second.json()).toEqual({
      firstVisit: false,
      previousVisitedAt: FIRST_VISIT.toISOString(),
      newReviewOpportunities: 3,
      strongestCardLabel: "alpha Counter",
      strongestCardOpportunities: 3
    });

    const third = await customerMutation(
      `/api/customer/locations/${tenant.locationId}/visit`,
      tenant,
      "POST",
      {},
      new Date("2026-09-13T01:20:00.000Z")
    );
    expect((await third.json<Record<string, any>>()).newReviewOpportunities).toBe(0);
  });

  it("rejects another tenant's location before creating or revealing a visit marker", async () => {
    const alpha = await seedTenant("alpha");
    const beta = await seedTenant("beta");
    const rejected = await customerMutation(
      `/api/customer/locations/${beta.locationId}/visit`,
      alpha,
      "POST",
      {}
    );
    const markers = await env.DB.prepare(`
      SELECT user_id, location_id FROM customer_dashboard_visits
    `).all();

    expect(rejected.status).toBe(404);
    expect(markers.results).toHaveLength(0);
  });
});

describe("recent Tapntrust activity", () => {
  it("returns only the five latest tenant taps with a safe Google Maps listing and no provider call", async () => {
    const tenant = await seedTenant("alpha");
    const provider: GooglePlacesProvider = {
      fetchSummary: vi.fn(),
      fetchReviews: vi.fn()
    };
    for (let index = 0; index < 7; index += 1) {
      await env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
        .bind(
          crypto.randomUUID(),
          tenant.cardId,
          new Date(FIRST_VISIT.getTime() - index * 60_000).toISOString()
        ).run();
    }
    const response = await request(
      `/api/customer/insights?period=all&locationId=${tenant.locationId}`,
      { headers: { Cookie: tenant.cookie } },
      FIRST_VISIT,
      { placesProvider: provider }
    );
    const data = await response.json<Record<string, any>>();
    const mapsUrl = new URL(data.recentActivity[0].googleMapsUrl);

    expect(response.status).toBe(200);
    expect(data.recentActivity).toHaveLength(5);
    expect(data.recentActivity[0]).toMatchObject({
      cardId: tenant.cardId,
      label: "alpha Counter",
      placementType: "counter",
      locationName: "alpha Business",
      locationAddress: "alpha Street",
      tappedAt: FIRST_VISIT.toISOString()
    });
    expect(mapsUrl.origin).toBe("https://www.google.com");
    expect(mapsUrl.pathname).toBe("/maps/search/");
    expect(mapsUrl.searchParams.get("api")).toBe("1");
    expect(mapsUrl.searchParams.get("query")).toBe("alpha Business");
    expect(mapsUrl.searchParams.get("query_place_id")).toBe("ChIJalpha");
    expect(data.recentActivity.every(
      (item: { googleMapsUrl: string }) => item.googleMapsUrl === mapsUrl.toString()
    )).toBe(true);
    expect(JSON.stringify(data.recentActivity)).not.toContain(tenant.reviewUrl);
    expect(JSON.stringify(data.recentActivity)).not.toContain("search.google.com/local/writereview");
    expect(provider.fetchSummary).not.toHaveBeenCalled();
    expect(provider.fetchReviews).not.toHaveBeenCalled();
    expect(JSON.stringify(data.recentActivity)).not.toContain("visitor");
    expect(JSON.stringify(data.recentActivity)).not.toContain("reviewer");
  });

  it("rejects unusable Place IDs without falling back to the stored write-review destination", async () => {
    const tenant = await seedTenant("alpha");
    await env.DB.prepare("UPDATE locations SET google_place_id = ?1 WHERE id = ?2")
      .bind("javascript:alert(1)", tenant.locationId).run();
    await env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
      .bind(crypto.randomUUID(), tenant.cardId, FIRST_VISIT.toISOString()).run();
    const response = await request(
      `/api/customer/insights?period=all&locationId=${tenant.locationId}`,
      { headers: { Cookie: tenant.cookie } }
    );
    const data = await response.json<Record<string, any>>();

    expect(response.status).toBe(200);
    expect(data.recentActivity[0].googleMapsUrl).toBeNull();
    expect(JSON.stringify(data.recentActivity)).not.toContain(tenant.reviewUrl);
  });

  it("constructs only encoded HTTPS Google Maps listing URLs from valid Place IDs", () => {
    const url = buildGoogleMapsListingUrl(
      "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "Tapntrust Café & Reviews?next=https://attacker.invalid"
    );
    const parsed = new URL(url || "");

    expect(parsed.protocol).toBe("https:");
    expect(parsed.hostname).toBe("www.google.com");
    expect(parsed.pathname).toBe("/maps/search/");
    expect(parsed.searchParams.get("query")).toBe(
      "Tapntrust Café & Reviews?next=https://attacker.invalid"
    );
    expect(parsed.searchParams.get("query_place_id")).toBe("ChIJN1t_tDeuEmsRUsoyG83frY4");
    expect(buildGoogleMapsListingUrl("javascript:alert(1)", "Unsafe")).toBeNull();
    expect(buildGoogleMapsListingUrl("../../secret", "Unsafe")).toBeNull();
    expect(buildGoogleMapsListingUrl("", "Missing")).toBeNull();
  });

  it("applies the Phase 3C migration with ISO UTC profile and visit fields", async () => {
    const userColumns = await env.DB.prepare("PRAGMA table_info(customer_users)")
      .all<{ name: string; type: string }>();
    const visitColumns = await env.DB.prepare("PRAGMA table_info(customer_dashboard_visits)")
      .all<{ name: string; type: string }>();

    expect(userColumns.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "nickname", type: "TEXT" }),
      expect.objectContaining({ name: "nickname_prompt_dismissed_at", type: "TEXT" }),
      expect.objectContaining({ name: "onboarding_dismissed_at", type: "TEXT" })
    ]));
    expect(visitColumns.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "last_visited_at", type: "TEXT" })
    ]));
  });
});
