import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { handleSubscriptionInsightsOrderUpdated } from "../src/shopify-subscription-email-gate";
import type { ShopifyEmailAutomationEnv } from "../src/shopify-email-automation";

const SHOP_DOMAIN = "tapntrust-test.myshopify.com";
const WEBHOOK_SECRET = "test-shopify-webhook-secret-not-for-production";
const INSIGHTS_VARIANT_ID = "400000000001";

function automationEnv(): ShopifyEmailAutomationEnv {
  return {
    DB: env.DB,
    RESEND_API_KEY: "re_test_not_production",
    SHOPIFY_CLIENT_ID: "test-shopify-client-id",
    SHOPIFY_CLIENT_SECRET: WEBHOOK_SECRET,
    SHOPIFY_SHOP_DOMAIN: SHOP_DOMAIN,
    SHOPIFY_ADMIN_API_VERSION: "2026-07",
    SHOPIFY_INSIGHTS_VARIANT_ID: INSIGHTS_VARIANT_ID,
    QUICK_SETUP_GUIDE_URL: "https://tapntrust.com/guides/quick-setup.pdf",
    USEFUL_GUIDE_URL: "https://tapntrust.com/guides/useful-guide.pdf"
  };
}

async function sign(rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return btoa(String.fromCharCode(...signature));
}

async function requestFor(tags: string, hmacOverride?: string): Promise<Request> {
  const payload = {
    id: "1234567890",
    admin_graphql_api_id: "gid://shopify/Order/1234567890",
    created_at: "2026-09-15T14:00:00.000Z",
    email: "customer@example.com",
    contact_email: "customer@example.com",
    tags,
    line_items: [{ variant_id: INSIGHTS_VARIANT_ID, quantity: 1 }]
  };
  const body = JSON.stringify(payload);
  return new Request("https://go.tapntrust.com/api/shopify/webhooks/orders-updated", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": hmacOverride ?? await sign(body),
      "X-Shopify-Shop-Domain": SHOP_DOMAIN,
      "X-Shopify-Topic": "orders/updated",
      "X-Shopify-Webhook-Id": crypto.randomUUID()
    },
    body
  });
}

describe("Shopify Insights subscription tag gate", () => {
  it("ignores insight-progress on a verified non-subscription order", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const response = await handleSubscriptionInsightsOrderUpdated(
      await requestFor("insight-progress"),
      automationEnv(),
      new Date(),
      { fetcher }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: "ignored",
      reason: "not_subscription_order"
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not let an invalid HMAC bypass verification through the subscription gate", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const response = await handleSubscriptionInsightsOrderUpdated(
      await requestFor("insight-progress", "invalid"),
      automationEnv(),
      new Date(),
      { fetcher }
    );

    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows a verified subscription order to continue into the Insights handler", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://api.resend.com/emails") {
        return Response.json({ id: "email_test_subscription" });
      }
      if (url.endsWith("/graphql.json")) {
        return Response.json({
          data: {
            tagsAdd: {
              node: { id: "gid://shopify/Order/1234567890" },
              userErrors: []
            }
          }
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;

    const response = await handleSubscriptionInsightsOrderUpdated(
      await requestFor("subscription, insight-progress"),
      automationEnv(),
      new Date(),
      {
        fetcher,
        getAdminAccessToken: async () => "test-admin-token"
      }
    );

    expect(response.status).toBe(200);
    expect(calls).toContain("https://api.resend.com/emails");
    expect(calls.some((url) => url.endsWith("/graphql.json"))).toBe(true);
  });
});
