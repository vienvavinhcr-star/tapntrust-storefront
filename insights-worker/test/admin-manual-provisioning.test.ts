import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  createAdminPlaceSearchProvider,
  type AdminPlaceSearchProvider
} from "../src/admin-place-search";
import {
  handleAdminProvisioningRequest,
  type AdminProvisioningDependencies
} from "../src/admin-provisioning";
import { handleRequest } from "../src/index";
import { createD1Repository } from "../src/repository";

const ORIGIN = "https://go.tapntrust.com";
const ADMIN_TOKEN = "test-admin-token-that-is-not-a-production-secret";
const GOOGLE_KEY = "server-side-test-key";
const PLACE_ID = "ChIJAdminManual123";
const REVIEW_URL = `https://search.google.com/local/writereview?placeid=${PLACE_ID}`;

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

function manualBody(): Record<string, unknown> {
  return {
    provisioningSource: "manual",
    businessMode: "new",
    businessName: "Manual Test Cafe",
    locationMode: "new",
    businessAddress: "100 Test Street, Melbourne VIC",
    googlePlaceId: PLACE_ID,
    googleReviewUrl: REVIEW_URL,
    physicalCardCount: 2
  };
}

async function directProvision(
  body: Record<string, unknown>,
  dependencies: AdminProvisioningDependencies = {}
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
    () => new Date("2026-09-15T02:00:00.000Z"),
    dependencies
  )) as Response;
}

async function authenticatedAdminGet(path: string, dependencies: AdminProvisioningDependencies): Promise<Response> {
  const context = createExecutionContext();
  return handleRequest(
    new Request(`${ORIGIN}${path}`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    }),
    env,
    context,
    createD1Repository(env.DB),
    {},
    {},
    {},
    dependencies
  );
}

beforeEach(clearDatabase);

