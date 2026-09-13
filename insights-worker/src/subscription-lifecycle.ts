import { hashToken, readSessionToken } from "./auth";
import {
  completeShopifyWebhookReceipt,
  reserveShopifyWebhookReceipt
} from "./billing-repository";
import { createCustomerRepository, type CustomerSession } from "./customer-repository";
import {
  createShopifyAdminProvider,
  ShopifyAdminProviderError,
  type ShopifyAdminProvider
} from "./shopify-admin";
import { shopifyIdentifiersMatch } from "./shopify-webhook";
import {
  readShopifyRefundCreatedWebhook,
  ShopifyRefundWebhookError
} from "./shopify-refund-webhook";
import {
  CANCELLATION_REASONS,
  confirmCancellationRequest,
  createCancellationRequest,
  findBillingEventForProviderLine,
  getCustomerBillingStatus,
  processLifecycleBatch,
  recordRefundObserved,
  withdrawCancellationRequest,
  type CancellationReason
} from "./subscription-lifecycle-repository";

const CUSTOMER_BILLING_BODY_BYTES = 2048;
const CANCELLATION_NOTE_MAX_LENGTH = 800;
const LOCATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface SubscriptionLifecycleEnv {
  DB: D1Database;
  AUTH_BASE_URL: string;
  SHOPIFY_WEBHOOK_SECRET: string;
  SHOPIFY_SHOP_DOMAIN: string;
  SHOPIFY_INSIGHTS_VARIANT_ID: string;
  SHOPIFY_INSIGHTS_INTRO_SELLING_PLAN_ID: string;
  SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID: string;
  SHOPIFY_ADMIN_API_ACCESS_TOKEN: string;
  SHOPIFY_ADMIN_API_VERSION: string;
}

export interface SubscriptionLifecycleDependencies {
  shopifyAdminProvider?: ShopifyAdminProvider;
  now?: () => Date;
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff"
};

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(data, { status, headers: { ...SECURITY_HEADERS, ...extraHeaders } });
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", { status: 405, headers: { ...SECURITY_HEADERS, Allow: allow } });
}

