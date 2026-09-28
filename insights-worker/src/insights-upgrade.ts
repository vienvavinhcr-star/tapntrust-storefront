import { generateOpaqueToken, hashToken, isValidOpaqueToken } from "./auth";
import { renderInsightsUpgradePage, renderUpgradeConfirmationPage, renderUpgradeUnavailablePage } from "./insights-upgrade-page";
import { createZeptoMailUpgradeLinkMailer, safeMailFailure, type UpgradeLinkMailer } from "./zeptomail";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_SECONDS = 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_MAX = 3;
const SESSION_COOKIE = "__Host-tnt_insights_upgrade";
const GENERIC_REQUEST_MESSAGE = "If this location matches a Tapntrust order, a secure link is on its way to the email saved with that order.";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export interface InsightsUpgradeEnv {
  DB: D1Database;
  AUTH_BASE_URL: string;
  AUTH_FROM_EMAIL: string;
  ZEPTOMAIL_API_KEY: string;
  STOREFRONT_ORIGIN: string;
  SHOPIFY_SHOP_DOMAIN: string;
  SHOPIFY_STOREFRONT_API_VERSION: string;
  SHOPIFY_STOREFRONT_TOKEN: string;
  SHOPIFY_INSIGHTS_VARIANT_ID: string;
  SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID: string;
  SHOPIFY_INSIGHTS_INTRO_DISCOUNT_CODE?: string;
}

export interface InsightsUpgradeDependencies {
  mailer?: UpgradeLinkMailer;
  shopifyFetch?: typeof fetch;
  now?: () => Date;
}

export interface UpgradeSessionRow {
  session_id: string;
  provisioning_batch_id: string;
  first_name: string;
  business_id: string;
  location_id: string;
  business_name: string;
  business_address: string;
  google_place_id: string | null;
  card_count: number;
  entitlement_status: string | null;
}

interface MatchedBatchRow {
  id: string;
  customer_email: string;
}

export const UPGRADE_HTML_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "origin",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; img-src 'self' https://tapntrust.com; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};

export function cleanUpgradeValue(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normaliseUpgradeOrigin(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : "";
  } catch {
    return "";
  }
}

export function upgradeJson(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", { status: 405, headers: { Allow: allow, "Cache-Control": "no-store" } });
}

async function readJson(request: Request, byteLimit = 2048): Promise<Record<string, unknown> | null> {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) return null;
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > byteLimit) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > byteLimit) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function readUpgradeSessionToken(request: Request): string | null {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const token = value.join("=");
      return isValidOpaqueToken(token) ? token : null;
    }
  }
  return null;
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function safeConfirmationSource(request: Request, env: InsightsUpgradeEnv): boolean {
  const expected = normaliseUpgradeOrigin(env.AUTH_BASE_URL);
  if (!expected) return false;
  const origin = request.headers.get("Origin");
  if (origin !== null) return normaliseUpgradeOrigin(origin) === expected;
  const fetchSite = (request.headers.get("Sec-Fetch-Site") || "").toLowerCase();
  if (fetchSite === "same-origin") return true;
  if (fetchSite === "cross-site") return false;
  return normaliseUpgradeOrigin(request.headers.get("Referer") || "") === expected;
}

function storefrontHeaders(env: InsightsUpgradeEnv): HeadersInit {
  return {
    "Access-Control-Allow-Origin": normaliseUpgradeOrigin(env.STOREFRONT_ORIGIN),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff"
  };
}

