import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createSessionCookie, hashToken } from "../src/auth";
import { handleRequest } from "../src/index";
import type { ShopifyAdminBillingLine, ShopifyAdminProvider } from "../src/shopify-admin";
import {
  addCalendarMonthUtc,
  addGracePeriodUtc,
  applySuccessfulPaymentAccessWindow,
  confirmCancellationRequest,
  createCancellationRequest,
  getCustomerBillingStatus,
  processLifecycleBatch,
  recordRefundObserved,
  withdrawCancellationRequest
} from "../src/subscription-lifecycle-repository";
import { CUSTOMER_PAGE } from "../src/customer-page";

const ORIGIN = "https://go.tapntrust.com";
const ADMIN_TOKEN = "test-admin-token-that-is-not-a-production-secret";
const WEBHOOK_SECRET = "test-shopify-webhook-secret-not-for-production";
const SHOP_DOMAIN = "tapntrust-test.myshopify.com";
const INSIGHTS_VARIANT_ID = "400000000001";
const INTRO_PLAN_ID = "500000000001";

interface SeededSubscription {
  businessId: string;
  locationId: string;
  subscriptionId: string;
  userId: string;
  email: string;
  cookie: string;
  cardId: string;
  cardToken: string;
}

class MockShopifyAdminProvider implements ShopifyAdminProvider {
  readonly orders = new Map<string, ShopifyAdminBillingLine[]>();
  async getOrderBillingLines(providerOrderReference: string): Promise<ShopifyAdminBillingLine[]> {
    return this.orders.get(providerOrderReference) || [];
  }
}

function unique(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM insights_subscription_lifecycle_events"),
    env.DB.prepare("DELETE FROM insights_cancellation_requests"),
    env.DB.prepare("DELETE FROM business_insights_intro_redemptions"),
    // insights_billing_events.source_event_id is a self-referencing FK.
    // Break those internal references before deleting the table contents so
    // test cleanup remains valid when a later event points at an earlier one.
    env.DB.prepare("UPDATE insights_billing_events SET source_event_id = NULL WHERE source_event_id IS NOT NULL"),
    env.DB.prepare("DELETE FROM insights_billing_events"),
    env.DB.prepare("DELETE FROM insights_subscriptions"),
    env.DB.prepare("DELETE FROM shopify_webhook_receipts"),
    env.DB.prepare("DELETE FROM auth_request_limits"),
    env.DB.prepare("DELETE FROM customer_dashboard_visits"),
    env.DB.prepare("DELETE FROM customer_sessions"),
    env.DB.prepare("DELETE FROM auth_magic_links"),
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

async function seedSubscription(options: {
  status?: "active" | "review" | "cancel_at_period_end" | "grace" | "past_due" | "cancelled" | "expired";
  paidAt?: string;
  paidThrough?: string | null;
  graceEndsAt?: string | null;
  cancelConfirmedAt?: string | null;
  entitlementStatus?: "active" | "inactive";
  suffix?: string;
} = {}): Promise<SeededSubscription> {
  const suffix = options.suffix || unique("lifecycle");
  const businessId = `biz-${suffix}`;
  const locationId = `loc-${suffix}`;
  const subscriptionId = `sub-${suffix}`;
  const userId = `user-${suffix}`;
  const email = `${suffix}@example.invalid`;
  const cardId = `card-${suffix}`;
  const cardToken = `TNT-${suffix.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 20).padEnd(5, "A")}`;
  const paidAt = options.paidAt || "2026-01-31T10:00:00.000Z";
  const paidThrough = options.paidThrough === undefined ? "2026-02-28T10:00:00.000Z" : options.paidThrough;
  const status = options.status || "active";
  const now = "2026-01-31T10:00:00.000Z";
  const sessionToken = `session_${suffix.replace(/[^A-Za-z0-9_-]/g, "").padEnd(44, "x").slice(0, 44)}`;
  const sessionHash = await hashToken(sessionToken);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO businesses (id, name, created_at) VALUES (?1, ?2, ?3)")
      .bind(businessId, `Business ${suffix}`, now),
    env.DB.prepare(`
      INSERT INTO locations (
        id, business_id, business_name, business_address, google_place_id,
        google_review_url, active, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)
    `).bind(
      locationId,
      businessId,
      `Business ${suffix}`,
      `${suffix} Street, Melbourne VIC`,
      `ChIJ${suffix}`,
      "https://search.google.com/local/writereview?placeid=lifecycle-test",
      now
    ),
    env.DB.prepare(`
      INSERT INTO cards (
        id, public_token, location_id, label, placement_type, active, created_at, updated_at
      ) VALUES (?1, ?2, ?3, 'Front Counter', 'counter', 1, ?4, ?4)
    `).bind(cardId, cardToken, locationId, now),
    env.DB.prepare(`
      INSERT INTO customer_users (id, email, active, created_at, updated_at)
      VALUES (?1, ?2, 1, ?3, ?3)
    `).bind(userId, email, now),
    env.DB.prepare(`
      INSERT INTO customer_business_access (user_id, business_id, role, created_at)
      VALUES (?1, ?2, 'owner', ?3)
    `).bind(userId, businessId, now),
    env.DB.prepare(`
      INSERT INTO customer_sessions (id, user_id, token_hash, expires_at, revoked_at, created_at)
      VALUES (?1, ?2, ?3, '2027-01-01T00:00:00.000Z', NULL, ?4)
    `).bind(`session-id-${suffix}`, userId, sessionHash, now),
    env.DB.prepare(`
      INSERT INTO insights_entitlements (
        location_id, status, source, activated_at, deactivated_at, updated_at
      ) VALUES (?1, ?2, 'phase4b_test', ?3, ?4, ?3)
    `).bind(
      locationId,
      options.entitlementStatus || "active",
      now,
      (options.entitlementStatus || "active") === "inactive" ? now : null
    ),
    env.DB.prepare(`
      INSERT INTO insights_subscriptions (
        id, business_id, location_id, provider, billing_email,
        provider_customer_reference, provider_subscription_reference,
        external_setup_reference,
        first_provider_order_reference, most_recent_provider_order_reference,
        plan_code, status, currency,
        expected_intro_price_minor, expected_recurring_price_minor,
        started_at, last_paid_at, expected_next_billing_at,
        current_period_started_at, current_period_ends_at,
        review_required, created_at, updated_at,
        access_period_started_at, access_paid_through_at,
        grace_started_at, grace_ends_at,
        cancel_requested_at, cancel_confirmed_at, cancelled_at, expired_at, lifecycle_reason
      ) VALUES (
        ?1, ?2, ?3, 'shopify', ?4,
        ?5, NULL, ?6,
        ?7, ?7,
        'standard', ?8, 'AUD',
        199, 999,
        ?9, ?9, NULL,
        ?9, NULL,
        0, ?10, ?10,
        ?9, ?11,
        ?12, ?13,
        NULL, ?14, ?15, ?16, NULL
      )
    `).bind(
      subscriptionId,
      businessId,
      locationId,
      email,
      `gid://shopify/Customer/customer-${suffix}`,
      `setup-${suffix}`,
      `gid://shopify/Order/order-${suffix}`,
      status,
      paidAt,
      now,
      paidThrough,
      status === "grace" ? paidThrough : null,
      options.graceEndsAt || null,
      options.cancelConfirmedAt || null,
      status === "cancelled" ? paidThrough : null,
      status === "expired" ? (options.graceEndsAt || paidThrough) : null
    )
  ]);

  return {
    businessId,
    locationId,
    subscriptionId,
    userId,
    email,
    cookie: createSessionCookie(sessionToken, 3600).split(";", 1)[0] || "",
    cardId,
    cardToken
  };
}

