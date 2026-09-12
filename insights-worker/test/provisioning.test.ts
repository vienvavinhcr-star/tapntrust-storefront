import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createSessionCookie, generateOpaqueToken, hashToken } from "../src/auth";
import { isValidPublicToken } from "../src/destinations";
import { handleRequest } from "../src/index";
import { generatePublicCardToken } from "../src/provisioning";

const ORIGIN = "https://go.tapntrust.com";
const ADMIN_TOKEN = "test-admin-token-that-is-not-a-production-secret";
const REVIEW_URL = "https://search.google.com/local/writereview?placeid=phase2b-example";

function uniqueReference(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function provisioningBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    externalOrderReference: uniqueReference("order"),
    externalSetupReference: uniqueReference("setup"),
    businessMode: "new",
    businessName: "Phase 2B Business",
    locationMode: "new",
    businessAddress: "100 Test Street, Melbourne VIC",
    googlePlaceId: "ChIJ-phase2b-example",
    googleReviewUrl: REVIEW_URL,
    physicalCardCount: 2,
    ...overrides
  };
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

async function request(path: string, init?: RequestInit): Promise<{ response: Response; context: ExecutionContext }> {
  const context = createExecutionContext();
  const response = await handleRequest(new Request(`${ORIGIN}${path}`, init), env, context);
  return { response, context };
}

async function adminPost(path: string, body: unknown, origin = ORIGIN): Promise<Response> {
  const { response } = await request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json",
      Origin: origin
    },
    body: JSON.stringify(body)
  });
  return response;
}

async function provision(body: Record<string, unknown>): Promise<{
  response: Response;
  result: {
    replayed: boolean;
    manifest: {
      id: string;
      businessId: string;
      locationId: string;
      physicalCardCount: number;
      cards: Array<{ id: string; publicToken: string; programmingUrl: string }>;
    };
  };
}> {
  const response = await adminPost("/api/admin/provisioning/batches", body);
  return { response, result: await response.clone().json() };
}

async function createCustomerSession(email: string): Promise<string> {
  const user = await env.DB.prepare("SELECT id FROM customer_users WHERE email = ?1 COLLATE NOCASE")
    .bind(email)
    .first<{ id: string }>();
  if (!user) throw new Error("Expected customer user");
  const rawToken = generateOpaqueToken();
  await env.DB.prepare(`
    INSERT INTO customer_sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (?1, ?2, ?3, '2026-10-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z')
  `).bind(crypto.randomUUID(), user.id, await hashToken(rawToken)).run();
  return createSessionCookie(rawToken, 30 * 24 * 60 * 60).split(";", 1)[0] || "";
}

async function customerSummary(cookie: string): Promise<Response> {
  return (await request("/api/customer/summary", { headers: { Cookie: cookie } })).response;
}

beforeEach(clearDatabase);

describe("physical-card public token generation", () => {
  it("generates unique 26-character suffixes from the approved 32-character alphabet", () => {
    const tokens = Array.from({ length: 256 }, () => generatePublicCardToken());

    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) {
      expect(token).toMatch(/^TNT-[A-HJ-NP-Z2-9]{26}$/);
      expect(isValidPublicToken(token)).toBe(true);
    }
    expect(isValidPublicToken("TNT-A7K29")).toBe(true);
  });
});

