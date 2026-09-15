import { describe, expect, it, vi } from "vitest";
import type { ProvisioningManifest } from "../src/provisioning";
import {
  mergeProgrammingManifest,
  programmingManifestBlock,
  ShopifyOrderProgrammingError,
  syncProgrammingManifestToShopifyOrder
} from "../src/shopify-order-programming";

const CONFIG = {
  shopDomain: "tapntrust-test.myshopify.com",
  accessToken: "test-admin-token",
  apiVersion: "2026-07"
};

function manifest(setup = "setup-one", urls = ["TNT-AAAAAAAAAAAAAAAAAAAAAAAAAA", "TNT-BBBBBBBBBBBBBBBBBBBBBBBBBB"]): ProvisioningManifest {
  return {
    id: "batch-one",
    source: "admin_shopify",
    externalOrderReference: "#1001",
    externalSetupReference: setup,
    businessId: "business-one",
    businessName: "KFC George Street Sydney",
    locationId: "location-one",
    businessAddress: "485 George Street, Sydney NSW 2000",
    googleReviewUrl: "https://search.google.com/local/writereview?placeid=test",
    physicalCardCount: urls.length,
    createdAt: "2026-09-15T01:00:00.000Z",
    cards: urls.map((token, index) => ({
      id: `card-${index + 1}`,
      ordinal: index + 1,
      publicToken: token,
      programmingUrl: `https://go.tapntrust.com/t/${token}`,
      label: `Card ${index + 1}`
    }))
  };
}

function json(data: unknown): Response {
  return Response.json(data);
}

function bodyOf(init?: RequestInit): { query: string; variables: Record<string, unknown> } {
  if (typeof init?.body !== "string") throw new Error("Expected GraphQL body");
  return JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
}