async function request(path: string, init?: RequestInit, billingProvider?: ShopifyAdminProvider): Promise<Response> {
  const context = createExecutionContext();
  return handleRequest(
    new Request(`${ORIGIN}${path}`, init),
    env,
    context,
    undefined,
    undefined,
    billingProvider ? { shopifyAdminProvider: billingProvider } : undefined
  );
}

async function ensureBillingSource(
  seeded: SeededSubscription,
  eventId: string,
  paidAt: string
): Promise<void> {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO insights_billing_events (
      id, subscription_id, source_event_id, provider,
      provider_webhook_id, provider_event_id, provider_order_reference,
      provider_line_reference, external_order_reference, external_setup_reference,
      provider_customer_reference, provider_subscription_reference,
      billing_email, event_type, plan_code, amount_minor, currency,
      occurred_at, payload_hash, result, created_at
    ) VALUES (
      ?1, NULL, NULL, 'shopify',
      ?2, NULL, ?3,
      ?4, ?5, ?6,
      ?7, NULL,
      ?8, 'orders_paid', 'standard', 999, 'AUD',
      ?9, ?10, 'ready', ?9
    )
  `).bind(
    eventId,
    `webhook-${eventId}`,
    `gid://shopify/Order/${eventId}`,
    `gid://shopify/LineItem/${eventId}`,
    `#${eventId}`,
    `setup-${seeded.locationId}`,
    `customer-${seeded.locationId}`,
    seeded.email,
    paidAt,
    "c".repeat(64)
  ).run();
}

async function applyDirectPayment(
  seeded: SeededSubscription,
  eventId: string,
  paidAt: string,
  now: string
) {
  await ensureBillingSource(seeded, eventId, paidAt);
  return applySuccessfulPaymentAccessWindow(env.DB, seeded.subscriptionId, eventId, paidAt, now);
}

async function requestAndWait(path: string, init?: RequestInit): Promise<Response> {
  const context = createExecutionContext();
  const response = await handleRequest(new Request(`${ORIGIN}${path}`, init), env, context);
  await waitOnExecutionContext(context);
  return response;
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

async function deliverPaidOrder(
  payload: Record<string, unknown>,
  provider: ShopifyAdminProvider,
  webhookId = unique("paid-webhook")
): Promise<Response> {
  const rawBody = JSON.stringify(payload);
  return request("/api/shopify/webhooks/orders-paid", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": await sign(rawBody),
      "X-Shopify-Shop-Domain": SHOP_DOMAIN,
      "X-Shopify-Topic": "orders/paid",
      "X-Shopify-Webhook-Id": webhookId,
      "X-Shopify-Event-Id": `${webhookId}-event`
    },
    body: rawBody
  }, provider);
}

beforeEach(clearDatabase);

