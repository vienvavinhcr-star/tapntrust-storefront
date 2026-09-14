import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { handleRequest } from "../src/index";
import { generatePublicToken } from "../src/provisioning";
import { hashToken, SESSION_COOKIE_NAME } from "../src/auth";

const ADMIN_TOKEN = "provisioning-test-admin-token";
const ADMIN_ORIGIN = "https://go.tapntrust.com";

async function clearDatabase() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM customer_usage_events"),
    env.DB.prepare("DELETE FROM auth_request_limits"),
    env.DB.prepare("DELETE FROM customer_dashboard_visits"),
    env.DB.prepare("DELETE FROM customer_sessions"),
    env.DB.prepare("DELETE FROM customer_magic_links"),
    env.DB.prepare("DELETE FROM customer_business_access"),
    env.DB.prepare("DELETE FROM customer_users"),
    env.DB.prepare("DELETE FROM business_insights_intro_redemptions"),
    env.DB.prepare("DELETE FROM insights_subscription_lifecycle_events"),
    env.DB.prepare("DELETE FROM insights_cancellation_requests"),
    env.DB.prepare("DELETE FROM insights_billing_events"),
    env.DB.prepare("DELETE FROM shopify_webhook_receipts"),
    env.DB.prepare("DELETE FROM insights_subscriptions"),
    env.DB.prepare("DELETE FROM provisioning_batch_cards"),
    env.DB.prepare("DELETE FROM provisioning_batches"),
    env.DB.prepare("DELETE FROM insights_entitlements"),
    env.DB.prepare("DELETE FROM tap_events"),
    env.DB.prepare("DELETE FROM cards"),
    env.DB.prepare("DELETE FROM locations"),
    env.DB.prepare("DELETE FROM businesses")
  ]);
}

async function request(
  path: string,
  init: RequestInit = {},
  authenticated = true
): Promise<{ response: Response; context: ExecutionContext }> {
  const context = createExecutionContext();
  const headers = new Headers(init.headers);
  if (authenticated) headers.set("Authorization", `Bearer ${ADMIN_TOKEN}`);
  const response = await handleRequest(
    new Request(`https://go.tapntrust.com${path}`, { ...init, headers }),
    { ...env, ADMIN_API_TOKEN: ADMIN_TOKEN } as Env,
    context
  );
  await waitOnExecutionContext(context);
  return { response, context };
}

function adminPost(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ADMIN_ORIGIN,
      ...headers
    },
    body: JSON.stringify(body)
  });
}

function unique(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function provision(overrides: Record<string, unknown> = {}) {
  const externalOrderReference = unique("order");
  const externalSetupReference = unique("setup");
  const payload = {
    externalOrderReference,
    externalSetupReference,
    businessMode: "new",
    businessName: "Provisioning Test Business",
    locationMode: "new",
    businessAddress: "1 Test Street, Melbourne VIC",
    googlePlaceId: "ChIJProvisioningTest123",
    googleReviewUrl: "https://search.google.com/local/writereview?placeid=ChIJProvisioningTest123",
    physicalCardCount: 1,
    ...overrides
  };
  const { response } = await adminPost("/api/admin/provisioning/batches", payload);
  return {
    response,
    result: await response.json<Record<string, any>>(),
    payload
  };
}

async function seedCustomerSession(email: string, businessId: string): Promise<string> {
  const userId = unique("user");
  const rawToken = `session-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const tokenHash = await hashToken(rawToken);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO customer_users (id, email, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)")
      .bind(userId, email, now),
    env.DB.prepare("INSERT INTO customer_business_access (user_id, business_id, created_at) VALUES (?1, ?2, ?3)")
      .bind(userId, businessId, now),
    env.DB.prepare(`
      INSERT INTO customer_sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).bind(unique("session"), userId, tokenHash, "2099-01-01T00:00:00.000Z", now)
  ]);
  return `${SESSION_COOKIE_NAME}=${rawToken}`;
}

