import {
  clearSessionCookie,
  createSessionCookie,
  generateOpaqueToken,
  hashToken,
  isValidEmail,
  isValidOpaqueToken,
  type MagicLinkMailer,
  normaliseEmail,
  readSessionToken
} from "./auth";
import { CUSTOMER_PAGE } from "./customer-page";
import {
  createCustomerRepository,
  type CustomerCardUpdate,
  type CustomerRepository
} from "./customer-repository";
import {
  createCustomerInsightsRepository,
  parseInsightsPeriod,
  parseTimezoneOffset,
  selectCustomerLocation,
  type CustomerInsightsRepository
} from "./customer-insights";
import {
  createGooglePlacesProvider,
  GooglePlacesProviderError,
  type GooglePlacesProvider
} from "./places-provider";
import type { PlacementType } from "./repository";
import { createZeptoMailMagicLinkMailer, safeMailFailure } from "./zeptomail";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const MAGIC_LINK_COOLDOWN_MS = 60 * 1000;
const MAGIC_LINK_RATE_WINDOW_MS = 15 * 60 * 1000;
const MAGIC_LINK_MAX_REQUESTS = 3;
const REQUEST_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const GOOGLE_RATE_WINDOW_MS = 60 * 60 * 1000;
const CUSTOMER_CARD_UPDATE_BODY_BYTES = 1024;
const CUSTOMER_CARD_LABEL_MAX_LENGTH = 40;
const CUSTOMER_CARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CUSTOMER_CARD_PLACEMENT_TYPES = new Set<PlacementType>([
  "counter", "table", "reception", "register", "other"
]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const GOOGLE_RATE_POLICIES = {
  summary: { maxRequests: 30, cooldownMs: 30 * 1000 },
  reviews: { maxRequests: 12, cooldownMs: 2 * 60 * 1000 }
} as const;
const GENERIC_LINK_MESSAGE = "If this email has Tapntrust Insights access, a sign-in link is on its way.";

type CustomerEnv = Env & {
  AUTH_BASE_URL: string;
  AUTH_FROM_EMAIL: string;
  ZEPTOMAIL_API_KEY: string;
  GOOGLE_PLACES_API_KEY?: string;
};

export interface CustomerAuthDependencies {
  repository?: CustomerRepository;
  insightsRepository?: CustomerInsightsRepository;
  placesProvider?: GooglePlacesProvider;
  mailer?: MagicLinkMailer;
  now?: () => Date;
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(data, { status, headers: { ...SECURITY_HEADERS, ...extraHeaders } });
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", { status: 405, headers: { ...SECURITY_HEADERS, Allow: allow } });
}

function monthStartUtc(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function readBoundedText(request: Request, byteLimit: number): Promise<{ text?: string; status?: 400 | 413 }> {
  if (!request.body) return { status: 400 };
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
      return { status: 413 };
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();

  return { text };
}

async function readBoundedJson(request: Request, byteLimit: number): Promise<{ value?: unknown; status?: 400 | 413 }> {
  const body = await readBoundedText(request, byteLimit);
  if (body.status || body.text === undefined) return { status: body.status || 400 };

  try {
    return { value: JSON.parse(body.text) };
  } catch {
    return { status: 400 };
  }
}

function safeBaseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function expectedAuthOrigin(env: CustomerEnv): string | null {
  return safeBaseUrl(env.AUTH_BASE_URL)?.origin || null;
}

function hasExpectedOrigin(request: Request, env: CustomerEnv): boolean {
  const expectedOrigin = expectedAuthOrigin(env);
  return Boolean(expectedOrigin && request.headers.get("Origin") === expectedOrigin);
}

type ConfirmationFailureReason =
  | "bad_origin"
  | "bad_content_type"
  | "bad_token_format"
  | "token_not_consumable";

function hasExpectedRefererOrigin(request: Request, expectedOrigin: string): boolean {
  const referer = request.headers.get("Referer");
  if (!referer) return false;

  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function hasSafeConfirmationSource(request: Request, env: CustomerEnv): boolean {
  const expectedOrigin = expectedAuthOrigin(env);
  if (!expectedOrigin) return false;

  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site")?.toLowerCase() || "";
  if (fetchSite === "cross-site") return false;

  // A supplied Origin is authoritative. Never let another header override a mismatch.
  if (origin !== null) return origin === expectedOrigin;

  // Modern browsers provide an unforgeable same-origin signal even when a WebView
  // omits Origin on a navigation-mode form POST.
  if (fetchSite === "same-origin") return true;

  // Older or privacy-restricted clients may omit Fetch Metadata. The confirmation
  // page sends only its origin as Referer, never the token-bearing path/query.
  if (fetchSite && fetchSite !== "same-site" && fetchSite !== "none") return false;
  return hasExpectedRefererOrigin(request, expectedOrigin);
}

function safeOriginForLog(request: Request): string | undefined {
  const origin = request.headers.get("Origin");
  if (!origin) return undefined;

  try {
    const url = new URL(origin);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function safeFetchSiteForLog(request: Request): string {
  const value = request.headers.get("Sec-Fetch-Site")?.toLowerCase();
  return value && ["same-origin", "same-site", "cross-site", "none"].includes(value)
    ? value
    : value ? "other" : "missing";
}

function logConfirmationFailure(request: Request, reason: ConfirmationFailureReason): void {
  const origin = safeOriginForLog(request);
  console.warn(JSON.stringify({
    message: "magic link confirmation rejected",
    reason,
    originPresent: request.headers.has("Origin"),
    ...(origin ? { origin } : {}),
    secFetchSite: safeFetchSiteForLog(request)
  }));
}

function hasContentType(request: Request, expected: string): boolean {
  const mediaType = (request.headers.get("Content-Type") || "").split(";", 1)[0] || "";
  return mediaType.trim().toLowerCase() === expected;
}

function parseCustomerCardUpdate(value: unknown): CustomerCardUpdate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.includes("label") || !keys.includes("placementType")) return null;

  const label = typeof record.label === "string" ? record.label.trim() : "";
  const placementType = typeof record.placementType === "string" ? record.placementType : "";
  if (
    !label
    || label.length > CUSTOMER_CARD_LABEL_MAX_LENGTH
    || CONTROL_CHARACTER_PATTERN.test(label)
    || !CUSTOMER_CARD_PLACEMENT_TYPES.has(placementType as PlacementType)
  ) return null;

  return { label, placementType: placementType as PlacementType };
}

function invalidLinkPage(): Response {
  return new Response("<!doctype html><title>Tapntrust Insights</title><h1>This sign-in link is invalid or has expired.</h1><p>Return to the Tapntrust Insights sign-in page and request a new link.</p>", {
    status: 401,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}

function confirmationPage(rawToken: string): Response {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Continue to Tapntrust Insights</title><style>body{margin:0;background:#f4f7fb;color:#061a45;font:16px/1.5 system-ui,sans-serif}.panel{width:min(560px,calc(100% - 32px));margin:12vh auto;background:#fff;border:1px solid #d7e2f1;border-radius:22px;box-shadow:0 18px 45px rgba(6,26,69,.08);padding:32px;box-sizing:border-box}h1{font-size:clamp(2rem,7vw,3.2rem);line-height:1.05;letter-spacing:-.04em}.button{width:100%;border:0;border-radius:12px;background:#1769ed;color:#fff;padding:14px 18px;font:inherit;font-weight:800;cursor:pointer}</style></head><body><main class="panel"><p>Tapntrust Insights</p><h1>Continue to your dashboard</h1><p>Confirm below to securely sign in. This keeps automated email scanners from using your one-time link.</p><form method="post" action="/auth/confirm"><input type="hidden" name="token" value="${rawToken}"><button class="button" type="submit">Continue to Insights</button></form></main></body></html>`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "origin",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function authenticateCustomer(
  request: Request,
  repository: CustomerRepository,
  now: Date
) {
  const rawToken = readSessionToken(request);
  if (!rawToken) return null;
  return repository.findActiveSession(await hashToken(rawToken), now.toISOString());
}

async function requestMagicLink(
  request: Request,
  env: CustomerEnv,
  ctx: ExecutionContext,
  repository: CustomerRepository,
  mailer: MagicLinkMailer,
  now: Date
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!hasContentType(request, "application/json")) {
    return json({ error: "Content-Type must be application/json" }, 415);
  }
  if (!hasExpectedOrigin(request, env)) return json({ error: "Forbidden" }, 403);

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 1024) return json({ error: "Request body too large" }, 413);

  const parsed = await readBoundedJson(request, 1024);
  if (parsed.status === 413) return json({ error: "Request body too large" }, 413);
  if (parsed.status === 400 || !parsed.value || typeof parsed.value !== "object") {
    return json({ error: "Invalid request" }, 400);
  }

  const emailValue = (parsed.value as Record<string, unknown>).email;
  if (typeof emailValue !== "string" || !isValidEmail(emailValue)) {
    return json({ error: "Enter a valid email address" }, 400);
  }

  const email = normaliseEmail(emailValue);
  const createdAt = now.toISOString();
  const requestAllowed = await repository.reserveMagicLinkRequest({
    identifierHash: await hashToken(email),
    now: createdAt,
    cooldownCutoff: new Date(now.getTime() - MAGIC_LINK_COOLDOWN_MS).toISOString(),
    windowResetCutoff: new Date(now.getTime() - MAGIC_LINK_RATE_WINDOW_MS).toISOString(),
    maxRequests: MAGIC_LINK_MAX_REQUESTS
  });
  ctx.waitUntil(repository.deleteExpiredAuthRecords(
    createdAt,
    new Date(now.getTime() - REQUEST_LIMIT_RETENTION_MS).toISOString()
  ).catch(() => undefined));
  if (!requestAllowed) return json({ message: GENERIC_LINK_MESSAGE }, 202);

  const user = await repository.findActiveUserByEmail(email);
  if (!user) {
    return json({ message: GENERIC_LINK_MESSAGE }, 202);
  }

  const baseUrl = safeBaseUrl(env.AUTH_BASE_URL);
  if (!baseUrl) {
    console.error(JSON.stringify({ message: "invalid AUTH_BASE_URL configuration" }));
    return json({ message: GENERIC_LINK_MESSAGE }, 202);
  }

  const rawToken = generateOpaqueToken();
  const tokenHash = await hashToken(rawToken);
  await repository.createMagicLink({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash,
    createdAt,
    expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString()
  });

  const magicUrl = new URL("/auth/verify", baseUrl);
  magicUrl.searchParams.set("token", rawToken);
  ctx.waitUntil(mailer.sendMagicLink(user.email, magicUrl.toString()).catch(async (error) => {
    await repository.deleteMagicLink(tokenHash).catch(() => undefined);
    console.error(JSON.stringify({
      message: "magic link email failed",
      ...safeMailFailure(error)
    }));
  }));

  return json({ message: GENERIC_LINK_MESSAGE }, 202);
}

function prepareMagicLink(
  request: Request,
  url: URL
): Response {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const rawToken = url.searchParams.get("token") || "";
  if (!isValidOpaqueToken(rawToken)) return invalidLinkPage();
  return confirmationPage(rawToken);
}

async function confirmMagicLink(
  request: Request,
  env: CustomerEnv,
  repository: CustomerRepository,
  now: Date
): Promise<Response> {
  if (request.method === "GET") {
    return new Response(null, {
      status: 303,
      headers: { ...SECURITY_HEADERS, Location: "/app" }
    });
  }
  if (request.method !== "POST") return methodNotAllowed("GET, POST");
  if (!hasContentType(request, "application/x-www-form-urlencoded")) {
    logConfirmationFailure(request, "bad_content_type");
    return invalidLinkPage();
  }
  if (!hasSafeConfirmationSource(request, env)) {
    logConfirmationFailure(request, "bad_origin");
    return invalidLinkPage();
  }
  const confirmation = await readBoundedText(request, 256);
  const rawToken = confirmation.status
    ? ""
    : new URLSearchParams(confirmation.text || "").get("token") || "";
  if (!isValidOpaqueToken(rawToken)) {
    logConfirmationFailure(request, "bad_token_format");
    return invalidLinkPage();
  }

  const sessionToken = generateOpaqueToken();
  const createdAt = now.toISOString();
  const consumed = await repository.consumeMagicLink(await hashToken(rawToken), createdAt, {
    id: crypto.randomUUID(),
    tokenHash: await hashToken(sessionToken),
    createdAt,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString()
  });
  if (!consumed) {
    logConfirmationFailure(request, "token_not_consumable");
    return invalidLinkPage();
  }

  const headers = new Headers({ ...SECURITY_HEADERS, Location: "/app" });
  headers.append("Set-Cookie", createSessionCookie(sessionToken, SESSION_TTL_SECONDS));
  return new Response(null, {
    status: 303,
    headers
  });
}

async function customerSummary(
  request: Request,
  repository: CustomerRepository,
  now: Date
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const customer = await authenticateCustomer(request, repository, now);
  if (!customer) return json({ error: "Unauthorized" }, 401);
  return json(await repository.getCustomerSummary(customer, monthStartUtc(now)));
}

async function updateCustomerCard(
  request: Request,
  cardId: string,
  env: CustomerEnv,
  repository: CustomerRepository,
  now: Date
): Promise<Response> {
  if (request.method !== "PATCH") return methodNotAllowed("PATCH");
  const customer = await authenticateCustomer(request, repository, now);
  if (!customer) return json({ error: "Unauthorized" }, 401);
  if (!hasExpectedOrigin(request, env)) return json({ error: "Request not allowed" }, 403);
  if (!hasContentType(request, "application/json")) {
    return json({ error: "Content-Type must be application/json" }, 415);
  }
  if (!CUSTOMER_CARD_ID_PATTERN.test(cardId)) return json({ error: "Not found" }, 404);

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > CUSTOMER_CARD_UPDATE_BODY_BYTES) {
    return json({ error: "Request body too large" }, 413);
  }
  const body = await readBoundedJson(request, CUSTOMER_CARD_UPDATE_BODY_BYTES);
  if (body.status === 413) return json({ error: "Request body too large" }, 413);
  if (body.status === 400) return json({ error: "Invalid JSON" }, 400);
  const update = parseCustomerCardUpdate(body.value);
  if (!update) return json({ error: "Enter a valid card label and placement" }, 400);

  const card = await repository.updateOwnedCard(customer.id, cardId, update, now.toISOString());
  return card ? json({ card }) : json({ error: "Not found" }, 404);
}

async function authenticatedInsights(
  request: Request,
  url: URL,
  repository: CustomerRepository,
  insightsRepository: CustomerInsightsRepository,
  now: Date
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const customer = await authenticateCustomer(request, repository, now);
  if (!customer) return json({ error: "Unauthorized" }, 401);
  const locations = await insightsRepository.listEntitledLocations(customer.id);
  const location = selectCustomerLocation(locations, url.searchParams.get("locationId"));
  if (!location) {
    return url.searchParams.has("locationId")
      ? json({ error: "Not found" }, 404)
      : json({ error: "Insights is not active for a location." }, 403);
  }
  return json(await insightsRepository.getLocationInsights(
    location,
    locations,
    parseInsightsPeriod(url.searchParams.get("period")),
    parseTimezoneOffset(url.searchParams.get("timezoneOffsetMinutes")),
    now
  ));
}

async function authenticatedGooglePlace(
  request: Request,
  url: URL,
  env: CustomerEnv,
  repository: CustomerRepository,
  insightsRepository: CustomerInsightsRepository,
  placesProvider: GooglePlacesProvider,
  now: Date,
  kind: "summary" | "reviews"
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const customer = await authenticateCustomer(request, repository, now);
  if (!customer) return json({ error: "Unauthorized" }, 401);
  const locations = await insightsRepository.listEntitledLocations(customer.id);
  const location = selectCustomerLocation(locations, url.searchParams.get("locationId"));
  if (!location) return json({ error: "Not found" }, 404);
  if (!location.googlePlaceId || !env.GOOGLE_PLACES_API_KEY) {
    return json({ status: "unavailable" });
  }
  const policy = GOOGLE_RATE_POLICIES[kind];
  const identifierHash = await hashToken(JSON.stringify([
    "google-places-rate-v1",
    kind,
    customer.id,
    location.id
  ]));
  const providerRequestAllowed = await insightsRepository.reserveGoogleProviderRequest({
    identifierHash,
    now: now.toISOString(),
    cooldownCutoff: new Date(now.getTime() - policy.cooldownMs).toISOString(),
    windowResetCutoff: new Date(now.getTime() - GOOGLE_RATE_WINDOW_MS).toISOString(),
    maxRequests: policy.maxRequests
  });
  if (!providerRequestAllowed) {
    return json(
      { status: "rate_limited" },
      429,
      { "Retry-After": String(Math.ceil(policy.cooldownMs / 1000)) }
    );
  }

  try {
    const data = kind === "summary"
      ? await placesProvider.fetchSummary(location.googlePlaceId, env.GOOGLE_PLACES_API_KEY)
      : await placesProvider.fetchReviews(location.googlePlaceId, env.GOOGLE_PLACES_API_KEY);
    return json({ status: "available", locationId: location.id, data });
  } catch (error) {
    console.warn(JSON.stringify({
      message: "google places request failed",
      kind,
      reason: error instanceof GooglePlacesProviderError ? error.code : "provider_unavailable"
    }));
    return json({ status: "unavailable" });
  }
}

async function logoutCustomer(
  request: Request,
  repository: CustomerRepository,
  now: Date
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const rawToken = readSessionToken(request);
  if (rawToken) await repository.revokeSession(await hashToken(rawToken), now.toISOString());
  return new Response(null, {
    status: 204,
    headers: { ...SECURITY_HEADERS, "Set-Cookie": clearSessionCookie() }
  });
}

export async function handleCustomerRequest(
  request: Request,
  url: URL,
  env: CustomerEnv,
  ctx: ExecutionContext,
  dependencies: CustomerAuthDependencies = {}
): Promise<Response | null> {
  const repository = dependencies.repository || createCustomerRepository(env.DB);
  const insightsRepository = dependencies.insightsRepository || createCustomerInsightsRepository(env.DB);
  const placesProvider = dependencies.placesProvider || createGooglePlacesProvider();
  const now = (dependencies.now || (() => new Date()))();

  if (url.pathname === "/app") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return new Response(CUSTOMER_PAGE, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' https://*.googleusercontent.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }
  if (url.pathname === "/auth/verify") return prepareMagicLink(request, url);
  if (url.pathname === "/auth/confirm") return confirmMagicLink(request, env, repository, now);
  if (url.pathname === "/api/auth/request-link") {
    const mailer = dependencies.mailer || createZeptoMailMagicLinkMailer(
      env.ZEPTOMAIL_API_KEY,
      env.AUTH_FROM_EMAIL
    );
    return requestMagicLink(request, env, ctx, repository, mailer, now);
  }
  if (url.pathname === "/api/auth/logout") return logoutCustomer(request, repository, now);
  const customerCardMatch = url.pathname.match(/^\/api\/customer\/cards\/([^/]+)$/);
  if (customerCardMatch) {
    let cardId = "";
    try {
      cardId = decodeURIComponent(customerCardMatch[1] || "");
    } catch {
      return json({ error: "Not found" }, 404);
    }
    return updateCustomerCard(request, cardId, env, repository, now);
  }
  if (url.pathname === "/api/customer/summary") return customerSummary(request, repository, now);
  if (url.pathname === "/api/customer/insights") {
    return authenticatedInsights(request, url, repository, insightsRepository, now);
  }
  if (url.pathname === "/api/customer/google-place/summary") {
    return authenticatedGooglePlace(
      request, url, env, repository, insightsRepository, placesProvider, now, "summary"
    );
  }
  if (url.pathname === "/api/customer/google-place/reviews") {
    return authenticatedGooglePlace(
      request, url, env, repository, insightsRepository, placesProvider, now, "reviews"
    );
  }
  return null;
}