describe("TapnTrust internal paid access calendar", () => {
  it("keeps month-end semantics without using a fixed 30-day duration", () => {
    expect(addCalendarMonthUtc("2026-01-31T10:00:00.000Z")).toBe("2026-02-28T10:00:00.000Z");
    expect(addCalendarMonthUtc("2028-01-31T10:00:00.000Z")).toBe("2028-02-29T10:00:00.000Z");
    expect(addCalendarMonthUtc("2026-02-28T10:00:00.000Z")).toBe("2026-03-31T10:00:00.000Z");
    expect(addGracePeriodUtc("2026-02-28T10:00:00.000Z")).toBe("2026-03-03T10:00:00.000Z");
  });

  it("starts, extends and deduplicates paid access", async () => {
    const seeded = await seedSubscription({ paidThrough: null });
    const first = await applyDirectPayment(
      seeded,
      "billing-event-first",
      "2026-01-31T10:00:00.000Z",
      "2026-01-31T10:01:00.000Z"
    );
    expect(first.eventType).toBe("access_period_started");
    expect(first.accessPaidThroughAt).toBe("2026-02-28T10:00:00.000Z");

    const earlyRenewal = await applyDirectPayment(
      seeded,
      "billing-event-renewal",
      "2026-02-20T10:00:00.000Z",
      "2026-02-20T10:01:00.000Z"
    );
    expect(earlyRenewal.eventType).toBe("renewal_applied");
    expect(earlyRenewal.accessPaidThroughAt).toBe("2026-03-31T10:00:00.000Z");

    const duplicate = await applyDirectPayment(
      seeded,
      "billing-event-renewal",
      "2026-02-20T10:00:00.000Z",
      "2026-02-20T10:02:00.000Z"
    );
    expect(duplicate.applied).toBe(false);
    expect(duplicate.accessPaidThroughAt).toBe("2026-03-31T10:00:00.000Z");
  });

  it("uses a late successful payment as the new access anchor", async () => {
    const seeded = await seedSubscription({ paidThrough: "2026-02-28T10:00:00.000Z" });
    const renewed = await applyDirectPayment(
      seeded,
      "billing-event-late",
      "2026-03-05T09:30:00.000Z",
      "2026-03-05T09:31:00.000Z"
    );
    expect(renewed.accessPaidThroughAt).toBe("2026-04-05T09:30:00.000Z");
  });

  it("reactivates an expired entitlement after a later verified standard payment", async () => {
    const seeded = await seedSubscription({
      status: "expired",
      entitlementStatus: "inactive",
      paidThrough: "2026-02-28T10:00:00.000Z",
      graceEndsAt: "2026-03-03T10:00:00.000Z",
      suffix: "reactivate4b"
    });
    const orderId = "reactivate-order";
    const lineId = "reactivate-line";
    const orderGid = `gid://shopify/Order/${orderId}`;
    const lineGid = `gid://shopify/LineItem/${lineId}`;
    const provider = new MockShopifyAdminProvider();
    provider.orders.set(orderGid, [{
      providerLineReference: lineGid,
      variantId: `gid://shopify/ProductVariant/${INSIGHTS_VARIANT_ID}`,
      sellingPlanId: `gid://shopify/SellingPlan/500000000002`,
      sellingPlanName: "TapnTrust Insights Monthly",
      providerSubscriptionReference: null
    }]);
    const payload = {
      id: orderId,
      admin_graphql_api_id: orderGid,
      name: "#reactivate-4b",
      currency: "AUD",
      processed_at: "2026-03-10T10:00:00.000Z",
      test: false,
      email: seeded.email,
      contact_email: seeded.email,
      customer: {
        id: "customer-reactivate4b",
        admin_graphql_api_id: "gid://shopify/Customer/customer-reactivate4b",
        email: seeded.email
      },
      line_items: [{
        id: lineId,
        admin_graphql_api_id: lineGid,
        variant_id: INSIGHTS_VARIANT_ID,
        quantity: 1,
        price: "9.99",
        total_discount: "0.00",
        price_set: { shop_money: { amount: "9.99", currency_code: "AUD" } },
        properties: [{ name: "_Business Setup ID", value: "setup-reactivate4b" }]
      }]
    };
    const response = await deliverPaidOrder(payload, provider, "reactivate-paid-webhook");
    const subscription = await env.DB.prepare(`
      SELECT status, access_period_started_at, access_paid_through_at
      FROM insights_subscriptions WHERE id = ?1
    `).bind(seeded.subscriptionId).first<{
      status: string;
      access_period_started_at: string;
      access_paid_through_at: string;
    }>();
    const entitlement = await env.DB.prepare("SELECT status FROM insights_entitlements WHERE location_id = ?1")
      .bind(seeded.locationId).first<{ status: string }>();
    expect(response.status).toBe(200);
    expect((await response.json<Record<string, any>>()).result).toBe("activated");
    expect(subscription?.status).toBe("active");
    expect(subscription?.access_period_started_at).toBe("2026-03-10T10:00:00.000Z");
    expect(subscription?.access_paid_through_at).toBe("2026-04-10T10:00:00.000Z");
    expect(entitlement?.status).toBe("active");
  });
});

