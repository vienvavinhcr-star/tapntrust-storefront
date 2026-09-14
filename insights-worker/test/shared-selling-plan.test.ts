import { describe, expect, it } from "vitest";
import { readShopifyOrdersPaidWebhook } from "../src/shopify-webhook";

const SECRET = "shared-plan-test-secret";

async function sign(raw: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))
  );
  return btoa(String.fromCharCode(...bytes));
}

describe("shared Insights selling plan", () => {
  it("accepts one monthly selling plan for intro and recurring billing", async () => {
    const planId = "gid://shopify/SellingPlan/2791899267";
    const payload = {
      id: "123",
      admin_graphql_api_id: "gid://shopify/Order/123",
      name: "#1001",
      currency: "AUD",
      processed_at: "2026-09-15T00:00:00.000Z",
      test: false,
      email: "owner@example.invalid",
      line_items: [{
        id: "456",
        admin_graphql_api_id: "gid://shopify/LineItem/456",
        variant_id: "48192855376003",
        quantity: 1,
        price: "1.99",
        total_discount: "0.00",
        price_set: { shop_money: { amount: "1.99", currency_code: "AUD" } },
        properties: [{ name: "_Business Setup ID", value: "setup-shared-plan" }]
      }]
    };
    const raw = JSON.stringify(payload);
    const request = new Request("https://go.tapntrust.com/api/shopify/webhooks/orders-paid", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Hmac-Sha256": await sign(raw),
        "X-Shopify-Shop-Domain": "iz8qif-0j.myshopify.com",
        "X-Shopify-Topic": "orders/paid",
        "X-Shopify-Webhook-Id": "shared-plan-webhook"
      },
      body: raw
    });

    const order = await readShopifyOrdersPaidWebhook(request, {
      webhookSecret: SECRET,
      shopDomain: "iz8qif-0j.myshopify.com",
      insightsVariantId: "gid://shopify/ProductVariant/48192855376003",
      introSellingPlanId: planId,
      standardSellingPlanId: planId
    }, "2026-09-15T00:00:01.000Z");

    expect(order.billingLines).toHaveLength(1);
    expect(order.billingLines[0]?.amountMinor).toBe(199);
  });
});
