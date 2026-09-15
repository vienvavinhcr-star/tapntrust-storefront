import { getShopifyAdminAccessToken } from "./shopify-admin-token";
import { shopifyIdentifiersMatch, verifyShopifyWebhookHmac } from "./shopify-webhook";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const QUICK_GUIDE_TEMPLATE = "tapntrust-order-quick-setup";
const INSIGHTS_TEMPLATE = "tapntrust-insights-getting-started";
const QUICK_GUIDE_SENT_TAG = "quick-guide-sent";
const INSIGHTS_PROGRESS_TAG = "insight-progress";
const INSIGHTS_EMAIL_SENT_TAG = "insight-email-sent";
const SUBSCRIPTION_TAG = "subscription";

export interface OrderEmailAutomationEnv {
  RESEND_API_KEY?: string;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  SHOPIFY_SHOP_DOMAIN: string;
  SHOPIFY_ADMIN_API_VERSION: string;
  SHOPIFY_INSIGHTS_VARIANT_ID: string;
  EMAIL_AUTOMATION_CUTOFF?: string;
  QUICK_SETUP_GUIDE_URL?: string;
  USEFUL_GUIDE_URL?: string;
}

type OrderRecord = Record<string, unknown>;

export class OrderEmailAutomationError extends Error {
  constructor(
    public readonly code:
      | "method_not_allowed"
      | "body_too_large"
      | "missing_signature"
      | "invalid_signature"
      | "invalid_shop"
      | "invalid_topic"
      | "invalid_json"
      | "invalid_payload"
      | "configuration_error",
    public readonly status: 400 | 401 | 403 | 405 | 413 | 503
  ) {
    super(code);
    this.name = "OrderEmailAutomationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanShopDomain(value: string): string | null {
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(cleaned) ? cleaned : null;
}

function cleanIdentifier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).trim();
  return cleaned && cleaned.length <= 200 ? cleaned : null;
}

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function firstEmail(payload: OrderRecord): string | null {
  const customer = isRecord(payload.customer) ? payload.customer : null;
  return normaliseEmail(payload.contact_email)
    || normaliseEmail(payload.email)
    || normaliseEmail(customer?.email);
}

function orderTags(payload: OrderRecord): Set<string> {
  const raw = payload.tags;
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  return new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean));
}

function orderCreatedAt(payload: OrderRecord): Date | null {
  if (typeof payload.created_at !== "string") return null;
  const date = new Date(payload.created_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cutoffDate(env: OrderEmailAutomationEnv): Date | null {
  if (!env.EMAIL_AUTOMATION_CUTOFF) return null;
  const date = new Date(env.EMAIL_AUTOMATION_CUTOFF);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isEligibleByCutoff(payload: OrderRecord, env: OrderEmailAutomationEnv): boolean {
  const createdAt = orderCreatedAt(payload);
  const cutoff = cutoffDate(env);
  return Boolean(createdAt && cutoff && createdAt.getTime() >= cutoff.getTime());
}

function providerOrderReference(payload: OrderRecord): string | null {
  const graphqlId = cleanIdentifier(payload.admin_graphql_api_id);
  if (graphqlId && /^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(graphqlId)) return graphqlId;
  const id = cleanIdentifier(payload.id);
  return id && /^[A-Za-z0-9_-]+$/.test(id) ? `gid://shopify/Order/${id}` : null;
}

function orderHasInsightsVariant(payload: OrderRecord, configuredVariantId: string): boolean {
  if (!Array.isArray(payload.line_items)) return false;
  return payload.line_items.some((line) => (
    isRecord(line) && shopifyIdentifiersMatch(line.variant_id, configuredVariantId)
  ));
}

async function readVerifiedOrderWebhook(
  request: Request,
  env: OrderEmailAutomationEnv,
  expectedTopic: "orders/paid" | "orders/updated"
): Promise<OrderRecord> {
  if (request.method !== "POST") throw new OrderEmailAutomationError("method_not_allowed", 405);
  if (!env.SHOPIFY_CLIENT_SECRET || !cleanShopDomain(env.SHOPIFY_SHOP_DOMAIN)) {
    throw new OrderEmailAutomationError("configuration_error", 503);
  }

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new OrderEmailAutomationError("body_too_large", 413);
  }
  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new OrderEmailAutomationError("body_too_large", 413);
  }

  const suppliedHmac = request.headers.get("X-Shopify-Hmac-Sha256");
  if (!suppliedHmac) throw new OrderEmailAutomationError("missing_signature", 401);
  if (!(await verifyShopifyWebhookHmac(rawBody, suppliedHmac, env.SHOPIFY_CLIENT_SECRET))) {
    throw new OrderEmailAutomationError("invalid_signature", 401);
  }

  const expectedShop = cleanShopDomain(env.SHOPIFY_SHOP_DOMAIN);
  const suppliedShop = cleanShopDomain(request.headers.get("X-Shopify-Shop-Domain") || "");
  if (!expectedShop || suppliedShop !== expectedShop) {
    throw new OrderEmailAutomationError("invalid_shop", 403);
  }
  if (request.headers.get("X-Shopify-Topic") !== expectedTopic) {
    throw new OrderEmailAutomationError("invalid_topic", 403);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new OrderEmailAutomationError("invalid_json", 400);
  }
  if (!isRecord(payload) || !providerOrderReference(payload)) {
    throw new OrderEmailAutomationError("invalid_payload", 400);
  }
  return payload;
}

async function resendTemplate(
  env: OrderEmailAutomationEnv,
  input: {
    to: string;
    template: string;
    idempotencyKey: string;
    scheduledAt?: string;
    attachments?: Array<{ filename: string; path: string }>;
  }
): Promise<void> {
  if (!env.RESEND_API_KEY) throw new OrderEmailAutomationError("configuration_error", 503);
  const body: Record<string, unknown> = {
    from: "TapnTrust <contact@tapntrust.com>",
    to: [input.to],
    reply_to: "contact@tapntrust.com",
    template: { id: input.template }
  };
  if (input.scheduledAt) body.scheduled_at = input.scheduledAt;
  if (input.attachments?.length) body.attachments = input.attachments;

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`resend_${response.status}`);
}

