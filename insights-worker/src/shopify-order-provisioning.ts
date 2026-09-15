import { provisionPhysicalCards } from "./provisioning-repository";
import { normaliseGoogleReviewUrl, type ProvisioningIntent, type ProvisioningManifest } from "./provisioning";
import {
  SHOPIFY_ORDERS_PAID_TOPIC,
  SHOPIFY_WEBHOOK_MAX_BODY_BYTES,
  verifyShopifyWebhookHmac
} from "./shopify-webhook";

const PRIMARY_ROLE = "Primary Card Package";
const EXTRA_ROLE = "Extra NFC Card";
const MAX_CARD_COUNT = 100;

type AutoProvisioningEnv = {
  DB: D1Database;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_SHOP_DOMAIN?: string;
};

interface SetupAccumulator {
  setupId: string;
  businessName: string;
  businessAddress: string;
  googlePlaceId: string;
  googleReviewUrl: string;
  physicalCardCount: number;
  hasPrimary: boolean;
  invalid: boolean;
}

export interface AutoProvisionedShopifyBatch {
  manifest: ProvisioningManifest;
  batchId: string;
  setupId: string;
  businessName: string;
  physicalCardCount: number;
  customerEmail: string | null;
  replayed: boolean;
  programmingUrls: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, maximumLength = 300): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const cleaned = String(value).trim().replace(/\s+/g, " ");
  return cleaned.length <= maximumLength ? cleaned : "";
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

function lineProperty(line: Record<string, unknown>, names: string[]): string {
  if (!Array.isArray(line.properties)) return "";
  for (const property of line.properties) {
    if (!isRecord(property)) continue;
    const name = cleanText(property.name ?? property.key, 100);
    if (name && names.includes(name)) return cleanText(property.value, 2048);
  }
  return "";
}

function lineQuantity(line: Record<string, unknown>): number | null {
  const quantity = Number(line.quantity ?? line.current_quantity ?? 1);
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= MAX_CARD_COUNT ? quantity : null;
}

