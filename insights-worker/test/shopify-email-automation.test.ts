import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  handleOrdersUpdatedEmailAutomation,
  processPaidOrderEmailAutomation,
  TRANSACTIONAL_EMAIL_AUTOMATION_CUTOFF,
  type ShopifyEmailAutomationEnv
} from "../src/shopify-email-automation";

const WEBHOOK_SECRET = "test-shopify-webhook-secret-not-for-production";
const SHOP_DOMAIN = "tapntrust-test.myshopify.com";
const INSIGHTS_VARIANT_ID = "400000000001";

type FetchCall = { url: string; init?: RequestInit };

function automationEnv(overrides: Partial<ShopifyEmailAutomationEnv> = {}): ShopifyEmailAutomationEnv {
  return {
    DB: env.DB,
    RESEND_API_KEY: "re_test_not_production",
    SHOPIFY_CLIENT_ID: "test-shopify-client-id",
    SHOPIFY_CLIENT_SECRET: WEBHOOK_SECRET,
    SHOPIFY_SHOP_DOMAIN: SHOP_DOMAIN,
    SHOPIFY_ADMIN_API_VERSION: "2026-07",
    SHOPIFY_INSIGHTS_VARIANT_ID: INSIGHTS_VARIANT_ID,
    QUICK_SETUP_GUIDE_URL: "https://tapntrust.com/guides/quick-setup.pdf",
    USEFUL_GUIDE_URL: "https://tapntrust.com/guides/useful-guide.pdf",
    ...overrides
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

function orderPayload({
  id = "1234567890",
  createdAt = "2026-09-15T13:30:00.000Z",
  email = "customer@example.com",
  tags = "",
  variantId = INSIGHTS_VARIANT_ID,
  test = false
}: {
  id?: string;
  createdAt?: string;
  email?: string | null;
  tags?: string;
  variantId?: string;
  test?: boolean;
} = {}): Record<string, unknown> {
  return {
    id,
    admin_graphql_api_id: `gid://shopify/Order/${id}`,
    name: `#${id}`,
    created_at: createdAt,
    processed_at: createdAt,
    test,
    email,
    contact_email: email,
    customer: email ? { email } : null,
    tags,
    line_items: [{ id: `line-${id}`, variant_id: variantId, quantity: 1 }]
  };
}

async function webhookRequest(
  topic: "orders/paid" | "orders/updated",
  payload: Record<string, unknown>,
  hmac?: string
): Promise<Request> {
  const rawBody = JSON.stringify(payload);
  return new Request("https://go.tapntrust.com/api/shopify/webhooks/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": hmac ?? await sign(rawBody),
      "X-Shopify-Shop-Domain": SHOP_DOMAIN,
      "X-Shopify-Topic": topic,
      "X-Shopify-Webhook-Id": crypto.randomUUID()
    },
    body: rawBody
  });
}

function providerFetch(calls: FetchCall[], { failTags = false }: { failTags?: boolean } = {}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://api.resend.com/emails") {
      return Response.json({ id: "email_test_123" });
    }
    if (url.endsWith("/graphql.json")) {
      return Response.json({
        data: {
          tagsAdd: failTags
            ? { node: null, userErrors: [{ message: "temporary failure" }] }
            : { node: { id: "gid://shopify/Order/1234567890" }, userErrors: [] }
        }
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
}

const adminToken = async () => "test-admin-access-token";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM transactional_email_deliveries").run();
});

