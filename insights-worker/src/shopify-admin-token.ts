import { ShopifyAdminProviderError } from "./shopify-admin";

const REFRESH_SKEW_MS = 5 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 3000;

interface TokenConfig {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<CachedToken>>();

function cleanShopDomain(value: string): string | null {
  const cleaned = value.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(cleaned)
    ? cleaned
    : null;
}

function safeLogText(value: unknown, max = 180): string {
  return typeof value === "string"
    ? value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max)
    : "";
}

async function logRejectedTokenResponse(response: Response): Promise<void> {
  let error = "";
  let errorDescription = "";
  try {
    const payload = await response.clone().json<{
      error?: unknown;
      error_description?: unknown;
    }>();
    error = safeLogText(payload.error, 80);
    errorDescription = safeLogText(payload.error_description, 180);
  } catch {
    // Keep diagnostics metadata-only if Shopify did not return JSON.
  }

  console.error(JSON.stringify({
    message: "shopify admin token rejected",
    status: response.status,
    error: error || undefined,
    errorDescription: errorDescription || undefined
  }));
}

async function mintToken(
  config: TokenConfig,
  fetcher: typeof fetch = fetch
): Promise<CachedToken> {
  const shopDomain = cleanShopDomain(config.shopDomain);
  const clientId = config.clientId.trim();
  const clientSecret = config.clientSecret.trim();

  if (!shopDomain || !clientId || !clientSecret) {
    console.error(JSON.stringify({
      message: "shopify admin token configuration invalid",
      hasShopDomain: Boolean(shopDomain),
      hasClientId: Boolean(clientId),
      hasClientSecret: Boolean(clientSecret)
    }));
    throw new ShopifyAdminProviderError("configuration_error");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);

  try {
    const response = await fetcher(
      `https://${shopDomain}/admin/oauth/access_token`,
      {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret
        }).toString()
      }
    );

    if (!response.ok) {
      await logRejectedTokenResponse(response);
      throw new ShopifyAdminProviderError(
        "request_failed",
        response.status
      );
    }

    const payload = await response.json<{
      access_token?: unknown;
      expires_in?: unknown;
    }>();

    const accessToken =
      typeof payload.access_token === "string"
        ? payload.access_token.trim()
        : "";

    const expiresIn = Number(payload.expires_in);

    if (
      !accessToken ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      console.error(JSON.stringify({
        message: "shopify admin token response invalid",
        status: response.status,
        hasAccessToken: Boolean(accessToken),
        hasValidExpiry: Number.isFinite(expiresIn) && expiresIn > 0
      }));
      throw new ShopifyAdminProviderError(
        "invalid_response",
        response.status
      );
    }

    return {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000
    };
  } catch (error) {
    if (error instanceof ShopifyAdminProviderError) throw error;
    const category = error instanceof DOMException && error.name === "AbortError"
      ? "timeout"
      : "network_error";
    console.error(JSON.stringify({
      message: "shopify admin token request failed",
      category,
      errorName: error instanceof Error ? error.name : "unknown"
    }));
    throw new ShopifyAdminProviderError("request_failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function getShopifyAdminAccessToken(
  config: TokenConfig,
  fetcher: typeof fetch = fetch,
  forceRefresh = false
): Promise<string> {
  const shopDomain = cleanShopDomain(config.shopDomain);
  const clientId = config.clientId.trim();

  if (!shopDomain || !clientId) {
    console.error(JSON.stringify({
      message: "shopify admin token cache key invalid",
      hasShopDomain: Boolean(shopDomain),
      hasClientId: Boolean(clientId)
    }));
    throw new ShopifyAdminProviderError("configuration_error");
  }

  const key = `${shopDomain}:${clientId}`;
  const cached = cache.get(key);

  if (
    !forceRefresh &&
    cached &&
    cached.expiresAt - Date.now() > REFRESH_SKEW_MS
  ) {
    return cached.accessToken;
  }

  const existing = inflight.get(key);
  if (existing) return (await existing).accessToken;

  const request = mintToken(config, fetcher)
    .then((token) => {
      cache.set(key, token);
      return token;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return (await request).accessToken;
}
