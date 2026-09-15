import {
  handleOrdersUpdatedEmailAutomation,
  type ShopifyEmailAutomationDependencies,
  type ShopifyEmailAutomationEnv
} from "./shopify-email-automation";
import { SHOPIFY_WEBHOOK_MAX_BODY_BYTES, verifyShopifyWebhookHmac } from "./shopify-webhook";

const SUBSCRIPTION_TAG = "subscription";
const ORDERS_UPDATED_TOPIC = "orders/updated";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanShopDomain(value: string): string | null {
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(cleaned) ? cleaned : null;
}

function parseTags(value: unknown): Set<string> {
  const tags = new Set<string>();
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  for (const candidate of values) {
    if (typeof candidate !== "string") continue;
    const tag = candidate.trim().toLowerCase();
    if (tag) tags.add(tag);
  }
  return tags;
}

async function verifiedSubscriptionTag(
  request: Request,
  env: ShopifyEmailAutomationEnv
): Promise<boolean | null> {
  const expectedShop = cleanShopDomain(env.SHOPIFY_SHOP_DOMAIN || "");
  const suppliedShop = cleanShopDomain(request.headers.get("X-Shopify-Shop-Domain") || "");
  const suppliedHmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const secret = env.SHOPIFY_CLIENT_SECRET || "";

  if (
    request.method !== "POST"
    || request.headers.get("X-Shopify-Topic") !== ORDERS_UPDATED_TOPIC
    || !expectedShop
    || suppliedShop !== expectedShop
    || !suppliedHmac
    || !secret
  ) {
    return null;
  }

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > SHOPIFY_WEBHOOK_MAX_BODY_BYTES) return null;

  try {
    const rawBody = new Uint8Array(await request.clone().arrayBuffer());
    if (rawBody.byteLength > SHOPIFY_WEBHOOK_MAX_BODY_BYTES) return null;
    if (!(await verifyShopifyWebhookHmac(rawBody, suppliedHmac, secret))) return null;

    const payload: unknown = JSON.parse(new TextDecoder().decode(rawBody));
    if (!isRecord(payload)) return null;
    return parseTags(payload.tags).has(SUBSCRIPTION_TAG);
  } catch {
    return null;
  }
}

/**
 * TapnTrust's Shopify automation already tags every Insights subscription order
 * with `subscription`. Treat that tag as an additional business-level safety gate.
 *
 * The gate only short-circuits after verifying the Shopify HMAC, shop and topic.
 * Invalid or unreadable requests are always delegated to the canonical webhook
 * handler so they receive the normal rejection response instead of a false 200.
 *
 * If Shopify adds `subscription` after `insight-progress`, that tag change emits
 * another orders/updated webhook and the welcome email can be sent on that event.
 */
export async function handleSubscriptionInsightsOrderUpdated(
  request: Request,
  env: ShopifyEmailAutomationEnv,
  now: Date = new Date(),
  dependencies: ShopifyEmailAutomationDependencies = {}
): Promise<Response> {
  const subscriptionTagged = await verifiedSubscriptionTag(request, env);

  if (subscriptionTagged === false) {
    return Response.json({ ok: true, result: "ignored", reason: "not_subscription_order" });
  }

  return handleOrdersUpdatedEmailAutomation(request, env, now, dependencies);
}

export const SHOPIFY_INSIGHTS_SUBSCRIPTION_TAG = SUBSCRIPTION_TAG;
