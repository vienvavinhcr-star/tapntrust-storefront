import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { handleRequest } from "../src/index";
import { processShopifyPaidOrder } from "../src/billing-service";
import type { MagicLinkMailer } from "../src/auth";

const ORIGIN = "https://go.tapntrust.com";
const EMAIL = "owner@example.invalid";
const BUSINESS_ID = "activation-business";
const LOCATION_ID = "activation-location";
const PLACE_ID = "activation-place";
const REVIEW_URL = `https://search.google.com/local/writereview?placeid=${PLACE_ID}`;

let magicUrl = "";

const mailer: MagicLinkMailer = {
  async sendMagicLink(_email, url) {
    magicUrl = url;
  }
};

const placesProvider = {
  async fetchSummary() {
    return { id: PLACE_ID, displayName: "Activation Business", rating: 4.8, userRatingCount: 18 } as any;
  },
  async fetchReviews() {
    return { reviews: [] } as any;
  }
};

const discountProvider = {
  async createIntroDiscount(input: { code: string }) {
    return { nodeId: "gid://shopify/DiscountCodeNode/test-activation", code: input.code };
  }
};

const storefrontFetch: typeof fetch = async (_input, init) => {
  const request = JSON.parse(String(init?.body || "{}"));
  const code = request.variables?.input?.discountCodes?.[0] || "";
  return Response.json({
    data: {
      cartCreate: {
        cart: {
          id: "gid://shopify/Cart/activation-test",
          checkoutUrl: "https://iz8qif-0j.myshopify.com/checkouts/activation-test",
          discountCodes: code ? [{ code, applicable: true }] : []
        },
        userErrors: [],
        warnings: []
      }
    }
  });
};

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM insights_activation_checkouts"),
    env.DB.prepare("DELETE FROM insights_activation_sessions"),
    env.DB.prepare("DELETE FROM insights_activation_magic_links"),
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
  magicUrl = "";
}

async function seedPurchasedCards(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO businesses (id, name) VALUES (?1, ?2)")
      .bind(BUSINESS_ID, "Activation Business"),
    env.DB.prepare(`
      INSERT INTO locations (
        id, business_id, business_name, business_address,
        google_place_id, google_review_url, active
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
    `).bind(
      LOCATION_ID,
      BUSINESS_ID,
      "Activation Business",
      "100 Test Street, Melbourne VIC",
      PLACE_ID,
      REVIEW_URL
    ),
    env.DB.prepare(`
      INSERT INTO cards (id, public_token, location_id, label, placement_type, active)
      VALUES ('activation-card-1', 'activationtoken000000000000000000000000000000000001', ?1, 'Front Counter', 'counter', 1)
    `).bind(LOCATION_ID),
    env.DB.prepare(`
      INSERT INTO cards (id, public_token, location_id, label, placement_type, active)
      VALUES ('activation-card-2', 'activationtoken000000000000000000000000000000000002', ?1, 'Reception', 'reception', 1)
    `).bind(LOCATION_ID),
    env.DB.prepare(`
      INSERT INTO provisioning_batches (
        id, source, external_order_reference, external_setup_reference,
        request_fingerprint, business_id, location_id, physical_card_count, customer_email
      ) VALUES ('activation-batch', 'admin_shopify', '#CARD-1200', 'physical-setup-1200', 'activation-fingerprint', ?1, ?2, 2, ?3)
    `).bind(BUSINESS_ID, LOCATION_ID, EMAIL),
    env.DB.prepare("INSERT INTO provisioning_batch_cards (batch_id, card_id, card_ordinal) VALUES ('activation-batch', 'activation-card-1', 1)"),
    env.DB.prepare("INSERT INTO provisioning_batch_cards (batch_id, card_id, card_ordinal) VALUES ('activation-batch', 'activation-card-2', 2)"),
    env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES ('activation-tap-1', 'activation-card-1', '2026-09-14T10:00:00.000Z')"),
    env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES ('activation-tap-2', 'activation-card-2', '2026-09-14T10:01:00.000Z')")
  ]);
}

