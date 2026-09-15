import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  handleAdminProvisioningRequest,
  type AdminProvisioningDependencies
} from "../src/admin-provisioning";
import { ShopifyOrderProgrammingError } from "../src/shopify-order-programming";

const ORIGIN = "https://go.tapntrust.com";
const REVIEW_URL = "https://search.google.com/local/writereview?placeid=admin-sync-test";

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

function requestBody(): Record<string, unknown> {
  return {
    externalOrderReference: "#1001",
    externalSetupReference: `setup-${crypto.randomUUID()}`,
    businessMode: "new",
    businessName: "Programming Sync Test",
    locationMode: "new",
    businessAddress: "100 Test Street, Melbourne VIC",
    googlePlaceId: "ChIJ-admin-sync-test",
    googleReviewUrl: REVIEW_URL,
    physicalCardCount: 2
  };
}

async function provision(
  body: Record<string, unknown>,
  dependencies: AdminProvisioningDependencies
): Promise<Response> {
  return (await handleAdminProvisioningRequest(
    new Request(`${ORIGIN}/api/admin/provisioning/batches`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN
      },
      body: JSON.stringify(body)
    }),
    "/api/admin/provisioning/batches",
    env.DB,
    ORIGIN,
    () => new Date("2026-09-15T01:30:00.000Z"),
    dependencies
  )) as Response;
}

beforeEach(clearDatabase);

describe("admin Shopify programming URL sync", () => {
  it("syncs the immutable manifest after provisioning and reports the Shopify order", async () => {
    const syncProgrammingManifest = vi.fn(async (manifest) => ({
      orderId: "gid://shopify/Order/1001",
      orderName: manifest.externalOrderReference,
      metafieldId: "gid://shopify/Metafield/10"
    }));
    const response = await provision(requestBody(), { syncProgrammingManifest });
    const payload = await response.json<{
      manifest: { externalOrderReference: string; cards: Array<{ programmingUrl: string }> };
      shopifyOrderSync: { status: string; orderName: string };
    }>();

    expect(response.status).toBe(201);
    expect(payload.shopifyOrderSync).toEqual({ status: "synced", orderName: "#1001" });
    expect(syncProgrammingManifest).toHaveBeenCalledTimes(1);
    const syncedManifest = syncProgrammingManifest.mock.calls[0]?.[0];
    expect(syncedManifest?.cards).toHaveLength(2);
    expect(syncedManifest?.cards[0]?.programmingUrl).toMatch(/^https:\/\/go\.tapntrust\.com\/t\/TNT-/);
  });

  it("does not roll back provisioned cards when Shopify metadata write-back fails", async () => {
    const syncProgrammingManifest = vi.fn(async () => {
      throw new ShopifyOrderProgrammingError("request_failed", 403);
    });
    const response = await provision(requestBody(), { syncProgrammingManifest });
    const payload = await response.json<{
      manifest: { cards: Array<{ publicToken: string }> };
      shopifyOrderSync: { status: string; reason: string };
    }>();

    expect(response.status).toBe(201);
    expect(payload.manifest.cards).toHaveLength(2);
    expect(payload.shopifyOrderSync).toEqual({ status: "failed", reason: "request_failed" });
    const cards = await env.DB.prepare("SELECT COUNT(*) AS count FROM cards").first<{ count: number }>();
    expect(Number(cards?.count || 0)).toBe(2);
  });

  it("retries Shopify write-back when an identical provisioning request is replayed", async () => {
    const body = requestBody();
    const syncProgrammingManifest = vi.fn(async (manifest) => ({
      orderId: "gid://shopify/Order/1001",
      orderName: manifest.externalOrderReference,
      metafieldId: "gid://shopify/Metafield/10"
    }));

    const first = await provision(body, { syncProgrammingManifest });
    const replay = await provision(body, { syncProgrammingManifest });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(syncProgrammingManifest).toHaveBeenCalledTimes(2);
    const cards = await env.DB.prepare("SELECT COUNT(*) AS count FROM cards").first<{ count: number }>();
    expect(Number(cards?.count || 0)).toBe(2);
  });
});
