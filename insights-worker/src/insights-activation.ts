import {
  generateOpaqueToken,
  hashToken,
  isValidEmail,
  isValidOpaqueToken,
  normaliseEmail,
  type MagicLinkMailer
} from "./auth";
import { INSIGHTS_ACTIVATION_PAGE } from "./insights-activation-page";
import {
  handleInsightsPurchaseRequest,
  type InsightsPurchaseDependencies,
  type InsightsPurchaseEnv
} from "./insights-purchase";
import { createZeptoMailMagicLinkMailer, safeMailFailure } from "./zeptomail";

const ACTIVATION_COOKIE = "__Host-tnt_insights_activation";
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const ACTIVATION_SESSION_TTL_MS = 30 * 60 * 1000;
const ACTIVATION_SESSION_TTL_SECONDS = Math.floor(ACTIVATION_SESSION_TTL_MS / 1000);
const CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_MAX = 3;
const MAX_BODY_BYTES = 1024;
const PUBLIC_STOREFRONT_TOKEN = "d5ece3960c932e194af79a157d7560bd";
const GENERIC_LINK_MESSAGE = "If this email is linked to TapNTrust cards, a secure verification link is on its way.";

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

export type InsightsActivationEnv = InsightsPurchaseEnv & {
  AUTH_BASE_URL: string;
  AUTH_FROM_EMAIL: string;
  ZEPTOMAIL_API_KEY: string;
};

export interface InsightsActivationDependencies {
  mailer?: MagicLinkMailer;
  purchaseDependencies?: InsightsPurchaseDependencies;
  storefrontFetch?: typeof fetch;
  now?: () => Date;
}

interface ActivationSessionRow {
  id: string;
  email: string;
}

interface OwnedLocationRow {
  business_id: string;
  business_name: string;
  location_id: string;
  location_name: string;
  business_address: string;
  google_place_id: string;
  google_review_url: string;
  purchased_card_count: number;
  insights_status: "active" | "inactive" | "not_configured";
}

interface CardRow {
  id: string;
  location_id: string;
  label: string;
  active: number;
  lifetime_taps: number;
}

interface OfferPayload {
  offerKind: "intro" | "standard";
  introEligible: boolean;
  reason: string;
  currency: "AUD";
  firstMonthMinor: number;
  recurringMinor: number;
  variantId: string;
  sellingPlanId: string;
  offerId?: string;
  discountCode?: string;
  expiresAt?: string;
}

interface CheckoutRow {
  id: string;
  checkout_url: string | null;
}

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(data, { status, headers: { ...SECURITY_HEADERS, ...extraHeaders } });
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", { status: 405, headers: { ...SECURITY_HEADERS, Allow: allow } });
}

