import { getShopifyAdminAccessToken } from "./shopify-admin-token";
import { shopifyIdentifiersMatch, SHOPIFY_WEBHOOK_MAX_BODY_BYTES, verifyShopifyWebhookHmac } from "./shopify-webhook";

const DEFAULT_AUTOMATION_CUTOFF = "2026-09-15T00:00:00+10:00";
const ORDERS_PAID_TOPIC = "orders/paid";
const ORDERS_UPDATED_TOPIC = "orders/updated";
const QUICK_GUIDE_TAG = "quick-guide-sent";
const INSIGHT_PROGRESS_TAG = "insight-progress";
const INSIGHT_EMAIL_SENT_TAG = "insight-email-sent";
const QUICK_GUIDE_TEMPLATE = "tapntrust-order-quick-setup";
const INSIGHTS_TEMPLATE = "tapntrust-insights-getting-started";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 5000;
const SHOPIFY_TIMEOUT_MS = 4000;
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const FROM_EMAIL = "TapnTrust <contact@tapntrust.com>";
const REPLY_TO_EMAIL = "contact@tapntrust.com";
const AUTOMATION_CUTOFF_MS = new Date(DEFAULT_AUTOMATION_CUTOFF).getTime();

type EmailKind = "quick_setup" | "insights_welcome";
type DeliveryState = "accepted" | "tagged";

export interface ShopifyEmailAutomationEnv {
  DB: D1Database;
  RESEND_API_KEY?: string;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  SHOPIFY_SHOP_DOMAIN: string;
  SHOPIFY_ADMIN_API_VERSION: string;
  SHOPIFY_INSIGHTS_VARIANT_ID: string;
  QUICK_SETUP_GUIDE_URL?: string;
  USEFUL_GUIDE_URL?: string;
}

export interface ShopifyEmailAutomationDependencies {
  fetcher?: typeof fetch;
  getAdminAccessToken?: typeof getShopifyAdminAccessToken;
}

export interface PaidEmailAutomationOutcome {
  result: "ignored" | "not_configured" | "scheduled" | "duplicate" | "reconciled" | "retry" | "rejected";
  retry: boolean;
}

interface VerifiedOrderEvent {
  topic: typeof ORDERS_PAID_TOPIC | typeof ORDERS_UPDATED_TOPIC;
  webhookId: string;
  providerOrderReference: string;
  createdAt: string;
  email: string | null;
  tags: Set<string>;
  testOrder: boolean;
  hasInsightsVariant: boolean;
}

interface StoredDelivery {
  state: DeliveryState;
  resendEmailId: string | null;
}

class ShopifyEmailWebhookError extends Error {
  constructor(
    public readonly code:
      | "method_not_allowed"
      | "body_too_large"
      | "missing_signature"
      | "invalid_signature"
      | "invalid_shop"
      | "invalid_topic"
      | "invalid_delivery"
      | "invalid_json"
      | "invalid_payload"
      | "configuration_error",
    public readonly status: 400 | 401 | 403 | 405 | 413 | 503
  ) {
    super(code);
    this.name = "ShopifyEmailWebhookError";
  }
}

