import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  SESSION_COOKIE_NAME,
  type MagicLinkMailer
} from "../src/auth";
import type { CustomerAuthDependencies } from "../src/customer-auth";
import { handleRequest } from "../src/index";
import { createZeptoMailMagicLinkMailer } from "../src/zeptomail";

const NOW = new Date("2026-09-12T04:30:00.000Z");
const AUTH_ORIGIN = "https://go.tapntrust.com";

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
    `).bind(tenant.userId, tenant.businessId),
    env.DB.prepare(`
      INSERT INTO insights_entitlements (
        location_id, status, source, activated_at, updated_at
      ) VALUES (?1, 'active', 'test', ?2, ?2)
    `).bind(tenant.locationId, tappedAt)
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

function responseCookie(response: Response, name: string): string {
  const setCookie = response.headers.get("Set-Cookie") || "";
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;]*)`));
  return match ? `${name}=${match[1]}` : "";
}

async function requestMagicLink(email: string): Promise<string> {
  let magicUrl = "";
  const mailer: MagicLinkMailer = {
    async sendMagicLink(recipient, url) {
      expect(recipient).toBe(email);
      magicUrl = url;
    }
  };
  const linkRequest = await request("/api/auth/request-link", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: AUTH_ORIGIN },
    body: JSON.stringify({ email })
  }, { mailer });
  expect(linkRequest.response.status).toBe(202);
  await waitOnExecutionContext(linkRequest.context);
  expect(magicUrl).toContain("/auth/verify?token=");
  return magicUrl;
}

async function prepareConfirmation(magicUrl: string): Promise<{
  html: string;
  rawToken: string;
  response: Response;
}> {
  const verifyUrl = new URL(magicUrl);
  const verification = await request(`${verifyUrl.pathname}${verifyUrl.search}`);
  const rawToken = verifyUrl.searchParams.get("token") || "";
  const html = await verification.response.text();
  expect(verification.response.status).toBe(200);
  expect(verification.response.headers.get("Location")).toBeNull();
  expect(verification.response.headers.get("Set-Cookie")).toBeNull();
  expect(html).toContain(`name="token" value="${rawToken}"`);
  return { html, rawToken, response: verification.response };
}

async function confirmMagicLink(
  rawToken: string,
  options: {
    now?: Date;
    origin?: string | null;
    referer?: string | null;
    secFetchSite?: string | null;
  } = {}
): Promise<Response> {
  const testNow = options.now;
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  if (options.origin !== null) headers.set("Origin", options.origin || AUTH_ORIGIN);
  if (options.referer) headers.set("Referer", options.referer);
  if (options.secFetchSite) headers.set("Sec-Fetch-Site", options.secFetchSite);
  const confirmation = await request("/auth/confirm", {
    method: "POST",
    headers,
    body: new URLSearchParams({ token: rawToken }).toString()
  }, testNow ? { now: () => testNow } : {});
  return confirmation.response;
}

