import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { handleRequest } from "../src/index";

const ORIGIN = "https://go.tapntrust.com";
const ADMIN_TOKEN = "test-admin-token-that-is-not-a-production-secret";
const REVIEW_URL = "https://search.google.com/local/writereview?placeid=contact-flow";

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM insights_invite_deliveries"),
    env.DB.prepare("DELETE FROM shopify_order_contacts"),
    env.DB.prepare("DELETE FROM insights_subscription_lifecycle_events"),
    env.DB.prepare("DELETE FROM insights_cancellation_requests"),
    env.DB.prepare("DELETE FROM business_insights_intro_redemptions"),
    env.DB.prepare("DELETE FROM insights_billing_events"),
    env.DB.prepare("DELETE FROM insights_subscriptions"),
    env.DB.prepare("DELETE FROM shopify_webhook_receipts"),
    env.DB.prepare("DELETE FROM customer_usage_events"),
    env.DB.prepare("DELETE FROM customer_dashboard_visits"),
    env.DB.prepare("DELETE FROM customer_sessions"),
    env.DB.prepare("DELETE FROM auth_magic_links"),
    env.DB.prepare("DELETE FROM auth_request_limits"),
    env.DB.prepare("DELETE FROM customer_business_access"),
    env.DB.prepare("DELETE FROM customer_users"),
    env.DB.prepare("DELETE FROM provisioning_batch_cards"),
    env.DB.prepare("DELETE FROM provisioning_batches"),
    env.DB.prepare("DELETE FROM insights_entitlements"),
    env.DB.prepare("DELETE FROM tap_events"),
    env.DB.prepare("DELETE FROM cards"),
    env.DB.prepare("DELETE FROM locations"),
    env.DB.prepare("DELETE FROM businesses")
  ]);
}

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SHOPIFY_CLIENT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function dispatch(request: Request) {
  const context = createExecutionContext();
  const response = await handleRequest(request, env, context);
  return { response, context };
}

async function deliverPaidOrder(input: {
  orderReference: string;
  setupReference: string;
  contact?: string;
  role?: string;
  test?: boolean;
  validSignature?: boolean;
}) {
  const body = JSON.stringify({
    id: `order-${input.orderReference}`,
    admin_graphql_api_id: `gid://shopify/Order/order-${input.orderReference}`,
    name: input.orderReference,
    currency: "AUD",
    processed_at: "2026-09-14T10:00:00.000Z",
    contact_email: input.contact || "buyer@example.invalid",
    test: input.test === true,
    line_items: [{
      id: `line-${input.setupReference}`,
      variant_id: "physical-card-only",
      price: "29.99",
      quantity: 1,
      total_discount: "0.00",
      properties: [
        { name: "_Business Setup ID", value: input.setupReference },
        { name: "_Item Role", value: input.role || "Primary Card Package" }
      ]
    }]
  });
  const signature = input.validSignature === false ? "invalid" : await sign(body);
  return dispatch(new Request(`${ORIGIN}/api/shopify/webhooks/orders-paid`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": signature,
      "X-Shopify-Shop-Domain": env.SHOPIFY_SHOP_DOMAIN,
      "X-Shopify-Topic": "orders/paid",
      "X-Shopify-Webhook-Id": crypto.randomUUID()
    },
    body
  }));
}

