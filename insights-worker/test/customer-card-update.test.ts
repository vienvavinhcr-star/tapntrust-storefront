import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { generateOpaqueToken, hashToken, SESSION_COOKIE_NAME } from "../src/auth";
import { handleRequest } from "../src/index";

const NOW = new Date("2026-09-12T04:30:00.000Z");
const AUTH_ORIGIN = "https://go.tapntrust.com";

interface Tenant {
  businessId: string;
  locationId: string;
  cardId: string;
  publicToken: string;
  reviewUrl: string;
  cookie: string;
}

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

async function seedTenant(prefix: string): Promise<Tenant> {
  const businessId = `${prefix}-business`;
  const locationId = `${prefix}-location`;
  const cardId = `${prefix}-card`;
  const userId = `${prefix}-user`;
  const publicToken = `TNT-${prefix.toUpperCase()}12345`;
  const reviewUrl = `https://search.google.com/local/writereview?placeid=ChIJ${prefix}`;
  const rawSession = generateOpaqueToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO businesses (id, name) VALUES (?1, ?2)").bind(businessId, `${prefix} Business`),
    env.DB.prepare(`
      INSERT INTO locations (id, business_id, business_name, business_address, google_place_id, google_review_url)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(locationId, businessId, `${prefix} Business`, `${prefix} Address`, `ChIJ${prefix}`, reviewUrl),
    env.DB.prepare(`
      INSERT INTO cards (id, public_token, location_id, label, placement_type)
      VALUES (?1, ?2, ?3, 'Card 1', 'counter')
    `).bind(cardId, publicToken, locationId),
    env.DB.prepare("INSERT INTO customer_users (id, email) VALUES (?1, ?2)")
      .bind(userId, `${prefix}@example.invalid`),
    env.DB.prepare("INSERT INTO customer_business_access (user_id, business_id) VALUES (?1, ?2)")
      .bind(userId, businessId),
    env.DB.prepare(`
      INSERT INTO insights_entitlements (location_id, status, source, activated_at, updated_at)
      VALUES (?1, 'active', 'test', ?2, ?2)
    `).bind(locationId, NOW.toISOString()),
    env.DB.prepare(`
      INSERT INTO customer_sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).bind(
      crypto.randomUUID(),
      userId,
      await hashToken(rawSession),
      new Date(NOW.getTime() + 86_400_000).toISOString(),
      NOW.toISOString()
    )
  ]);
  return { businessId, locationId, cardId, publicToken, reviewUrl, cookie: `${SESSION_COOKIE_NAME}=${rawSession}` };
}

async function request(path: string, init: RequestInit = {}): Promise<{ response: Response; context: ExecutionContext }> {
  const context = createExecutionContext();
  const response = await handleRequest(
    new Request(`${AUTH_ORIGIN}${path}`, init),
    env,
    context,
    undefined,
    { now: () => NOW }
  );
  return { response, context };
}

function updateRequest(
  tenant: Tenant,
  body: unknown,
  overrides: { cardId?: string; origin?: string; contentType?: string; rawBody?: string; cookie?: string } = {}
) {
  return request(`/api/customer/cards/${overrides.cardId || tenant.cardId}`, {
    method: "PATCH",
    headers: {
      Cookie: overrides.cookie === undefined ? tenant.cookie : overrides.cookie,
      Origin: overrides.origin || AUTH_ORIGIN,
      "Content-Type": overrides.contentType || "application/json"
    },
    body: overrides.rawBody === undefined ? JSON.stringify(body) : overrides.rawBody
  });
}

beforeEach(clearDatabase);