describe("manual admin provisioning", () => {
  it("creates permanent card URLs without Shopify references or Shopify write-back", async () => {
    const syncProgrammingManifest = vi.fn(async () => ({
      orderId: "gid://shopify/Order/should-not-be-called",
      orderName: "#should-not-be-called",
      metafieldId: "gid://shopify/Metafield/should-not-be-called"
    }));

    const response = await directProvision(manualBody(), { syncProgrammingManifest });
    const payload = await response.json<{
      replayed: boolean;
      manifest: {
        source: string;
        externalOrderReference: string;
        externalSetupReference: string;
        cards: Array<{ programmingUrl: string }>;
      };
      shopifyOrderSync?: unknown;
    }>();

    expect(response.status).toBe(201);
    expect(payload.replayed).toBe(false);
    expect(payload.manifest.externalOrderReference).toMatch(/^MANUAL-[0-9a-f-]{36}$/i);
    expect(payload.manifest.externalSetupReference).toBe(payload.manifest.externalOrderReference);
    expect(payload.manifest.cards).toHaveLength(2);
    expect(payload.manifest.cards[0]?.programmingUrl).toMatch(/^https:\/\/go\.tapntrust\.com\/t\/TNT-/);
    expect(payload.shopifyOrderSync).toBeUndefined();
    expect(syncProgrammingManifest).not.toHaveBeenCalled();

    const stored = await env.DB.prepare(`
      SELECT source, COUNT(*) AS count
      FROM provisioning_batches
      GROUP BY source
    `).first<{ source: string; count: number }>();
    expect(stored?.source).toBe("admin_shopify");
    expect(Number(stored?.count || 0)).toBe(1);
  });

  it("keeps Shopify mode strict when order references are missing", async () => {
    const response = await directProvision({
      ...manualBody(),
      provisioningSource: "shopify"
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid provisioning request" });
  });
});

describe("authenticated admin Google business finder", () => {
  it("searches and resolves a business without exposing the Google API key", async () => {
    const provider: AdminPlaceSearchProvider = {
      search: vi.fn(async () => [{ placeId: PLACE_ID, name: "Manual Test Cafe", address: "100 Test Street" }]),
      getDetails: vi.fn(async () => ({
        businessName: "Manual Test Cafe",
        businessAddress: "100 Test Street, Melbourne VIC",
        googlePlaceId: PLACE_ID,
        googleMapsUrl: "https://www.google.com/maps/place/example",
        reviewUrl: REVIEW_URL,
        category: "Cafe"
      }))
    };
    const dependencies = { placeSearchProvider: provider, googlePlacesApiKey: GOOGLE_KEY };

    const search = await authenticatedAdminGet("/api/admin/places/search?q=manual%20test", dependencies);
    const searchPayload = await search.json<{ suggestions: Array<{ placeId: string; name: string }> }>();
    expect(search.status).toBe(200);
    expect(searchPayload.suggestions).toEqual([{ placeId: PLACE_ID, name: "Manual Test Cafe", address: "100 Test Street" }]);
    expect(provider.search).toHaveBeenCalledWith("manual test", GOOGLE_KEY);
    expect(JSON.stringify(searchPayload)).not.toContain(GOOGLE_KEY);

    const detail = await authenticatedAdminGet(`/api/admin/places/${PLACE_ID}`, dependencies);
    const detailPayload = await detail.json<{ business: { businessName: string; reviewUrl: string } }>();
    expect(detail.status).toBe(200);
    expect(detailPayload.business.businessName).toBe("Manual Test Cafe");
    expect(detailPayload.business.reviewUrl).toBe(REVIEW_URL);
    expect(provider.getDetails).toHaveBeenCalledWith(PLACE_ID, GOOGLE_KEY);
    expect(JSON.stringify(detailPayload)).not.toContain(GOOGLE_KEY);
  });

  it("keeps the business finder behind the existing admin bearer token", async () => {
    const provider: AdminPlaceSearchProvider = {
      search: vi.fn(async () => []),
      getDetails: vi.fn(async () => {
        throw new Error("not expected");
      })
    };
    const context = createExecutionContext();
    const response = await handleRequest(
      new Request(`${ORIGIN}/api/admin/places/search?q=test`),
      env,
      context,
      createD1Repository(env.DB),
      {},
      {},
      {},
      { placeSearchProvider: provider, googlePlacesApiKey: GOOGLE_KEY }
    );

    expect(response.status).toBe(401);
    expect(provider.search).not.toHaveBeenCalled();
  });
});

describe("Google Places admin provider transport", () => {
  it("uses the server key in headers and builds the permanent review destination from the Place ID", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/places:autocomplete")) {
        return Response.json({
          suggestions: [{
            placePrediction: {
              placeId: PLACE_ID,
              structuredFormat: {
                mainText: { text: "Manual Test Cafe" },
                secondaryText: { text: "100 Test Street, Melbourne VIC" }
              }
            }
          }]
        });
      }
      return Response.json({
        id: PLACE_ID,
        displayName: { text: "Manual Test Cafe" },
        formattedAddress: "100 Test Street, Melbourne VIC",
        primaryTypeDisplayName: { text: "Cafe" },
        googleMapsUri: "https://www.google.com/maps/place/example"
      });
    });
    const provider = createAdminPlaceSearchProvider(fetcher);

    const suggestions = await provider.search("Manual Test", GOOGLE_KEY);
    const business = await provider.getDetails(PLACE_ID, GOOGLE_KEY);

    expect(suggestions[0]).toEqual({
      placeId: PLACE_ID,
      name: "Manual Test Cafe",
      address: "100 Test Street, Melbourne VIC"
    });
    expect(business.reviewUrl).toBe(REVIEW_URL);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const call of fetcher.mock.calls) {
      expect(call[1]?.headers).toMatchObject({ "X-Goog-Api-Key": GOOGLE_KEY });
      expect(String(call[0])).not.toContain(GOOGLE_KEY);
    }
  });
});
