import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  handleAdminProvisioningRequest,
  type AdminProvisioningDependencies
} from "../src/admin-provisioning";
import { handleAdminShopifySyncRetryRequest } from "../src/admin-shopify-sync-retry-api";
import { ShopifyOrderProgrammingError } from "../src/shopify-order-programming";

const ORIGIN = "https://go.tapntrust.com";
const REVIEW_URL = "https://search.google.com/local/writereview?placeid=retry-sync-test";

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM provisioning_batch_cards"),
    env.DB.prepare("DELETE FROM provisioning_batches"),
    env.DB.prepare("DELETE FROM insights_entitlements"),
    env.DB.prepare("DELETE FROM tap_events"),
    env.DB.prepare("DELETE FROM cards"),
    env.DB.prepare("DELETE FROM locations"),
    env.DB.prepare("DELETE FROM businesses")
  ]);
}

function shopifyBody(): Record<string, unknown> {
  return {
    externalOrderReference: "#2001",
    externalSetupReference: `setup-${crypto.randomUUID()}`,
    businessMode: "new",
    businessName: "Retry Sync Test",
    locationMode: "new",
    businessAddress: "200 Test Street, Melbourne VIC",
    googlePlaceId: "ChIJ-retry-sync-test",
    googleReviewUrl: REVIEW_URL,
    physicalCardCount: 3
  };
}

async function provision(
  body: Record<string, unknown>,
  dependencies: AdminProvisioningDependencies
): Promise<Response> {
  return (await handleAdminProvisioningRequest(
    new Request(`${ORIGIN}/api/admin/provisioning/batches`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify(body)
    }),
    "/api/admin/provisioning/batches",
    env.DB,
    ORIGIN,
    () => new Date("2026-09-16T00:30:00.000Z"),
    dependencies
  )) as Response;
}

async function retry(
  batchId: string,
  dependencies: AdminProvisioningDependencies
): Promise<Response> {
  return (await handleAdminShopifySyncRetryRequest(
    new Request(`${ORIGIN}/api/admin/provisioning/batches/${encodeURIComponent(batchId)}/sync-shopify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: "{}"
    }),
    `/api/admin/provisioning/batches/${encodeURIComponent(batchId)}/sync-shopify`,
    env.DB,
    ORIGIN,
    dependencies
  )) as Response;
}

beforeEach(clearDatabase);

describe("admin Shopify programming sync recovery", () => {
  it("retries Shopify write-back from an existing batch without creating or replacing cards", async () => {
    const initialFailure = vi.fn(async () => {
      throw new ShopifyOrderProgrammingError("request_failed", 503);
    });
    const provisionResponse = await provision(shopifyBody(), { syncProgrammingManifest: initialFailure });
    const provisionPayload = await provisionResponse.json<{
      manifest: { id: string; cards: Array<{ id: string; publicToken: string; programmingUrl: string }> };
    }>();

    expect(provisionResponse.status).toBe(201);
    expect(provisionPayload.manifest.cards).toHaveLength(3);
    const originalTokens = provisionPayload.manifest.cards.map((card) => card.publicToken);

    const syncProgrammingManifest = vi.fn(async (manifest) => ({
      orderId: "gid://shopify/Order/2001",
      orderName: manifest.externalOrderReference,
      metafieldId: "gid://shopify/Metafield/20"
    }));
    const retryResponse = await retry(provisionPayload.manifest.id, { syncProgrammingManifest });
    const retryPayload = await retryResponse.json<{
      manifest: { cards: Array<{ publicToken: string; programmingUrl: string }> };
      shopifyOrderSync: { status: string; orderName: string };
    }>();

    expect(retryResponse.status).toBe(200);
    expect(retryPayload.shopifyOrderSync).toEqual({ status: "synced", orderName: "#2001" });
    expect(retryPayload.manifest.cards.map((card) => card.publicToken)).toEqual(originalTokens);
    expect(syncProgrammingManifest).toHaveBeenCalledTimes(1);

    const cardCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM cards").first<{ count: number }>();
    const batchCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM provisioning_batches").first<{ count: number }>();
    expect(Number(cardCount?.count || 0)).toBe(3);
    expect(Number(batchCount?.count || 0)).toBe(1);
  });

  it("does not allow Shopify sync recovery for manual provisioning batches", async () => {
    const manualResponse = await provision({
      provisioningSource: "manual",
      businessMode: "new",
      businessName: "Manual Retry Test",
      locationMode: "new",
      businessAddress: "1 Manual Street",
      googlePlaceId: "",
      googleReviewUrl: REVIEW_URL,
      physicalCardCount: 1
    }, {});
    const manualPayload = await manualResponse.json<{ manifest: { id: string } }>();

    const syncProgrammingManifest = vi.fn();
    const retryResponse = await retry(manualPayload.manifest.id, { syncProgrammingManifest });
    const retryPayload = await retryResponse.json<{ error: string }>();

    expect(retryResponse.status).toBe(409);
    expect(retryPayload.error).toContain("manual provisioning batch");
    expect(syncProgrammingManifest).not.toHaveBeenCalled();
  });
});
