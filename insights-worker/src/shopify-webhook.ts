const ORDERS_PAID_TOPIC = "orders/paid";
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const MAX_IDENTIFIER_LENGTH = 200;

export type ShopifyPlanCode = "intro" | "standard";

export interface ShopifyBillingConfiguration {
  webhookSecret: string;
  shopDomain: string;
  insightsVariantId: string;
  introSellingPlanId: string;
  standardSellingPlanId: string;
}

export interface NormalizedShopifyBillingLine {
  providerLineReference: string;
  externalSetupReference: string | null;
  amountMinor: number;
  currency: string;
  moneyValid: boolean;
}

export interface NormalizedShopifyPaidOrder {
  webhookId: string;
  eventId: string | null;
  topic: typeof ORDERS_PAID_TOPIC;
  shopDomain: string;
  payloadHash: string;
  providerOrderReference: string;
  externalOrderReference: string;
  providerCustomerReference: string | null;
  billingEmail: string | null;
  occurredAt: string;
  testOrder: boolean;
  billingLines: NormalizedShopifyBillingLine[];
}

export class ShopifyWebhookError extends Error {
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
    this.name = "ShopifyWebhookError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanIdentifier(value: unknown, maximumLength = MAX_IDENTIFIER_LENGTH): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).trim();
  return cleaned && cleaned.length <= maximumLength ? cleaned : null;
}

function canonicalShopifyId(value: unknown): string | null {
  const identifier = cleanIdentifier(value);
  if (!identifier) return null;
  const suffix = identifier.match(/(?:^|\/)([^/]+)$/)?.[1] || identifier;
  return /^[A-Za-z0-9_-]+$/.test(suffix) ? suffix : null;
}

export function shopifyIdentifiersMatch(value: unknown, configured: string): boolean {
  const left = canonicalShopifyId(value);
  const right = canonicalShopifyId(configured);
  return Boolean(left && right && left === right);
}

function isConfiguredShopifyId(value: string): boolean {
  return Boolean(canonicalShopifyId(value)) && !/^REPLACE_WITH_/i.test(value.trim());
}

function cleanShopDomain(value: string): string | null {
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(cleaned) ? cleaned : null;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function verifyShopifyWebhookHmac(
  rawBody: Uint8Array,
  suppliedHmac: string,
  webhookSecret: string
): Promise<boolean> {
  const bodyBuffer = new Uint8Array(rawBody.byteLength);
  bodyBuffer.set(rawBody);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, bodyBuffer.buffer));
  const supplied = decodeBase64(suppliedHmac) || new Uint8Array();
  return constantTimeEqual(supplied, expected);
}

async function readBoundedRawBody(request: Request): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new ShopifyWebhookError("body_too_large", 413);
  }
  if (!request.body) throw new ShopifyWebhookError("invalid_json", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > MAX_WEBHOOK_BODY_BYTES) {
      await reader.cancel();
      throw new ShopifyWebhookError("body_too_large", 413);
    }
    chunks.push(chunk.value);
  }

  const rawBody = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return rawBody;
}

export function decimalMoneyToMinor(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  const match = text.match(/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] || "").padEnd(2, "0"));
  const result = whole * 100 + fraction;
  return Number.isSafeInteger(result) ? result : null;
}

function lineProperty(line: Record<string, unknown>, keys: string[]): string | null {
  if (!Array.isArray(line.properties)) return null;
  for (const property of line.properties) {
    if (!isRecord(property)) continue;
    const name = cleanIdentifier(property.name ?? property.key, 100);
    if (name && keys.includes(name)) return cleanIdentifier(property.value, 200);
  }
  return null;
}

function lineMoney(line: Record<string, unknown>, orderCurrency: string): { amountMinor: number; currency: string } | null {
  const priceSet = isRecord(line.price_set) ? line.price_set : null;
  const shopMoney = priceSet && isRecord(priceSet.shop_money) ? priceSet.shop_money : null;
  const unitPrice = decimalMoneyToMinor(shopMoney?.amount ?? line.price);
  const discount = decimalMoneyToMinor(line.total_discount ?? "0.00");
  const quantity = Number(line.quantity ?? line.current_quantity ?? 1);
  const currency = cleanIdentifier(shopMoney?.currency_code ?? orderCurrency, 3)?.toUpperCase() || "";
  if (
    unitPrice === null
    || discount === null
    || !Number.isSafeInteger(quantity)
    || quantity < 1
    || quantity > 100
    || !/^[A-Z]{3}$/.test(currency)
    || currency !== orderCurrency
  ) return null;
  const amountMinor = unitPrice * quantity - discount;
  return Number.isSafeInteger(amountMinor) && amountMinor >= 0 ? { amountMinor, currency } : null;
}

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function firstNormalisedEmail(...values: unknown[]): string | null {
  for (const value of values) {
    const email = normaliseEmail(value);
    if (email) return email;
  }
  return null;
}