describe("physical-card provisioning", () => {
  beforeEach(clearDatabase);

  it("generates unique 26-character suffixes from the approved 32-character alphabet", () => {
    const values = new Set(Array.from({ length: 200 }, () => generatePublicToken()));
    expect(values.size).toBe(200);
    for (const value of values) expect(value).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{26}$/);
  });

  it("provisions non-Insights cards without creating customer access and records taps from day one", async () => {
    const created = await provision({ physicalCardCount: 2 });
    expect(created.response.status).toBe(201);
    expect(created.result.manifest.cards).toHaveLength(2);
    expect(created.result.manifest.cards[0].programmingUrl).toMatch(/^https:\/\/go\.tapntrust\.com\/t\//);

    const access = await env.DB.prepare("SELECT COUNT(*) AS count FROM customer_business_access").first<{ count: number }>();
    expect(Number(access?.count || 0)).toBe(0);

    const token = created.result.manifest.cards[0].publicToken;
    const context = createExecutionContext();
    const tapResponse = await handleRequest(
      new Request(`https://go.tapntrust.com/t/${token}`),
      env,
      context
    );
    await waitOnExecutionContext(context);
    expect(tapResponse.status).toBe(302);
    const taps = await env.DB.prepare("SELECT COUNT(*) AS count FROM tap_events").first<{ count: number }>();
    expect(Number(taps?.count || 0)).toBe(1);
  });

  it("replays an identical request but rejects material changes under the same key", async () => {
    const first = await provision();
    expect(first.response.status).toBe(201);

    const replay = await adminPost("/api/admin/provisioning/batches", first.payload);
    expect(replay.response.status).toBe(200);
    expect((await replay.response.json<Record<string, any>>()).replayed).toBe(true);

    const changed = await adminPost("/api/admin/provisioning/batches", {
      ...first.payload,
      physicalCardCount: 2
    });
    expect(changed.response.status).toBe(409);
  });

  it("handles concurrent identical provisioning with exactly one physical card set", async () => {
    const payload = {
      externalOrderReference: unique("order"),
      externalSetupReference: unique("setup"),
      businessMode: "new",
      businessName: "Concurrent Test",
      locationMode: "new",
      businessAddress: "2 Test Street",
      googlePlaceId: "ChIJConcurrentTest123",
      googleReviewUrl: "https://search.google.com/local/writereview?placeid=ChIJConcurrentTest123",
      physicalCardCount: 3
    };
    const [left, right] = await Promise.all([
      adminPost("/api/admin/provisioning/batches", payload),
      adminPost("/api/admin/provisioning/batches", payload)
    ]);
    expect([left.response.status, right.response.status].sort()).toEqual([200, 201]);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM cards").first<{ count: number }>();
    expect(Number(count?.count || 0)).toBe(3);
  });

  it("can explicitly reuse an existing business/location without recreating them", async () => {
    const first = await provision();
    const businessId = first.result.manifest.businessId;
    const locationId = first.result.manifest.locationId;
    const second = await provision({
      businessMode: "existing",
      businessId,
      businessName: undefined,
      locationMode: "existing",
      locationId,
      businessAddress: undefined,
      googlePlaceId: undefined,
      googleReviewUrl: first.payload.googleReviewUrl
    });
    expect(second.response.status).toBe(201);
    expect(second.result.manifest.businessId).toBe(businessId);
    expect(second.result.manifest.locationId).toBe(locationId);
    const businesses = await env.DB.prepare("SELECT COUNT(*) AS count FROM businesses").first<{ count: number }>();
    const locations = await env.DB.prepare("SELECT COUNT(*) AS count FROM locations").first<{ count: number }>();
    expect(Number(businesses?.count || 0)).toBe(1);
    expect(Number(locations?.count || 0)).toBe(1);
  });

  it("rejects changing an explicit business or location selection under an existing idempotency key", async () => {
    const first = await provision();
    const other = await provision();
    const mismatch = await adminPost("/api/admin/provisioning/batches", {
      ...first.payload,
      businessMode: "existing",
      businessId: other.result.manifest.businessId,
      businessName: undefined,
      locationMode: "existing",
      locationId: other.result.manifest.locationId,
      businessAddress: undefined,
      googlePlaceId: undefined,
      googleReviewUrl: other.payload.googleReviewUrl
    });
    expect(mismatch.response.status).toBe(409);
  });

  it("rejects unsupported destinations and stand-only zero-card requests", async () => {
    const badDestination = await provision({ googleReviewUrl: "https://example.com/review" });
    expect(badDestination.response.status).toBe(400);

    const zeroCards = await provision({ physicalCardCount: 0 });
    expect(zeroCards.response.status).toBe(400);
  });

  it("protects provisioning mutations with the owner token, JSON and same-origin checks", async () => {
    const payload = {
      externalOrderReference: unique("order"),
      externalSetupReference: unique("setup"),
      businessMode: "new",
      businessName: "Security Test",
      locationMode: "new",
      businessAddress: "3 Test Street",
      googleReviewUrl: "https://search.google.com/local/writereview?placeid=ChIJSecurityTest123",
      physicalCardCount: 1
    };

    const unauthenticated = await request("/api/admin/provisioning/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ADMIN_ORIGIN },
      body: JSON.stringify(payload)
    }, false);
    expect(unauthenticated.response.status).toBe(401);

    const wrongOrigin = await request("/api/admin/provisioning/batches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.com"
      },
      body: JSON.stringify(payload)
    });
    expect(wrongOrigin.response.status).toBe(403);

    const wrongType = await request("/api/admin/provisioning/batches", {
      method: "POST",
      headers: { "Content-Type": "text/plain", Origin: ADMIN_ORIGIN },
      body: JSON.stringify(payload)
    });
    expect(wrongType.response.status).toBe(415);
  });

  it("activates existing records, preserves history and supports safe access/entitlement correction", async () => {
    const created = await provision();
    const { businessId, locationId, cards } = created.result.manifest;
    const cardId = cards[0].cardId;
    const publicToken = cards[0].publicToken;
    await env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
      .bind(unique("tap"), cardId, "2026-08-01T00:00:00.000Z").run();

    const email = "owner@example.invalid";
    const activated = await adminPost("/api/admin/insights/activations", { email, businessId, locationId });
    expect(activated.response.status).toBe(200);

    const card = await env.DB.prepare("SELECT public_token FROM cards WHERE id = ?1").bind(cardId).first<{ public_token: string }>();
    const taps = await env.DB.prepare("SELECT COUNT(*) AS count FROM tap_events WHERE card_id = ?1").bind(cardId).first<{ count: number }>();
    expect(card?.public_token).toBe(publicToken);
    expect(Number(taps?.count || 0)).toBe(1);

    const sessionCookie = await seedCustomerSession(email, businessId);
    const appResponse = await handleRequest(
      new Request("https://go.tapntrust.com/api/customer/me", { headers: { Cookie: sessionCookie } }),
      env,
      createExecutionContext()
    );
    expect(appResponse.status).toBe(200);

    const revoke = await adminPost("/api/admin/insights/access/revoke", { email, businessId });
    expect(revoke.response.status).toBe(200);
    const revokedResponse = await handleRequest(
      new Request("https://go.tapntrust.com/api/customer/me", { headers: { Cookie: sessionCookie } }),
      env,
      createExecutionContext()
    );
    expect(revokedResponse.status).toBe(401);

    const deactivate = await adminPost("/api/admin/insights/entitlements/deactivate", { locationId });
    expect(deactivate.response.status).toBe(200);
    const entitlement = await env.DB.prepare("SELECT status FROM insights_entitlements WHERE location_id = ?1")
      .bind(locationId).first<{ status: string }>();
    expect(entitlement?.status).toBe("inactive");

    const tapContext = createExecutionContext();
    const tapResponse = await handleRequest(new Request(`https://go.tapntrust.com/t/${publicToken}`), env, tapContext);
    await waitOnExecutionContext(tapContext);
    expect(tapResponse.status).toBe(302);
  });

  it("keeps non-entitled locations hidden inside an otherwise accessible business", async () => {
    const first = await provision();
    const second = await provision({
      businessMode: "existing",
      businessId: first.result.manifest.businessId,
      businessName: undefined,
      locationMode: "new",
      businessAddress: "Second location",
      googlePlaceId: "ChIJSecondLocation123",
      googleReviewUrl: "https://search.google.com/local/writereview?placeid=ChIJSecondLocation123"
    });
    const email = "tenant@example.invalid";
    await adminPost("/api/admin/insights/activations", {
      email,
      businessId: first.result.manifest.businessId,
      locationId: first.result.manifest.locationId
    });
    const cookie = await seedCustomerSession(email, first.result.manifest.businessId);
    const context = createExecutionContext();
    const response = await handleRequest(
      new Request("https://go.tapntrust.com/api/customer/me", { headers: { Cookie: cookie } }),
      env,
      context
    );
    await waitOnExecutionContext(context);
    const summary = await response.json<Record<string, any>>();
    expect(summary.businesses[0]?.cards.map((card: any) => card.publicToken)).toEqual([
      first.result.manifest.cards[0]?.publicToken
    ]);
    expect(JSON.stringify(summary)).not.toContain(second.result.manifest.cards[0]?.publicToken || "missing");
  });

  it("renders the extended admin controls without exposing an admin credential", async () => {
    const { response } = await request("/admin");
    const html = await response.text();
    const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), (match) => match[1] || "");

    expect(response.status).toBe(200);
    expect(html).toContain("Provision physical NFC cards");
    expect(html).toContain("Activate Insights");
    expect(html).toContain("Revoke incorrect customer access");
    expect(html).not.toContain(ADMIN_TOKEN);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });
});