class EmailProviderError extends Error {
  constructor(
    public readonly provider: "resend" | "shopify_admin",
    public readonly code: "configuration_error" | "request_failed" | "invalid_response",
    public readonly providerStatus: number | null = null
  ) {
    super(`${provider}:${code}`);
    this.name = "EmailProviderError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, maximumLength = 300): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).trim();
  return cleaned && cleaned.length <= maximumLength ? cleaned : null;
}

function cleanShopDomain(value: string): string | null {
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(cleaned) ? cleaned : null;
}

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function checkoutEmail(payload: Record<string, unknown>): string | null {
  const customer = isRecord(payload.customer) ? payload.customer : null;
  return normaliseEmail(payload.contact_email)
    || normaliseEmail(payload.email)
    || normaliseEmail(customer?.email);
}

function toOrderGid(value: unknown): string | null {
  const identifier = cleanText(value, 200);
  if (!identifier) return null;
  if (/^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(identifier)) return identifier;
  return /^[A-Za-z0-9_-]+$/.test(identifier) ? `gid://shopify/Order/${identifier}` : null;
}

function orderKey(orderGid: string): string {
  return orderGid.split("/").pop() || orderGid;
}

function normaliseTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseTags(value: unknown): Set<string> {
  const tags = new Set<string>();
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  for (const candidate of values) {
    const tag = cleanText(candidate, 120)?.toLowerCase();
    if (tag) tags.add(tag);
  }
  return tags;
}

function hasInsightsVariant(payload: Record<string, unknown>, configuredVariantId: string): boolean {
  if (!Array.isArray(payload.line_items)) return false;
  return payload.line_items.some((value) => {
    if (!isRecord(value)) return false;
    const variant = isRecord(value.variant) ? value.variant : null;
    return shopifyIdentifiersMatch(value.variant_id ?? variant?.id, configuredVariantId);
  });
}

function isAfterCutoff(event: VerifiedOrderEvent): boolean {
  return new Date(event.createdAt).getTime() >= AUTOMATION_CUTOFF_MS;
}

function publicHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function readRawBody(request: Request): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > SHOPIFY_WEBHOOK_MAX_BODY_BYTES) {
    throw new ShopifyEmailWebhookError("body_too_large", 413);
  }
  if (!request.body) throw new ShopifyEmailWebhookError("invalid_json", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > SHOPIFY_WEBHOOK_MAX_BODY_BYTES) {
      await reader.cancel();
      throw new ShopifyEmailWebhookError("body_too_large", 413);
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readVerifiedOrderEvent(
  request: Request,
  env: ShopifyEmailAutomationEnv,
  expectedTopic: typeof ORDERS_PAID_TOPIC | typeof ORDERS_UPDATED_TOPIC
): Promise<VerifiedOrderEvent> {
  if (request.method !== "POST") throw new ShopifyEmailWebhookError("method_not_allowed", 405);
  const expectedShop = cleanShopDomain(env.SHOPIFY_SHOP_DOMAIN || "");
  const secret = env.SHOPIFY_CLIENT_SECRET || "";
  if (!expectedShop || !secret || !cleanText(env.SHOPIFY_INSIGHTS_VARIANT_ID, 200)) {
    throw new ShopifyEmailWebhookError("configuration_error", 503);
  }

  const rawBody = await readRawBody(request);
  const signature = request.headers.get("X-Shopify-Hmac-Sha256");
  if (!signature) throw new ShopifyEmailWebhookError("missing_signature", 401);
  if (!(await verifyShopifyWebhookHmac(rawBody, signature, secret))) {
    throw new ShopifyEmailWebhookError("invalid_signature", 401);
  }

  const suppliedShop = cleanShopDomain(request.headers.get("X-Shopify-Shop-Domain") || "");
  if (!suppliedShop || suppliedShop !== expectedShop) throw new ShopifyEmailWebhookError("invalid_shop", 403);
  if (request.headers.get("X-Shopify-Topic") !== expectedTopic) {
    throw new ShopifyEmailWebhookError("invalid_topic", 403);
  }
  const webhookId = cleanText(request.headers.get("X-Shopify-Webhook-Id"), 200);
  if (!webhookId) throw new ShopifyEmailWebhookError("invalid_delivery", 400);

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new ShopifyEmailWebhookError("invalid_json", 400);
  }
  if (!isRecord(payload)) throw new ShopifyEmailWebhookError("invalid_payload", 400);

  const providerOrderReference = toOrderGid(payload.admin_graphql_api_id ?? payload.id);
  const createdAt = normaliseTimestamp(payload.created_at);
  if (!providerOrderReference || !createdAt) throw new ShopifyEmailWebhookError("invalid_payload", 400);

  return {
    topic: expectedTopic,
    webhookId,
    providerOrderReference,
    createdAt,
    email: checkoutEmail(payload),
    tags: parseTags(payload.tags),
    testOrder: payload.test === true,
    hasInsightsVariant: hasInsightsVariant(payload, env.SHOPIFY_INSIGHTS_VARIANT_ID)
  };
}