async function provision(orderReference: string, setupReference: string) {
  const context = createExecutionContext();
  const response = await handleRequest(new Request(`${ORIGIN}/api/admin/provisioning/batches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json",
      Origin: ORIGIN
    },
    body: JSON.stringify({
      externalOrderReference: orderReference,
      externalSetupReference: setupReference,
      businessMode: "new",
      businessName: `Business ${setupReference}`,
      locationMode: "new",
      businessAddress: "100 Test Street, Melbourne VIC",
      googlePlaceId: `place-${setupReference}`,
      googleReviewUrl: REVIEW_URL,
      physicalCardCount: 2
    })
  }), env, context);
  return { response, context, result: await response.clone().json<any>() };
}

beforeEach(clearDatabase);

describe("paid physical-card purchaser contact capture", () => {
  it("reconciles a paid order received before provisioning and becomes invite-eligible after two taps", async () => {
    const paid = await deliverPaidOrder({
      orderReference: "#1201",
      setupReference: "setup-before",
      contact: "Buyer+Before@Example.Invalid"
    });
    expect(paid.response.status).toBe(200);
    await waitOnExecutionContext(paid.context);

    const stored = await env.DB.prepare(`
      SELECT customer_email FROM shopify_order_contacts
      WHERE external_order_reference = '#1201' AND external_setup_reference = 'setup-before'
    `).first<{ customer_email: string }>();
    expect(stored?.customer_email).toBe("buyer+before@example.invalid");

    const created = await provision("#1201", "setup-before");
    expect(created.response.status).toBe(201);
    const batch = await env.DB.prepare(`
      SELECT customer_email FROM provisioning_batches
      WHERE external_order_reference = '#1201' AND external_setup_reference = 'setup-before'
    `).first<{ customer_email: string | null }>();
    expect(batch?.customer_email).toBe("buyer+before@example.invalid");

    const accountCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM customer_users").first<{ count: number }>();
    const entitlementCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM insights_entitlements").first<{ count: number }>();
    expect(Number(accountCount?.count || 0)).toBe(0);
    expect(Number(entitlementCount?.count || 0)).toBe(0);

    const publicToken = created.result.manifest.cards[0].publicToken as string;
    for (let index = 0; index < 2; index += 1) {
      const tap = await dispatch(new Request(`${ORIGIN}/t/${publicToken}`));
      expect(tap.response.status).toBe(302);
      await waitOnExecutionContext(tap.context);
    }

    const inviteContext = createExecutionContext();
    const inviteResponse = await handleRequest(new Request(`${ORIGIN}/api/admin/insights-invites`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    }), env, inviteContext);
    const invite = await inviteResponse.json<any>();
    expect(invite.eligibleCount).toBe(1);
    expect(invite.contacts[0]).toMatchObject({
      email: "buyer+before@example.invalid",
      lifetimeReviewOpportunities: 2,
      eligible: true,
      eligibilityReason: "eligible"
    });
  });

  it("attaches the purchaser contact when provisioning already exists", async () => {
    const created = await provision("#1202", "setup-after");
    expect(created.response.status).toBe(201);

    const before = await env.DB.prepare(`
      SELECT customer_email FROM provisioning_batches
      WHERE external_order_reference = '#1202' AND external_setup_reference = 'setup-after'
    `).first<{ customer_email: string | null }>();
    expect(before?.customer_email).toBeNull();

    const paid = await deliverPaidOrder({
      orderReference: "#1202",
      setupReference: "setup-after",
      contact: "after@example.invalid"
    });
    expect(paid.response.status).toBe(200);
    await waitOnExecutionContext(paid.context);

    const after = await env.DB.prepare(`
      SELECT customer_email FROM provisioning_batches
      WHERE external_order_reference = '#1202' AND external_setup_reference = 'setup-after'
    `).first<{ customer_email: string | null }>();
    expect(after?.customer_email).toBe("after@example.invalid");
  });

  it("does not retain contact data from invalid, test or non-card deliveries", async () => {
    const invalid = await deliverPaidOrder({
      orderReference: "#1203",
      setupReference: "setup-invalid",
      validSignature: false
    });
    expect(invalid.response.status).toBe(401);
    await waitOnExecutionContext(invalid.context);

    const testOrder = await deliverPaidOrder({
      orderReference: "#1204",
      setupReference: "setup-test",
      test: true
    });
    expect(testOrder.response.status).toBe(200);
    await waitOnExecutionContext(testOrder.context);

    const standOnly = await deliverPaidOrder({
      orderReference: "#1205",
      setupReference: "setup-stand",
      role: "Counter Stand"
    });
    expect(standOnly.response.status).toBe(200);
    await waitOnExecutionContext(standOnly.context);

    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM shopify_order_contacts")
      .first<{ count: number }>();
    expect(Number(count?.count || 0)).toBe(0);
  });
});