function primaryPackageCount(line: Record<string, unknown>): number | null {
  const candidates = [line.variant_title, line.name, line.title];
  for (const value of candidates) {
    const text = cleanText(value, 300);
    const match = text.match(/\b(1|2|3|5)\s*cards?\b/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function mergeField(setup: SetupAccumulator, field: "businessName" | "businessAddress" | "googlePlaceId" | "googleReviewUrl", value: string): void {
  if (!value) return;
  if (setup[field] && setup[field] !== value) {
    setup.invalid = true;
    return;
  }
  setup[field] = value;
}

function getSetup(map: Map<string, SetupAccumulator>, setupId: string): SetupAccumulator {
  const existing = map.get(setupId);
  if (existing) return existing;
  const created: SetupAccumulator = {
    setupId,
    businessName: "",
    businessAddress: "",
    googlePlaceId: "",
    googleReviewUrl: "",
    physicalCardCount: 0,
    hasPrimary: false,
    invalid: false
  };
  map.set(setupId, created);
  return created;
}

function extractPhysicalSetups(payload: Record<string, unknown>): SetupAccumulator[] {
  if (!Array.isArray(payload.line_items)) return [];
  const setups = new Map<string, SetupAccumulator>();

  for (const value of payload.line_items) {
    if (!isRecord(value)) continue;
    const role = lineProperty(value, ["_Item Role", "Item Role"]);
    if (role !== PRIMARY_ROLE && role !== EXTRA_ROLE) continue;

    const setupId = lineProperty(value, ["_Business Setup ID", "Business Setup ID"]);
    const quantity = lineQuantity(value);
    if (!setupId || !quantity) continue;
    const setup = getSetup(setups, setupId);

    if (role === PRIMARY_ROLE) {
      const packageCount = primaryPackageCount(value);
      if (!packageCount) {
        setup.invalid = true;
        continue;
      }
      setup.hasPrimary = true;
      setup.physicalCardCount += packageCount * quantity;

      mergeField(setup, "businessName", lineProperty(value, ["_Business Name", "Business Name"]));
      mergeField(setup, "businessAddress", lineProperty(value, ["_Business Address", "Business Address"]));
      mergeField(setup, "googlePlaceId", lineProperty(value, ["_Google Place ID", "Google Place ID"]));
      const reviewUrl = normaliseGoogleReviewUrl(
        lineProperty(value, ["_Review Link", "Review Link", "Review URL"])
      );
      if (!reviewUrl) setup.invalid = true;
      else mergeField(setup, "googleReviewUrl", reviewUrl);
    } else {
      setup.physicalCardCount += quantity;
    }

    if (setup.physicalCardCount > MAX_CARD_COUNT) setup.invalid = true;
  }

  return Array.from(setups.values()).filter((setup) => (
    setup.hasPrimary
    && !setup.invalid
    && Boolean(setup.businessName)
    && Boolean(setup.googleReviewUrl)
    && setup.physicalCardCount >= 1
    && setup.physicalCardCount <= MAX_CARD_COUNT
  ));
}

async function readRawBody(request: Request<any, any>): Promise<Uint8Array | null> {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > SHOPIFY_WEBHOOK_MAX_BODY_BYTES || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > SHOPIFY_WEBHOOK_MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function autoProvisionPaidShopifyOrder(
  request: Request<any, any>,
  env: AutoProvisioningEnv,
  now: Date = new Date()
): Promise<AutoProvisionedShopifyBatch[]> {
  if (request.method !== "POST") return [];
  if (request.headers.get("X-Shopify-Topic") !== SHOPIFY_ORDERS_PAID_TOPIC) return [];

  const expectedShop = cleanShopDomain(env.SHOPIFY_SHOP_DOMAIN || "");
  const suppliedShop = cleanShopDomain(request.headers.get("X-Shopify-Shop-Domain") || "");
  const secret = env.SHOPIFY_CLIENT_SECRET || "";
  if (!expectedShop || suppliedShop !== expectedShop || !secret) return [];

  const rawBody = await readRawBody(request);
  const signature = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  if (!rawBody || !signature || !(await verifyShopifyWebhookHmac(rawBody, signature, secret))) return [];

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return [];
  }
  if (!isRecord(payload)) return [];

  const orderReference = cleanText(payload.name ?? payload.order_number ?? payload.id, 160);
  if (!orderReference) return [];
  const customerEmail = checkoutEmail(payload);
  const setups = extractPhysicalSetups(payload);
  const timestamp = now.toISOString();
  const results: AutoProvisionedShopifyBatch[] = [];

  for (const setup of setups) {
    const intent: ProvisioningIntent = {
      source: "admin_shopify",
      shopifyLinked: true,
      externalOrderReference: orderReference,
      externalSetupReference: setup.setupId,
      business: { mode: "new", name: setup.businessName },
      location: {
        mode: "new",
        businessAddress: setup.businessAddress,
        googlePlaceId: setup.googlePlaceId,
        googleReviewUrl: setup.googleReviewUrl
      },
      physicalCardCount: setup.physicalCardCount
    };

    const provisioned = await provisionPhysicalCards(env.DB, intent, timestamp);
    if (customerEmail) {
      await env.DB.prepare(`
        UPDATE provisioning_batches
        SET customer_email = ?2
        WHERE id = ?1
      `).bind(provisioned.manifest.id, customerEmail).run();
    }

    results.push({
      manifest: provisioned.manifest,
      batchId: provisioned.manifest.id,
      setupId: setup.setupId,
      businessName: provisioned.manifest.businessName,
      physicalCardCount: provisioned.manifest.physicalCardCount,
      customerEmail,
      replayed: provisioned.replayed,
      programmingUrls: provisioned.manifest.cards.map((card) => card.programmingUrl)
    });
  }

  if (results.length > 0) {
    console.log(JSON.stringify({
      event: "shopify_card_auto_provisioned",
      orderReference,
      setupCount: results.length,
      physicalCardCount: results.reduce((sum, batch) => sum + batch.physicalCardCount, 0),
      replayed: results.every((batch) => batch.replayed)
    }));
  }

  return results;
}