function expectedOrigin(env: InsightsActivationEnv): string | null {
  try {
    const url = new URL(env.AUTH_BASE_URL);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

function hasExpectedOrigin(request: Request, env: InsightsActivationEnv): boolean {
  const expected = expectedOrigin(env);
  return Boolean(expected && request.headers.get("Origin") === expected);
}

function hasSafeConfirmationSource(request: Request, env: InsightsActivationEnv): boolean {
  const expected = expectedOrigin(env);
  if (!expected) return false;
  const origin = request.headers.get("Origin");
  if (origin !== null) return origin === expected;
  const fetchSite = request.headers.get("Sec-Fetch-Site")?.toLowerCase() || "";
  if (fetchSite === "cross-site") return false;
  if (fetchSite === "same-origin") return true;
  const referer = request.headers.get("Referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

function hasContentType(request: Request, expected: string): boolean {
  return (request.headers.get("Content-Type") || "").split(";", 1)[0]?.trim().toLowerCase() === expected;
}

async function readBoundedText(request: Request, byteLimit = MAX_BODY_BYTES): Promise<string | null> {
  if (!request.body) return null;
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > byteLimit) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > byteLimit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await readBoundedText(request);
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [candidate, ...valueParts] = part.trim().split("=");
    if (candidate !== name) continue;
    const value = valueParts.join("=");
    return isValidOpaqueToken(value) ? value : null;
  }
  return null;
}

function activationCookie(token: string): string {
  return `${ACTIVATION_COOKIE}=${token}; Path=/; Max-Age=${ACTIVATION_SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function clearActivationCookie(): string {
  return `${ACTIVATION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function htmlPage(): Response {
  return new Response(INSIGHTS_ACTIVATION_PAGE, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function invalidLinkPage(): Response {
  return new Response("<!doctype html><meta name=viewport content='width=device-width'><title>TapNTrust Insights</title><h1>This verification link is invalid or has expired.</h1><p>Return to the Insights activation page and request a new link.</p>", {
    status: 401,
    headers: { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8" }
  });
}

function confirmationPage(rawToken: string): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Confirm TapNTrust Insights</title><style>body{margin:0;background:#f2f6fc;color:#071a3d;font:16px/1.5 system-ui,sans-serif}.box{width:min(560px,calc(100% - 28px));margin:12vh auto;background:white;border:1px solid #d9e3f0;border-radius:22px;padding:30px;box-shadow:0 20px 50px rgba(7,26,61,.1)}h1{letter-spacing:-.04em}.btn{width:100%;border:0;border-radius:12px;background:#1769ed;color:#fff;padding:14px;font:inherit;font-weight:900;cursor:pointer}</style></head><body><main class="box"><p><strong>TapNTrust Insights</strong></p><h1>Confirm your email</h1><p>Continue to securely view the TapNTrust card setup linked to this email. The link itself is not consumed until you confirm.</p><form method="post" action="/insights/confirm"><input type="hidden" name="token" value="${rawToken}"><button class="btn" type="submit">Continue to Insights activation</button></form></main></body></html>`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "origin",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function reserveRequest(db: D1Database, email: string, now: Date): Promise<boolean> {
  const identifierHash = await hashToken(`insights-activation:${email}`);
  const nowIso = now.toISOString();
  const [, reservation] = await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO auth_request_limits (
        identifier_hash, window_started_at, request_count, last_allowed_at
      ) VALUES (?1, ?2, 0, '1970-01-01T00:00:00.000Z')
    `).bind(identifierHash, nowIso),
    db.prepare(`
      UPDATE auth_request_limits
      SET window_started_at = CASE WHEN window_started_at <= ?2 THEN ?3 ELSE window_started_at END,
          request_count = CASE WHEN window_started_at <= ?2 THEN 1 ELSE request_count + 1 END,
          last_allowed_at = ?3
      WHERE identifier_hash = ?1
        AND (window_started_at <= ?2 OR (request_count < ?4 AND last_allowed_at <= ?5))
    `).bind(
      identifierHash,
      new Date(now.getTime() - REQUEST_WINDOW_MS).toISOString(),
      nowIso,
      REQUEST_MAX,
      new Date(now.getTime() - REQUEST_COOLDOWN_MS).toISOString()
    )
  ]);
  return Number(reservation?.meta.changes || 0) === 1;
}

async function purchaserExists(db: D1Database, email: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT id FROM provisioning_batches
    WHERE customer_email = ?1 COLLATE NOCASE
    LIMIT 1
  `).bind(email).first<{ id: string }>();
  return Boolean(row);
}

async function requestLink(
  request: Request,
  env: InsightsActivationEnv,
  ctx: ExecutionContext,
  dependencies: InsightsActivationDependencies,
  now: Date
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!hasExpectedOrigin(request, env)) return json({ error: "Forbidden" }, 403);
  if (!hasContentType(request, "application/json")) return json({ error: "Content-Type must be application/json" }, 415);
  const body = await readJson(request);
  const emailValue = body?.email;
  if (typeof emailValue !== "string" || !isValidEmail(emailValue)) {
    return json({ error: "Enter a valid email address" }, 400);
  }
  const email = normaliseEmail(emailValue);
  if (!(await reserveRequest(env.DB, email, now))) return json({ message: GENERIC_LINK_MESSAGE }, 202);
  if (!(await purchaserExists(env.DB, email))) return json({ message: GENERIC_LINK_MESSAGE }, 202);

  const rawToken = generateOpaqueToken();
  const tokenHash = await hashToken(rawToken);
  const nowIso = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE insights_activation_magic_links
      SET used_at = ?1
      WHERE email = ?2 COLLATE NOCASE AND used_at IS NULL
    `).bind(nowIso, email),
    env.DB.prepare(`
      INSERT INTO insights_activation_magic_links (id, email, token_hash, expires_at, used_at, created_at)
      VALUES (?1, ?2, ?3, ?4, NULL, ?5)
    `).bind(
      crypto.randomUUID(),
      email,
      tokenHash,
      new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString(),
      nowIso
    )
  ]);

  const base = new URL(env.AUTH_BASE_URL);
  const verifyUrl = new URL("/insights/verify", base);
  verifyUrl.searchParams.set("token", rawToken);
  const mailer = dependencies.mailer || createZeptoMailMagicLinkMailer(env.ZEPTOMAIL_API_KEY, env.AUTH_FROM_EMAIL);
  ctx.waitUntil(mailer.sendMagicLink(email, verifyUrl.toString()).catch(async (error) => {
    await env.DB.prepare("DELETE FROM insights_activation_magic_links WHERE token_hash = ?1").bind(tokenHash).run().catch(() => undefined);
    console.error(JSON.stringify({ message: "Insights activation email failed", ...safeMailFailure(error) }));
  }));
  ctx.waitUntil(env.DB.batch([
    env.DB.prepare("DELETE FROM insights_activation_magic_links WHERE expires_at <= ?1").bind(nowIso),
    env.DB.prepare("DELETE FROM insights_activation_sessions WHERE expires_at <= ?1 OR revoked_at IS NOT NULL").bind(nowIso)
  ]).then(() => undefined).catch(() => undefined));
  return json({ message: GENERIC_LINK_MESSAGE }, 202);
}

async function prepareVerification(request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const token = url.searchParams.get("token") || "";
  return isValidOpaqueToken(token) ? confirmationPage(token) : invalidLinkPage();
}

async function confirmVerification(
  request: Request,
  env: InsightsActivationEnv,
  now: Date
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!hasContentType(request, "application/x-www-form-urlencoded") || !hasSafeConfirmationSource(request, env)) {
    return invalidLinkPage();
  }
  const text = await readBoundedText(request, 256);
  const token = text === null ? "" : new URLSearchParams(text).get("token") || "";
  if (!isValidOpaqueToken(token)) return invalidLinkPage();
  const tokenHash = await hashToken(token);
  const sessionToken = generateOpaqueToken();
  const sessionHash = await hashToken(sessionToken);
  const nowIso = now.toISOString();
  const [insertResult] = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO insights_activation_sessions (id, email, token_hash, expires_at, revoked_at, created_at)
      SELECT ?1, ml.email, ?2, ?3, NULL, ?4
      FROM insights_activation_magic_links ml
      WHERE ml.token_hash = ?5
        AND ml.used_at IS NULL
        AND ml.expires_at > ?4
    `).bind(
      crypto.randomUUID(),
      sessionHash,
      new Date(now.getTime() + ACTIVATION_SESSION_TTL_MS).toISOString(),
      nowIso,
      tokenHash
    ),
    env.DB.prepare(`
      UPDATE insights_activation_magic_links
      SET used_at = ?1
      WHERE token_hash = ?2 AND used_at IS NULL AND expires_at > ?1
    `).bind(nowIso, tokenHash)
  ]);
  if (Number(insertResult?.meta.changes || 0) !== 1) return invalidLinkPage();
  const headers = new Headers({ ...SECURITY_HEADERS, Location: "/insights" });
  headers.append("Set-Cookie", activationCookie(sessionToken));
  return new Response(null, { status: 303, headers });
}

async function activationSession(request: Request, db: D1Database, now: Date): Promise<ActivationSessionRow | null> {
  const raw = readCookie(request, ACTIVATION_COOKIE);
  if (!raw) return null;
  return db.prepare(`
    SELECT id, email
    FROM insights_activation_sessions
    WHERE token_hash = ?1
      AND revoked_at IS NULL
      AND expires_at > ?2
    LIMIT 1
  `).bind(await hashToken(raw), now.toISOString()).first<ActivationSessionRow>();
}

async function ownedLocations(db: D1Database, email: string): Promise<OwnedLocationRow[]> {
  const result = await db.prepare(`
    WITH owned AS (
      SELECT
        p.business_id,
        p.location_id,
        SUM(p.physical_card_count) AS purchased_card_count
      FROM provisioning_batches p
      WHERE p.customer_email = ?1 COLLATE NOCASE
      GROUP BY p.business_id, p.location_id
    )
    SELECT
      owned.business_id,
      b.name AS business_name,
      owned.location_id,
      l.business_name AS location_name,
      l.business_address,
      l.google_place_id,
      l.google_review_url,
      owned.purchased_card_count,
      CASE WHEN e.location_id IS NULL THEN 'not_configured' ELSE e.status END AS insights_status
    FROM owned
    JOIN businesses b ON b.id = owned.business_id
    JOIN locations l ON l.id = owned.location_id AND l.business_id = owned.business_id
    LEFT JOIN insights_entitlements e ON e.location_id = owned.location_id
    ORDER BY b.name COLLATE NOCASE ASC, l.created_at ASC
  `).bind(email).all<OwnedLocationRow>();
  return result.results;
}

async function locationCards(db: D1Database, locationIds: string[]): Promise<CardRow[]> {
  if (locationIds.length === 0) return [];
  const placeholders = locationIds.map((_, index) => `?${index + 1}`).join(",");
  const result = await db.prepare(`
    SELECT
      c.id,
      c.location_id,
      c.label,
      c.active,
      COUNT(t.id) AS lifetime_taps
    FROM cards c
    LEFT JOIN tap_events t ON t.card_id = c.id
    WHERE c.location_id IN (${placeholders})
    GROUP BY c.id
    ORDER BY c.created_at ASC, c.id ASC
  `).bind(...locationIds).all<CardRow>();
  return result.results;
}

async function getOwnedLocation(
  db: D1Database,
  email: string,
  locationId: string
): Promise<OwnedLocationRow | null> {
  const rows = await ownedLocations(db, email);
  return rows.find((row) => row.location_id === locationId) || null;
}

async function summary(request: Request, env: InsightsActivationEnv, now: Date): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const session = await activationSession(request, env.DB, now);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const locations = await ownedLocations(env.DB, session.email);
  const cards = await locationCards(env.DB, locations.map((location) => location.location_id));
  return json({
    email: session.email,
    locations: locations.map((location) => {
      const ownedCards = cards.filter((card) => card.location_id === location.location_id);
      return {
        businessId: location.business_id,
        businessName: location.business_name,
        locationId: location.location_id,
        locationName: location.location_name,
        businessAddress: location.business_address,
        cardCount: Number(location.purchased_card_count || ownedCards.length),
        activeCardCount: ownedCards.filter((card) => card.active === 1).length,
        lifetimeReviewOpportunities: ownedCards.reduce((sum, card) => sum + Number(card.lifetime_taps || 0), 0),
        insightsStatus: location.insights_status,
        cards: ownedCards.map((card) => ({
          id: card.id,
          label: card.label,
          active: card.active === 1,
          lifetimeTaps: Number(card.lifetime_taps || 0)
        }))
      };
    })
  });
}

async function internalOffer(
  env: InsightsActivationEnv,
  location: OwnedLocationRow,
  action: "quote" | "issue",
  setupId: string | undefined,
  dependencies: InsightsActivationDependencies
): Promise<OfferPayload> {
  const endpoint = new URL("/api/storefront/insights/offer", env.AUTH_BASE_URL);
  const request = new Request(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: env.STOREFRONT_ORIGIN
    },
    body: JSON.stringify({
      action,
      ...(setupId ? { setupId } : {}),
      businessName: location.location_name || location.business_name,
      googlePlaceId: location.google_place_id || "",
      reviewUrl: location.google_review_url
    })
  });
  const response = await handleInsightsPurchaseRequest(
    request,
    endpoint,
    env,
    dependencies.purchaseDependencies || {}
  );
  if (!response) throw new Error("Offer service unavailable");
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Could not confirm Insights pricing.");
  return payload as unknown as OfferPayload;
}