async function dispatch(request: Request) {
  const context = createExecutionContext();
  const response = await handleRequest(
    request,
    env,
    context,
    undefined,
    {},
    {},
    { placesProvider, discountProvider },
    { mailer, storefrontFetch, purchaseDependencies: { placesProvider, discountProvider } }
  );
  return { response, context };
}

async function verifiedActivationCookie(): Promise<string> {
  const requested = await dispatch(new Request(`${ORIGIN}/api/insights/activation/request-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL })
  }));
  expect(requested.response.status).toBe(202);
  await waitOnExecutionContext(requested.context);
  expect(magicUrl).toContain("/insights/verify?token=");
  const token = new URL(magicUrl).searchParams.get("token");
  expect(token).toBeTruthy();

  const confirmed = await dispatch(new Request(`${ORIGIN}/insights/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: ORIGIN
    },
    body: new URLSearchParams({ token: token || "" }).toString()
  }));
  expect(confirmed.response.status).toBe(303);
  const cookie = confirmed.response.headers.get("Set-Cookie")?.split(";", 1)[0] || "";
  expect(cookie).toContain("__Host-tnt_insights_activation=");
  return cookie;
}

beforeEach(async () => {
  await clearDatabase();
  await seedPurchasedCards();
});

describe("existing-card customer Insights activation", () => {
  it("never reveals purchaser details from email input alone", async () => {
    const page = await dispatch(new Request(`${ORIGIN}/insights`));
    expect(page.response.status).toBe(200);
    expect(await page.response.text()).toContain("For existing card owners");

    const requested = await dispatch(new Request(`${ORIGIN}/api/insights/activation/request-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ email: EMAIL })
    }));
    const requestPayload = await requested.response.json<any>();
    expect(requested.response.status).toBe(202);
    expect(requestPayload.message).not.toContain("Activation Business");

    const unauthenticated = await dispatch(new Request(`${ORIGIN}/api/insights/activation/summary`));
    expect(unauthenticated.response.status).toBe(401);
  });

  it("verifies ownership, shows cards and builds an Insights-only Shopify checkout", async () => {
    const cookie = await verifiedActivationCookie();

    const beforeUsers = await env.DB.prepare("SELECT COUNT(*) AS count FROM customer_users").first<{ count: number }>();
    expect(Number(beforeUsers?.count || 0)).toBe(0);

    const summary = await dispatch(new Request(`${ORIGIN}/api/insights/activation/summary`, {
      headers: { Cookie: cookie }
    }));
    const account = await summary.response.json<any>();
    expect(summary.response.status).toBe(200);
    expect(account.email).toBe(EMAIL);
    expect(account.locations).toHaveLength(1);
    expect(account.locations[0]).toMatchObject({
      businessName: "Activation Business",
      locationId: LOCATION_ID,
      cardCount: 2,
      activeCardCount: 2,
      lifetimeReviewOpportunities: 2,
      insightsStatus: "not_configured"
    });
    expect(account.locations[0].cards.map((card: any) => card.label)).toEqual(["Front Counter", "Reception"]);

    const quote = await dispatch(new Request(`${ORIGIN}/api/insights/activation/quote?locationId=${LOCATION_ID}`, {
      headers: { Cookie: cookie }
    }));
    const offer = await quote.response.json<any>();
    expect(quote.response.status).toBe(200);
    expect(offer).toMatchObject({ introEligible: true, firstMonthMinor: 199, recurringMinor: 699 });

    const checkout = await dispatch(new Request(`${ORIGIN}/api/insights/activation/checkout`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: ORIGIN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ locationId: LOCATION_ID })
    }));
    const checkoutPayload = await checkout.response.json<any>();
    expect(checkout.response.status).toBe(200);
    expect(checkoutPayload.checkoutUrl).toContain("myshopify.com/checkouts/activation-test");
    expect(checkoutPayload).toMatchObject({ offerKind: "intro", firstMonthMinor: 199, recurringMinor: 699 });

    const stored = await env.DB.prepare(`
      SELECT setup_reference, email, business_id, location_id, status
      FROM insights_activation_checkouts
      WHERE location_id = ?1
      LIMIT 1
    `).bind(LOCATION_ID).first<any>();
    expect(stored).toMatchObject({
      email: EMAIL,
      business_id: BUSINESS_ID,
      location_id: LOCATION_ID,
      status: "ready"
    });
    expect(stored.setup_reference).toMatch(/^activate_[a-f0-9]{32}$/);
  });

  it("activates only the verified checkout target after an authoritative paid subscription event", async () => {
    const cookie = await verifiedActivationCookie();
    const checkout = await dispatch(new Request(`${ORIGIN}/api/insights/activation/checkout`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ locationId: LOCATION_ID })
    }));
    expect(checkout.response.status).toBe(200);

    const stored = await env.DB.prepare(`
      SELECT id, setup_reference FROM insights_activation_checkouts
      WHERE location_id = ?1 AND status = 'ready'
      LIMIT 1
    `).bind(LOCATION_ID).first<{ id: string; setup_reference: string }>();
    expect(stored?.setup_reference).toBeTruthy();

    const result = await processShopifyPaidOrder(
      env.DB,
      {
        webhookId: "activation-paid-webhook",
        eventId: "activation-paid-event",
        topic: "orders/paid",
        shopDomain: env.SHOPIFY_SHOP_DOMAIN,
        payloadHash: "activation-payload-hash",
        providerOrderReference: "gid://shopify/Order/activation-paid-order",
        externalOrderReference: "#INSIGHTS-2200",
        providerCustomerReference: "gid://shopify/Customer/activation-customer",
        billingEmail: EMAIL,
        occurredAt: "2026-09-14T11:00:00.000Z",
        testOrder: false,
        billingLines: [{
          providerLineReference: "gid://shopify/LineItem/activation-line",
          externalSetupReference: stored?.setup_reference || null,
          amountMinor: 199,
          currency: "AUD",
          moneyValid: true
        }]
      },
      "2026-09-14T11:00:01.000Z",
      {
        async getOrderBillingLines() {
          return [{
            providerLineReference: "gid://shopify/LineItem/activation-line",
            variantId: env.SHOPIFY_INSIGHTS_VARIANT_ID,
            sellingPlanId: env.SHOPIFY_INSIGHTS_INTRO_SELLING_PLAN_ID,
            sellingPlanName: "Monthly",
            providerSubscriptionReference: "gid://shopify/SubscriptionContract/activation-contract"
          }];
        }
      },
      {
        webhookSecret: env.SHOPIFY_CLIENT_SECRET,
        shopDomain: env.SHOPIFY_SHOP_DOMAIN,
        insightsVariantId: env.SHOPIFY_INSIGHTS_VARIANT_ID,
        introSellingPlanId: env.SHOPIFY_INSIGHTS_INTRO_SELLING_PLAN_ID,
        standardSellingPlanId: env.SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID
      }
    );
    expect(result).toBe("activated");

    const entitlement = await env.DB.prepare("SELECT status FROM insights_entitlements WHERE location_id = ?1")
      .bind(LOCATION_ID).first<{ status: string }>();
    expect(entitlement?.status).toBe("active");
    const customer = await env.DB.prepare("SELECT email FROM customer_users WHERE email = ?1 COLLATE NOCASE")
      .bind(EMAIL).first<{ email: string }>();
    expect(customer?.email).toBe(EMAIL);
    const paid = await env.DB.prepare("SELECT status, provider_order_reference FROM insights_activation_checkouts WHERE id = ?1")
      .bind(stored?.id).first<{ status: string; provider_order_reference: string }>();
    expect(paid).toMatchObject({
      status: "paid",
      provider_order_reference: "gid://shopify/Order/activation-paid-order"
    });
  });
});