describe("grace and expiry lifecycle", () => {
  it("moves active access into a 3-day grace without deactivating Insights", async () => {
    const seeded = await seedSubscription({ paidThrough: "2026-02-28T10:00:00.000Z" });
    const result = await processLifecycleBatch(env.DB, "2026-02-28T10:00:00.000Z");
    const subscription = await env.DB.prepare(`
      SELECT status, grace_started_at, grace_ends_at FROM insights_subscriptions WHERE id = ?1
    `).bind(seeded.subscriptionId).first<{ status: string; grace_started_at: string; grace_ends_at: string }>();
    const entitlement = await env.DB.prepare("SELECT status FROM insights_entitlements WHERE location_id = ?1")
      .bind(seeded.locationId).first<{ status: string }>();
    expect(result.graceStarted).toBe(1);
    expect(subscription?.status).toBe("grace");
    expect(subscription?.grace_started_at).toBe("2026-02-28T10:00:00.000Z");
    expect(subscription?.grace_ends_at).toBe("2026-03-03T10:00:00.000Z");
    expect(entitlement?.status).toBe("active");
  });

  it("recovers automatically when a successful payment arrives during grace", async () => {
    const seeded = await seedSubscription({
      status: "grace",
      paidThrough: "2026-02-28T10:00:00.000Z",
      graceEndsAt: "2026-03-03T10:00:00.000Z"
    });
    const recovered = await applyDirectPayment(
      seeded,
      "billing-event-grace-recovery",
      "2026-03-02T09:00:00.000Z",
      "2026-03-02T09:01:00.000Z"
    );
    const row = await env.DB.prepare(`
      SELECT status, grace_started_at, grace_ends_at FROM insights_subscriptions WHERE id = ?1
    `).bind(seeded.subscriptionId).first<{ status: string; grace_started_at: string | null; grace_ends_at: string | null }>();
    expect(recovered.eventType).toBe("grace_recovered");
    expect(row).toMatchObject({ status: "active", grace_started_at: null, grace_ends_at: null });
  });

  it("expires after grace while card redirect and tap history remain intact", async () => {
    const seeded = await seedSubscription({
      status: "grace",
      paidThrough: "2026-02-28T10:00:00.000Z",
      graceEndsAt: "2026-03-03T10:00:00.000Z"
    });
    await env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
      .bind(unique("tap"), seeded.cardId, "2026-03-03T09:59:00.000Z").run();

    const result = await processLifecycleBatch(env.DB, "2026-03-03T10:00:00.000Z");
    const entitlement = await env.DB.prepare("SELECT status FROM insights_entitlements WHERE location_id = ?1")
      .bind(seeded.locationId).first<{ status: string }>();
    expect(result.expired).toBe(1);
    expect(entitlement?.status).toBe("inactive");

    const tapsBefore = await env.DB.prepare("SELECT COUNT(*) AS total FROM tap_events WHERE card_id = ?1")
      .bind(seeded.cardId).first<{ total: number }>();
    const redirect = await requestAndWait(`/t/${seeded.cardToken}`);
    expect(redirect.status).toBe(302);
    const tapsAfter = await env.DB.prepare("SELECT COUNT(*) AS total FROM tap_events WHERE card_id = ?1")
      .bind(seeded.cardId).first<{ total: number }>();
    expect(Number(tapsAfter?.total || 0)).toBe(Number(tapsBefore?.total || 0) + 1);
  });

  it("is idempotent when the hourly lifecycle processor runs twice", async () => {
    const seeded = await seedSubscription({ paidThrough: "2026-02-28T10:00:00.000Z" });
    const first = await processLifecycleBatch(env.DB, "2026-02-28T10:00:00.000Z");
    const second = await processLifecycleBatch(env.DB, "2026-02-28T10:00:00.000Z");
    const events = await env.DB.prepare(`
      SELECT COUNT(*) AS total FROM insights_subscription_lifecycle_events
      WHERE subscription_id = ?1 AND event_type = 'grace_started'
    `).bind(seeded.subscriptionId).first<{ total: number }>();
    expect(first.graceStarted).toBe(1);
    expect(second.graceStarted).toBe(0);
    expect(Number(events?.total || 0)).toBe(1);
  });

  it("keeps each lifecycle scan bounded", async () => {
    await seedSubscription({ suffix: "bounded-a", paidThrough: "2026-02-28T10:00:00.000Z" });
    await seedSubscription({ suffix: "bounded-b", paidThrough: "2026-02-28T10:00:00.000Z" });
    const result = await processLifecycleBatch(env.DB, "2026-02-28T10:00:00.000Z", 1);
    expect(result.scanned).toBe(1);
    expect(result.graceStarted).toBe(1);
  });

  it("continues processing other subscriptions when one lifecycle item is malformed", async () => {
    const broken = await seedSubscription({ suffix: "broken-boundary", paidThrough: "2026-02-28T10:00:00.000Z" });
    const healthy = await seedSubscription({ suffix: "healthy-boundary", paidThrough: "2026-02-28T10:00:00.000Z" });
    await env.DB.prepare("UPDATE insights_subscriptions SET access_paid_through_at = '0000-00-00' WHERE id = ?1")
      .bind(broken.subscriptionId).run();
    const result = await processLifecycleBatch(env.DB, "2026-02-28T10:00:00.000Z", 10);
    const healthyRow = await env.DB.prepare("SELECT status FROM insights_subscriptions WHERE id = ?1")
      .bind(healthy.subscriptionId).first<{ status: string }>();
    expect(result.scanned).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.graceStarted).toBe(1);
    expect(healthyRow?.status).toBe("grace");
  });
});