describe("customer-owned card labels and placements", () => {
  it("rejects unauthenticated, cross-tenant and arbitrary card updates", async () => {
    const alpha = await seedTenant("alpha");
    const beta = await seedTenant("beta");

    const unauthenticated = await updateRequest(alpha, { label: "Reception", placementType: "reception" }, { cookie: "" });
    const crossTenant = await updateRequest(alpha, { label: "Reception", placementType: "reception" }, { cardId: beta.cardId });
    const arbitrary = await updateRequest(alpha, { label: "Reception", placementType: "reception" }, { cardId: "missing-card" });

    expect(unauthenticated.response.status).toBe(401);
    expect(crossTenant.response.status).toBe(404);
    expect(arbitrary.response.status).toBe(404);
    const betaCard = await env.DB.prepare("SELECT label, placement_type FROM cards WHERE id = ?1")
      .bind(beta.cardId).first<{ label: string; placement_type: string }>();
    expect(betaCard).toEqual({ label: "Card 1", placement_type: "counter" });
  });

  it("rejects updates when Insights entitlement is inactive", async () => {
    const tenant = await seedTenant("alpha");
    await env.DB.prepare("UPDATE insights_entitlements SET status = 'inactive' WHERE location_id = ?1")
      .bind(tenant.locationId).run();

    const update = await updateRequest(tenant, { label: "Reception", placementType: "reception" });
    expect(update.response.status).toBe(404);
  });

  it("rejects an inactive-location update without changing identity, destination or tap history", async () => {
    const tenant = await seedTenant("alpha");
    await env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
      .bind(crypto.randomUUID(), tenant.cardId, NOW.toISOString()).run();
    const before = await env.DB.prepare(`
      SELECT c.label, c.placement_type, c.public_token, c.location_id, c.active,
        l.google_review_url, (SELECT COUNT(*) FROM tap_events t WHERE t.card_id = c.id) AS tap_count
      FROM cards c JOIN locations l ON l.id = c.location_id WHERE c.id = ?1
    `).bind(tenant.cardId).first<Record<string, string | number>>();
    await env.DB.prepare("UPDATE locations SET active = 0 WHERE id = ?1").bind(tenant.locationId).run();

    const update = await updateRequest(tenant, { label: "Reception", placementType: "reception" });
    const after = await env.DB.prepare(`
      SELECT c.label, c.placement_type, c.public_token, c.location_id, c.active,
        l.google_review_url, (SELECT COUNT(*) FROM tap_events t WHERE t.card_id = c.id) AS tap_count
      FROM cards c JOIN locations l ON l.id = c.location_id WHERE c.id = ?1
    `).bind(tenant.cardId).first<Record<string, string | number>>();

    expect(update.response.status).toBe(404);
    expect(after).toEqual(before);
  });

  it.each([
    ["invalid placement", { label: "Counter", placementType: "balcony" }],
    ["empty custom label", { label: "  ", placementType: "other" }],
    ["overlong label", { label: "x".repeat(41), placementType: "other" }],
    ["control character", { label: "Front\u0007 desk", placementType: "other" }]
  ])("rejects %s", async (_name, body) => {
    const tenant = await seedTenant("alpha");
    const update = await updateRequest(tenant, body);
    expect(update.response.status).toBe(400);
  });

  it("rejects malformed JSON, wrong content type and wrong origin", async () => {
    const tenant = await seedTenant("alpha");
    const malformed = await updateRequest(tenant, {}, { rawBody: "{" });
    const wrongType = await updateRequest(tenant, { label: "Reception", placementType: "reception" }, { contentType: "text/plain" });
    const wrongOrigin = await updateRequest(tenant, { label: "Reception", placementType: "reception" }, { origin: "https://attacker.invalid" });
    const missingOrigin = await request(`/api/customer/cards/${tenant.cardId}`, {
      method: "PATCH",
      headers: { Cookie: tenant.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Reception", placementType: "reception" })
    });

    expect(malformed.response.status).toBe(400);
    expect(wrongType.response.status).toBe(415);
    expect(wrongOrigin.response.status).toBe(403);
    expect(missingOrigin.response.status).toBe(403);
  });

  it.each([
    {
      name: "a generic card label",
      storedLabel: "Card 1",
      storedPlacementType: "counter",
      submittedLabel: "Front Counter",
      submittedPlacementType: "counter",
      expectedLabel: "Front Counter",
      expectedPlacementType: "counter"
    },
    {
      name: "a custom card label",
      storedLabel: "Coffee Station",
      storedPlacementType: "counter",
      submittedLabel: "Coffee Station",
      submittedPlacementType: "counter",
      expectedLabel: "Coffee Station",
      expectedPlacementType: "counter"
    },
    {
      name: "an explicit Reception preset",
      storedLabel: "Coffee Station",
      storedPlacementType: "counter",
      submittedLabel: "Reception",
      submittedPlacementType: "reception",
      expectedLabel: "Reception",
      expectedPlacementType: "reception"
    },
    {
      name: "an explicit Other selection",
      storedLabel: "Front Counter",
      storedPlacementType: "counter",
      submittedLabel: "Waiting Room",
      submittedPlacementType: "other",
      expectedLabel: "Waiting Room",
      expectedPlacementType: "other"
    }
  ])("preserves or changes placement intentionally for $name", async ({
    storedLabel,
    storedPlacementType,
    submittedLabel,
    submittedPlacementType,
    expectedLabel,
    expectedPlacementType
  }) => {
    const tenant = await seedTenant("alpha");
    await env.DB.prepare("UPDATE cards SET label = ?1, placement_type = ?2 WHERE id = ?3")
      .bind(storedLabel, storedPlacementType, tenant.cardId).run();

    const updated = await updateRequest(tenant, {
      label: submittedLabel,
      placementType: submittedPlacementType
    });
    const stored = await env.DB.prepare("SELECT label, placement_type FROM cards WHERE id = ?1")
      .bind(tenant.cardId).first<{ label: string; placement_type: string }>();

    expect(updated.response.status).toBe(200);
    expect(stored).toEqual({ label: expectedLabel, placement_type: expectedPlacementType });
  });

  it("updates one of three cards with a valid preset without changing the other cards", async () => {
    const tenant = await seedTenant("alpha");
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO cards (id, public_token, location_id, label, placement_type)
        VALUES ('alpha-card-2', 'TNT-ALPHA12346', ?1, 'Card 2', 'table')
      `).bind(tenant.locationId),
      env.DB.prepare(`
        INSERT INTO cards (id, public_token, location_id, label, placement_type)
        VALUES ('alpha-card-3', 'TNT-ALPHA12347', ?1, 'Entrance', 'other')
      `).bind(tenant.locationId)
    ]);
    const updated = await updateRequest(tenant, { label: "Reception", placementType: "reception" });
    const body = await updated.response.json<{ card: { id: string; publicToken: string; locationId: string } }>();

    expect(updated.response.status).toBe(200);
    expect(body.card).toMatchObject({ id: tenant.cardId, publicToken: tenant.publicToken, locationId: tenant.locationId });
    const cards = await env.DB.prepare("SELECT id, label, placement_type FROM cards ORDER BY id").all();
    expect(cards.results).toEqual([
      { id: tenant.cardId, label: "Reception", placement_type: "reception" },
      { id: "alpha-card-2", label: "Card 2", placement_type: "table" },
      { id: "alpha-card-3", label: "Entrance", placement_type: "other" }
    ]);
  });

  it("updates a custom label while preserving redirect, destination, active state and tap history", async () => {
    const tenant = await seedTenant("alpha");
    await env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
      .bind(crypto.randomUUID(), tenant.cardId, NOW.toISOString()).run();
    const before = await env.DB.prepare(`
      SELECT c.public_token, c.location_id, c.active, l.google_review_url,
        (SELECT COUNT(*) FROM tap_events t WHERE t.card_id = c.id) AS tap_count
      FROM cards c JOIN locations l ON l.id = c.location_id WHERE c.id = ?1
    `).bind(tenant.cardId).first<Record<string, string | number>>();

    const updated = await updateRequest(tenant, { label: "  Coffee pickup counter  ", placementType: "other" });
    expect(updated.response.status).toBe(200);
    const after = await env.DB.prepare(`
      SELECT c.public_token, c.location_id, c.active, c.label, c.placement_type, l.google_review_url,
        (SELECT COUNT(*) FROM tap_events t WHERE t.card_id = c.id) AS tap_count
      FROM cards c JOIN locations l ON l.id = c.location_id WHERE c.id = ?1
    `).bind(tenant.cardId).first<Record<string, string | number>>();

    expect(after).toMatchObject({
      public_token: before?.public_token,
      location_id: before?.location_id,
      active: before?.active,
      google_review_url: before?.google_review_url,
      tap_count: before?.tap_count,
      label: "Coffee pickup counter",
      placement_type: "other"
    });

    const insights = await request(`/api/customer/insights?locationId=${tenant.locationId}`, {
      headers: { Cookie: tenant.cookie }
    });
    const insightsBody = await insights.response.json<{ cards: Array<{ id: string; label: string; placementType: string }> }>();
    expect(insightsBody.cards).toContainEqual(expect.objectContaining({
      id: tenant.cardId,
      label: "Coffee pickup counter",
      placementType: "other"
    }));

    const redirect = await request(`/t/${tenant.publicToken}`);
    expect(redirect.response.status).toBe(302);
    expect(redirect.response.headers.get("Location")).toBe(tenant.reviewUrl);
    await waitOnExecutionContext(redirect.context);
    const tapCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM tap_events WHERE card_id = ?1")
      .bind(tenant.cardId).first<{ count: number }>();
    expect(Number(tapCount?.count || 0)).toBe(Number(before?.tap_count || 0) + 1);
  });
});
