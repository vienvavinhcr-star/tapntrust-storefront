import { isAllowedGoogleReviewUrl } from "./destinations";
import {
  createGooglePlacesProvider,
  GooglePlacesProviderError,
  type GooglePlacesProvider
} from "./places-provider";
import { getShopifyAdminAccessToken } from "./shopify-admin-token";

const INTRO_DISCOUNT_AMOUNT = "8.00";
const INTRO_FIRST_MONTH_MINOR = 199;
const STANDARD_MONTH_MINOR = 999;
const OFFER_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 4096;

export interface InsightsPurchaseEnv {
  DB: D1Database;
  GOOGLE_PLACES_API_KEY: string;
  SHOPIFY_SHOP_DOMAIN: string;
  SHOPIFY_ADMIN_API_VERSION: string;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  SHOPIFY_INSIGHTS_VARIANT_ID: string;
  SHOPIFY_INSIGHTS_INTRO_SELLING_PLAN_ID: string;
  SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID: string;
  STOREFRONT_ORIGIN: string;
}

export interface IntroDiscountInput {
  code: string;
  title: string;
  startsAt: string;
  endsAt: string;
  variantId: string;
}

export interface IntroDiscountResult {
  nodeId: string;
  code: string;
}

export interface ShopifyDiscountProvider {
  createIntroDiscount(input: IntroDiscountInput): Promise<IntroDiscountResult>;
}

export interface InsightsPurchaseDependencies {
  discountProvider?: ShopifyDiscountProvider;
  placesProvider?: GooglePlacesProvider;
}

export class ShopifyDiscountProviderError extends Error {
  constructor(message: string, readonly category = "provider_error") {
    super(message);
    this.name = "ShopifyDiscountProviderError";
  }
}

interface PurchaseRequestBody {
  action: "quote" | "issue";
  setupId?: string;
  businessName: string;
  googlePlaceId?: string;
  reviewUrl: string;
}

interface EligibilityResolution {
  identityKey: string;
  businessId: string | null;
  eligibleIntro: boolean;
  reason: "eligible" | "intro_already_used" | "ambiguous_business" | "manual_unverified";
}

interface OfferRow {
  id: string;
  identity_key: string;
  business_id: string | null;
  setup_id: string;
  discount_code: string | null;
  shopify_discount_node_id: string | null;
  status: string;
  expires_at: string | null;
}

interface VerificationFailure {
  status: number;
  message: string;
}

function clean(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normaliseOrigin(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function responseHeaders(env: InsightsPurchaseEnv): HeadersInit {
  return {
    "Access-Control-Allow-Origin": normaliseOrigin(env.STOREFRONT_ORIGIN),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  };
}

function json(env: InsightsPurchaseEnv, data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: responseHeaders(env) });
}

function originAllowed(request: Request, env: InsightsPurchaseEnv): boolean {
  const expected = normaliseOrigin(env.STOREFRONT_ORIGIN);
  const origin = normaliseOrigin(request.headers.get("Origin") || "");
  return Boolean(expected && origin && origin === expected);
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) throw new Error("content_type");
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) throw new Error("body_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error("body_too_large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid_json");
  }
}

function parseBody(value: unknown): PurchaseRequestBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const action = record.action === "quote" || record.action === "issue" ? record.action : null;
  const businessName = clean(record.businessName, 120);
  const googlePlaceId = clean(record.googlePlaceId, 220);
  const reviewUrl = clean(record.reviewUrl, 1200);
  const setupId = clean(record.setupId, 120);
  if (!action || !businessName || !isAllowedGoogleReviewUrl(reviewUrl)) return null;
  if (googlePlaceId && !/^[A-Za-z0-9_-]{3,220}$/.test(googlePlaceId)) return null;
  if (action === "issue" && (!setupId || !/^[A-Za-z0-9_-]{8,120}$/.test(setupId))) return null;
  return { action, businessName, googlePlaceId, reviewUrl, setupId: setupId || undefined };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function identityKey(body: PurchaseRequestBody): Promise<string> {
  if (body.googlePlaceId) return `place:${await sha256(body.googlePlaceId)}`;
  const source = `${body.businessName.toLocaleLowerCase("en-AU")}\n${body.reviewUrl}`;
  return `manual:${await sha256(source)}`;
}

async function resolveBusinessIds(db: D1Database, googlePlaceId: string): Promise<string[]> {
  const result = await db.prepare(`
    SELECT DISTINCT business_id
    FROM locations
    WHERE google_place_id = ?
    LIMIT 2
  `).bind(googlePlaceId).all<{ business_id: string }>();
  return (result.results || []).map((row) => row.business_id);
}

