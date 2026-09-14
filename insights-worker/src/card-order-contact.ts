import { storeOrderContact } from "./order-contact-repository";
import {
  SHOPIFY_ORDERS_PAID_TOPIC,
  SHOPIFY_WEBHOOK_MAX_BODY_BYTES,
  verifyShopifyWebhookHmac
} from "./shopify-webhook";

const PHYSICAL_ROLES = new Set(["Primary Card Package", "Extra NFC Card"]);

type ContactEnv = Env & {
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_SHOP_DOMAIN?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, limit = 200): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).trim();
  return cleaned && cleaned.length <= limit ? cleaned : null;
}

function cleanShop(value: string): string | null {
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(cleaned) ? cleaned : null;
}

function lineProperty(line: Record<string, unknown>, names: string[]): string | null {
  if (!Array.isArray(line.properties)) return null;
  for (const value of line.properties) {
    if (!isRecord(value)) continue;
    const name = cleanText(value.name ?? value.key, 100);
    if (name && names.includes(name)) return cleanText(value.value, 200);
  }
  return null;
}

function contactValue(payload: Record<string, unknown>): string | null {
  const customer = isRecord(payload.customer) ? payload.customer : null;
  const candidates = [payload.contact_email, payload.email, customer?.email];
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const candidate = value.trim().toLowerCase();
    if (candidate.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return candidate;
  }
  return null;
}

function setupReferences(payload: Record<string, unknown>): string[] {
  if (!Array.isArray(payload.line_items)) return [];
  const found = new Set<string>();
  for (const value of payload.line_items) {
    if (!isRecord(value)) continue;
    const role = lineProperty(value, ["_Item Role", "Item Role"]);
    if (!role || !PHYSICAL_ROLES.has(role)) continue;
    const setup = lineProperty(value, ["_Business Setup ID", "Business Setup ID"]);
    if (setup) found.add(setup);
  }
  return Array.from(found);
}

async function rawBody(request: Request<any, any>): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > SHOPIFY_WEBHOOK_MAX_BODY_BYTES || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > SHOPIFY_WEBHOOK_MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function capturePaidCardOrderContact(
  request: Request<any, any>,
  env: ContactEnv,
  now: Date = new Date()
): Promise<void> {
  if (request.method !== "POST") return;
  if (request.headers.get("X-Shopify-Topic") !== SHOPIFY_ORDERS_PAID_TOPIC) return;

  const expectedShop = cleanShop(env.SHOPIFY_SHOP_DOMAIN || "");
  const suppliedShop = cleanShop(request.headers.get("X-Shopify-Shop-Domain") || "");
  const secret = env.SHOPIFY_CLIENT_SECRET || "";
  if (!expectedShop || suppliedShop !== expectedShop || !secret) return;

  const body = await rawBody(request);
  const signature = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  if (!body || !signature || !(await verifyShopifyWebhookHmac(body, signature, secret))) return;

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return;
  }
  if (!isRecord(payload) || payload.test === true) return;

  const orderReference = cleanText(payload.name ?? payload.order_number ?? payload.id);
  const providerReference = cleanText(payload.admin_graphql_api_id ?? payload.id);
  const contact = contactValue(payload);
  const setups = setupReferences(payload);
  if (!orderReference || !providerReference || !contact || setups.length === 0) return;

  const observedAt = typeof payload.processed_at === "string" && !Number.isNaN(new Date(payload.processed_at).getTime())
    ? new Date(payload.processed_at).toISOString()
    : now.toISOString();

  await storeOrderContact(
    env.DB,
    orderReference,
    setups,
    providerReference,
    contact,
    observedAt,
    now.toISOString()
  );
}
