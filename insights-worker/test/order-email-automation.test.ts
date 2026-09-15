import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleUpdatedOrderInsightsEmail,
  processPaidOrderQuickGuide,
  type OrderEmailAutomationEnv
} from "../src/order-email-automation";

const WEBHOOK_SECRET = "test-shopify-webhook-secret-not-for-production";
const SHOP_DOMAIN = "tapntrust-test.myshopify.com";
const INSIGHTS_VARIANT_ID = "gid://shopify/ProductVariant/400000000001";
const QUICK_URL = "https://cdn.shopify.com/quick.pdf";
const USEFUL_URL = "https://cdn.shopify.com/useful.pdf";

let clientCounter = 0;

function testEnv(overrides: Partial<OrderEmailAutomationEnv> = {}): OrderEmailAutomationEnv {
  clientCounter += 1;
  return {
    RESEND_API_KEY: "re_test_key",
    SHOPIFY_CLIENT_ID: `test-client-${clientCounter}`,
    SHOPIFY_CLIENT_SECRET: WEBHOOK_SECRET,
    SHOPIFY_SHOP_DOMAIN: SHOP_DOMAIN,
    SHOPIFY_ADMIN_API_VERSION: "2026-07",
    SHOPIFY_INSIGHTS_VARIANT_ID: INSIGHTS_VARIANT_ID,
    EMAIL_AUTOMATION_CUTOFF: "2026-09-15T00:00:00+10:00",
    QUICK_SETUP_GUIDE_URL: QUICK_URL,
    USEFUL_GUIDE_URL: USEFUL_URL,
    ...overrides
  };
}

function orderPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "12345",
    admin_graphql_api_id: "gid://shopify/Order/12345",
    created_at: "2026-09-16T09:00:00+10:00",
    email: "customer@example.com",
    contact_email: "customer@example.com",
    tags: "",
    line_items: [{ variant_id: "400000000001" }],
    ...overrides
  };
}

async function sign(rawBody: string, secret = WEBHOOK_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody))
  );
  return btoa(String.fromCharCode(...signature));
}