describe("support-managed cancellation", () => {
  it("rejects unauthenticated cancellation requests", async () => {
    const response = await request("/api/customer/billing/cancellation-request", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ locationId: "loc-missing", reason: "Other", note: "test" })
    });
    expect(response.status).toBe(401);
  });

  it("persists a tenant-safe cancellation request without deactivating access", async () => {
    const seeded = await seedSubscription();
    const response = await request("/api/customer/billing/cancellation-request", {
      method: "POST",
      headers: {
        Cookie: seeded.cookie,
        Origin: ORIGIN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        locationId: seeded.locationId,
        reason: "Not using it enough",
        note: "Please stop the next renewal."
      })
    });
    const payload = await response.json<Record<string, any>>();
    const entitlement = await env.DB.prepare("SELECT status FROM insights_entitlements WHERE location_id = ?1")
      .bind(seeded.locationId).first<{ status: string }>();
    expect(response.status).toBe(202);
    expect(payload.request.customerEmail).toBe(seeded.email);
    expect(payload.request.reason).toBe("Not using it enough");
    expect(entitlement?.status).toBe("active");
  });

  it("ignores browser email fields and rejects cross-tenant locations", async () => {
    const alpha = await seedSubscription({ suffix: "alpha4b" });
    const beta = await seedSubscription({ suffix: "beta4b" });
    const extraEmail = await request("/api/customer/billing/cancellation-request", {
      method: "POST",
      headers: { Cookie: alpha.cookie, Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId: alpha.locationId,
        reason: "Other",
        note: "test",
        email: "attacker@example.invalid"
      })
    });
    expect(extraEmail.status).toBe(400);

    const crossTenant = await request("/api/customer/billing/cancellation-request", {
      method: "POST",
      headers: { Cookie: alpha.cookie, Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ locationId: beta.locationId, reason: "Other", note: "test" })
    });
    expect(crossTenant.status).toBe(404);
  });

  it("rejects invalid cancellation reasons and notes longer than 800 characters", async () => {
    const seeded = await seedSubscription();
    const invalidReason = await request("/api/customer/billing/cancellation-request", {
      method: "POST",
      headers: { Cookie: seeded.cookie, Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ locationId: seeded.locationId, reason: "Because I said so", note: "" })
    });
    const oversizedNote = await request("/api/customer/billing/cancellation-request", {
      method: "POST",
      headers: { Cookie: seeded.cookie, Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ locationId: seeded.locationId, reason: "Other", note: "x".repeat(801) })
    });
    expect(invalidReason.status).toBe(400);
    expect(oversizedNote.status).toBe(400);
  });

  it("accepts a normal multiline support note within the 800-character limit", async () => {
    const seeded = await seedSubscription({ suffix: "multiline-note" });
    const response = await request("/api/customer/billing/cancellation-request", {
      method: "POST",
      headers: { Cookie: seeded.cookie, Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId: seeded.locationId,
        reason: "Other",
        note: "First line\nSecond line"
      })
    });
    const payload = await response.json<Record<string, any>>();
    expect(response.status).toBe(202);
    expect(payload.request.note).toBe("First line\nSecond line");
  });

  it("deduplicates repeated open cancellation requests", async () => {
    const seeded = await seedSubscription();
    const first = await createCancellationRequest(env.DB, {
      userId: seeded.userId,
      userEmail: seeded.email,
      locationId: seeded.locationId,
      reason: "Too expensive",
      note: null,
      now: "2026-02-01T00:00:00.000Z"
    });
    const second = await createCancellationRequest(env.DB, {
      userId: seeded.userId,
      userEmail: seeded.email,
      locationId: seeded.locationId,
      reason: "Other",
      note: "duplicate",
      now: "2026-02-01T00:01:00.000Z"
    });
    expect(first?.id).toBe(second?.id);
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM insights_cancellation_requests")
      .first<{ total: number }>();
    expect(Number(count?.total || 0)).toBe(1);
  });

  it("requires admin authentication before confirming provider cancellation", async () => {
    const seeded = await seedSubscription();
    const cancellation = await createCancellationRequest(env.DB, {
      userId: seeded.userId,
      userEmail: seeded.email,
      locationId: seeded.locationId,
      reason: "Other",
      note: null,
      now: "2026-02-01T00:00:00.000Z"
    });
    const rejected = await request(`/api/admin/billing/cancellation-requests/${cancellation?.id}/confirm`, {
      method: "POST"
    });
    expect(rejected.status).toBe(401);
  });

  it("withdraws an open request without changing paid access", async () => {
    const seeded = await seedSubscription();
    const cancellation = await createCancellationRequest(env.DB, {
      userId: seeded.userId,
      userEmail: seeded.email,
      locationId: seeded.locationId,
      reason: "Other",
      note: null,
      now: "2026-02-01T00:00:00.000Z"
    });
    const withdrawn = await withdrawCancellationRequest(env.DB, cancellation!.id, "2026-02-01T01:00:00.000Z");
    const subscription = await env.DB.prepare("SELECT status, cancel_requested_at FROM insights_subscriptions WHERE id = ?1")
      .bind(seeded.subscriptionId).first<{ status: string; cancel_requested_at: string | null }>();
    const entitlement = await env.DB.prepare("SELECT status FROM insights_entitlements WHERE location_id = ?1")
      .bind(seeded.locationId).first<{ status: string }>();
    expect(withdrawn?.status).toBe("withdrawn");
    expect(subscription).toMatchObject({ status: "active", cancel_requested_at: null });
    expect(entitlement?.status).toBe("active");
  });

  it("allows the protected admin route to confirm cancellation at period end", async () => {
    const seeded = await seedSubscription();
    const cancellation = await createCancellationRequest(env.DB, {
      userId: seeded.userId,
      userEmail: seeded.email,
      locationId: seeded.locationId,
      reason: "Other",
      note: null,
      now: "2026-02-01T00:00:00.000Z"
    });
    const response = await request(`/api/admin/billing/cancellation-requests/${cancellation?.id}/confirm`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    const subscription = await env.DB.prepare("SELECT status FROM insights_subscriptions WHERE id = ?1")
      .bind(seeded.subscriptionId).first<{ status: string }>();
    const entitlement = await env.DB.prepare("SELECT status FROM insights_entitlements WHERE location_id = ?1")
      .bind(seeded.locationId).first<{ status: string }>();
    expect(response.status).toBe(200);
    expect(subscription?.status).toBe("cancel_at_period_end");
    expect(entitlement?.status).toBe("active");
  });

  it("treats repeated admin cancellation confirmation as an idempotent no-op", async () => {
    const seeded = await seedSubscription({ suffix: "confirm-idempotent" });
    const cancellation = await createCancellationRequest(env.DB, {
      userId: seeded.userId,
      userEmail: seeded.email,
      locationId: seeded.locationId,
      reason: "Other",
      note: null,
      now: "2026-02-01T00:00:00.000Z"
    });
    const first = await confirmCancellationRequest(env.DB, cancellation!.id, "2026-02-01T01:00:00.000Z");
    const second = await confirmCancellationRequest(env.DB, cancellation!.id, "2026-02-01T01:01:00.000Z");
    const events = await env.DB.prepare(`
      SELECT COUNT(*) AS total FROM insights_subscription_lifecycle_events
      WHERE subscription_id = ?1 AND event_type = 'cancel_at_period_end'
    `).bind(seeded.subscriptionId).first<{ total: number }>();
    expect(first?.status).toBe("provider_cancelled");
    expect(second?.status).toBe("provider_cancelled");
    expect(Number(events?.total || 0)).toBe(1);
  });

  it("keeps access until the paid-through boundary, then cancels with no grace", async () => {
    const seeded = await seedSubscription({ paidThrough: "2026-02-28T10:00:00.000Z" });
    const cancellation = await createCancellationRequest(env.DB, {
      userId: seeded.userId,
      userEmail: seeded.email,
      locationId: seeded.locationId,
      reason: "Business closed or paused",
      note: null,
      now: "2026-02-10T00:00:00.000Z"
    });
    expect(cancellation).not.toBeNull();
    await confirmCancellationRequest(env.DB, cancellation!.id, "2026-02-10T01:00:00.000Z");
    const before = await env.DB.prepare("SELECT status FROM insights_entitlements WHERE location_id = ?1")
      .bind(seeded.locationId).first<{ status: string }>();
    expect(before?.status).toBe("active");

    const lifecycle = await processLifecycleBatch(env.DB, "2026-02-28T10:00:00.000Z");
    const subscription = await env.DB.prepare("SELECT status, grace_ends_at FROM insights_subscriptions WHERE id = ?1")
      .bind(seeded.subscriptionId).first<{ status: string; grace_ends_at: string | null }>();
    const entitlement = await env.DB.prepare("SELECT status FROM insights_entitlements WHERE location_id = ?1")
      .bind(seeded.locationId).first<{ status: string }>();
    expect(lifecycle.cancelled).toBe(1);
    expect(subscription).toMatchObject({ status: "cancelled", grace_ends_at: null });
    expect(entitlement?.status).toBe("inactive");
  });

  it("reactivates a later standard payment after a completed cancellation and clears old cancellation markers", async () => {
    const seeded = await seedSubscription({
      status: "cancelled",
      entitlementStatus: "inactive",
      paidThrough: "2026-02-28T10:00:00.000Z",
      cancelConfirmedAt: "2026-02-10T00:00:00.000Z"
    });
    const access = await applyDirectPayment(
      seeded,
      "billing-event-resubscribe",
      "2026-03-10T10:00:00.000Z",
      "2026-03-10T10:01:00.000Z"
    );
    const subscription = await env.DB.prepare(`
      SELECT status, cancel_requested_at, cancel_confirmed_at, cancelled_at
      FROM insights_subscriptions WHERE id = ?1
    `).bind(seeded.subscriptionId).first<{
      status: string;
      cancel_requested_at: string | null;
      cancel_confirmed_at: string | null;
      cancelled_at: string | null;
    }>();
    expect(access.eventType).toBe("reactivated");
    expect(access.status).toBe("active");
    expect(subscription).toMatchObject({
      status: "active",
      cancel_requested_at: null,
      cancel_confirmed_at: null,
      cancelled_at: null
    });
  });

  it("keeps cancel-at-period-end when a delayed paid event predates support confirmation", async () => {
    const seeded = await seedSubscription({
      status: "cancel_at_period_end",
      paidThrough: "2026-02-28T10:00:00.000Z",
      cancelConfirmedAt: "2026-02-20T12:00:00.000Z"
    });
    const access = await applyDirectPayment(
      seeded,
      "billing-event-before-confirm",
      "2026-02-15T10:00:00.000Z",
      "2026-02-21T10:01:00.000Z"
    );
    expect(access.eventType).toBe("renewal_applied");
    expect(access.status).toBe("cancel_at_period_end");
    expect(access.accessPaidThroughAt).toBe("2026-03-31T10:00:00.000Z");
  });

  it("flags a real payment after cancellation intent and keeps paid service available", async () => {
    const seeded = await seedSubscription({
      status: "cancel_at_period_end",
      paidThrough: "2026-02-28T10:00:00.000Z",
      cancelConfirmedAt: "2026-02-10T00:00:00.000Z"
    });
    const access = await applyDirectPayment(
      seeded,
      "billing-event-after-cancel",
      "2026-02-20T10:00:00.000Z",
      "2026-02-20T10:01:00.000Z"
    );
    expect(access.eventType).toBe("payment_after_cancellation");
    expect(access.status).toBe("review");
    expect(access.accessPaidThroughAt).toBe("2026-03-31T10:00:00.000Z");
  });
});