async function reserveRequest(db: D1Database, identifierHash: string, now: Date): Promise<boolean> {
  const timestamp = now.toISOString();
  const [, reservation] = await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO auth_request_limits (identifier_hash, window_started_at, request_count, last_allowed_at)
      VALUES (?1, ?2, 0, '1970-01-01T00:00:00.000Z')
    `).bind(identifierHash, timestamp),
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
      timestamp,
      REQUEST_MAX,
      new Date(now.getTime() - REQUEST_COOLDOWN_MS).toISOString()
    )
  ]);
  return Number(reservation?.meta.changes || 0) === 1;
}

async function findMatchingBatch(db: D1Database, googlePlaceId: string): Promise<MatchedBatchRow | null> {
  return db.prepare(`
    SELECT pb.id, pb.customer_email
    FROM provisioning_batches pb
    JOIN locations l ON l.id = pb.location_id AND l.business_id = pb.business_id
    WHERE l.google_place_id = ?1
      AND pb.customer_email IS NOT NULL
      AND TRIM(pb.customer_email) <> ''
    ORDER BY pb.created_at DESC
    LIMIT 1
  `).bind(googlePlaceId).first<MatchedBatchRow>();
}

async function requestUpgradeLink(
  request: Request,
  env: InsightsUpgradeEnv,
  ctx: ExecutionContext,
  dependencies: InsightsUpgradeDependencies,
  now: Date
): Promise<Response> {
  const headers = storefrontHeaders(env);
  if (request.method === "OPTIONS") {
    const allowed = normaliseUpgradeOrigin(request.headers.get("Origin") || "") === normaliseUpgradeOrigin(env.STOREFRONT_ORIGIN);
    return new Response(null, { status: allowed ? 204 : 403, headers });
  }
  if (request.method !== "POST") return upgradeJson({ error: "Method not allowed" }, 405, headers);
  if (normaliseUpgradeOrigin(request.headers.get("Origin") || "") !== normaliseUpgradeOrigin(env.STOREFRONT_ORIGIN)) {
    return upgradeJson({ error: "Origin not allowed" }, 403, headers);
  }
  const body = await readJson(request);
  const firstName = cleanUpgradeValue(body?.firstName, 40);
  const businessName = cleanUpgradeValue(body?.businessName, 120);
  const googlePlaceId = cleanUpgradeValue(body?.googlePlaceId, 220);
  if (
    !firstName || CONTROL_CHARACTERS.test(firstName)
    || !businessName || CONTROL_CHARACTERS.test(businessName)
    || !/^[A-Za-z0-9_-]{3,220}$/.test(googlePlaceId)
  ) return upgradeJson({ error: "Choose the exact Google business location and enter your first name." }, 400, headers);

  const allowed = await reserveRequest(env.DB, await hashToken(`insights-upgrade:${googlePlaceId}`), now);
  if (!allowed) return upgradeJson({ message: GENERIC_REQUEST_MESSAGE }, 202, headers);
  const batch = await findMatchingBatch(env.DB, googlePlaceId);
  if (!batch) return upgradeJson({ message: GENERIC_REQUEST_MESSAGE }, 202, headers);

  const rawToken = generateOpaqueToken();
  const tokenHash = await hashToken(rawToken);
  const createdAt = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE insights_upgrade_magic_links SET used_at = ?1
      WHERE provisioning_batch_id = ?2 AND used_at IS NULL
    `).bind(createdAt, batch.id),
    env.DB.prepare(`
      INSERT INTO insights_upgrade_magic_links
        (id, provisioning_batch_id, first_name, token_hash, expires_at, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      crypto.randomUUID(), batch.id, firstName, tokenHash,
      new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString(), createdAt
    )
  ]);

  const magicUrl = new URL("/insights-upgrade/verify", env.AUTH_BASE_URL);
  magicUrl.searchParams.set("token", rawToken);
  const mailer = dependencies.mailer || createZeptoMailUpgradeLinkMailer(env.ZEPTOMAIL_API_KEY, env.AUTH_FROM_EMAIL);
  ctx.waitUntil(mailer.sendUpgradeLink(batch.customer_email, firstName, magicUrl.toString()).catch(async (error) => {
    await env.DB.prepare("DELETE FROM insights_upgrade_magic_links WHERE token_hash = ?1").bind(tokenHash).run().catch(() => undefined);
    console.error(JSON.stringify({ message: "insights upgrade email failed", ...safeMailFailure(error) }));
  }));
  return upgradeJson({ message: GENERIC_REQUEST_MESSAGE }, 202, headers);
}

async function consumeMagicLink(db: D1Database, rawToken: string, now: Date): Promise<string | null> {
  const sessionToken = generateOpaqueToken();
  const timestamp = now.toISOString();
  const tokenHash = await hashToken(rawToken);
  const [insert, update] = await db.batch([
    db.prepare(`
      INSERT INTO insights_upgrade_sessions
        (id, provisioning_batch_id, first_name, token_hash, expires_at, created_at)
      SELECT ?1, provisioning_batch_id, first_name, ?2, ?3, ?4
      FROM insights_upgrade_magic_links
      WHERE token_hash = ?5 AND used_at IS NULL AND expires_at > ?4
    `).bind(
      crypto.randomUUID(), await hashToken(sessionToken),
      new Date(now.getTime() + SESSION_TTL_MS).toISOString(), timestamp, tokenHash
    ),
    db.prepare(`
      UPDATE insights_upgrade_magic_links SET used_at = ?1
      WHERE token_hash = ?2 AND used_at IS NULL AND expires_at > ?1
    `).bind(timestamp, tokenHash)
  ]);
  return Number(insert?.meta.changes || 0) === 1 && Number(update?.meta.changes || 0) === 1 ? sessionToken : null;
}

export async function findActiveUpgradeSession(
  db: D1Database,
  request: Request,
  now: Date
): Promise<UpgradeSessionRow | null> {
  const token = readUpgradeSessionToken(request);
  if (!token) return null;
  return db.prepare(`
    SELECT s.id AS session_id, s.provisioning_batch_id, s.first_name,
      pb.business_id, pb.location_id, l.business_name, l.business_address, l.google_place_id,
      (SELECT COUNT(DISTINCT c.id) FROM cards c WHERE c.location_id = pb.location_id) AS card_count,
      (SELECT e.status FROM insights_entitlements e WHERE e.location_id = pb.location_id LIMIT 1) AS entitlement_status
    FROM insights_upgrade_sessions s
    JOIN provisioning_batches pb ON pb.id = s.provisioning_batch_id
    JOIN locations l ON l.id = pb.location_id AND l.business_id = pb.business_id
    WHERE s.token_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2
    LIMIT 1
  `).bind(await hashToken(token), now.toISOString()).first<UpgradeSessionRow>();
}

export async function isIntroEligible(db: D1Database, businessId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT business_id FROM business_insights_intro_redemptions WHERE business_id = ?1 LIMIT 1
  `).bind(businessId).first<{ business_id: string }>();
  return !row;
}