describe("universal physical-card provisioning", () => {
  it("provisions non-Insights cards without creating customer access and records taps from day one", async () => {
    const body = provisioningBody({ physicalCardCount: 3 });
    const { response, result } = await provision(body);

    expect(response.status).toBe(201);
    expect(result.replayed).toBe(false);
    expect(result.manifest.physicalCardCount).toBe(3);
    expect(new Set(result.manifest.cards.map((card) => card.publicToken)).size).toBe(3);
    for (const card of result.manifest.cards) {
      expect(card.publicToken).toMatch(/^TNT-[A-HJ-NP-Z2-9]{26}$/);
      expect(card.programmingUrl).toBe(`${ORIGIN}/t/${card.publicToken}`);
    }

    const [users, access, entitlements] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM customer_users").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM customer_business_access").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM insights_entitlements").first<{ count: number }>()
    ]);
    expect(Number(users?.count || 0)).toBe(0);
    expect(Number(access?.count || 0)).toBe(0);
    expect(Number(entitlements?.count || 0)).toBe(0);
    const batch = await env.DB.prepare(`
      SELECT request_fingerprint, created_at, typeof(created_at) AS created_at_type
      FROM provisioning_batches
    `).first<{ request_fingerprint: string; created_at: string; created_at_type: string }>();
    expect(batch?.request_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(batch?.created_at_type).toBe("text");
    expect(batch?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const tap = await request(`/t/${result.manifest.cards[0]?.publicToken}`);
    await waitOnExecutionContext(tap.context);
    expect(tap.response.status).toBe(302);
    expect(tap.response.headers.get("Location")).toBe(REVIEW_URL);
    const taps = await env.DB.prepare("SELECT COUNT(*) AS count FROM tap_events").first<{ count: number }>();
    expect(Number(taps?.count || 0)).toBe(1);
  });

  it("replays an identical request but rejects material changes under the same key", async () => {
    const body = provisioningBody();
    const first = await provision(body);
    const retry = await provision(body);

    expect(first.response.status).toBe(201);
    expect(retry.response.status).toBe(200);
    expect(retry.result.replayed).toBe(true);
    expect(retry.result.manifest).toEqual(first.result.manifest);

    const countConflict = await adminPost("/api/admin/provisioning/batches", {
      ...body,
      physicalCardCount: 5
    });
    const destinationConflict = await adminPost("/api/admin/provisioning/batches", {
      ...body,
      googleReviewUrl: "https://search.google.com/local/writereview?placeid=changed-destination"
    });
    const businessConflict = await adminPost("/api/admin/provisioning/batches", {
      ...body,
      businessName: "A different business"
    });
    const locationConflict = await adminPost("/api/admin/provisioning/batches", {
      ...body,
      businessAddress: "A different location"
    });

    for (const response of [countConflict, destinationConflict, businessConflict, locationConflict]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "intent_conflict" });
    }
    const cards = await env.DB.prepare("SELECT COUNT(*) AS count FROM cards").first<{ count: number }>();
    expect(Number(cards?.count || 0)).toBe(2);
  });

  it("handles concurrent identical provisioning with exactly one physical card set", async () => {
    const body = provisioningBody({ physicalCardCount: 4 });
    const [left, right] = await Promise.all([provision(body), provision(body)]);

    expect([left.response.status, right.response.status].sort()).toEqual([200, 201]);
    expect(left.result.manifest.cards).toEqual(right.result.manifest.cards);
    const [batches, cards] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM provisioning_batches").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM cards").first<{ count: number }>()
    ]);
    expect(Number(batches?.count || 0)).toBe(1);
    expect(Number(cards?.count || 0)).toBe(4);
  });

  it("can explicitly reuse an existing business/location without recreating them", async () => {
    const first = await provision(provisioningBody({ physicalCardCount: 1 }));
    const secondBody = provisioningBody({
      businessMode: "existing",
      businessId: first.result.manifest.businessId,
      locationMode: "existing",
      locationId: first.result.manifest.locationId,
      googleReviewUrl: REVIEW_URL,
      physicalCardCount: 2
    });
    const second = await provision(secondBody);

    expect(second.response.status).toBe(201);
    const [businesses, locations, cards] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM businesses").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM locations").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM cards").first<{ count: number }>()
    ]);
    expect(Number(businesses?.count || 0)).toBe(1);
    expect(Number(locations?.count || 0)).toBe(1);
    expect(Number(cards?.count || 0)).toBe(3);
  });

  it("rejects changing an explicit business or location selection under an existing idempotency key", async () => {
    const first = await provision(provisioningBody({ physicalCardCount: 1 }));
    const second = await provision(provisioningBody({
      businessName: "Second Business",
      businessAddress: "200 Second Street, Melbourne VIC",
      googlePlaceId: "ChIJ-second",
      googleReviewUrl: "https://search.google.com/local/writereview?placeid=second-location",
      physicalCardCount: 1
    }));
    const keyedIntent = provisioningBody({
      businessMode: "existing",
      businessId: first.result.manifest.businessId,
      locationMode: "existing",
      locationId: first.result.manifest.locationId,
      googleReviewUrl: REVIEW_URL,
      physicalCardCount: 1
    });
    const created = await provision(keyedIntent);
    expect(created.response.status).toBe(201);

    const changedBusiness = await adminPost("/api/admin/provisioning/batches", {
      ...keyedIntent,
      businessId: second.result.manifest.businessId,
      locationId: second.result.manifest.locationId,
      googleReviewUrl: "https://search.google.com/local/writereview?placeid=second-location"
    });
    const changedLocation = await adminPost("/api/admin/provisioning/batches", {
      ...keyedIntent,
      locationId: second.result.manifest.locationId
    });

    expect(changedBusiness.status).toBe(409);
    expect(changedLocation.status).toBe(409);
    const keyedBatchCards = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM provisioning_batch_cards
      WHERE batch_id = ?1
    `).bind(created.result.manifest.id).first<{ count: number }>();
    expect(Number(keyedBatchCards?.count || 0)).toBe(1);
  });

  it("rejects unsupported destinations and stand-only zero-card requests", async () => {
    const unsupported = await adminPost("/api/admin/provisioning/batches", provisioningBody({
      googleReviewUrl: "https://example.com/review"
    }));
    const standOnly = await adminPost("/api/admin/provisioning/batches", provisioningBody({
      physicalCardCount: 0
    }));

    expect(unsupported.status).toBe(400);
    expect(standOnly.status).toBe(400);
    const cards = await env.DB.prepare("SELECT COUNT(*) AS count FROM cards").first<{ count: number }>();
    expect(Number(cards?.count || 0)).toBe(0);
  });

  it("protects provisioning mutations with the owner token, JSON and same-origin checks", async () => {
    const body = provisioningBody();
    const unauthorized = await request("/api/admin/provisioning/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify(body)
    });
    const wrongType = await request("/api/admin/provisioning/batches", {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, Origin: ORIGIN },
      body: JSON.stringify(body)
    });
    const wrongOrigin = await adminPost(
      "/api/admin/provisioning/batches",
      body,
      "https://cross-origin.example"
    );

    expect(unauthorized.response.status).toBe(401);
    expect(wrongType.response.status).toBe(415);
    expect(wrongOrigin.status).toBe(403);
  });
});

describe("Insights activation and owner recovery", () => {
  it("activates existing records, preserves history and supports safe access/entitlement correction", async () => {
    const { result } = await provision(provisioningBody({ physicalCardCount: 2 }));
    const foreign = await provision(provisioningBody({
      businessName: "Unrelated Business",
      businessAddress: "300 Other Street, Melbourne VIC",
      googlePlaceId: "ChIJ-unrelated",
      googleReviewUrl: "https://search.google.com/local/writereview?placeid=unrelated-location",
      physicalCardCount: 1
    }));
    const originalTokens = result.manifest.cards.map((card) => card.publicToken);
    const firstTap = await request(`/t/${originalTokens[0]}`);
    await waitOnExecutionContext(firstTap.context);

    const wrongEmail = `wrong-${crypto.randomUUID()}@example.invalid`;
    const correctEmail = `correct-${crypto.randomUUID()}@example.invalid`;
    for (const email of [wrongEmail, correctEmail]) {
      const activation = await adminPost("/api/admin/insights/activations", {
        email,
        businessId: result.manifest.businessId,
        locationId: result.manifest.locationId
      });
      expect(activation.status).toBe(200);
    }
    const entitlement = await env.DB.prepare(`
      SELECT
        status,
        typeof(activated_at) AS activated_at_type,
        typeof(updated_at) AS updated_at_type
      FROM insights_entitlements
      WHERE location_id = ?1
    `).bind(result.manifest.locationId).first<{
      status: string;
      activated_at_type: string;
      updated_at_type: string;
    }>();
    expect(entitlement).toEqual({
      status: "active",
      activated_at_type: "text",
      updated_at_type: "text"
    });

    const wrongCookie = await createCustomerSession(wrongEmail);
    const correctCookie = await createCustomerSession(correctEmail);
    const beforeCorrection = await customerSummary(correctCookie);
    expect(beforeCorrection.status).toBe(200);
    const visible = await beforeCorrection.json<{
      businesses: Array<{ id: string; cards: Array<{ publicToken: string; lifetimeTaps: number }> }>;
    }>();
    expect(visible.businesses).toHaveLength(1);
    expect(visible.businesses[0]?.id).toBe(result.manifest.businessId);
    expect(visible.businesses[0]?.cards.map((card) => card.publicToken).sort()).toEqual([...originalTokens].sort());
    expect(
      visible.businesses[0]?.cards.find((card) => card.publicToken === originalTokens[0])?.lifetimeTaps
    ).toBe(1);
    expect(JSON.stringify(visible)).not.toContain(foreign.result.manifest.businessId);
    expect(JSON.stringify(visible)).not.toContain(foreign.result.manifest.cards[0]?.publicToken || "missing");

    const revoked = await adminPost("/api/admin/insights/access/revoke", {
      email: wrongEmail,
      businessId: result.manifest.businessId
    });
    expect(revoked.status).toBe(200);
    expect((await customerSummary(wrongCookie)).status).toBe(401);
    expect((await customerSummary(correctCookie)).status).toBe(200);

    const deactivated = await adminPost("/api/admin/insights/entitlements/deactivate", {
      locationId: result.manifest.locationId
    });
    expect(deactivated.status).toBe(200);
    const hidden = await customerSummary(correctCookie);
    expect(hidden.status).toBe(200);
    expect((await hidden.json<{ businesses: unknown[] }>()).businesses).toEqual([]);

    const tapWhileInactive = await request(`/t/${originalTokens[0]}`);
    await waitOnExecutionContext(tapWhileInactive.context);
    expect(tapWhileInactive.response.status).toBe(302);
    expect(tapWhileInactive.response.headers.get("Location")).toBe(REVIEW_URL);
    const storedTaps = await env.DB.prepare("SELECT COUNT(*) AS count FROM tap_events")
      .first<{ count: number }>();
    expect(Number(storedTaps?.count || 0)).toBe(2);

    const reactivated = await adminPost("/api/admin/insights/activations", {
      email: correctEmail,
      businessId: result.manifest.businessId,
      locationId: result.manifest.locationId
    });
    expect(reactivated.status).toBe(200);
    const restored = await (await customerSummary(correctCookie)).json<{
      businesses: Array<{ cards: Array<{ publicToken: string; lifetimeTaps: number }> }>;
    }>();
    expect(restored.businesses[0]?.cards.map((card) => card.publicToken).sort()).toEqual([...originalTokens].sort());
    expect(
      restored.businesses[0]?.cards.find((card) => card.publicToken === originalTokens[0])?.lifetimeTaps
    ).toBe(2);

    const cardRows = await env.DB.prepare(`
      SELECT public_token FROM cards WHERE location_id = ?1 ORDER BY created_at, id
    `).bind(result.manifest.locationId)
      .all<{ public_token: string }>();
    expect(cardRows.results.map((card) => card.public_token).sort()).toEqual([...originalTokens].sort());
  });

  it("keeps non-entitled locations hidden inside an otherwise accessible business", async () => {
    const first = await provision(provisioningBody({ physicalCardCount: 1 }));
    const second = await provision(provisioningBody({
      businessMode: "existing",
      businessId: first.result.manifest.businessId,
      locationMode: "new",
      businessAddress: "200 Hidden Street, Melbourne VIC",
      googlePlaceId: "ChIJ-hidden",
      googleReviewUrl: "https://search.google.com/local/writereview?placeid=hidden-location",
      physicalCardCount: 1
    }));
    const email = `owner-${crypto.randomUUID()}@example.invalid`;
    await adminPost("/api/admin/insights/activations", {
      email,
      businessId: first.result.manifest.businessId,
      locationId: first.result.manifest.locationId
    });
    const cookie = await createCustomerSession(email);
    const summary = await (await customerSummary(cookie)).json<{
      businesses: Array<{ cards: Array<{ publicToken: string }> }>;
    }>();

    expect(summary.businesses[0]?.cards.map((card) => card.publicToken)).toEqual([
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
    expect(scripts).toHaveLength(2);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });
});
