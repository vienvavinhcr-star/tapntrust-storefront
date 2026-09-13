const MAX_ADMIN_RESPONSE_BYTES = 512 * 1024;
const MAX_LINE_ITEM_PAGES = 4;
const SHOPIFY_ADMIN_REQUEST_TIMEOUT_MS = 2500;

export interface ShopifyAdminBillingLine {
  providerLineReference: string;
  variantId: string | null;
  sellingPlanId: string | null;
  sellingPlanName: string | null;
  providerSubscriptionReference: string | null;
}

export interface ShopifyAdminProvider {
  getOrderBillingLines(providerOrderReference: string): Promise<ShopifyAdminBillingLine[]>;
}

export interface ShopifyAdminConfiguration {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

export class ShopifyAdminProviderError extends Error {
  constructor(
    public readonly code: "configuration_error" | "request_failed" | "invalid_response",
    public readonly providerStatus: number | null = null
  ) {
    super(code);
    this.name = "ShopifyAdminProviderError";
  }
}

interface GraphqlLineItemNode {
  id?: unknown;
  variant?: { id?: unknown } | null;
  sellingPlan?: { sellingPlanId?: unknown; name?: unknown } | null;
}

interface GraphqlResponse {
  data?: {
    order?: {
      id?: unknown;
      lineItems?: {
        nodes?: unknown;
        pageInfo?: { hasNextPage?: unknown; endCursor?: unknown };
      };
    } | null;
  };
  errors?: unknown;
}

const ORDER_BILLING_QUERY = `
  query TapnTrustOrderBilling($id: ID!, $after: String) {
    order(id: $id) {
      id
      lineItems(first: 250, after: $after) {
        nodes {
          id
          variant { id }
          sellingPlan {
            sellingPlanId
            name
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= 200 ? cleaned : null;
}

function cleanShopDomain(value: string): string | null {
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(cleaned) ? cleaned : null;
}

function toOrderGid(value: string): string | null {
  const cleaned = cleanIdentifier(value);
  if (!cleaned) return null;
  if (/^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(cleaned)) return cleaned;
  return /^[A-Za-z0-9_-]+$/.test(cleaned) ? `gid://shopify/Order/${cleaned}` : null;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_ADMIN_RESPONSE_BYTES || !response.body) {
    throw new ShopifyAdminProviderError("invalid_response", response.status);
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
      throw new ShopifyAdminProviderError("invalid_response", response.status);
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();
  try {
    return JSON.parse(body);
  } catch {
    throw new ShopifyAdminProviderError("invalid_response", response.status);
  }
}

function parseLine(value: unknown): ShopifyAdminBillingLine | null {
  if (!isRecord(value)) return null;
  const node = value as GraphqlLineItemNode;
  const providerLineReference = cleanIdentifier(node.id);
  if (!providerLineReference) return null;
  return {
    providerLineReference,
    variantId: cleanIdentifier(node.variant?.id),
    sellingPlanId: cleanIdentifier(node.sellingPlan?.sellingPlanId),
    sellingPlanName: cleanIdentifier(node.sellingPlan?.name),
    providerSubscriptionReference: null
  };
}

export function createShopifyAdminProvider(
  configuration: ShopifyAdminConfiguration,
  fetcher: typeof fetch = fetch
): ShopifyAdminProvider {
  const shopDomain = cleanShopDomain(configuration.shopDomain);
  const apiVersion = configuration.apiVersion.trim();
  const accessToken = configuration.accessToken.trim();

  return {
    async getOrderBillingLines(providerOrderReference: string): Promise<ShopifyAdminBillingLine[]> {
      const orderId = toOrderGid(providerOrderReference);
      if (!shopDomain || !/^\d{4}-(01|04|07|10)$/.test(apiVersion) || !accessToken || !orderId) {
        throw new ShopifyAdminProviderError("configuration_error");
      }

      const lines: ShopifyAdminBillingLine[] = [];
      let after: string | null = null;
      for (let page = 0; page < MAX_LINE_ITEM_PAGES; page += 1) {
        let response: Response;
        let rawPayload: unknown;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SHOPIFY_ADMIN_REQUEST_TIMEOUT_MS);
        try {
          response = await fetcher(`https://${shopDomain}/admin/api/${apiVersion}/graphql.json`, {
            method: "POST",
            redirect: "error",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": accessToken
            },
            body: JSON.stringify({ query: ORDER_BILLING_QUERY, variables: { id: orderId, after } })
          });
          if (!response.ok) throw new ShopifyAdminProviderError("request_failed", response.status);
          rawPayload = await readBoundedJson(response);
        } catch (error) {
          if (error instanceof ShopifyAdminProviderError) throw error;
          throw new ShopifyAdminProviderError("request_failed");
        } finally {
          clearTimeout(timeoutId);
        }

        if (!isRecord(rawPayload)) {
          throw new ShopifyAdminProviderError("invalid_response", response.status);
        }
        const payload = rawPayload as GraphqlResponse;
        const hasErrors = Array.isArray(payload.errors)
          ? payload.errors.length > 0
          : payload.errors !== undefined;
        if (hasErrors || !payload.data?.order || cleanIdentifier(payload.data.order.id) !== orderId) {
          throw new ShopifyAdminProviderError("invalid_response", response.status);
        }
        const connection = payload.data.order.lineItems;
        if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo) {
          throw new ShopifyAdminProviderError("invalid_response", response.status);
        }
        for (const node of connection.nodes) {
          const line = parseLine(node);
          if (!line) throw new ShopifyAdminProviderError("invalid_response", response.status);
          lines.push(line);
        }

        if (connection.pageInfo.hasNextPage !== true) return lines;
        after = cleanIdentifier(connection.pageInfo.endCursor);
        if (!after) throw new ShopifyAdminProviderError("invalid_response", response.status);
      }
      throw new ShopifyAdminProviderError("invalid_response");
    }
  };
}
