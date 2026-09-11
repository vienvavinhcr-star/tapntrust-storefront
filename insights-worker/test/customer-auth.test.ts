import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { MagicLinkMailer } from "../src/auth";
import type { CustomerAuthDependencies } from "../src/customer-auth";
import { handleRequest } from "../src/index";

const NOW = new Date("2026-09-12T04:30:00.000Z");

interface TenantFixture {
  businessId: string;
  businessName: string;
  locationId: string;
  cardId: string;
  publicToken: string;
  reviewUrl: string;
  userId: string;
  email: string;
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;

function createTenantFixture(): TenantFixture {
  const suffix = crypto.randomUUID().replace(/-/g, "");
  const tokenSuffix = suffix.slice(0, 10).toUpperCase();
  return {
    businessId: `business-${suffix}`,
    businessName: `Business ${suffix.slice(0, 8)}`,
    locationId: `location-${suffix}`,
    cardId: `card-${suffix}`,
    publicToken: `TNT-${tokenSuffix}`,
    reviewUrl: `https://search.google.com/local/writereview?placeid=${suffix}`,
    userId: `user-${suffix}`,
    email: `account-${suffix}@example.invalid`
  };
}

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM customer_sessions"),
    env.DB.prepare("DELETE FROM auth_magic_links"),
    env.DB.prepare("DELETE FROM customer_business_access"),
    env.DB.prepare("DELETE FROM customer_users"),
    env.DB.prepare("DELETE FROM tap_events"),
    env.DB.prepare("DELETE FROM cards"),
    env.DB.prepare("DELETE FROM locations"),
    env.DB.prepare("DELETE FROM businesses")
  ]);
}

async function seedTenant(tenant: TenantFixture, tappedAt: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO businesses (id, name) VALUES (?1, ?2)")
      .bind(tenant.businessId, tenant.businessName),
    env.DB.prepare(`
      INSERT INTO locations (id, business_id, business_name, business_address, google_place_id, google_review_url)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      tenant.locationId,
      tenant.businessId,
      tenant.businessName,
      `Address ${tenant.locationId}`,
      tenant.locationId,
      tenant.reviewUrl
    ),
    env.DB.prepare(`
      INSERT INTO cards (id, public_token, location_id, label, placement_type)
      VALUES (?1, ?2, ?3, 'Counter', 'counter')
    `).bind(tenant.cardId, tenant.publicToken, tenant.locationId),
    env.DB.prepare(`
      INSERT INTO tap_events (id, card_id, tapped_at)
      VALUES (?1, ?2, ?3)
    `).bind(crypto.randomUUID(), tenant.cardId, tappedAt),
    env.DB.prepare("INSERT INTO customer_users (id, email) VALUES (?1, ?2)")
      .bind(tenant.userId, tenant.email),
    env.DB.prepare(`
      INSERT INTO customer_business_access (user_id, business_id)
      VALUES (?1, ?2)
    `).bind(tenant.userId, tenant.businessId)
  ]);
}

async function request(
  path: string,
  init?: RequestInit,
  dependencies: CustomerAuthDependencies = {}
): Promise<{ response: Response; context: ExecutionContext }> {
  const context = createExecutionContext();
  const response = await handleRequest(
    new Request(`https://go.tapntrust.com${path}`, init),
    env,
    context,
    undefined,
    { now: () => NOW, ...dependencies }
  );
  return { response, context };
}

