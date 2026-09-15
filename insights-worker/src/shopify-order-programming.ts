import type { ProvisioningManifest } from "./provisioning";

const MAX_ADMIN_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 3500;
const METAFIELD_NAMESPACE = "tapntrust";
const METAFIELD_KEY = "programming_urls";
const METAFIELD_TYPE = "multi_line_text_field";
const METAFIELD_NAME = "TapNTrust Programming URLs";
const MAX_METAFIELD_VALUE_LENGTH = 60_000;

export interface ShopifyOrderProgrammingConfiguration {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

export interface ShopifyOrderProgrammingResult {
  orderId: string;
  orderName: string;
  metafieldId: string;
}

export class ShopifyOrderProgrammingError extends Error {
  constructor(
    public readonly code:
      | "configuration_error"
      | "request_failed"
      | "invalid_response"
      | "order_not_found"
      | "metafield_write_failed",
    public readonly providerStatus: number | null = null
  ) {
    super(code);
    this.name = "ShopifyOrderProgrammingError";
  }
}

interface ExistingMetafield {
  id: string;
  value: string;
  type: string;
  compareDigest: string | null;
}

interface ResolvedOrder {
  id: string;
  name: string;
  metafield: ExistingMetafield | null;
}

const ORDER_QUERY = `
  query TapnTrustProgrammingOrder($identifier: OrderIdentifierInput!) {
    orderByIdentifier(identifier: $identifier) {
      id
      name
      metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
        id
        value
        type
        compareDigest
      }
    }
  }
`;

const DEFINITION_QUERY = `
  query TapnTrustProgrammingDefinition {
    metafieldDefinitions(
      first: 5,
      ownerType: ORDER,
      query: "namespace:${METAFIELD_NAMESPACE} key:${METAFIELD_KEY}"
    ) {
      nodes {
        id
        namespace
        key
        pinnedPosition
        type { name }
      }
    }
  }
`;

const DEFINITION_CREATE = `
  mutation TapnTrustCreateProgrammingDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        namespace
        key
        pinnedPosition
        type { name }
      }
      userErrors { field message }
    }
  }
`;

const DEFINITION_PIN = `
  mutation TapnTrustPinProgrammingDefinition($identifier: MetafieldDefinitionIdentifierInput!) {
    metafieldDefinitionPin(identifier: $identifier) {
      pinnedDefinition { id pinnedPosition }
      userErrors { field message }
    }
  }
`;

const METAFIELD_SET = `
  mutation TapnTrustSetProgrammingUrls($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key type value }
      userErrors { field message code }
    }
  }
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maximumLength ? cleaned : null;
}

function cleanShopDomain(value: string): string | null {
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(cleaned) ? cleaned : null;
}

function validApiVersion(value: string): boolean {
  return /^\d{4}-(01|04|07|10)$/.test(value.trim());
}

function safeLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function setupMarkers(setupReference: string): { start: string; end: string } {
  const reference = safeLine(setupReference);
  return {
    start: `--- TapNTrust setup ${reference} ---`,
    end: `--- End TapNTrust setup ${reference} ---`
  };
}

export function programmingManifestBlock(manifest: ProvisioningManifest): string {
  const markers = setupMarkers(manifest.externalSetupReference);
  const lines = [
    markers.start,
    `Business: ${safeLine(manifest.businessName)}`,
    ...manifest.cards.map((card) => `Card ${card.ordinal}: ${card.programmingUrl}`),
    markers.end
  ];
  return lines.join("\n");
}

export function mergeProgrammingManifest(
  existingValue: string | null,
  manifest: ProvisioningManifest
): string {
  const block = programmingManifestBlock(manifest);
  const existing = (existingValue || "").trim();
  if (!existing) return block;

  const markers = setupMarkers(manifest.externalSetupReference);
  const startIndex = existing.indexOf(markers.start);
  if (startIndex < 0) return `${existing}\n\n${block}`;

  const endIndex = existing.indexOf(markers.end, startIndex);
  if (endIndex < 0) {
    throw new ShopifyOrderProgrammingError("invalid_response");
  }
  const afterEnd = endIndex + markers.end.length;
  const before = existing.slice(0, startIndex).trimEnd();
  const after = existing.slice(afterEnd).trimStart();
  return [before, block, after].filter(Boolean).join("\n\n");
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_ADMIN_RESPONSE_BYTES || !response.body) {
    throw new ShopifyOrderProgrammingError("invalid_response", response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > MAX_ADMIN_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ShopifyOrderProgrammingError("invalid_response", response.status);
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();
  try {
    return JSON.parse(body);
  } catch {
    throw new ShopifyOrderProgrammingError("invalid_response", response.status);
  }
}

async function graphql(
  configuration: ShopifyOrderProgrammingConfiguration,
  query: string,
  variables: Record<string, unknown>,
  fetcher: typeof fetch
): Promise<Record<string, unknown>> {
  const shopDomain = cleanShopDomain(configuration.shopDomain);
  const apiVersion = configuration.apiVersion.trim();
  const accessToken = configuration.accessToken.trim();
  if (!shopDomain || !validApiVersion(apiVersion) || !accessToken) {
    throw new ShopifyOrderProgrammingError("configuration_error");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
      body: JSON.stringify({ query, variables })
    });
    if (!response.ok) throw new ShopifyOrderProgrammingError("request_failed", response.status);
    const raw = await readBoundedJson(response);
    if (!isRecord(raw)) throw new ShopifyOrderProgrammingError("invalid_response", response.status);
    if (Array.isArray(raw.errors) ? raw.errors.length > 0 : raw.errors !== undefined) {
      throw new ShopifyOrderProgrammingError("invalid_response", response.status);
    }
    if (!isRecord(raw.data)) throw new ShopifyOrderProgrammingError("invalid_response", response.status);
    return raw.data;
  } catch (error) {
    if (error instanceof ShopifyOrderProgrammingError) throw error;
    throw new ShopifyOrderProgrammingError("request_failed");
  } finally {
    clearTimeout(timeout);
  }
}

function parseExistingMetafield(value: unknown): ExistingMetafield | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new ShopifyOrderProgrammingError("invalid_response");
  const id = cleanText(value.id, 200);
  const metafieldValue = typeof value.value === "string" ? value.value : null;
  const type = cleanText(value.type, 80);
  const compareDigest = value.compareDigest === null
    ? null
    : cleanText(value.compareDigest, 300);
  if (!id || metafieldValue === null || !type || (value.compareDigest !== null && !compareDigest)) {
    throw new ShopifyOrderProgrammingError("invalid_response");
  }
  return { id, value: metafieldValue, type, compareDigest };
}

async function resolveOrder(
  configuration: ShopifyOrderProgrammingConfiguration,
  orderName: string,
  fetcher: typeof fetch
): Promise<ResolvedOrder> {
  const name = cleanText(orderName, 160);
  if (!name) throw new ShopifyOrderProgrammingError("configuration_error");
  const data = await graphql(configuration, ORDER_QUERY, { identifier: { name } }, fetcher);
  const order = data.orderByIdentifier;
  if (order === null || order === undefined) throw new ShopifyOrderProgrammingError("order_not_found");
  if (!isRecord(order)) throw new ShopifyOrderProgrammingError("invalid_response");
  const id = cleanText(order.id, 200);
  const returnedName = cleanText(order.name, 160);
  if (!id || !returnedName || returnedName !== name) {
    throw new ShopifyOrderProgrammingError("invalid_response");
  }
  const metafield = parseExistingMetafield(order.metafield);
  if (metafield && metafield.type !== METAFIELD_TYPE) {
    throw new ShopifyOrderProgrammingError("invalid_response");
  }
  return { id, name: returnedName, metafield };
}

function userErrors(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function exactDefinition(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (value.namespace !== METAFIELD_NAMESPACE || value.key !== METAFIELD_KEY) return null;
  const type = isRecord(value.type) ? value.type.name : null;
  if (type !== METAFIELD_TYPE) throw new ShopifyOrderProgrammingError("invalid_response");
  return value;
}

async function queryDefinition(
  configuration: ShopifyOrderProgrammingConfiguration,
  fetcher: typeof fetch
): Promise<Record<string, unknown> | null> {
  const data = await graphql(configuration, DEFINITION_QUERY, {}, fetcher);
  const connection = data.metafieldDefinitions;
  if (!isRecord(connection) || !Array.isArray(connection.nodes)) {
    throw new ShopifyOrderProgrammingError("invalid_response");
  }
  const matches = connection.nodes.map(exactDefinition).filter(Boolean) as Record<string, unknown>[];
  if (matches.length > 1) throw new ShopifyOrderProgrammingError("invalid_response");
  return matches[0] || null;
}

async function ensureDefinition(
  configuration: ShopifyOrderProgrammingConfiguration,
  fetcher: typeof fetch
): Promise<void> {
  let definition = await queryDefinition(configuration, fetcher);
  if (!definition) {
    const data = await graphql(configuration, DEFINITION_CREATE, {
      definition: {
        name: METAFIELD_NAME,
        namespace: METAFIELD_NAMESPACE,
        key: METAFIELD_KEY,
        description: "Permanent TapNTrust NFC programming URLs. One URL per physical card, grouped by business setup.",
        type: METAFIELD_TYPE,
        ownerType: "ORDER",
        pin: true
      }
    }, fetcher);
    const payload = data.metafieldDefinitionCreate;
    if (!isRecord(payload)) throw new ShopifyOrderProgrammingError("invalid_response");
    const created = exactDefinition(payload.createdDefinition);
    if (created && userErrors(payload.userErrors).length === 0) return;

    // A concurrent first-time provisioning can create the definition between our read and write.
    definition = await queryDefinition(configuration, fetcher);
    if (!definition) throw new ShopifyOrderProgrammingError("metafield_write_failed");
  }

  if (definition.pinnedPosition !== null && definition.pinnedPosition !== undefined) return;
  const data = await graphql(configuration, DEFINITION_PIN, {
    identifier: {
      namespace: METAFIELD_NAMESPACE,
      key: METAFIELD_KEY,
      ownerType: "ORDER"
    }
  }, fetcher);
  const payload = data.metafieldDefinitionPin;
  if (!isRecord(payload) || userErrors(payload.userErrors).length > 0 || !isRecord(payload.pinnedDefinition)) {
    throw new ShopifyOrderProgrammingError("metafield_write_failed");
  }
}

async function setMetafield(
  configuration: ShopifyOrderProgrammingConfiguration,
  order: ResolvedOrder,
  manifest: ProvisioningManifest,
  fetcher: typeof fetch
): Promise<string | null> {
  const value = mergeProgrammingManifest(order.metafield?.value || null, manifest);
  if (value.length > MAX_METAFIELD_VALUE_LENGTH) {
    throw new ShopifyOrderProgrammingError("metafield_write_failed");
  }
  const data = await graphql(configuration, METAFIELD_SET, {
    metafields: [{
      ownerId: order.id,
      namespace: METAFIELD_NAMESPACE,
      key: METAFIELD_KEY,
      type: METAFIELD_TYPE,
      value,
      compareDigest: order.metafield?.compareDigest ?? null
    }]
  }, fetcher);
  const payload = data.metafieldsSet;
  if (!isRecord(payload)) throw new ShopifyOrderProgrammingError("invalid_response");
  if (userErrors(payload.userErrors).length > 0) return null;
  if (!Array.isArray(payload.metafields) || payload.metafields.length !== 1 || !isRecord(payload.metafields[0])) {
    throw new ShopifyOrderProgrammingError("invalid_response");
  }
  const id = cleanText(payload.metafields[0].id, 200);
  return id;
}

export async function syncProgrammingManifestToShopifyOrder(
  configuration: ShopifyOrderProgrammingConfiguration,
  manifest: ProvisioningManifest,
  fetcher: typeof fetch = fetch
): Promise<ShopifyOrderProgrammingResult> {
  await ensureDefinition(configuration, fetcher);

  let order = await resolveOrder(configuration, manifest.externalOrderReference, fetcher);
  let metafieldId = await setMetafield(configuration, order, manifest, fetcher);
  if (!metafieldId) {
    // Re-read and retry once so concurrent updates do not silently overwrite another setup's URLs.
    order = await resolveOrder(configuration, manifest.externalOrderReference, fetcher);
    metafieldId = await setMetafield(configuration, order, manifest, fetcher);
  }
  if (!metafieldId) throw new ShopifyOrderProgrammingError("metafield_write_failed");

  return { orderId: order.id, orderName: order.name, metafieldId };
}
