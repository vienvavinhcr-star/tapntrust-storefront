import type { AdminProvisioningDependencies } from "./admin-provisioning";
import { ShopifyAdminProviderError } from "./shopify-admin";
import { getProvisioningManifest } from "./provisioning-repository";
import { ShopifyOrderProgrammingError } from "./shopify-order-programming";

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function hasSafeAdminSource(request: Request, authBaseUrl: string): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return origin === new URL(authBaseUrl).origin;
  } catch {
    return false;
  }
}

function cleanIdentifier(value: string): string | null {
  const cleaned = value.trim();
  return cleaned && cleaned.length <= 160 ? cleaned : null;
}

function shopifyFailure(error: unknown): {
  message: string;
  stage: "authentication" | "programming" | "unexpected";
  code: string;
  providerStatus: number | null;
} {
  if (error instanceof ShopifyAdminProviderError) {
    const providerStatus = error.providerStatus;
    if (error.code === "configuration_error") {
      return {
        message: "Shopify Admin credentials are not configured correctly in the Worker.",
        stage: "authentication",
        code: error.code,
        providerStatus
      };
    }
    if (providerStatus) {
      return {
        message: `Shopify Admin authentication failed (provider status ${providerStatus}).`,
        stage: "authentication",
        code: error.code,
        providerStatus
      };
    }
    return {
      message: "Shopify Admin authentication request failed before programming URLs could be synced.",
      stage: "authentication",
      code: error.code,
      providerStatus
    };
  }

  if (error instanceof ShopifyOrderProgrammingError) {
    const providerStatus = error.providerStatus;
    if (error.code === "order_not_found") {
      return {
        message: "The linked Shopify order could not be found.",
        stage: "programming",
        code: error.code,
        providerStatus
      };
    }
    if (error.code === "metafield_write_failed") {
      return {
        message: "Shopify rejected the TapNTrust Programming URLs metafield write.",
        stage: "programming",
        code: error.code,
        providerStatus
      };
    }
    if (error.code === "configuration_error") {
      return {
        message: "Shopify programming sync configuration is invalid.",
        stage: "programming",
        code: error.code,
        providerStatus
      };
    }
    if (providerStatus) {
      return {
        message: `Could not sync programming URLs to Shopify (provider status ${providerStatus}).`,
        stage: "programming",
        code: error.code,
        providerStatus
      };
    }
    return {
      message: error.code === "invalid_response"
        ? "Shopify returned an unexpected response while syncing programming URLs."
        : "Could not sync programming URLs to Shopify.",
      stage: "programming",
      code: error.code,
      providerStatus
    };
  }

  return {
    message: "Could not sync programming URLs to Shopify because an unexpected Worker error occurred.",
    stage: "unexpected",
    code: "unexpected_error",
    providerStatus: null
  };
}

export async function handleAdminShopifySyncRetryRequest(
  request: Request,
  pathname: string,
  db: D1Database,
  authBaseUrl: string,
  dependencies: AdminProvisioningDependencies
): Promise<Response | null> {
  const match = pathname.match(/^\/api\/admin\/provisioning\/batches\/([^/]+)\/sync-shopify$/);
  if (!match) return null;

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  if (!hasSafeAdminSource(request, authBaseUrl)) return json({ error: "Forbidden" }, 403);

  const batchId = cleanIdentifier(decodeURIComponent(match[1] || ""));
  if (!batchId) return json({ error: "Invalid provisioning batch" }, 400);

  const manifest = await getProvisioningManifest(db, batchId);
  if (!manifest) return json({ error: "Provisioning batch was not found." }, 404);

  if (manifest.externalOrderReference.startsWith("MANUAL-")) {
    return json({
      error: "This is a manual provisioning batch and is not linked to a Shopify order."
    }, 409);
  }

  if (!dependencies.syncProgrammingManifest) {
    return json({ error: "Shopify programming sync is not configured." }, 503);
  }

  try {
    const result = await dependencies.syncProgrammingManifest(manifest);
    console.log(JSON.stringify({
      event: "admin_shopify_programming_urls_synced",
      orderReference: manifest.externalOrderReference.slice(0, 80),
      setupReference: manifest.externalSetupReference.slice(0, 80),
      batchId: manifest.id,
      cardCount: manifest.cards.length,
      orderName: result.orderName
    }));
    return json({
      manifest,
      shopifyOrderSync: { status: "synced", orderName: result.orderName }
    });
  } catch (error) {
    const failure = shopifyFailure(error);
    console.warn(JSON.stringify({
      event: "admin_shopify_programming_urls_sync_failed",
      orderReference: manifest.externalOrderReference.slice(0, 80),
      setupReference: manifest.externalSetupReference.slice(0, 80),
      batchId: manifest.id,
      cardCount: manifest.cards.length,
      stage: failure.stage,
      reason: failure.code,
      providerStatus: failure.providerStatus
    }));
    return json({
      error: failure.message,
      shopifyOrderSync: {
        status: "failed",
        stage: failure.stage,
        reason: failure.code,
        providerStatus: failure.providerStatus
      }
    }, 502);
  }
}