async function signIn(email: string): Promise<{ cookie: string; magicUrl: string }> {
  let magicUrl = "";
  const mailer: MagicLinkMailer = {
    async sendMagicLink(recipient, url) {
      expect(recipient).toBe(email);
      magicUrl = url;
    }
  };
  const linkRequest = await request("/api/auth/request-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  }, { mailer });
  expect(linkRequest.response.status).toBe(202);
  await waitOnExecutionContext(linkRequest.context);
  expect(magicUrl).toContain("/auth/verify?token=");

  const verifyUrl = new URL(magicUrl);
  const verification = await request(`${verifyUrl.pathname}${verifyUrl.search}`);
  expect(verification.response.status).toBe(303);
  expect(verification.response.headers.get("Location")).toBe("/app");
  const setCookie = verification.response.headers.get("Set-Cookie") || "";
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  expect(setCookie).toContain("SameSite=Lax");

  return { cookie: setCookie.split(";")[0] || "", magicUrl };
}

beforeEach(async () => {
  await clearDatabase();
  tenantA = createTenantFixture();
  tenantB = createTenantFixture();
  await seedTenant(tenantA, "2026-09-12T03:00:00.000Z");
  await seedTenant(tenantB, "2026-09-12T03:15:00.000Z");
});

describe("customer magic-link authentication", () => {
  it("serves a customer sign-in page that is separate from master admin access", async () => {
    const { response } = await request("/app");
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(page).toContain("Passwordless sign in");
    expect(page).not.toContain("ADMIN_API_TOKEN");
    expect(page).not.toContain("tnt-admin-token");

    const embeddedScript = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(embeddedScript).toBeTruthy();
    expect(() => new Function(embeddedScript || "")).not.toThrow();
  });

  it("allows an authenticated customer to access only their own business", async () => {
    const { cookie } = await signIn(tenantA.email);
    const { response } = await request("/api/customer/summary", { headers: { Cookie: cookie } });

    expect(response.status).toBe(200);
    const body = await response.json<{
      email: string;
      monthTapCount: number;
      businesses: Array<{ id: string; monthTapCount: number; cards: Array<{ publicToken: string }> }>;
    }>();
    expect(body.email).toBe(tenantA.email);
    expect(body.monthTapCount).toBe(1);
    expect(body.businesses).toEqual([
      expect.objectContaining({
        id: tenantA.businessId,
        monthTapCount: 1,
        cards: [expect.objectContaining({ publicToken: tenantA.publicToken })]
      })
    ]);
  });

  it("ignores a client-supplied business id and never exposes another tenant", async () => {
    const { cookie } = await signIn(tenantA.email);
    const { response } = await request(`/api/customer/summary?business_id=${tenantB.businessId}`, {
      headers: { Cookie: cookie }
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain(tenantA.businessId);
    expect(text).not.toContain(tenantB.businessId);
    expect(text).not.toContain(tenantB.publicToken);
    expect(text).not.toContain(tenantB.businessName);
  });

  it("rejects unauthenticated customer insight requests", async () => {
    const { response } = await request("/api/customer/summary");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("does not issue a sign-in link to an account without explicit business access", async () => {
    const unlinkedUserId = crypto.randomUUID();
    const unlinkedEmail = `account-${crypto.randomUUID()}@example.invalid`;
    await env.DB.prepare("INSERT INTO customer_users (id, email) VALUES (?1, ?2)")
      .bind(unlinkedUserId, unlinkedEmail)
      .run();
    let sent = false;
    const { response, context } = await request("/api/auth/request-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: unlinkedEmail })
    }, {
      mailer: { async sendMagicLink() { sent = true; } }
    });
    await waitOnExecutionContext(context);

    expect(response.status).toBe(202);
    expect(sent).toBe(false);
  });

  it("keeps the internal master admin API separate and working", async () => {
    const { response } = await request("/api/admin/summary", {
      headers: { Authorization: "Bearer test-admin-token-that-is-not-a-production-secret" }
    });
    const body = await response.json<{ cards: Array<{ publicToken: string }> }>();

    expect(response.status).toBe(200);
    expect(body.cards.map((card) => card.publicToken).sort()).toEqual(
      [tenantA.publicToken, tenantB.publicToken].sort()
    );
  });

  it("stores only a hash and accepts each magic link once", async () => {
    const { magicUrl } = await signIn(tenantA.email);
    const token = new URL(magicUrl).searchParams.get("token") || "";
    const stored = await env.DB.prepare(`
      SELECT token_hash, used_at FROM auth_magic_links WHERE user_id = ?1
    `).bind(tenantA.userId).first<{ token_hash: string; used_at: string | null }>();

    expect(stored?.token_hash).not.toBe(token);
    expect(stored?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.used_at).toBe(NOW.toISOString());

    const verifyUrl = new URL(magicUrl);
    const reused = await request(`${verifyUrl.pathname}${verifyUrl.search}`);
    expect(reused.response.status).toBe(401);
  });
});
