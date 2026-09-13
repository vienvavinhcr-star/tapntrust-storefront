import { verifyShopifyWebhookHmac } from "./shopify-webhook";

const REFUNDS_CREATE_TOPIC = "refunds/create";
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const MAX_IDENTIFIER_LENGTH = 200;

export interface ShopifyRefundConfiguration {
  webhookSecret: string;
  shopDomain: string;
}

export interface NormalizedRefundLine {
  providerLineReference: string;
  amountMinor: number | null;
  currency: string | null;
}

export interface NormalizedShopifyRefund {
  webhookId: string;
  eventId: string | null;
  topic: typeof REFUNDS_CREATE_TOPIC;
  shopDomain: string;
  payloadHash: string;
  providerRefundReference: string;
  providerOrderReference: string;
  occurredAt: string;
  refundLines: NormalizedRefundLine[];
}

export class ShopifyRefundWebhookError extends Error {
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
    this.name = "ShopifyRefundWebhookError";
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

function cleanShopDomain(value: string): string | null {
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(cleaned) ? cleaned : null;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decimalMoneyToMinor(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  const match = text.match(/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] || "").padEnd(2, "0"));
  const result = whole * 100 + fraction;
  return Number.isSafeInteger(result) ? result : null;
}

async function readBoundedRawBody(request: Request): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new ShopifyRefundWebhookError("body_too_large", 413);
  }
  if (!request.body) throw new ShopifyRefundWebhookError("invalid_json", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > MAX_WEBHOOK_BODY_BYTES) {
      await reader.cancel();
      throw new ShopifyRefundWebhookError("body_too_large", 413);
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

function normaliseOccurredAt(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const parsedFallback = new Date(fallback);
  return Number.isNaN(parsedFallback.getTime()) ? new Date().toISOString() : parsedFallback.toISOString();
}

function normaliseRefundLine(value: unknown): NormalizedRefundLine | null {
  if (!isRecord(value)) return null;
  const lineItem = isRecord(value.line_item) ? value.line_item : null;
  const providerLineReference = cleanIdentifier(
    lineItem?.admin_graphql_api_id ?? value.line_item_id ?? lineItem?.id
  );
  if (!providerLineReference) return null;

  const subtotalSet = isRecord(value.subtotal_set) ? value.subtotal_set : null;
  const shopMoney = subtotalSet && isRecord(subtotalSet.shop_money) ? subtotalSet.shop_money : null;
  const amountMinor = decimalMoneyToMinor(shopMoney?.amount ?? value.subtotal);
  const currency = cleanIdentifier(shopMoney?.currency_code, 3)?.toUpperCase() || null;
  return {
    providerLineReference,
    amountMinor,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null
  };
}

export async function readShopifyRefundCreatedWebhook(
  request: Request,
  configuration: ShopifyRefundConfiguration,
  receivedAt: string
): Promise<NormalizedShopifyRefund> {
  if (request.method !== "POST") throw new ShopifyRefundWebhookError("method_not_allowed", 405);
  const expectedShop = cleanShopDomain(configuration.shopDomain);
  if (!configuration.webhookSecret || !expectedShop) {
    throw new ShopifyRefundWebhookError("configuration_error", 503);
  }

  const rawBody = await readBoundedRawBody(request);
  const hmac = request.headers.get("X-Shopify-Hmac-Sha256");
  if (!hmac) throw new ShopifyRefundWebhookError("missing_signature", 401);
  if (!(await verifyShopifyWebhookHmac(rawBody, hmac, configuration.webhookSecret))) {
    throw new ShopifyRefundWebhookError("invalid_signature", 401);
  }

  const suppliedShop = cleanShopDomain(request.headers.get("X-Shopify-Shop-Domain") || "");
  if (suppliedShop !== expectedShop) throw new ShopifyRefundWebhookError("invalid_shop", 403);
  if (request.headers.get("X-Shopify-Topic") !== REFUNDS_CREATE_TOPIC) {
    throw new ShopifyRefundWebhookError("invalid_topic", 403);
  }
  const webhookId = cleanIdentifier(request.headers.get("X-Shopify-Webhook-Id"));
  const eventId = cleanIdentifier(request.headers.get("X-Shopify-Event-Id"));
  if (!webhookId) throw new ShopifyRefundWebhookError("invalid_delivery", 400);

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new ShopifyRefundWebhookError("invalid_json", 400);
  }
  if (!isRecord(payload)) throw new ShopifyRefundWebhookError("invalid_payload", 400);

  const providerRefundReference = cleanIdentifier(payload.admin_graphql_api_id ?? payload.id);
  const providerOrderReference = cleanIdentifier(payload.order_id);
  if (!providerRefundReference || !providerOrderReference) {
    throw new ShopifyRefundWebhookError("invalid_payload", 400);
  }
  const refundLines = Array.isArray(payload.refund_line_items)
    ? payload.refund_line_items.flatMap((line) => {
        const normalized = normaliseRefundLine(line);
        return normalized ? [normalized] : [];
      })
    : [];

  const digestBody = new Uint8Array(rawBody.byteLength);
  digestBody.set(rawBody);
  const payloadHash = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", digestBody.buffer)));

  return {
    webhookId,
    eventId,
    topic: REFUNDS_CREATE_TOPIC,
    shopDomain: expectedShop,
    payloadHash,
    providerRefundReference,
    providerOrderReference,
    occurredAt: normaliseOccurredAt(payload.created_at, request.headers.get("X-Shopify-Triggered-At") || receivedAt),
    refundLines
  };
}

export const SHOPIFY_REFUNDS_CREATE_TOPIC = REFUNDS_CREATE_TOPIC;