function normaliseOccurredAt(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const parsedFallback = new Date(fallback);
  return Number.isNaN(parsedFallback.getTime()) ? new Date().toISOString() : parsedFallback.toISOString();
}

function normaliseLine(
  value: unknown,
  orderCurrency: string,
  configuration: ShopifyBillingConfiguration
): NormalizedShopifyBillingLine | null {
  if (!isRecord(value) || !shopifyIdentifiersMatch(value.variant_id, configuration.insightsVariantId)) return null;
  const providerLineReference = cleanIdentifier(value.admin_graphql_api_id ?? value.id);
  if (!providerLineReference) return null;
  const money = lineMoney(value, orderCurrency);
  return {
    providerLineReference,
    externalSetupReference: lineProperty(value, ["_Business Setup ID", "Business Setup ID"]),
    amountMinor: money?.amountMinor ?? 0,
    currency: money?.currency || orderCurrency,
    moneyValid: Boolean(money)
  };
}

export async function readShopifyOrdersPaidWebhook(
  request: Request,
  configuration: ShopifyBillingConfiguration,
  receivedAt: string
): Promise<NormalizedShopifyPaidOrder> {
  if (request.method !== "POST") throw new ShopifyWebhookError("method_not_allowed", 405);
  if (
    !configuration.webhookSecret
    || !cleanShopDomain(configuration.shopDomain)
    || !isConfiguredShopifyId(configuration.insightsVariantId)
    || !isConfiguredShopifyId(configuration.introSellingPlanId)
    || !isConfiguredShopifyId(configuration.standardSellingPlanId)
    || shopifyIdentifiersMatch(configuration.introSellingPlanId, configuration.standardSellingPlanId)
  ) {
    throw new ShopifyWebhookError("configuration_error", 503);
  }

  const rawBody = await readBoundedRawBody(request);
  const hmac = request.headers.get("X-Shopify-Hmac-Sha256");
  if (!hmac) throw new ShopifyWebhookError("missing_signature", 401);
  if (!(await verifyShopifyWebhookHmac(rawBody, hmac, configuration.webhookSecret))) {
    throw new ShopifyWebhookError("invalid_signature", 401);
  }

  const expectedShop = cleanShopDomain(configuration.shopDomain);
  const suppliedShop = cleanShopDomain(request.headers.get("X-Shopify-Shop-Domain") || "");
  if (!expectedShop || suppliedShop !== expectedShop) throw new ShopifyWebhookError("invalid_shop", 403);
  if (request.headers.get("X-Shopify-Topic") !== ORDERS_PAID_TOPIC) {
    throw new ShopifyWebhookError("invalid_topic", 403);
  }
  const webhookId = cleanIdentifier(request.headers.get("X-Shopify-Webhook-Id"));
  const eventId = cleanIdentifier(request.headers.get("X-Shopify-Event-Id"));
  if (!webhookId) throw new ShopifyWebhookError("invalid_delivery", 400);

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new ShopifyWebhookError("invalid_json", 400);
  }
  if (!isRecord(payload)) throw new ShopifyWebhookError("invalid_payload", 400);

  const providerOrderReference = cleanIdentifier(payload.admin_graphql_api_id ?? payload.id);
  const externalOrderReference = cleanIdentifier(payload.name ?? payload.order_number ?? payload.id);
  const orderCurrency = cleanIdentifier(payload.currency, 3)?.toUpperCase() || "";
  if (!providerOrderReference || !externalOrderReference || !/^[A-Z]{3}$/.test(orderCurrency)) {
    throw new ShopifyWebhookError("invalid_payload", 400);
  }

  const customer = isRecord(payload.customer) ? payload.customer : null;
  const providerCustomerReference = cleanIdentifier(customer?.admin_graphql_api_id ?? customer?.id);
  const billingEmail = firstNormalisedEmail(payload.contact_email, payload.email, customer?.email);
  const billingLines = Array.isArray(payload.line_items)
    ? payload.line_items.flatMap((line) => {
        const normalized = normaliseLine(line, orderCurrency, configuration);
        return normalized ? [normalized] : [];
      })
    : [];
  const digestBody = new Uint8Array(rawBody.byteLength);
  digestBody.set(rawBody);
  const payloadHash = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", digestBody.buffer)));

  return {
    webhookId,
    eventId,
    topic: ORDERS_PAID_TOPIC,
    shopDomain: expectedShop,
    payloadHash,
    providerOrderReference,
    externalOrderReference,
    providerCustomerReference,
    billingEmail,
    occurredAt: normaliseOccurredAt(payload.processed_at, request.headers.get("X-Shopify-Triggered-At") || receivedAt),
    testOrder: payload.test === true,
    billingLines
  };
}

export const SHOPIFY_ORDERS_PAID_TOPIC = ORDERS_PAID_TOPIC;
export const SHOPIFY_WEBHOOK_MAX_BODY_BYTES = MAX_WEBHOOK_BODY_BYTES;