async function webhookRequest(
  topic: "orders/paid" | "orders/updated",
  payload: Record<string, unknown>,
  hmac?: string
): Promise<Request> {
  const raw = JSON.stringify(payload);
  return new Request(`https://go.tapntrust.com/api/shopify/webhooks/${topic === "orders/paid" ? "orders-paid" : "orders-updated"}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Shop-Domain": SHOP_DOMAIN,
      "X-Shopify-Topic": topic,
      "X-Shopify-Hmac-Sha256": hmac ?? await sign(raw)
    },
    body: raw
  });
}

function successFetchRecorder() {
  const calls: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    let body: Record<string, unknown> | undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = undefined;
      }
    }
    calls.push({ url, init, body });

    if (url === "https://api.resend.com/emails") {
      return Response.json({ id: "email_123" }, { status: 200 });
    }
    if (url === `https://${SHOP_DOMAIN}/admin/oauth/access_token`) {
      return Response.json({ access_token: "shopify_access_token", expires_in: 3600 });
    }
    if (url === `https://${SHOP_DOMAIN}/admin/api/2026-07/graphql.json`) {
      return Response.json({ data: { tagsAdd: { userErrors: [] } } });
    }
    return new Response("unexpected fetch", { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("paid order quick-guide automation", () => {
  it("ignores orders created before the cutoff", async () => {
    const { fetchMock } = successFetchRecorder();
    const request = await webhookRequest("orders/paid", orderPayload({
      created_at: "2026-09-14T23:59:59+10:00"
    }));

    await expect(processPaidOrderQuickGuide(request, testEnv())).resolves.toBe("ignored");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores paid orders with no customer email", async () => {
    const { fetchMock } = successFetchRecorder();
    const request = await webhookRequest("orders/paid", orderPayload({
      email: null,
      contact_email: null,
      customer: null
    }));

    await expect(processPaidOrderQuickGuide(request, testEnv())).resolves.toBe("ignored");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores orders already tagged quick-guide-sent", async () => {
    const { fetchMock } = successFetchRecorder();
    const request = await webhookRequest("orders/paid", orderPayload({ tags: "quick-guide-sent" }));

    await expect(processPaidOrderQuickGuide(request, testEnv())).resolves.toBe("ignored");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("schedules the template with both PDF URLs and adds quick-guide-sent", async () => {
    const { calls } = successFetchRecorder();
    const request = await webhookRequest("orders/paid", orderPayload());
    const now = new Date("2026-09-16T00:00:00.000Z");

    await expect(processPaidOrderQuickGuide(request, testEnv(), now)).resolves.toBe("scheduled");

    const resendCall = calls.find((call) => call.url === "https://api.resend.com/emails");
    expect(resendCall).toBeTruthy();
    expect(resendCall?.body).toMatchObject({
      to: ["customer@example.com"],
      scheduled_at: "2026-09-16T00:02:00.000Z",
      template: { id: "tapntrust-order-quick-setup" },
      attachments: [
        { filename: "Tapntrust-Quick-Setup-Guide.pdf", url: QUICK_URL },
        { filename: "Tapntrust-Useful-Guide.pdf", url: USEFUL_URL }
      ]
    });
    expect(new Headers(resendCall?.init?.headers).get("Idempotency-Key"))
      .toBe("quick-guide/gid://shopify/Order/12345");

    const tagCall = calls.find((call) => call.url.endsWith("/graphql.json"));
    expect(tagCall?.body).toMatchObject({
      variables: {
        id: "gid://shopify/Order/12345",
        tags: ["quick-guide-sent"]
      }
    });
  });

  it("rejects a webhook with an invalid HMAC before making external calls", async () => {
    const { fetchMock } = successFetchRecorder();
    const request = await webhookRequest("orders/paid", orderPayload(), "invalid-hmac");

    await expect(processPaidOrderQuickGuide(request, testEnv())).rejects.toMatchObject({
      code: "invalid_signature",
      status: 401
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the same Resend idempotency key when Shopify retries", async () => {
    const { calls } = successFetchRecorder();
    const env = testEnv();

    await processPaidOrderQuickGuide(await webhookRequest("orders/paid", orderPayload()), env);
    await processPaidOrderQuickGuide(await webhookRequest("orders/paid", orderPayload()), env);

    const keys = calls
      .filter((call) => call.url === "https://api.resend.com/emails")
      .map((call) => new Headers(call.init?.headers).get("Idempotency-Key"));
    expect(keys).toEqual([
      "quick-guide/gid://shopify/Order/12345",
      "quick-guide/gid://shopify/Order/12345"
    ]);
  });
});

describe("Tapntrust Insights ready-email automation", () => {
  it("ignores orders without insight-progress", async () => {
    const { fetchMock } = successFetchRecorder();
    const response = await handleUpdatedOrderInsightsEmail(
      await webhookRequest("orders/updated", orderPayload({ tags: "subscription" })),
      testEnv()
    );

    expect(await response.json()).toMatchObject({ result: "ignored_not_ready" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires Shopify's subscription tag", async () => {
    const { fetchMock } = successFetchRecorder();
    const response = await handleUpdatedOrderInsightsEmail(
      await webhookRequest("orders/updated", orderPayload({ tags: "insight-progress" })),
      testEnv()
    );

    expect(await response.json()).toMatchObject({ result: "ignored_not_subscription" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores orders that do not contain the configured Insights variant", async () => {
    const { fetchMock } = successFetchRecorder();
    const response = await handleUpdatedOrderInsightsEmail(
      await webhookRequest("orders/updated", orderPayload({
        tags: "subscription, insight-progress",
        line_items: [{ variant_id: "999999" }]
      })),
      testEnv()
    );

    expect(await response.json()).toMatchObject({ result: "ignored_no_insights_variant" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not resend after insight-email-sent is present", async () => {
    const { fetchMock } = successFetchRecorder();
    const response = await handleUpdatedOrderInsightsEmail(
      await webhookRequest("orders/updated", orderPayload({
        tags: "subscription, insight-progress, insight-email-sent"
      })),
      testEnv()
    );

    expect(await response.json()).toMatchObject({ result: "duplicate" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the Insights template and adds insight-email-sent when ready", async () => {
    const { calls } = successFetchRecorder();
    const response = await handleUpdatedOrderInsightsEmail(
      await webhookRequest("orders/updated", orderPayload({
        tags: "subscription, insight-progress"
      })),
      testEnv()
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: "sent" });

    const resendCall = calls.find((call) => call.url === "https://api.resend.com/emails");
    expect(resendCall?.body).toMatchObject({
      to: ["customer@example.com"],
      template: { id: "tapntrust-insights-getting-started" }
    });
    expect(new Headers(resendCall?.init?.headers).get("Idempotency-Key"))
      .toBe("insight-welcome/gid://shopify/Order/12345");

    const tagCall = calls.find((call) => call.url.endsWith("/graphql.json"));
    expect(tagCall?.body).toMatchObject({
      variables: {
        id: "gid://shopify/Order/12345",
        tags: ["insight-email-sent"]
      }
    });
  });

  it("ignores an old order even if insight-progress is added later", async () => {
    const { fetchMock } = successFetchRecorder();
    const response = await handleUpdatedOrderInsightsEmail(
      await webhookRequest("orders/updated", orderPayload({
        created_at: "2026-09-14T23:00:00+10:00",
        tags: "subscription, insight-progress"
      })),
      testEnv()
    );

    expect(await response.json()).toMatchObject({ result: "ignored_old_order" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