async function signIn(email: string): Promise<{ cookie: string; magicUrl: string }> {
  const magicUrl = await requestMagicLink(email);
  const confirmationPageResponse = await prepareConfirmation(magicUrl);
  expect(confirmationPageResponse.html).toContain("Continue to Insights");

  const confirmation = await confirmMagicLink(confirmationPageResponse.rawToken);
  expect(confirmation.status).toBe(303);
  expect(confirmation.headers.get("Location")).toBe("/app");
  const setCookie = confirmation.headers.get("Set-Cookie") || "";
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  expect(setCookie).toContain("SameSite=Lax");
  expect(setCookie).toContain("Max-Age=2592000");
  const cookie = responseCookie(confirmation, SESSION_COOKIE_NAME);
  expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
  return { cookie, magicUrl };
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
    expect(page).toContain("const REFRESH_INTERVAL_MS=60000");
    expect(page).toContain("if(summaryRequest)return summaryRequest");
    expect(page).toContain("if(refreshTimer!==null)return");
    expect(page).toContain("document.visibilityState!=='hidden'");
    expect(page).toContain("document.addEventListener('visibilitychange'");
    expect(page).toContain("window.addEventListener('focus'");
    expect(page).toContain("if(response.status===401){showLogin();return}");
    expect(page).toContain('src="/tapntrust-insights-mascot.png"');
    expect(page).toContain("const GOOGLE_REFRESH_COOLDOWN_MS=300000");
    expect(page).toContain("if(!currentLocationId||googleSummaryRequest)return googleSummaryRequest");
    expect(page).toContain("if(!currentLocationId||reviewsRequest)return reviewsRequest");
    expect(page).toContain("if(reviewsCache.has(currentLocationId))");
    expect(page).toContain("if(!force&&googleSummaryCache.has(currentLocationId))");
    expect(page).toContain("Date.now()-refreshedAt<GOOGLE_REFRESH_COOLDOWN_MS");
    expect(page).toContain("toggleReviewsButton.addEventListener('click',()=>void loadReviews())");
    expect(page).toContain("void load({showInitialError:true})");
    expect(page).toContain('<div class="google-attribution" translate="no">Google Maps</div>');
    expect(page.match(/translate="no">Google Maps<\/div>/g)).toHaveLength(4);
    expect(page).toContain(".google-attribution{display:block;margin-top:9px;color:#5e5e5e");
    expect(page).toContain("font-size:12px;font-style:normal;font-weight:400;letter-spacing:normal");
    expect(page).toContain("text-transform:none;white-space:nowrap");
    expect(page).not.toContain("google-dot");
    expect(page).toContain('<span id="opportunity-count">0</span> Review Opportunities');
    expect(page).not.toContain("customer taps");
    expect(page).toContain("Recorded opens are counted individually.");
    expect(page).toContain("data.trendDirection==='unavailable'?'—'");
    expect(page).toContain("data.period==='all'?'No comparison for all-time'");
    expect(page).toContain("review.author.photoUri");
    expect(page).toContain("review.author.profileUri");
    expect(page).toContain("review.sourceUri");
    expect(page).toContain("review.visitDate");
    expect(page).toContain("Google orders them by relevance, not recency.");
    expect(page).not.toContain("GOOGLE_PLACES_API_KEY");
    expect(page.match(/\/api\/customer\/google-place\/summary/g)).toHaveLength(1);
    expect(page.match(/\/api\/customer\/google-place\/reviews/g)).toHaveLength(1);
    const polling = page.match(/function startPolling\(\)\{[\s\S]*?\}\n    function chartMarkup/)?.[0] || "";
    expect(polling).not.toContain("google-place");
    expect(polling).not.toContain("loadGoogleSummary");
    const visibilityHandler = page.match(/document\.addEventListener\('visibilitychange',[^\n]+/)?.[0] || "";
    const focusHandler = page.match(/window\.addEventListener\('focus',[^\n]+/)?.[0] || "";
    expect(visibilityHandler).not.toContain("Google");
    expect(focusHandler).not.toContain("Google");
    const initialRender = page.match(/function renderDashboard\([\s\S]*?\}\n    function load\(/)?.[0] || "";
    expect(initialRender).toContain("loadGoogleSummary");
    expect(initialRender).not.toContain("loadReviews");

    const embeddedScript = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(embeddedScript).toBeTruthy();
    expect(() => new Function(embeddedScript || "")).not.toThrow();
  });

  it("restores legacy GET confirmation safely without consuming a link or creating a session", async () => {
    const magicUrl = await requestMagicLink(tenantA.email);
    const rawToken = new URL(magicUrl).searchParams.get("token") || "";
    const restored = await request(`/auth/confirm?token=${encodeURIComponent(rawToken)}`);
    const stored = await env.DB.prepare(`
      SELECT used_at FROM auth_magic_links WHERE user_id = ?1
    `).bind(tenantA.userId).first<{ used_at: string | null }>();
    const sessions = await env.DB.prepare("SELECT COUNT(*) AS count FROM customer_sessions")
      .first<{ count: number }>();
    const unauthenticated = await request("/api/customer/summary");

    expect(restored.response.status).toBe(303);
    expect(restored.response.headers.get("Location")).toBe("/app");
    expect(restored.response.headers.get("Set-Cookie")).toBeNull();
    expect(stored?.used_at).toBeNull();
    expect(Number(sessions?.count || 0)).toBe(0);
    expect(unauthenticated.response.status).toBe(401);
  });

  it("restores an existing authenticated session through GET confirmation", async () => {
    const { cookie } = await signIn(tenantA.email);
    const restored = await request("/auth/confirm", { headers: { Cookie: cookie } });
    const page = await request("/app", { headers: { Cookie: cookie } });
    const summary = await request("/api/customer/summary", { headers: { Cookie: cookie } });

    expect(restored.response.status).toBe(303);
    expect(restored.response.headers.get("Location")).toBe("/app");
    expect(restored.response.headers.get("Set-Cookie")).toBeNull();
    expect(page.response.status).toBe(200);
    expect(summary.response.status).toBe(200);
  });

  it("does not consume a magic link during GET verification", async () => {
    const magicUrl = await requestMagicLink(tenantA.email);
    const rawToken = new URL(magicUrl).searchParams.get("token") || "";
    await prepareConfirmation(magicUrl);

    const stored = await env.DB.prepare(`
      SELECT token_hash, used_at FROM auth_magic_links WHERE user_id = ?1
    `).bind(tenantA.userId).first<{ token_hash: string; used_at: string | null }>();
    const sessions = await env.DB.prepare("SELECT COUNT(*) AS count FROM customer_sessions")
      .first<{ count: number }>();

    expect(stored?.token_hash).not.toBe(rawToken);
    expect(stored?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.used_at).toBeNull();
    expect(Number(sessions?.count || 0)).toBe(0);
  });

  it("renders the no-store confirmation form directly without a pending cookie", async () => {
    const magicUrl = await requestMagicLink(tenantA.email);
    const confirmation = await prepareConfirmation(magicUrl);

    expect(confirmation.response.headers.get("Cache-Control")).toBe("no-store");
    expect(confirmation.response.headers.get("Referrer-Policy")).toBe("origin");
    expect(confirmation.response.headers.get("Content-Type")).toContain("text/html");
    expect(confirmation.html).toContain('method="post" action="/auth/confirm"');
    expect(confirmation.html).not.toMatch(/<(?:img|link|iframe|script)\b/i);

    const confirmed = await confirmMagicLink(confirmation.rawToken);
    expect(confirmed.status).toBe(303);
    expect(confirmed.headers.get("Location")).toBe("/app");
  });

  it("allows the customer to use a link after an automated GET prefetch", async () => {
    const magicUrl = await requestMagicLink(tenantA.email);
    const scannerPage = await prepareConfirmation(magicUrl);
    expect(scannerPage.response.status).toBe(200);

    const customerPage = await prepareConfirmation(magicUrl);
    const confirmed = await confirmMagicLink(customerPage.rawToken);
    expect(confirmed.status).toBe(303);
    expect(confirmed.headers.get("Location")).toBe("/app");
  });

  it("rejects an expired magic link without creating a session", async () => {
    const magicUrl = await requestMagicLink(tenantA.email);
    const { rawToken } = await prepareConfirmation(magicUrl);
    const expiredAt = new Date(NOW.getTime() + (15 * 60 * 1000) + 1);
    const expired = await confirmMagicLink(rawToken, { now: expiredAt });
    const sessions = await env.DB.prepare("SELECT COUNT(*) AS count FROM customer_sessions")
      .first<{ count: number }>();

    expect(expired.status).toBe(401);
    expect(Number(sessions?.count || 0)).toBe(0);
  });

  it("rejects malformed tokens on both GET and POST", async () => {
    const malformedGet = await request("/auth/verify?token=not-valid");
    const malformedPost = await confirmMagicLink("not-valid");
    const missingPost = await confirmMagicLink("");
    const sessions = await env.DB.prepare("SELECT COUNT(*) AS count FROM customer_sessions")
      .first<{ count: number }>();

    expect(malformedGet.response.status).toBe(401);
    expect(malformedPost.status).toBe(401);
    expect(missingPost.status).toBe(401);
    expect(Number(sessions?.count || 0)).toBe(0);
  });

  it("accepts an exact expected Origin", async () => {
    const magicUrl = await requestMagicLink(tenantA.email);
    const { rawToken } = await prepareConfirmation(magicUrl);
    const accepted = await confirmMagicLink(rawToken, { origin: AUTH_ORIGIN });

    expect(accepted.status).toBe(303);
    expect(accepted.headers.get("Location")).toBe("/app");
  });

  it("rejects a supplied wrong Origin even when Fetch Metadata says same-origin", async () => {
    const magicUrl = await requestMagicLink(tenantA.email);
    const { rawToken } = await prepareConfirmation(magicUrl);
    const rejected = await confirmMagicLink(rawToken, {
      origin: "https://cross-origin.example",
      secFetchSite: "same-origin"
    });
    const accepted = await confirmMagicLink(rawToken);

    expect(rejected.status).toBe(401);
    expect(accepted.status).toBe(303);
  });

  it("accepts absent Origin with same-origin Fetch Metadata", async () => {
    const magicUrl = await requestMagicLink(tenantA.email);
    const { rawToken } = await prepareConfirmation(magicUrl);
    const accepted = await confirmMagicLink(rawToken, {
      origin: null,
      secFetchSite: "same-origin"
    });

    expect(accepted.status).toBe(303);
    expect(accepted.headers.get("Location")).toBe("/app");
  });

  it("accepts an exact-origin Referer fallback when Origin and Fetch Metadata are absent", async () => {
    const magicUrl = await requestMagicLink(tenantA.email);
    const { rawToken } = await prepareConfirmation(magicUrl);
    const accepted = await confirmMagicLink(rawToken, {
      origin: null,
      referer: `${AUTH_ORIGIN}/`
    });

    expect(accepted.status).toBe(303);
  });

  it("rejects absent Origin with cross-site Fetch Metadata without consuming the token", async () => {
    const magicUrl = await requestMagicLink(tenantA.email);
    const { rawToken } = await prepareConfirmation(magicUrl);
    const rejected = await confirmMagicLink(rawToken, {
      origin: null,
      referer: `${AUTH_ORIGIN}/`,
      secFetchSite: "cross-site"
    });
    const accepted = await confirmMagicLink(rawToken);

    expect(rejected.status).toBe(401);
    expect(accepted.status).toBe(303);
  });

  it("logs only safe reason and request-source metadata on confirmation failure", async () => {
    const magicUrl = await requestMagicLink(tenantA.email);
    const { rawToken } = await prepareConfirmation(magicUrl);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const rejected = await confirmMagicLink(rawToken, {
        origin: "https://cross-origin.example/private/path?token=must-not-appear",
        secFetchSite: "same-origin"
      });
      const logs = consoleWarn.mock.calls.flat().join(" ");

      expect(rejected.status).toBe(401);
      expect(logs).toContain('"reason":"bad_origin"');
      expect(logs).toContain('"origin":"https://cross-origin.example"');
      expect(logs).toContain('"secFetchSite":"same-origin"');
      expect(logs).not.toContain(rawToken);
      expect(logs).not.toContain("private/path");
      expect(logs).not.toContain("must-not-appear");
      expect(logs).not.toContain(tenantA.email);
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("requires form content type without consuming the token", async () => {
    const magicUrl = await requestMagicLink(tenantA.email);
    const { rawToken } = await prepareConfirmation(magicUrl);
    const rejected = await request("/auth/confirm", {
      method: "POST",
      headers: { Origin: AUTH_ORIGIN, "Content-Type": "text/plain" },
      body: new URLSearchParams({ token: rawToken }).toString()
    });
    const accepted = await confirmMagicLink(rawToken);

    expect(rejected.response.status).toBe(401);
    expect(accepted.status).toBe(303);
  });

  it("requires JSON for magic-link requests", async () => {
    const missing = await request("/api/auth/request-link", {
      method: "POST",
      headers: { Origin: AUTH_ORIGIN },
      body: JSON.stringify({ email: tenantA.email })
    });
    const wrong = await request("/api/auth/request-link", {
      method: "POST",
      headers: { Origin: AUTH_ORIGIN, "Content-Type": "text/plain" },
      body: JSON.stringify({ email: tenantA.email })
    });

    expect(missing.response.status).toBe(415);
    expect(wrong.response.status).toBe(415);
  });

  it("rejects cross-origin magic-link requests", async () => {
    let sent = false;
    const { response, context } = await request("/api/auth/request-link", {
      method: "POST",
      headers: { Origin: "https://cross-origin.example", "Content-Type": "application/json" },
      body: JSON.stringify({ email: tenantA.email })
    }, { mailer: { async sendMagicLink() { sent = true; } } });
    await waitOnExecutionContext(context);

    expect(response.status).toBe(403);
    expect(sent).toBe(false);
  });

  it("rate-limits known and unknown emails with the same public response", async () => {
    let sent = 0;
    const mailer: MagicLinkMailer = { async sendMagicLink() { sent += 1; } };
    const requestBody = (email: string) => ({
      method: "POST",
      headers: { Origin: AUTH_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });

    const knownFirst = await request("/api/auth/request-link", requestBody(tenantA.email), { mailer });
    await waitOnExecutionContext(knownFirst.context);
    const knownLimited = await request("/api/auth/request-link", requestBody(tenantA.email), { mailer });
    await waitOnExecutionContext(knownLimited.context);

    const unknownEmail = `account-${crypto.randomUUID()}@example.invalid`;
    const unknownFirst = await request("/api/auth/request-link", requestBody(unknownEmail), { mailer });
    await waitOnExecutionContext(unknownFirst.context);
    const unknownLimited = await request("/api/auth/request-link", requestBody(unknownEmail), { mailer });
    await waitOnExecutionContext(unknownLimited.context);

    const responses = await Promise.all([
      knownFirst.response.text(),
      knownLimited.response.text(),
      unknownFirst.response.text(),
      unknownLimited.response.text()
    ]);
    expect([knownFirst, knownLimited, unknownFirst, unknownLimited].map(({ response }) => response.status))
      .toEqual([202, 202, 202, 202]);
    expect(new Set(responses).size).toBe(1);
    expect(sent).toBe(1);
  });

  it("deletes a newly-created magic link when delivery fails without logging sensitive details", async () => {
    const apiKey = `test-only-${crypto.randomUUID()}`;
    const providerDetail = `provider-detail-${crypto.randomUUID()}`;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const failed = await request("/api/auth/request-link", {
        method: "POST",
        headers: { Origin: AUTH_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ email: tenantA.email })
      }, {
        mailer: createZeptoMailMagicLinkMailer(
          apiKey,
          "contact@tapntrust.com",
          async () => new Response(providerDetail, { status: 401 })
        )
      });
      expect(failed.response.status).toBe(202);
      expect(await failed.response.json()).toEqual({
        message: "If this email has Tapntrust Insights access, a sign-in link is on its way."
      });
      await waitOnExecutionContext(failed.context);

      const storedLinks = await env.DB.prepare("SELECT COUNT(*) AS count FROM auth_magic_links")
        .first<{ count: number }>();
      const logs = consoleError.mock.calls.flat().join(" ");
      expect(Number(storedLinks?.count || 0)).toBe(0);
      expect(logs).toContain("provider_rejected");
      expect(logs).toContain('"status":401');
      expect(logs).not.toContain(apiKey);
      expect(logs).not.toContain(providerDetail);
      expect(logs).not.toContain(tenantA.email);
    } finally {
      consoleError.mockRestore();
    }
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

  it("keeps a session valid beyond the magic-link window and expires it at the fixed 30-day boundary", async () => {
    const { cookie } = await signIn(tenantA.email);
    const afterMagicLinkWindow = new Date(NOW.getTime() + (16 * 60 * 1000));
    const beforeSessionExpiry = new Date(NOW.getTime() + (30 * 24 * 60 * 60 * 1000) - 1);
    const atSessionExpiry = new Date(NOW.getTime() + (30 * 24 * 60 * 60 * 1000));

    const afterFifteenMinutes = await request(
      "/api/customer/summary",
      { headers: { Cookie: cookie } },
      { now: () => afterMagicLinkWindow }
    );
    const beforeThirtyDays = await request(
      "/api/customer/summary",
      { headers: { Cookie: cookie } },
      { now: () => beforeSessionExpiry }
    );
    const afterThirtyDays = await request(
      "/api/customer/summary",
      { headers: { Cookie: cookie } },
      { now: () => atSessionExpiry }
    );

    expect(afterFifteenMinutes.response.status).toBe(200);
    expect(beforeThirtyDays.response.status).toBe(200);
    expect(afterThirtyDays.response.status).toBe(401);
  });

  it("rejects a revoked customer session", async () => {
    const { cookie } = await signIn(tenantA.email);
    const logout = await request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie }
    });
    const summary = await request("/api/customer/summary", { headers: { Cookie: cookie } });

    expect(logout.response.status).toBe(204);
    expect(summary.response.status).toBe(401);
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
      headers: { "Content-Type": "application/json", Origin: AUTH_ORIGIN },
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

  it("consumes a magic link exactly once only after POST confirmation", async () => {
    const magicUrl = await requestMagicLink(tenantA.email);
    const token = new URL(magicUrl).searchParams.get("token") || "";
    const { rawToken } = await prepareConfirmation(magicUrl);
    const confirmed = await confirmMagicLink(rawToken);
    expect(confirmed.status).toBe(303);

    const stored = await env.DB.prepare(`
      SELECT token_hash, used_at FROM auth_magic_links WHERE user_id = ?1
    `).bind(tenantA.userId).first<{ token_hash: string; used_at: string | null }>();

    expect(stored?.token_hash).not.toBe(token);
    expect(stored?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.used_at).toBe(NOW.toISOString());

    const reused = await confirmMagicLink(rawToken);
    const sessions = await env.DB.prepare("SELECT COUNT(*) AS count FROM customer_sessions")
      .first<{ count: number }>();
    expect(reused.status).toBe(401);
    expect(Number(sessions?.count || 0)).toBe(1);
  });
});
