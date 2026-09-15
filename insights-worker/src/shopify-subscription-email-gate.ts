import {
  handleOrdersUpdatedEmailAutomation,
  type ShopifyEmailAutomationDependencies,
  type ShopifyEmailAutomationEnv
} from "./shopify-email-automation";

const SUBSCRIPTION_TAG = "subscription";
const MAX_GATE_BODY_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

async function hasSubscriptionTag(request: Request): Promise<boolean | null> {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_GATE_BODY_BYTES) return null;

  try {
    const text = await request.clone().text();
    if (new TextEncoder().encode(text).byteLength > MAX_GATE_BODY_BYTES) return null;
    const payload: unknown = JSON.parse(text);
    if (!isRecord(payload)) return null;
    return parseTags(payload.tags).has(SUBSCRIPTION_TAG);
  } catch {
    return null;
  }
}

/**
 * TapnTrust's Shopify automation already tags every Insights subscription order
 * with `subscription`. Treat that tag as an additional business-level safety gate
 * before the verified Insights webhook handler performs its HMAC, product-variant,
 * progress and duplicate checks.
 *
 * Returning `ignored` when the tag is absent is intentional. If Shopify adds the
 * subscription tag after `insight-progress`, that tag change emits another
 * orders/updated webhook and the email can be sent on that later event.
 */
export async function handleSubscriptionInsightsOrderUpdated(
  request: Request,
  env: ShopifyEmailAutomationEnv,
  now: Date = new Date(),
  dependencies: ShopifyEmailAutomationDependencies = {}
): Promise<Response> {
  const subscriptionTagged = await hasSubscriptionTag(request);

  if (subscriptionTagged === false) {
    return Response.json({ ok: true, result: "ignored", reason: "not_subscription_order" });
  }

  // Invalid/unreadable bodies still flow to the real handler so it can reject
  // them using the canonical Shopify HMAC/body validation path.
  return handleOrdersUpdatedEmailAutomation(request, env, now, dependencies);
}

export const SHOPIFY_INSIGHTS_SUBSCRIPTION_TAG = SUBSCRIPTION_TAG;
