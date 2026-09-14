import { describe, expect, it } from "vitest";
import { getShopifyAdminAccessToken } from "../src/shopify-admin-token";

function uniqueClientId(label: string): string {
  return `${label}-${crypto.randomUUID()}`;
}

describe("Shopify admin token transport", () => {
  it("uses manual redirect handling so redirects remain inspectable responses", async () => {
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response("", {
        status: 302,
        headers: { Location: "https://admin.shopify.com/" }
      });
    }) as typeof fetch;

    await expect(getShopifyAdminAccessToken({
      shopDomain: "redirect-test.myshopify.com",
      clientId: uniqueClientId("redirect-client"),
      clientSecret: "test-secret"
    }, fetcher, true)).rejects.toMatchObject({
      code: "request_failed",
      providerStatus: 302
    });
  });
});