async function resolveEligibility(db: D1Database, body: PurchaseRequestBody): Promise<EligibilityResolution> {
  const key = await identityKey(body);
  if (!body.googlePlaceId) {
    return { identityKey: key, businessId: null, eligibleIntro: false, reason: "manual_unverified" };
  }

  const businessIds = await resolveBusinessIds(db, body.googlePlaceId);
  if (businessIds.length > 1) {
    return { identityKey: key, businessId: null, eligibleIntro: false, reason: "ambiguous_business" };
  }
  const businessId = businessIds[0] || null;
  if (!businessId) return { identityKey: key, businessId: null, eligibleIntro: true, reason: "eligible" };
  const redemption = await db.prepare(`
    SELECT business_id FROM business_insights_intro_redemptions WHERE business_id = ? LIMIT 1
  `).bind(businessId).first<{ business_id: string }>();
  return redemption
    ? { identityKey: key, businessId, eligibleIntro: false, reason: "intro_already_used" }
    : { identityKey: key, businessId, eligibleIntro: true, reason: "eligible" };
}

async function verifyGoogleBusiness(
  body: PurchaseRequestBody,
  env: InsightsPurchaseEnv,
  dependencies: InsightsPurchaseDependencies
): Promise<VerificationFailure | null> {
  if (!body.googlePlaceId) return null;

  const provider = dependencies.placesProvider || createGooglePlacesProvider();
  try {
    await provider.fetchSummary(body.googlePlaceId, env.GOOGLE_PLACES_API_KEY);
    return null;
  } catch (error) {
    const code = error instanceof GooglePlacesProviderError ? error.code : "provider_unavailable";
    console.warn(JSON.stringify({ message: "insights business verification failed", category: code }));
    if (code === "invalid_place_id" || code === "not_found") {
      return { status: 400, message: "Business location could not be verified." };
    }
    return { status: 503, message: "Business verification is temporarily unavailable. Please try again." };
  }
}