async function addOrderTag(
  env: OrderEmailAutomationEnv,
  orderId: string,
  tag: string
): Promise<void> {
  const shopDomain = cleanShopDomain(env.SHOPIFY_SHOP_DOMAIN);
  if (!shopDomain || !/^\d{4}-(01|04|07|10)$/.test(env.SHOPIFY_ADMIN_API_VERSION)) {
    throw new OrderEmailAutomationError("configuration_error", 503);
  }
  const accessToken = await getShopifyAdminAccessToken({
    shopDomain,
    clientId: env.SHOPIFY_CLIENT_ID,
    clientSecret: env.SHOPIFY_CLIENT_SECRET
  });
  const response = await fetch(`https://${shopDomain}/admin/api/${env.SHOPIFY_ADMIN_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken
    },
    body: JSON.stringify({
      query: `mutation TapnTrustAddOrderTags($id: ID!, $tags: [String!]!) {\n  tagsAdd(id: $id, tags: $tags) {\n    userErrors { field message }\n  }\n}`,
      variables: { id: orderId, tags: [tag] }
    })
  });
  if (!response.ok) throw new Error(`shopify_tag_${response.status}`);
  const payload = await response.json() as { data?: { tagsAdd?: { userErrors?: Array<unknown> } }; errors?: Array<unknown> };
  if (payload.errors?.length || payload.data?.tagsAdd?.userErrors?.length) {
    throw new Error("shopify_tag_graphql_error");
  }
}

export async function processPaidOrderQuickGuide(
  request: Request,
  env: OrderEmailAutomationEnv,
  now: Date = new Date()
): Promise<"scheduled" | "ignored"> {
  const payload = await readVerifiedOrderWebhook(request, env, "orders/paid");
  if (!isEligibleByCutoff(payload, env)) return "ignored";
  const tags = orderTags(payload);
  if (tags.has(QUICK_GUIDE_SENT_TAG)) return "ignored";
  const email = firstEmail(payload);
  const orderId = providerOrderReference(payload);
  if (!email || !orderId) return "ignored";
  if (!env.QUICK_SETUP_GUIDE_URL || !env.USEFUL_GUIDE_URL) {
    console.warn(JSON.stringify({ event: "order_quick_guide_skipped", reason: "guide_urls_missing" }));
    return "ignored";
  }

  await resendTemplate(env, {
    to: email,
    template: QUICK_GUIDE_TEMPLATE,
    idempotencyKey: `quick-guide/${orderId}`,
    scheduledAt: new Date(now.getTime() + 2 * 60 * 1000).toISOString(),
    attachments: [
      { filename: "TapnTrust-Quick-Setup-Guide.pdf", path: env.QUICK_SETUP_GUIDE_URL },
      { filename: "TapnTrust-Useful-Guide.pdf", path: env.USEFUL_GUIDE_URL }
    ]
  });
  await addOrderTag(env, orderId, QUICK_GUIDE_SENT_TAG);
  console.log(JSON.stringify({ event: "order_quick_guide_scheduled", result: "scheduled" }));
  return "scheduled";
}

export async function handleUpdatedOrderInsightsEmail(
  request: Request,
  env: OrderEmailAutomationEnv
): Promise<Response> {
  try {
    const payload = await readVerifiedOrderWebhook(request, env, "orders/updated");
    if (!isEligibleByCutoff(payload, env)) return Response.json({ ok: true, result: "ignored_old_order" });
    const tags = orderTags(payload);
    if (!tags.has(SUBSCRIPTION_TAG)) return Response.json({ ok: true, result: "ignored_not_subscription" });
    if (!tags.has(INSIGHTS_PROGRESS_TAG)) return Response.json({ ok: true, result: "ignored_not_ready" });
    if (tags.has(INSIGHTS_EMAIL_SENT_TAG)) return Response.json({ ok: true, result: "duplicate" });
    if (!orderHasInsightsVariant(payload, env.SHOPIFY_INSIGHTS_VARIANT_ID)) {
      return Response.json({ ok: true, result: "ignored_no_insights_variant" });
    }

    const email = firstEmail(payload);
    const orderId = providerOrderReference(payload);
    if (!email || !orderId) return Response.json({ ok: true, result: "ignored_missing_email" });

    await resendTemplate(env, {
      to: email,
      template: INSIGHTS_TEMPLATE,
      idempotencyKey: `insight-welcome/${orderId}`
    });
    await addOrderTag(env, orderId, INSIGHTS_EMAIL_SENT_TAG);
    console.log(JSON.stringify({ event: "insights_welcome_email_sent", result: "sent" }));
    return Response.json({ ok: true, result: "sent" });
  } catch (error) {
    if (error instanceof OrderEmailAutomationError) {
      const headers = error.code === "method_not_allowed" ? { Allow: "POST" } : undefined;
      return Response.json(
        { error: error.code === "configuration_error" ? "Webhook unavailable" : "Webhook rejected" },
        { status: error.status, headers }
      );
    }
    console.error(JSON.stringify({ event: "insights_welcome_email_failed", reason: "internal_error" }));
    return Response.json({ error: "Webhook temporarily unavailable" }, { status: 503 });
  }
}