describe("billing status and refund observation", () => {
  it("returns only the authenticated tenant's safe billing state", async () => {
    const seeded = await seedSubscription();
    const response = await request(`/api/customer/billing/status?locationId=${seeded.locationId}`, {
      headers: { Cookie: seeded.cookie }
    });
    const payload = await response.json<Record<string, any>>();
    expect(response.status).toBe(200);
    expect(payload.status).toMatchObject({
      locationId: seeded.locationId,
      status: "active",
      accessPaidThroughAt: "2026-02-28T10:00:00.000Z"
    });
    expect(JSON.stringify(payload)).not.toContain(seeded.email);
    expect(JSON.stringify(payload)).not.toContain("provider_customer_reference");
  });

  it("records refund_observed for review without revoking entitlement", async () => {
    const seeded = await seedSubscription();
    await env.DB.prepare(`
      INSERT INTO insights_billing_events (
        id, subscription_id, source_event_id, provider, provider_webhook_id, provider_event_id,
        provider_order_reference, provider_line_reference, external_order_reference,
        external_setup_reference, provider_customer_reference, provider_subscription_reference,
        billing_email, event_type, plan_code, amount_minor, currency, occurred_at,
        payload_hash, result, created_at
      ) VALUES (?1, NULL, NULL, 'shopify', ?2, NULL, ?3, ?4, ?5, ?6, ?7, NULL, ?8,
        'orders_paid', 'standard', 999, 'AUD', ?9, ?10, 'ready', ?9)
    `).bind(
      "billing-refund-source",
      "webhook-source",
      "gid://shopify/Order/refund-source",
      "gid://shopify/LineItem/refund-source",
      "#refund-source",
      `setup-${seeded.locationId}`,
      `customer-${seeded.locationId}`,
      seeded.email,
      "2026-02-01T00:00:00.000Z",
      "a".repeat(64)
    ).run();

    const inserted = await recordRefundObserved(env.DB, {
      subscriptionId: seeded.subscriptionId,
      sourceBillingEventId: "billing-refund-source",
      refundReference: "refund-direct-test",
      providerLineReference: "gid://shopify/LineItem/refund-source",
      amountMinor: 999,
      currency: "AUD",
      occurredAt: "2026-02-02T00:00:00.000Z",
      now: "2026-02-02T00:00:01.000Z"
    });
    const entitlement = await env.DB.prepare("SELECT status FROM insights_entitlements WHERE location_id = ?1")
      .bind(seeded.locationId).first<{ status: string }>();
    const subscription = await env.DB.prepare("SELECT status, review_required FROM insights_subscriptions WHERE id = ?1")
      .bind(seeded.subscriptionId).first<{ status: string; review_required: number }>();
    expect(inserted).toBe(true);
    expect(entitlement?.status).toBe("active");
    expect(subscription).toMatchObject({ status: "review", review_required: 1 });
  });

  it("observes a refund without erasing cancel-at-period-end state", async () => {
    const seeded = await seedSubscription({
      suffix: "refund-cancel-state",
      status: "cancel_at_period_end",
      cancelConfirmedAt: "2026-02-01T00:00:00.000Z"
    });
    await ensureBillingSource(seeded, "billing-refund-cancelled", "2026-01-31T10:00:00.000Z");
    const inserted = await recordRefundObserved(env.DB, {
      subscriptionId: seeded.subscriptionId,
      sourceBillingEventId: "billing-refund-cancelled",
      refundReference: "refund-cancel-state",
      providerLineReference: "gid://shopify/LineItem/billing-refund-cancelled",
      amountMinor: 999,
      currency: "AUD",
      occurredAt: "2026-02-02T00:00:00.000Z",
      now: "2026-02-02T00:00:01.000Z"
    });
    const subscription = await env.DB.prepare(`
      SELECT status, review_required, cancel_confirmed_at
      FROM insights_subscriptions WHERE id = ?1
    `).bind(seeded.subscriptionId).first<{
      status: string;
      review_required: number;
      cancel_confirmed_at: string | null;
    }>();
    expect(inserted).toBe(true);
    expect(subscription).toMatchObject({
      status: "cancel_at_period_end",
      review_required: 1,
      cancel_confirmed_at: "2026-02-01T00:00:00.000Z"
    });
  });

  it("verifies refunds/create HMAC and deduplicates a matched Insights refund", async () => {
    const seeded = await seedSubscription();
    const orderRef = "gid://shopify/Order/900001";
    const lineRef = "gid://shopify/LineItem/910001";
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO insights_billing_events (
          id, subscription_id, source_event_id, provider, provider_webhook_id, provider_event_id,
          provider_order_reference, provider_line_reference, external_order_reference,
          external_setup_reference, provider_customer_reference, provider_subscription_reference,
          billing_email, event_type, plan_code, amount_minor, currency, occurred_at,
          payload_hash, result, created_at
        ) VALUES ('refund-payment', NULL, NULL, 'shopify', 'paid-hook', 'paid-event', ?1, ?2,
          '#900001', ?3, 'customer-900001', NULL, ?4, 'orders_paid', 'standard', 999, 'AUD',
          '2026-02-01T00:00:00.000Z', ?5, 'ready', '2026-02-01T00:00:00.000Z')
      `).bind(orderRef, lineRef, `setup-${seeded.locationId}`, seeded.email, "b".repeat(64)),
      env.DB.prepare(`
        INSERT INTO insights_billing_events (
          id, subscription_id, source_event_id, provider, provider_webhook_id, provider_event_id,
          provider_order_reference, provider_line_reference, external_order_reference,
          external_setup_reference, provider_customer_reference, provider_subscription_reference,
          billing_email, event_type, plan_code, amount_minor, currency, occurred_at,
          payload_hash, result, created_at
        ) VALUES ('refund-applied', ?1, 'refund-payment', 'shopify', 'paid-hook', 'paid-event', ?2, ?3,
          '#900001', ?4, 'customer-900001', NULL, ?5, 'payment_applied', 'standard', 999, 'AUD',
          '2026-02-01T00:00:00.000Z', ?6, 'activated', '2026-02-01T00:00:01.000Z')
      `).bind(seeded.subscriptionId, orderRef, lineRef, `setup-${seeded.locationId}`, seeded.email, "b".repeat(64))
    ]);

    const provider = new MockShopifyAdminProvider();
    provider.orders.set(orderRef, [{
      providerLineReference: lineRef,
      variantId: `gid://shopify/ProductVariant/${INSIGHTS_VARIANT_ID}`,
      sellingPlanId: `gid://shopify/SellingPlan/${INTRO_PLAN_ID}`,
      sellingPlanName: "TapnTrust Insights",
      providerSubscriptionReference: null
    }]);
    const payload = JSON.stringify({
      id: 920001,
      order_id: 900001,
      created_at: "2026-02-02T00:00:00.000Z",
      refund_line_items: [{
        line_item_id: 910001,
        subtotal: "9.99",
        subtotal_set: { shop_money: { amount: "9.99", currency_code: "AUD" } }
      }]
    });
    const headers = {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": await sign(payload),
      "X-Shopify-Shop-Domain": SHOP_DOMAIN,
      "X-Shopify-Topic": "refunds/create",
      "X-Shopify-Webhook-Id": "refund-webhook-920001",
      "X-Shopify-Event-Id": "refund-event-920001"
    };
    const first = await request("/api/shopify/webhooks/refunds-create", { method: "POST", headers, body: payload }, provider);
    const second = await request("/api/shopify/webhooks/refunds-create", { method: "POST", headers, body: payload }, provider);
    const entitlement = await env.DB.prepare("SELECT status FROM insights_entitlements WHERE location_id = ?1")
      .bind(seeded.locationId).first<{ status: string }>();
    expect(first.status).toBe(200);
    expect((await first.json<Record<string, any>>()).result).toBe("review");
    expect((await second.json<Record<string, any>>()).result).toBe("duplicate");
    expect(entitlement?.status).toBe("active");
  });

  it("keeps an authoritative Insights refund retryable when orders/paid has not been applied yet", async () => {
    const provider = new MockShopifyAdminProvider();
    const orderRef = "gid://shopify/Order/900099";
    const lineRef = "gid://shopify/LineItem/910099";
    provider.orders.set(orderRef, [{
      providerLineReference: lineRef,
      variantId: `gid://shopify/ProductVariant/${INSIGHTS_VARIANT_ID}`,
      sellingPlanId: `gid://shopify/SellingPlan/${INTRO_PLAN_ID}`,
      sellingPlanName: "TapnTrust Insights",
      providerSubscriptionReference: null
    }]);
    const payload = JSON.stringify({
      id: 920099,
      order_id: 900099,
      created_at: "2026-02-02T00:00:00.000Z",
      refund_line_items: [{
        line_item_id: 910099,
        subtotal: "9.99",
        subtotal_set: { shop_money: { amount: "9.99", currency_code: "AUD" } }
      }]
    });
    const response = await request("/api/shopify/webhooks/refunds-create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Hmac-Sha256": await sign(payload),
        "X-Shopify-Shop-Domain": SHOP_DOMAIN,
        "X-Shopify-Topic": "refunds/create",
        "X-Shopify-Webhook-Id": "refund-webhook-pending-source",
        "X-Shopify-Event-Id": "refund-event-pending-source"
      },
      body: payload
    }, provider);
    const receipt = await env.DB.prepare(`
      SELECT processed_at, result FROM shopify_webhook_receipts WHERE webhook_id = ?1
    `).bind("refund-webhook-pending-source").first<{ processed_at: string | null; result: string }>();

    expect(response.status).toBe(503);
    expect(receipt).toMatchObject({ processed_at: null, result: "received" });
  });

  it("rejects refunds/create from the wrong shop or topic", async () => {
    const payload = JSON.stringify({ id: 1, order_id: 2, refund_line_items: [] });
    const hmac = await sign(payload);
    const wrongShop = await request("/api/shopify/webhooks/refunds-create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Hmac-Sha256": hmac,
        "X-Shopify-Shop-Domain": "wrong-store.myshopify.com",
        "X-Shopify-Topic": "refunds/create",
        "X-Shopify-Webhook-Id": "refund-wrong-shop"
      },
      body: payload
    });
    const wrongTopic = await request("/api/shopify/webhooks/refunds-create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Hmac-Sha256": hmac,
        "X-Shopify-Shop-Domain": SHOP_DOMAIN,
        "X-Shopify-Topic": "orders/paid",
        "X-Shopify-Webhook-Id": "refund-wrong-topic"
      },
      body: payload
    });
    expect(wrongShop.status).toBe(403);
    expect(wrongTopic.status).toBe(403);
  });

  it("rejects an invalid refund webhook signature", async () => {
    const payload = JSON.stringify({ id: 1, order_id: 2, refund_line_items: [] });
    const response = await request("/api/shopify/webhooks/refunds-create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Hmac-Sha256": "invalid",
        "X-Shopify-Shop-Domain": SHOP_DOMAIN,
        "X-Shopify-Topic": "refunds/create",
        "X-Shopify-Webhook-Id": "refund-bad-hmac"
      },
      body: payload
    });
    expect(response.status).toBe(401);
  });
});

describe("quiet customer billing UI", () => {
  it("keeps billing at the bottom and cancellation hidden behind Account & billing", () => {
    expect(CUSTOMER_PAGE).toContain('id="account-billing-panel"');
    expect(CUSTOMER_PAGE).toContain("Account &amp; billing");
    expect(CUSTOMER_PAGE).toContain("Plan, support and subscription settings");
    expect(CUSTOMER_PAGE).toContain('id="request-cancellation"');
    expect(CUSTOMER_PAGE).not.toContain('<aside class="billing-card"><div class="eyebrow">Billing</div>');
    expect(CUSTOMER_PAGE.indexOf("Account &amp; billing")).toBeGreaterThan(CUSTOMER_PAGE.indexOf("Google Presence"));
    expect(CUSTOMER_PAGE).toContain("It does not cancel access instantly.");
    expect(CUSTOMER_PAGE).toContain("Saving your request…");
    expect(CUSTOMER_PAGE).toContain("Request reference: ");
    expect(CUSTOMER_PAGE).toContain("support@tapntrust.com");
    expect(CUSTOMER_PAGE).toContain("We haven't received the next successful subscription payment yet.");
  });
});