function hasJsonContentType(request: Request): boolean {
  return (request.headers.get("Content-Type") || "").split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function expectedOrigin(env: SubscriptionLifecycleEnv): string | null {
  try {
    const url = new URL(env.AUTH_BASE_URL);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

function hasExpectedOrigin(request: Request, env: SubscriptionLifecycleEnv): boolean {
  const expected = expectedOrigin(env);
  return Boolean(expected && request.headers.get("Origin") === expected);
}

async function readBoundedJson(request: Request, limit: number): Promise<{ value?: unknown; status?: 400 | 413 }> {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > limit || !request.body) return { status: declared > limit ? 413 : 400 };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > limit) {
      await reader.cancel();
      return { status: 413 };
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { status: 400 };
  }
}

async function authenticateCustomer(
  request: Request,
  env: SubscriptionLifecycleEnv,
  now: string
): Promise<CustomerSession | null> {
  const rawToken = readSessionToken(request);
  if (!rawToken) return null;
  return createCustomerRepository(env.DB).findActiveSession(await hashToken(rawToken), now);
}

function parseCancellationBody(value: unknown): {
  locationId: string;
  reason: CancellationReason;
  note: string | null;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(["locationId", "reason", "note"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return null;
  const locationId = typeof record.locationId === "string" ? record.locationId.trim() : "";
  const reason = typeof record.reason === "string" ? record.reason.trim() as CancellationReason : null;
  const note = typeof record.note === "string" ? record.note.trim() : "";
  if (!LOCATION_ID_PATTERN.test(locationId) || !reason || !CANCELLATION_REASONS.has(reason)) return null;
  if (note.length > CANCELLATION_NOTE_MAX_LENGTH || CONTROL_CHARACTER_PATTERN.test(note)) return null;
  return { locationId, reason, note: note || null };
}

async function cancellationContext(
  db: D1Database,
  businessId: string,
  locationId: string
): Promise<{ businessName: string; locationName: string } | null> {
  const row = await db.prepare(`
    SELECT b.name AS business_name, l.business_address, l.business_name AS location_business_name
    FROM businesses b
    JOIN locations l ON l.business_id = b.id
    WHERE b.id = ?1 AND l.id = ?2
    LIMIT 1
  `).bind(businessId, locationId).first<{
    business_name: string;
    business_address: string;
    location_business_name: string;
  }>();
  if (!row) return null;
  return {
    businessName: row.business_name,
    locationName: row.business_address || row.location_business_name || row.business_name
  };
}

export async function handleCustomerBillingRequest(
  request: Request,
  url: URL,
  env: SubscriptionLifecycleEnv,
  dependencies: SubscriptionLifecycleDependencies = {}
): Promise<Response | null> {
  if (
    url.pathname !== "/api/customer/billing/status"
    && url.pathname !== "/api/customer/billing/cancellation-request"
  ) return null;

  const now = (dependencies.now || (() => new Date()))().toISOString();
  const customer = await authenticateCustomer(request, env, now);
  if (!customer) return json({ error: "Unauthorized" }, 401);

  if (url.pathname === "/api/customer/billing/status") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const locationId = url.searchParams.get("locationId")?.trim() || "";
    if (!LOCATION_ID_PATTERN.test(locationId)) return json({ error: "Not found" }, 404);
    const status = await getCustomerBillingStatus(env.DB, customer.id, locationId);
    return status ? json({ status }) : json({ error: "Not found" }, 404);
  }

  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!hasExpectedOrigin(request, env)) return json({ error: "Request not allowed" }, 403);
  if (!hasJsonContentType(request)) return json({ error: "Content-Type must be application/json" }, 415);
  const body = await readBoundedJson(request, CUSTOMER_BILLING_BODY_BYTES);
  if (body.status === 413) return json({ error: "Request body too large" }, 413);
  if (body.status === 400) return json({ error: "Invalid JSON" }, 400);
  const parsed = parseCancellationBody(body.value);
  if (!parsed) return json({ error: "Invalid cancellation request" }, 400);

  const cancellation = await createCancellationRequest(env.DB, {
    userId: customer.id,
    userEmail: customer.email,
    locationId: parsed.locationId,
    reason: parsed.reason,
    note: parsed.note,
    now
  });
  if (!cancellation) return json({ error: "Subscription not found" }, 404);
  const context = await cancellationContext(env.DB, cancellation.businessId, cancellation.locationId);
  if (!context) return json({ error: "Subscription context unavailable" }, 409);

  return json({
    request: {
      id: cancellation.id,
      status: cancellation.status,
      customerEmail: cancellation.customerEmail,
      businessName: context.businessName,
      locationName: context.locationName,
      reason: cancellation.reason,
      note: cancellation.note,
      createdAt: cancellation.createdAt
    }
  }, 202);
}

export async function handleAdminSubscriptionLifecycleRequest(
  request: Request,
  pathname: string,
  db: D1Database,
  nowFactory: () => Date = () => new Date()
): Promise<Response | null> {
  const match = pathname.match(/^\/api\/admin\/billing\/cancellation-requests\/([^/]+)\/(confirm|withdraw)$/);
  if (!match) return null;
  if (request.method !== "POST") return methodNotAllowed("POST");
  let requestId = "";
  try {
    requestId = decodeURIComponent(match[1] || "");
  } catch {
    return json({ error: "Not found" }, 404);
  }
  if (!REQUEST_ID_PATTERN.test(requestId)) return json({ error: "Not found" }, 404);
  const now = nowFactory().toISOString();
  const result = match[2] === "confirm"
    ? await confirmCancellationRequest(db, requestId, now)
    : await withdrawCancellationRequest(db, requestId, now);
  return result ? json({ request: result }) : json({ error: "Request not found or not actionable" }, 404);
}

function toOrderGid(value: string): string {
  return value.startsWith("gid://shopify/Order/") ? value : `gid://shopify/Order/${value}`;
}

export async function handleShopifyRefundCreatedWebhook(
  request: Request,
  env: SubscriptionLifecycleEnv,
  nowFactory: () => Date = () => new Date(),
  dependencies: SubscriptionLifecycleDependencies = {}
): Promise<Response> {
  const now = nowFactory().toISOString();
  try {
    const refund = await readShopifyRefundCreatedWebhook(request, {
      webhookSecret: env.SHOPIFY_WEBHOOK_SECRET,
      shopDomain: env.SHOPIFY_SHOP_DOMAIN
    }, now);
    const reservation = await reserveShopifyWebhookReceipt(env.DB, {
      webhookId: refund.webhookId,
      eventId: refund.eventId,
      topic: refund.topic,
      shopDomain: refund.shopDomain,
      payloadHash: refund.payloadHash,
      receivedAt: now
    });
    if (reservation.payloadConflict) {
      await completeShopifyWebhookReceipt(env.DB, reservation.receiptWebhookId, "payload_conflict", now);
      return json({ ok: true, result: "review" });
    }
    if (reservation.alreadyProcessed) return json({ ok: true, result: "duplicate" });
    if (refund.refundLines.length === 0) {
      await completeShopifyWebhookReceipt(env.DB, reservation.receiptWebhookId, "ignored", now);
      return json({ ok: true, result: "ignored" });
    }

    const provider = dependencies.shopifyAdminProvider || createShopifyAdminProvider({
      shopDomain: env.SHOPIFY_SHOP_DOMAIN,
      accessToken: env.SHOPIFY_ADMIN_API_ACCESS_TOKEN,
      apiVersion: env.SHOPIFY_ADMIN_API_VERSION
    });
    const providerOrderReference = toOrderGid(refund.providerOrderReference);
    const authoritative = await provider.getOrderBillingLines(providerOrderReference);
    let observed = 0;
    let unresolvedInsightsSource = false;
    for (const refundLine of refund.refundLines) {
      const providerLine = authoritative.find((candidate) => (
        shopifyIdentifiersMatch(candidate.providerLineReference, refundLine.providerLineReference)
        && shopifyIdentifiersMatch(candidate.variantId, env.SHOPIFY_INSIGHTS_VARIANT_ID)
        && (
          shopifyIdentifiersMatch(candidate.sellingPlanId, env.SHOPIFY_INSIGHTS_INTRO_SELLING_PLAN_ID)
          || shopifyIdentifiersMatch(candidate.sellingPlanId, env.SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID)
        )
      ));
      if (!providerLine) continue;
      const source = await findBillingEventForProviderLine(
        env.DB,
        providerOrderReference,
        providerLine.providerLineReference
      );
      if (!source) {
        // An authoritative Insights refund can race ahead of orders/paid processing.
        // Leave this receipt unprocessed so Shopify can retry after the paid event lands.
        unresolvedInsightsSource = true;
        continue;
      }
      const inserted = await recordRefundObserved(env.DB, {
        subscriptionId: source.subscriptionId,
        sourceBillingEventId: source.billingEventId,
        refundReference: refund.providerRefundReference,
        providerLineReference: providerLine.providerLineReference,
        amountMinor: refundLine.amountMinor,
        currency: refundLine.currency,
        occurredAt: refund.occurredAt,
        now
      });
      if (inserted) observed += 1;
    }
    if (unresolvedInsightsSource) {
      console.warn(JSON.stringify({ event: "shopify_refund_source_pending" }));
      return json({ error: "Webhook temporarily unavailable" }, 503);
    }
    const result = observed > 0 ? "review" : "ignored";
    await completeShopifyWebhookReceipt(env.DB, reservation.receiptWebhookId, result, now);
    console.log(JSON.stringify({ event: "shopify_refund_observed", result, matchedLines: observed }));
    return json({ ok: true, result });
  } catch (error) {
    if (error instanceof ShopifyRefundWebhookError) {
      console.warn(JSON.stringify({ event: "shopify_refund_rejected", reason: error.code }));
      if (error.code === "method_not_allowed") return json({ error: "Method not allowed" }, error.status, { Allow: "POST" });
      return json({ error: error.code === "configuration_error" ? "Webhook unavailable" : "Webhook rejected" }, error.status);
    }
    if (error instanceof ShopifyAdminProviderError) {
      console.warn(JSON.stringify({
        event: "shopify_refund_lookup_failed",
        reason: error.code,
        providerStatus: error.providerStatus
      }));
      return json({ error: "Webhook temporarily unavailable" }, 503);
    }
    console.error(JSON.stringify({ event: "shopify_refund_failed", reason: "internal_error" }));
    return json({ error: "Webhook unavailable" }, 500);
  }
}

export async function runSubscriptionLifecycle(
  db: D1Database,
  nowFactory: () => Date = () => new Date()
) {
  const now = nowFactory().toISOString();
  const result = await processLifecycleBatch(db, now, 100);
  console.log(JSON.stringify({
    event: "subscription_lifecycle_batch",
    scanned: result.scanned,
    graceStarted: result.graceStarted,
    expired: result.expired,
    cancelled: result.cancelled,
    failed: result.failed
  }));
  return result;
}