async function renderUpgrade(request: Request, env: InsightsUpgradeEnv, now: Date): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
  const session = await findActiveUpgradeSession(env.DB, request, now);
  const html = session ? renderInsightsUpgradePage({
    firstName: session.first_name,
    businessName: session.business_name,
    businessAddress: session.business_address,
    cardCount: Number(session.card_count || 0),
    insightsActive: session.entitlement_status === "active",
    introEligible: await isIntroEligible(env.DB, session.business_id)
  }) : renderInsightsUpgradePage(null);
  return new Response(request.method === "HEAD" ? null : html, { headers: UPGRADE_HTML_HEADERS });
}

async function prepareConfirmation(request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const rawToken = url.searchParams.get("token") || "";
  const valid = isValidOpaqueToken(rawToken);
  return new Response(valid ? renderUpgradeConfirmationPage(rawToken) : renderUpgradeUnavailablePage(), {
    status: valid ? 200 : 400,
    headers: UPGRADE_HTML_HEADERS
  });
}

async function confirmUpgrade(request: Request, env: InsightsUpgradeEnv, now: Date): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/x-www-form-urlencoded") || !safeConfirmationSource(request, env)) {
    return new Response(renderUpgradeUnavailablePage(), { status: 400, headers: UPGRADE_HTML_HEADERS });
  }
  const rawToken = new URLSearchParams((await request.text()).slice(0, 256)).get("token") || "";
  if (!isValidOpaqueToken(rawToken)) return new Response(renderUpgradeUnavailablePage(), { status: 400, headers: UPGRADE_HTML_HEADERS });
  const sessionToken = await consumeMagicLink(env.DB, rawToken, now);
  if (!sessionToken) return new Response(renderUpgradeUnavailablePage(), { status: 400, headers: UPGRADE_HTML_HEADERS });
  const headers = new Headers({ Location: "/insights-upgrade", "Cache-Control": "no-store" });
  headers.append("Set-Cookie", sessionCookie(sessionToken));
  return new Response(null, { status: 303, headers });
}

async function logoutUpgrade(request: Request, env: InsightsUpgradeEnv, now: Date): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!safeConfirmationSource(request, env)) return new Response(null, { status: 403 });
  const token = readUpgradeSessionToken(request);
  if (token) {
    await env.DB.prepare("UPDATE insights_upgrade_sessions SET revoked_at = ?1 WHERE token_hash = ?2 AND revoked_at IS NULL")
      .bind(now.toISOString(), await hashToken(token)).run();
  }
  const headers = new Headers({ Location: "https://tapntrust.com/insights-only/", "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearSessionCookie());
  return new Response(null, { status: 303, headers });
}

export async function handleInsightsUpgradeRequest(
  request: Request,
  url: URL,
  env: InsightsUpgradeEnv,
  ctx: ExecutionContext,
  dependencies: InsightsUpgradeDependencies = {},
  checkoutHandler?: (request: Request, env: InsightsUpgradeEnv, dependencies: InsightsUpgradeDependencies, now: Date) => Promise<Response>
): Promise<Response | null> {
  const now = dependencies.now?.() || new Date();
  if (url.pathname === "/api/storefront/insights-upgrade/request-link") return requestUpgradeLink(request, env, ctx, dependencies, now);
  if (url.pathname === "/insights-upgrade" || url.pathname === "/insights-upgrade/") return renderUpgrade(request, env, now);
  if (url.pathname === "/insights-upgrade/verify") return prepareConfirmation(request, url);
  if (url.pathname === "/insights-upgrade/confirm") return confirmUpgrade(request, env, now);
  if (url.pathname === "/insights-upgrade/logout") return logoutUpgrade(request, env, now);
  if (url.pathname === "/api/insights-upgrade/checkout" && checkoutHandler) return checkoutHandler(request, env, dependencies, now);
  return null;
}