async function readBoundedProviderJson(
  response: Response,
  provider: "resend" | "shopify_admin"
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_PROVIDER_RESPONSE_BYTES || !response.body) {
    throw new EmailProviderError(provider, "invalid_response", response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new EmailProviderError(provider, "invalid_response", response.status);
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw new EmailProviderError(provider, "invalid_response", response.status);
  }
}

async function sendResendTemplate(
  env: ShopifyEmailAutomationEnv,
  event: VerifiedOrderEvent,
  kind: EmailKind,
  options: { scheduledAt?: string; attachments?: Array<{ filename: string; path: string }> },
  fetcher: typeof fetch
): Promise<string> {
  const apiKey = env.RESEND_API_KEY?.trim() || "";
  if (!apiKey || !event.email) throw new EmailProviderError("resend", "configuration_error");
  const template = kind === "quick_setup" ? QUICK_GUIDE_TEMPLATE : INSIGHTS_TEMPLATE;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  const payload: Record<string, unknown> = {
    from: FROM_EMAIL,
    to: [event.email],
    reply_to: [REPLY_TO_EMAIL],
    template: { id: template },
    tags: [{ name: "automation", value: kind }]
  };
  if (options.scheduledAt) payload.scheduled_at = options.scheduledAt;
  if (options.attachments?.length) payload.attachments = options.attachments;

  try {
    const response = await fetcher(RESEND_ENDPOINT, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `tapntrust/${kind}/${orderKey(event.providerOrderReference)}`
      },
      body: JSON.stringify(payload)
    });
    const raw = await readBoundedProviderJson(response, "resend");
    if (!response.ok) throw new EmailProviderError("resend", "request_failed", response.status);
    if (!isRecord(raw)) throw new EmailProviderError("resend", "invalid_response", response.status);
    const id = cleanText(raw.id, 200);
    if (!id) throw new EmailProviderError("resend", "invalid_response", response.status);
    return id;
  } catch (error) {
    if (error instanceof EmailProviderError) throw error;
    throw new EmailProviderError("resend", "request_failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function addOrderTag(
  env: ShopifyEmailAutomationEnv,
  event: VerifiedOrderEvent,
  tag: string,
  fetcher: typeof fetch,
  tokenProvider: typeof getShopifyAdminAccessToken
): Promise<void> {
  const shopDomain = cleanShopDomain(env.SHOPIFY_SHOP_DOMAIN || "");
  const apiVersion = env.SHOPIFY_ADMIN_API_VERSION?.trim() || "";
  if (!shopDomain || !/^\d{4}-(01|04|07|10)$/.test(apiVersion)) {
    throw new EmailProviderError("shopify_admin", "configuration_error");
  }
  const accessToken = await tokenProvider({
    shopDomain,
    clientId: env.SHOPIFY_CLIENT_ID,
    clientSecret: env.SHOPIFY_CLIENT_SECRET
  }, fetcher);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHOPIFY_TIMEOUT_MS);
  try {
    const response = await fetcher(`https://${shopDomain}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken
      },
      body: JSON.stringify({
        query: `mutation TapnTrustAddOrderTag($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            node { id }
            userErrors { message }
          }
        }`,
        variables: { id: event.providerOrderReference, tags: [tag] }
      })
    });
    const raw = await readBoundedProviderJson(response, "shopify_admin");
    if (!response.ok) throw new EmailProviderError("shopify_admin", "request_failed", response.status);
    if (!isRecord(raw) || (Array.isArray(raw.errors) ? raw.errors.length > 0 : raw.errors !== undefined)) {
      throw new EmailProviderError("shopify_admin", "invalid_response", response.status);
    }
    const data = isRecord(raw.data) ? raw.data : null;
    const mutation = data && isRecord(data.tagsAdd) ? data.tagsAdd : null;
    if (!mutation || !isRecord(mutation.node) || (Array.isArray(mutation.userErrors) && mutation.userErrors.length > 0)) {
      throw new EmailProviderError("shopify_admin", "invalid_response", response.status);
    }
  } catch (error) {
    if (error instanceof EmailProviderError) throw error;
    throw new EmailProviderError("shopify_admin", "request_failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function findDelivery(
  db: D1Database,
  providerOrderReference: string,
  emailKind: EmailKind
): Promise<StoredDelivery | null> {
  const row = await db.prepare(`
    SELECT state, resend_email_id
    FROM transactional_email_deliveries
    WHERE provider_order_reference = ?1 AND email_kind = ?2
    LIMIT 1
  `).bind(providerOrderReference, emailKind).first<{ state: DeliveryState; resend_email_id: string | null }>();
  if (!row || (row.state !== "accepted" && row.state !== "tagged")) return null;
  return { state: row.state, resendEmailId: row.resend_email_id };
}

async function recordAccepted(
  db: D1Database,
  providerOrderReference: string,
  emailKind: EmailKind,
  resendEmailId: string,
  now: string
): Promise<void> {
  await db.prepare(`
    INSERT INTO transactional_email_deliveries (
      id, provider_order_reference, email_kind, state, resend_email_id,
      accepted_at, tagged_at, created_at, updated_at
    ) VALUES (?1, ?2, ?3, 'accepted', ?4, ?5, NULL, ?5, ?5)
    ON CONFLICT(provider_order_reference, email_kind) DO UPDATE SET
      resend_email_id = COALESCE(transactional_email_deliveries.resend_email_id, excluded.resend_email_id),
      accepted_at = COALESCE(transactional_email_deliveries.accepted_at, excluded.accepted_at),
      updated_at = excluded.updated_at
  `).bind(crypto.randomUUID(), providerOrderReference, emailKind, resendEmailId, now).run();
}

async function markTagged(
  db: D1Database,
  providerOrderReference: string,
  emailKind: EmailKind,
  now: string
): Promise<void> {
  await db.prepare(`
    UPDATE transactional_email_deliveries
    SET state = 'tagged', tagged_at = COALESCE(tagged_at, ?3), updated_at = ?3
    WHERE provider_order_reference = ?1 AND email_kind = ?2
  `).bind(providerOrderReference, emailKind, now).run();
}

async function sendOrReconcile(
  env: ShopifyEmailAutomationEnv,
  event: VerifiedOrderEvent,
  kind: EmailKind,
  sentTag: string,
  options: { scheduledAt?: string; attachments?: Array<{ filename: string; path: string }> },
  dependencies: ShopifyEmailAutomationDependencies,
  now: Date
): Promise<PaidEmailAutomationOutcome> {
  const fetcher = dependencies.fetcher || fetch;
  const tokenProvider = dependencies.getAdminAccessToken || getShopifyAdminAccessToken;
  const existing = await findDelivery(env.DB, event.providerOrderReference, kind);
  if (existing?.state === "tagged" && event.tags.has(sentTag)) {
    return { result: "duplicate", retry: false };
  }

  if (!existing) {
    let emailId: string;
    try {
      emailId = await sendResendTemplate(env, event, kind, options, fetcher);
    } catch (error) {
      console.warn(JSON.stringify({
        event: "transactional_email_provider_failed",
        kind,
        orderReference: orderKey(event.providerOrderReference),
        provider: error instanceof EmailProviderError ? error.provider : "unknown",
        providerStatus: error instanceof EmailProviderError ? error.providerStatus : null
      }));
      return { result: "retry", retry: true };
    }
    try {
      await recordAccepted(env.DB, event.providerOrderReference, kind, emailId, now.toISOString());
    } catch {
      console.warn(JSON.stringify({
        event: "transactional_email_delivery_record_failed",
        kind,
        orderReference: orderKey(event.providerOrderReference)
      }));
    }
  }

  if (!event.tags.has(sentTag) || existing?.state !== "tagged") {
    try {
      await addOrderTag(env, event, sentTag, fetcher, tokenProvider);
      await markTagged(env.DB, event.providerOrderReference, kind, now.toISOString());
      return { result: existing ? "reconciled" : "scheduled", retry: false };
    } catch (error) {
      console.warn(JSON.stringify({
        event: "transactional_email_order_tag_failed",
        kind,
        orderReference: orderKey(event.providerOrderReference),
        providerStatus: error instanceof EmailProviderError ? error.providerStatus : null
      }));
      return { result: "retry", retry: true };
    }
  }

  return { result: existing ? "duplicate" : "scheduled", retry: false };
}

function webhookErrorResponse(error: ShopifyEmailWebhookError): Response {
  if (error.code === "method_not_allowed") {
    return Response.json({ error: "Method not allowed" }, { status: error.status, headers: { Allow: "POST" } });
  }
  return Response.json(
    { error: error.code === "configuration_error" ? "Webhook unavailable" : "Webhook rejected" },
    { status: error.status }
  );
}

export async function processPaidOrderEmailAutomation(
  request: Request,
  env: ShopifyEmailAutomationEnv,
  now: Date = new Date(),
  dependencies: ShopifyEmailAutomationDependencies = {}
): Promise<PaidEmailAutomationOutcome> {
  let event: VerifiedOrderEvent;
  try {
    event = await readVerifiedOrderEvent(request, env, ORDERS_PAID_TOPIC);
  } catch (error) {
    if (error instanceof ShopifyEmailWebhookError) return { result: "rejected", retry: false };
    return { result: "retry", retry: true };
  }

  if (event.testOrder || !isAfterCutoff(event) || !event.email || event.tags.has(QUICK_GUIDE_TAG)) {
    return { result: "ignored", retry: false };
  }
  const quickGuideUrl = publicHttpsUrl(env.QUICK_SETUP_GUIDE_URL);
  const usefulGuideUrl = publicHttpsUrl(env.USEFUL_GUIDE_URL);
  if (!env.RESEND_API_KEY?.trim() || !quickGuideUrl || !usefulGuideUrl) {
    console.warn(JSON.stringify({
      event: "transactional_email_not_configured",
      kind: "quick_setup",
      hasResendKey: Boolean(env.RESEND_API_KEY?.trim()),
      hasQuickGuideUrl: Boolean(quickGuideUrl),
      hasUsefulGuideUrl: Boolean(usefulGuideUrl)
    }));
    return { result: "not_configured", retry: false };
  }

  return sendOrReconcile(env, event, "quick_setup", QUICK_GUIDE_TAG, {
    scheduledAt: "in 2 min",
    attachments: [
      { filename: "TapnTrust-Quick-Setup-Guide.pdf", path: quickGuideUrl },
      { filename: "TapnTrust-Useful-Guide.pdf", path: usefulGuideUrl }
    ]
  }, dependencies, now);
}

export async function handleOrdersUpdatedEmailAutomation(
  request: Request,
  env: ShopifyEmailAutomationEnv,
  now: Date = new Date(),
  dependencies: ShopifyEmailAutomationDependencies = {}
): Promise<Response> {
  let event: VerifiedOrderEvent;
  try {
    event = await readVerifiedOrderEvent(request, env, ORDERS_UPDATED_TOPIC);
  } catch (error) {
    if (error instanceof ShopifyEmailWebhookError) return webhookErrorResponse(error);
    return Response.json({ error: "Webhook unavailable" }, { status: 500 });
  }

  if (
    event.testOrder
    || !isAfterCutoff(event)
    || !event.email
    || !event.tags.has(INSIGHT_PROGRESS_TAG)
    || event.tags.has(INSIGHT_EMAIL_SENT_TAG)
    || !event.hasInsightsVariant
  ) {
    return Response.json({ ok: true, result: "ignored" });
  }
  if (!env.RESEND_API_KEY?.trim()) {
    return Response.json({ error: "Webhook temporarily unavailable" }, { status: 503 });
  }

  const outcome = await sendOrReconcile(
    env,
    event,
    "insights_welcome",
    INSIGHT_EMAIL_SENT_TAG,
    {},
    dependencies,
    now
  );
  if (outcome.retry) return Response.json({ error: "Webhook temporarily unavailable" }, { status: 503 });
  return Response.json({ ok: true, result: outcome.result });
}

export const SHOPIFY_ORDERS_UPDATED_TOPIC = ORDERS_UPDATED_TOPIC;
export const TRANSACTIONAL_EMAIL_AUTOMATION_CUTOFF = DEFAULT_AUTOMATION_CUTOFF;