describe("Shopify order programming metadata", () => {
  it("builds readable card URLs and replaces only the matching setup block", () => {
    const first = manifest();
    const second = manifest("setup-two", ["TNT-CCCCCCCCCCCCCCCCCCCCCCCCCC"]);
    const initial = programmingManifestBlock(first);
    const both = mergeProgrammingManifest(initial, second);

    expect(both).toContain("TapNTrust setup setup-one");
    expect(both).toContain("Card 1: https://go.tapntrust.com/t/TNT-AAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(both).toContain("TapNTrust setup setup-two");

    const updatedFirst = manifest("setup-one", ["TNT-DDDDDDDDDDDDDDDDDDDDDDDDDD"]);
    const replaced = mergeProgrammingManifest(both, updatedFirst);
    expect(replaced).toContain("TNT-DDDDDDDDDDDDDDDDDDDDDDDDDD");
    expect(replaced).not.toContain("TNT-AAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(replaced).toContain("TapNTrust setup setup-two");
  });

  it("creates and pins the order metafield definition, then writes the manifest", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: { metafieldDefinitions: { nodes: [] } } }))
      .mockResolvedValueOnce(json({
        data: {
          metafieldDefinitionCreate: {
            createdDefinition: {
              id: "gid://shopify/MetafieldDefinition/1",
              namespace: "tapntrust",
              key: "programming_urls",
              pinnedPosition: 1,
              type: { name: "multi_line_text_field" }
            },
            userErrors: []
          }
        }
      }))
      .mockResolvedValueOnce(json({
        data: {
          orderByIdentifier: {
            id: "gid://shopify/Order/1001",
            name: "#1001",
            metafield: null
          }
        }
      }))
      .mockResolvedValueOnce(json({
        data: {
          metafieldsSet: {
            metafields: [{
              id: "gid://shopify/Metafield/10",
              namespace: "tapntrust",
              key: "programming_urls",
              type: "multi_line_text_field",
              value: "saved"
            }],
            userErrors: []
          }
        }
      }));

    const result = await syncProgrammingManifestToShopifyOrder(CONFIG, manifest(), fetcher);

    expect(result).toEqual({
      orderId: "gid://shopify/Order/1001",
      orderName: "#1001",
      metafieldId: "gid://shopify/Metafield/10"
    });
    expect(fetcher).toHaveBeenCalledTimes(4);

    const createBody = bodyOf(fetcher.mock.calls[1]?.[1]);
    expect(createBody.variables).toMatchObject({
      definition: {
        name: "TapNTrust Programming URLs",
        namespace: "tapntrust",
        key: "programming_urls",
        type: "multi_line_text_field",
        ownerType: "ORDER",
        pin: true
      }
    });

    const orderBody = bodyOf(fetcher.mock.calls[2]?.[1]);
    expect(orderBody.variables).toEqual({ identifier: { name: "#1001" } });

    const setBody = bodyOf(fetcher.mock.calls[3]?.[1]);
    const metafields = setBody.variables.metafields as Array<Record<string, unknown>>;
    expect(metafields[0]).toMatchObject({
      ownerId: "gid://shopify/Order/1001",
      namespace: "tapntrust",
      key: "programming_urls",
      type: "multi_line_text_field",
      compareDigest: null
    });
    expect(String(metafields[0]?.value)).toContain("Card 2: https://go.tapntrust.com/t/TNT-BBBBBBBBBBBBBBBBBBBBBBBBBB");
  });

  it("pins an existing definition and preserves programming URLs for other setups", async () => {
    const oldManifest = manifest("setup-old", ["TNT-EEEEEEEEEEEEEEEEEEEEEEEEEE"]);
    const existingValue = programmingManifestBlock(oldManifest);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({
        data: {
          metafieldDefinitions: {
            nodes: [{
              id: "gid://shopify/MetafieldDefinition/1",
              namespace: "tapntrust",
              key: "programming_urls",
              pinnedPosition: null,
              type: { name: "multi_line_text_field" }
            }]
          }
        }
      }))
      .mockResolvedValueOnce(json({
        data: {
          metafieldDefinitionPin: {
            pinnedDefinition: { id: "gid://shopify/MetafieldDefinition/1", pinnedPosition: 1 },
            userErrors: []
          }
        }
      }))
      .mockResolvedValueOnce(json({
        data: {
          orderByIdentifier: {
            id: "gid://shopify/Order/1001",
            name: "#1001",
            metafield: {
              id: "gid://shopify/Metafield/10",
              value: existingValue,
              type: "multi_line_text_field",
              compareDigest: "digest-1"
            }
          }
        }
      }))
      .mockResolvedValueOnce(json({
        data: {
          metafieldsSet: {
            metafields: [{ id: "gid://shopify/Metafield/10", namespace: "tapntrust", key: "programming_urls", type: "multi_line_text_field", value: "saved" }],
            userErrors: []
          }
        }
      }));

    await syncProgrammingManifestToShopifyOrder(CONFIG, manifest("setup-new"), fetcher);
    const setBody = bodyOf(fetcher.mock.calls[3]?.[1]);
    const metafield = (setBody.variables.metafields as Array<Record<string, unknown>>)[0];
    expect(metafield?.compareDigest).toBe("digest-1");
    expect(String(metafield?.value)).toContain("TapNTrust setup setup-old");
    expect(String(metafield?.value)).toContain("TapNTrust setup setup-new");
  });

  it("re-reads and retries once when Shopify rejects a concurrent metafield update", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({
        data: {
          metafieldDefinitions: {
            nodes: [{
              id: "gid://shopify/MetafieldDefinition/1",
              namespace: "tapntrust",
              key: "programming_urls",
              pinnedPosition: 1,
              type: { name: "multi_line_text_field" }
            }]
          }
        }
      }))
      .mockResolvedValueOnce(json({
        data: {
          orderByIdentifier: {
            id: "gid://shopify/Order/1001",
            name: "#1001",
            metafield: {
              id: "gid://shopify/Metafield/10",
              value: "existing",
              type: "multi_line_text_field",
              compareDigest: "digest-old"
            }
          }
        }
      }))
      .mockResolvedValueOnce(json({
        data: {
          metafieldsSet: {
            metafields: [],
            userErrors: [{ field: ["metafields", "0", "compareDigest"], message: "Compare digest mismatch", code: "STALE_OBJECT" }]
          }
        }
      }))
      .mockResolvedValueOnce(json({
        data: {
          orderByIdentifier: {
            id: "gid://shopify/Order/1001",
            name: "#1001",
            metafield: {
              id: "gid://shopify/Metafield/10",
              value: "concurrent setup data",
              type: "multi_line_text_field",
              compareDigest: "digest-new"
            }
          }
        }
      }))
      .mockResolvedValueOnce(json({
        data: {
          metafieldsSet: {
            metafields: [{ id: "gid://shopify/Metafield/10", namespace: "tapntrust", key: "programming_urls", type: "multi_line_text_field", value: "saved" }],
            userErrors: []
          }
        }
      }));

    const result = await syncProgrammingManifestToShopifyOrder(CONFIG, manifest(), fetcher);
    expect(result.metafieldId).toBe("gid://shopify/Metafield/10");
    expect(fetcher).toHaveBeenCalledTimes(5);
    const retrySet = bodyOf(fetcher.mock.calls[4]?.[1]);
    const metafield = (retrySet.variables.metafields as Array<Record<string, unknown>>)[0];
    expect(metafield?.compareDigest).toBe("digest-new");
    expect(String(metafield?.value)).toContain("concurrent setup data");
    expect(String(metafield?.value)).toContain("TapNTrust setup setup-one");
  });

  it("fails closed when the Shopify order cannot be resolved", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({
        data: {
          metafieldDefinitions: {
            nodes: [{
              id: "gid://shopify/MetafieldDefinition/1",
              namespace: "tapntrust",
              key: "programming_urls",
              pinnedPosition: 1,
              type: { name: "multi_line_text_field" }
            }]
          }
        }
      }))
      .mockResolvedValueOnce(json({ data: { orderByIdentifier: null } }));

    const expectedError: Partial<ShopifyOrderProgrammingError> = { code: "order_not_found" };
    await expect(syncProgrammingManifestToShopifyOrder(CONFIG, manifest(), fetcher))
      .rejects.toMatchObject(expectedError);
  });
});