function offerPayload(env: InsightsPurchaseEnv, eligibility: EligibilityResolution, extra: Record<string, unknown> = {}) {
  return {
    offerKind: eligibility.eligibleIntro ? "intro" : "standard",
    introEligible: eligibility.eligibleIntro,
    reason: eligibility.reason,
    currency: "AUD",
    firstMonthMinor: eligibility.eligibleIntro ? INTRO_FIRST_MONTH_MINOR : STANDARD_MONTH_MINOR,
    recurringMinor: STANDARD_MONTH_MINOR,
    variantId: env.SHOPIFY_INSIGHTS_VARIANT_ID,
    sellingPlanId: env.SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID,
    ...extra
  };
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `TNTI-${[...bytes].map((part) => alphabet[part % alphabet.length]).join("")}`;
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function findOffer(db: D1Database, identityKeyValue: string): Promise<OfferRow | null> {
  return db.prepare(`
    SELECT id, identity_key, business_id, setup_id, discount_code, shopify_discount_node_id, status, expires_at
    FROM insights_intro_offers
    WHERE identity_key = ?
    LIMIT 1
  `).bind(identityKeyValue).first<OfferRow>();
}

function isUnexpiredIssued(row: OfferRow | null, now: Date): boolean {
  if (!row || row.status !== "issued" || !row.discount_code || !row.expires_at) return false;
  return Date.parse(row.expires_at) > now.getTime();
}

async function reserveOffer(
  db: D1Database,
  eligibility: EligibilityResolution,
  setupId: string,
  now: Date
): Promise<OfferRow> {
  const existing = await findOffer(db, eligibility.identityKey);
  if (existing) {
    await db.prepare(`
      UPDATE insights_intro_offers
      SET business_id = ?, setup_id = ?, status = 'creating', discount_code = NULL,
          shopify_discount_node_id = NULL, expires_at = NULL, updated_at = ?
      WHERE id = ?
    `).bind(eligibility.businessId, setupId, now.toISOString(), existing.id).run();
    return { ...existing, business_id: eligibility.businessId, setup_id: setupId, status: "creating", discount_code: null, shopify_discount_node_id: null, expires_at: null };
  }
  const id = randomId("offer");
  await db.prepare(`
    INSERT INTO insights_intro_offers (
      id, identity_key, business_id, setup_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'creating', ?, ?)
  `).bind(id, eligibility.identityKey, eligibility.businessId, setupId, now.toISOString(), now.toISOString()).run();
  return {
    id,
    identity_key: eligibility.identityKey,
    business_id: eligibility.businessId,
    setup_id: setupId,
    discount_code: null,
    shopify_discount_node_id: null,
    status: "creating",
    expires_at: null
  };
}

async function markOfferFailed(db: D1Database, id: string, now: Date): Promise<void> {
  await db.prepare(`
    UPDATE insights_intro_offers SET status = 'failed', updated_at = ? WHERE id = ?
  `).bind(now.toISOString(), id).run();
}

async function completeOffer(
  db: D1Database,
  id: string,
  result: IntroDiscountResult,
  expiresAt: string,
  now: Date
): Promise<void> {
  await db.prepare(`
    UPDATE insights_intro_offers
    SET status = 'issued', discount_code = ?, shopify_discount_node_id = ?, expires_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(result.code, result.nodeId, expiresAt, now.toISOString(), id).run();
}

export function createShopifyDiscountProvider(env: InsightsPurchaseEnv, fetcher: typeof fetch = fetch): ShopifyDiscountProvider {
  return {
    async createIntroDiscount(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        const endpoint = `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
        const query = `
          mutation CreateTapnTrustIntro($input: DiscountCodeBasicInput!) {
            discountCodeBasicCreate(basicCodeDiscount: $input) {
              codeDiscountNode { id }
              userErrors { field message code }
            }
          }
        `;
        const variables = {
          input: {
            title: input.title,
            code: input.code,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            customerSelection: { all: true },
            customerGets: {
              value: { discountAmount: { amount: INTRO_DISCOUNT_AMOUNT, appliesOnEachItem: false } },
              items: { products: { productVariantsToAdd: [input.variantId] } },
              appliesOnOneTimePurchase: false,
              appliesOnSubscription: true
            },
            appliesOncePerCustomer: true,
            recurringCycleLimit: 1,
            usageLimit: 1,
            combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true }
          }
        };
        const response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": await getShopifyAdminAccessToken({
              shopDomain: env.SHOPIFY_SHOP_DOMAIN,
              clientId: env.SHOPIFY_CLIENT_ID,
              clientSecret: env.SHOPIFY_CLIENT_SECRET
            })
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal
        });
        if (!response.ok) throw new ShopifyDiscountProviderError(`Shopify discount API returned ${response.status}`, "http_error");
        const payload = await response.json() as {
          errors?: Array<{ message?: string }>;
          data?: { discountCodeBasicCreate?: { codeDiscountNode?: { id?: string }; userErrors?: Array<{ message?: string }> } };
        };
        const topError = payload.errors?.[0]?.message;
        const mutation = payload.data?.discountCodeBasicCreate;
        const userError = mutation?.userErrors?.[0]?.message;
        const nodeId = clean(mutation?.codeDiscountNode?.id, 240);
        if (topError || userError || !nodeId) {
          throw new ShopifyDiscountProviderError(topError || userError || "Shopify did not create the intro discount", "graphql_error");
        }
        return { nodeId, code: input.code };
      } catch (error) {
        if (error instanceof ShopifyDiscountProviderError) throw error;
        const category = error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error";
        throw new ShopifyDiscountProviderError("Shopify intro discount creation failed", category);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export async function handleInsightsPurchaseRequest(
  request: Request,
  url: URL,
  env: InsightsPurchaseEnv,
  dependencies: InsightsPurchaseDependencies = {},
  nowFactory: () => Date = () => new Date()
): Promise<Response | null> {
  if (url.pathname !== "/api/storefront/insights/offer") return null;
  if (request.method === "OPTIONS") {
    if (!originAllowed(request, env)) return new Response(null, { status: 403, headers: responseHeaders(env) });
    return new Response(null, { status: 204, headers: responseHeaders(env) });
  }
  if (request.method !== "POST") return json(env, { error: "Method not allowed" }, 405);
  if (!originAllowed(request, env)) return json(env, { error: "Origin not allowed" }, 403);

  let bodyValue: unknown;
  try {
    bodyValue = await readJson(request);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid_request";
    return json(env, { error: reason }, reason === "body_too_large" ? 413 : 400);
  }
  const body = parseBody(bodyValue);
  if (!body) return json(env, { error: "Invalid offer request" }, 400);

  const verificationFailure = await verifyGoogleBusiness(body, env, dependencies);
  if (verificationFailure) {
    return json(env, { error: verificationFailure.message }, verificationFailure.status);
  }

  const eligibility = await resolveEligibility(env.DB, body);
  if (body.action === "quote" || !eligibility.eligibleIntro) {
    return json(env, offerPayload(env, eligibility));
  }

  const now = nowFactory();
  const existing = await findOffer(env.DB, eligibility.identityKey);
  if (isUnexpiredIssued(existing, now)) {
    return json(env, offerPayload(env, eligibility, {
      offerId: existing?.id,
      discountCode: existing?.discount_code,
      expiresAt: existing?.expires_at
    }));
  }
  if (existing?.status === "creating") {
    return json(env, { error: "Offer is being prepared. Please try again." }, 409);
  }

  const reservation = await reserveOffer(env.DB, eligibility, body.setupId || "", now);
  const code = randomCode();
  const expiresAt = new Date(now.getTime() + OFFER_TTL_MS).toISOString();
  const provider = dependencies.discountProvider || createShopifyDiscountProvider(env);
  try {
    const created = await provider.createIntroDiscount({
      code,
      title: `TapnTrust Insights first month ${reservation.id.slice(-8)}`,
      startsAt: now.toISOString(),
      endsAt: expiresAt,
      variantId: env.SHOPIFY_INSIGHTS_VARIANT_ID
    });
    await completeOffer(env.DB, reservation.id, created, expiresAt, now);
    return json(env, offerPayload(env, eligibility, {
      offerId: reservation.id,
      discountCode: created.code,
      expiresAt
    }));
  } catch (error) {
    await markOfferFailed(env.DB, reservation.id, now).catch(() => {});
    console.error(JSON.stringify({
      message: "insights intro offer provider failure",
      category: error instanceof ShopifyDiscountProviderError ? error.category : "unknown"
    }));
    return json(env, { error: "The A$1.99 intro offer could not be prepared right now. Please try again." }, 503);
  }
}
