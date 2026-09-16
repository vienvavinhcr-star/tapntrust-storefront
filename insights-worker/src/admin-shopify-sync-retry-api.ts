import type { AdminProvisioningDependencies } from "./admin-provisioning";
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
    const reason = error instanceof ShopifyOrderProgrammingError
      ? error.code
      : "unexpected_error";
    const providerStatus = error instanceof ShopifyOrderProgrammingError
      ? error.providerStatus
      : undefined;
    console.warn(JSON.stringify({
      event: "admin_shopify_programming_urls_sync_failed",
      orderReference: manifest.externalOrderReference.slice(0, 80),
      setupReference: manifest.externalSetupReference.slice(0, 80),
      batchId: manifest.id,
      cardCount: manifest.cards.length,
      reason,
      providerStatus
    }));
    return json({
      error: providerStatus
        ? `Could not sync programming URLs to Shopify (provider status ${providerStatus}).`
        : "Could not sync programming URLs to Shopify.",
      shopifyOrderSync: { status: "failed", reason, providerStatus }
    }, 502);
  }
}