describe("Shopify transactional email automation", () => {
  it("uses the requested Melbourne cutoff", () => {
    expect(TRANSACTIONAL_EMAIL_AUTOMATION_CUTOFF).toBe("2026-09-15T00:00:00+10:00");
  });

  it("does not send a paid-order email for an order created before the cutoff", async () => {
    const calls: FetchCall[] = [];
    const request = await webhookRequest("orders/paid", orderPayload({ createdAt: "2026-09-14T13:59:59.000Z" }));
    const result = await processPaidOrderEmailAutomation(request, automationEnv(), new Date(), {
      fetcher: providerFetch(calls), getAdminAccessToken: adminToken
    });
    expect(result).toEqual({ result: "ignored", retry: false });
    expect(calls).toHaveLength(0);
  });

  it("schedules the quick guide two minutes after a recent paid order and tags it", async () => {
    const calls: FetchCall[] = [];
    const request = await webhookRequest("orders/paid", orderPayload());
    const result = await processPaidOrderEmailAutomation(request, automationEnv(), new Date("2026-09-15T14:00:00Z"), {
      fetcher: providerFetch(calls), getAdminAccessToken: adminToken
    });
    expect(result).toEqual({ result: "scheduled", retry: false });
    const resend = calls.find((call) => call.url === "https://api.resend.com/emails");
    expect(resend).toBeTruthy();
    const resendBody = JSON.parse(String(resend?.init?.body));
    expect(resendBody.scheduled_at).toBe("in 2 min");
    expect(resendBody.template.id).toBe("tapntrust-order-quick-setup");
    expect(resendBody.attachments).toHaveLength(2);
    expect(new Headers(resend?.init?.headers).get("Idempotency-Key")).toBe("tapntrust/quick_setup/1234567890");
    const shopify = calls.find((call) => call.url.endsWith("/graphql.json"));
    expect(JSON.parse(String(shopify?.init?.body)).variables.tags).toEqual(["quick-guide-sent"]);
  });

  it("does not send without an order email or when quick-guide-sent already exists", async () => {
    for (const payload of [orderPayload({ email: null }), orderPayload({ tags: "quick-guide-sent" })]) {
      const calls: FetchCall[] = [];
      const result = await processPaidOrderEmailAutomation(
        await webhookRequest("orders/paid", payload), automationEnv(), new Date(), {
          fetcher: providerFetch(calls), getAdminAccessToken: adminToken
        }
      );
      expect(result.result).toBe("ignored");
      expect(calls).toHaveLength(0);
    }
  });

  it("does not send when the paid webhook signature is invalid", async () => {
    const calls: FetchCall[] = [];
    const result = await processPaidOrderEmailAutomation(
      await webhookRequest("orders/paid", orderPayload(), "invalid"), automationEnv(), new Date(), {
        fetcher: providerFetch(calls), getAdminAccessToken: adminToken
      }
    );
    expect(result).toEqual({ result: "rejected", retry: false });
    expect(calls).toHaveLength(0);
  });

  it("does not resend on a Shopify retry even when the retry payload is stale", async () => {
    const calls: FetchCall[] = [];
    const first = await processPaidOrderEmailAutomation(
      await webhookRequest("orders/paid", orderPayload()), automationEnv(), new Date(), {
        fetcher: providerFetch(calls), getAdminAccessToken: adminToken
      }
    );
    expect(first.result).toBe("scheduled");

    const second = await processPaidOrderEmailAutomation(
      await webhookRequest("orders/paid", orderPayload()), automationEnv(), new Date(), {
        fetcher: providerFetch(calls), getAdminAccessToken: adminToken
      }
    );
    expect(["reconciled", "duplicate"]).toContain(second.result);
    expect(calls.filter((call) => call.url === "https://api.resend.com/emails")).toHaveLength(1);
  });

  it("ignores order updates until insight-progress exists and the Insights variant is present", async () => {
    const cases = [
      orderPayload(),
      orderPayload({ tags: "insight-progress", variantId: "999999" }),
      orderPayload({ tags: "insight-progress, insight-email-sent" })
    ];
    for (const payload of cases) {
      const calls: FetchCall[] = [];
      const response = await handleOrdersUpdatedEmailAutomation(
        await webhookRequest("orders/updated", payload), automationEnv(), new Date(), {
          fetcher: providerFetch(calls), getAdminAccessToken: adminToken
        }
      );
      expect(response.status).toBe(200);
      expect((await response.json<{ result: string }>()).result).toBe("ignored");
      expect(calls).toHaveLength(0);
    }
  });

  it("sends the Insights template immediately when insight-progress is added, then tags the order", async () => {
    const calls: FetchCall[] = [];
    const response = await handleOrdersUpdatedEmailAutomation(
      await webhookRequest("orders/updated", orderPayload({ tags: "insight-progress" })), automationEnv(), new Date(), {
        fetcher: providerFetch(calls), getAdminAccessToken: adminToken
      }
    );
    expect(response.status).toBe(200);
    const resend = calls.find((call) => call.url === "https://api.resend.com/emails");
    const resendBody = JSON.parse(String(resend?.init?.body));
    expect(resendBody.template.id).toBe("tapntrust-insights-getting-started");
    expect(resendBody.scheduled_at).toBeUndefined();
    expect(JSON.parse(String(calls.find((call) => call.url.endsWith("/graphql.json"))?.init?.body)).variables.tags)
      .toEqual(["insight-email-sent"]);
  });

  it("never sends an Insights email for an old order even if insight-progress is added later", async () => {
    const calls: FetchCall[] = [];
    const response = await handleOrdersUpdatedEmailAutomation(
      await webhookRequest("orders/updated", orderPayload({
        tags: "insight-progress",
        createdAt: "2026-09-14T13:59:59.000Z"
      })), automationEnv(), new Date(), {
        fetcher: providerFetch(calls), getAdminAccessToken: adminToken
      }
    );
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it("retries only the Shopify tag when tagging failed after Resend accepted the email", async () => {
    const firstCalls: FetchCall[] = [];
    const first = await handleOrdersUpdatedEmailAutomation(
      await webhookRequest("orders/updated", orderPayload({ tags: "insight-progress" })), automationEnv(), new Date(), {
        fetcher: providerFetch(firstCalls, { failTags: true }), getAdminAccessToken: adminToken
      }
    );
    expect(first.status).toBe(503);
    expect(firstCalls.filter((call) => call.url === "https://api.resend.com/emails")).toHaveLength(1);

    const secondCalls: FetchCall[] = [];
    const second = await handleOrdersUpdatedEmailAutomation(
      await webhookRequest("orders/updated", orderPayload({ tags: "insight-progress" })), automationEnv(), new Date(), {
        fetcher: providerFetch(secondCalls), getAdminAccessToken: adminToken
      }
    );
    expect(second.status).toBe(200);
    expect(secondCalls.filter((call) => call.url === "https://api.resend.com/emails")).toHaveLength(0);
    expect(secondCalls.filter((call) => call.url.endsWith("/graphql.json"))).toHaveLength(1);
  });
});