async function quote(
  request: Request,
  url: URL,
  env: InsightsActivationEnv,
  dependencies: InsightsActivationDependencies,
  now: Date
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const session = await activationSession(request, env.DB, now);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const locationId = url.searchParams.get("locationId") || "";
  const location = await getOwnedLocation(env.DB, session.email, locationId);
  if (!location) return json({ error: "Not found" }, 404);
  if (location.insights_status === "active") return json({ error: "Insights is already active for this location." }, 409);
  try {
    return json(await internalOffer(env, location, "quote", undefined, dependencies));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Pricing confirmation unavailable." }, 503);
  }
}

function setupReference(): string {
  return `activate_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function existingReadyCheckout(
  db: D1Database,
  email: string,
  locationId: string,
  nowIso: string
): Promise<CheckoutRow | null> {
  return db.prepare(`
    SELECT id, checkout_url
    FROM insights_activation_checkouts
    WHERE email = ?1 COLLATE NOCASE
      AND location_id = ?2
      AND status = 'ready'
      AND checkout_url IS NOT NULL
      AND expires_at > ?3
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(email, locationId, nowIso).first<CheckoutRow>();
}

async function createShopifyCheckout(
  env: InsightsActivationEnv,
  email: string,
  setupId: string,
  offer: OfferPayload,
  fetcher: typeof fetch
): Promise<string> {
  const query = `
    mutation TapNTrustInsightsActivation($input: CartInput!) {
      cartCreate(input: $input) {
        cart { id checkoutUrl discountCodes { code applicable } }
        userErrors { field message code }
        warnings { code message target }
      }
    }
  `;
  const attributes = [
    { key: "_Business Setup ID", value: setupId },
    { key: "_Item Role", value: "TapnTrust Insights" },
    { key: "_Insights Offer", value: offer.offerKind },
    ...(offer.offerId ? [{ key: "_Insights Offer ID", value: offer.offerId }] : []),
    ...(offer.discountCode ? [{ key: "_Insights Offer Code", value: offer.discountCode }] : [])
  ];
  const input: Record<string, unknown> = {
    buyerIdentity: { email },
    lines: [{
      merchandiseId: offer.variantId,
      quantity: 1,
      sellingPlanId: offer.sellingPlanId,
      attributes
    }],
    discountCodes: offer.discountCode ? [offer.discountCode] : []
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetcher(`https://${env.SHOPIFY_SHOP_DOMAIN}/api/${env.SHOPIFY_ADMIN_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": PUBLIC_STOREFRONT_TOKEN
      },
      body: JSON.stringify({ query, variables: { input } }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Shopify checkout is temporarily unavailable.");
    const payload = await response.json() as {
      errors?: Array<{ message?: string }>;
      data?: {
        cartCreate?: {
          cart?: { checkoutUrl?: string; discountCodes?: Array<{ code?: string; applicable?: boolean }> };
          userErrors?: Array<{ message?: string }>;
        };
      };
    };
    const mutation = payload.data?.cartCreate;
    const errorMessage = payload.errors?.[0]?.message || mutation?.userErrors?.[0]?.message;
    if (errorMessage || !mutation?.cart?.checkoutUrl) throw new Error(errorMessage || "Shopify did not return a checkout.");
    if (offer.offerKind === "intro") {
      const code = (offer.discountCode || "").toLowerCase();
      const applied = mutation.cart.discountCodes?.some((entry) => entry.applicable && (entry.code || "").toLowerCase() === code);
      if (!code || !applied) throw new Error("Shopify could not apply the A$1.99 first-month offer. Please try again.");
    }
    const checkoutUrl = new URL(mutation.cart.checkoutUrl);
    if (checkoutUrl.protocol !== "https:") throw new Error("Shopify returned an invalid checkout URL.");
    return checkoutUrl.toString();
  } finally {
    clearTimeout(timer);
  }
}

async function checkout(
  request: Request,
  env: InsightsActivationEnv,
  dependencies: InsightsActivationDependencies,
  now: Date
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!hasExpectedOrigin(request, env)) return json({ error: "Forbidden" }, 403);
  if (!hasContentType(request, "application/json")) return json({ error: "Content-Type must be application/json" }, 415);
  const session = await activationSession(request, env.DB, now);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const body = await readJson(request);
  const locationId = typeof body?.locationId === "string" ? body.locationId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(locationId)) return json({ error: "Invalid location" }, 400);
  const location = await getOwnedLocation(env.DB, session.email, locationId);
  if (!location) return json({ error: "Not found" }, 404);
  if (location.insights_status === "active") return json({ error: "Insights is already active for this location." }, 409);

  const nowIso = now.toISOString();
  const existing = await existingReadyCheckout(env.DB, session.email, locationId, nowIso);
  if (existing?.checkout_url) return json({ checkoutUrl: existing.checkout_url, reused: true });

  const setupId = setupReference();
  let offer: OfferPayload;
  try {
    offer = await internalOffer(env, location, "issue", setupId, dependencies);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not prepare Insights pricing." }, 503);
  }
  const checkoutId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + CHECKOUT_TTL_MS).toISOString();
  await env.DB.prepare(`
    INSERT INTO insights_activation_checkouts (
      id, setup_reference, email, business_id, location_id,
      offer_kind, offer_id, discount_code, provider_order_reference,
      checkout_url, status, expires_at, paid_at, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, 'creating', ?9, NULL, ?10, ?10)
  `).bind(
    checkoutId,
    setupId,
    session.email,
    location.business_id,
    location.location_id,
    offer.offerKind,
    offer.offerId || null,
    offer.discountCode || null,
    expiresAt,
    nowIso
  ).run();

  try {
    const checkoutUrl = await createShopifyCheckout(
      env,
      session.email,
      setupId,
      offer,
      dependencies.storefrontFetch || fetch
    );
    await env.DB.prepare(`
      UPDATE insights_activation_checkouts
      SET checkout_url = ?1, status = 'ready', updated_at = ?2
      WHERE id = ?3 AND status = 'creating'
    `).bind(checkoutUrl, nowIso, checkoutId).run();
    return json({
      checkoutUrl,
      offerKind: offer.offerKind,
      firstMonthMinor: offer.firstMonthMinor,
      recurringMinor: offer.recurringMinor,
      currency: offer.currency
    });
  } catch (error) {
    await env.DB.prepare(`
      UPDATE insights_activation_checkouts SET status = 'failed', updated_at = ?1 WHERE id = ?2
    `).bind(nowIso, checkoutId).run().catch(() => undefined);
    return json({ error: error instanceof Error ? error.message : "Could not prepare Shopify checkout." }, 503);
  }
}

async function logout(request: Request, env: InsightsActivationEnv, now: Date): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const raw = readCookie(request, ACTIVATION_COOKIE);
  if (raw) {
    await env.DB.prepare(`
      UPDATE insights_activation_sessions
      SET revoked_at = ?1
      WHERE token_hash = ?2 AND revoked_at IS NULL
    `).bind(now.toISOString(), await hashToken(raw)).run();
  }
  return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, "Set-Cookie": clearActivationCookie() } });
}

export async function handleInsightsActivationRequest(
  request: Request,
  url: URL,
  env: InsightsActivationEnv,
  ctx: ExecutionContext,
  dependencies: InsightsActivationDependencies = {}
): Promise<Response | null> {
  const now = (dependencies.now || (() => new Date()))();
  if (url.pathname === "/insights") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return htmlPage();
  }
  if (url.pathname === "/insights/verify") return prepareVerification(request, url);
  if (url.pathname === "/insights/confirm") return confirmVerification(request, env, now);
  if (url.pathname === "/api/insights/activation/request-link") return requestLink(request, env, ctx, dependencies, now);
  if (url.pathname === "/api/insights/activation/summary") return summary(request, env, now);
  if (url.pathname === "/api/insights/activation/quote") return quote(request, url, env, dependencies, now);
  if (url.pathname === "/api/insights/activation/checkout") return checkout(request, env, dependencies, now);
  if (url.pathname === "/api/insights/activation/logout") return logout(request, env, now);
  return null;
}
