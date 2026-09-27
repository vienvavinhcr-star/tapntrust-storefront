import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { handleRequest } from "../src/index";
import type { InsightsUpgradeDependencies } from "../src/insights-upgrade";

const STOREFRONT_ORIGIN = "https://tapntrust.com";
const WORKER_ORIGIN = "https://go.tapntrust.com";
const NOW = new Date("2026-09-27T01:00:00.000Z");
const INTRO_CODE = "TEST-INSIGHTS-INTRO";

function unique(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM insights_upgrade_checkout_claims"),
    env.DB.prepare("DELETE FROM insights_upgrade_sessions"),
    env.DB.prepare("DELETE FROM insights_upgrade_magic_links"),
    env.DB.prepare("DELETE FROM insights_intro_offers"),
    env.DB.prepare("DELETE FROM insights_subscription_lifecycle_events"),
    env.DB.prepare("DELETE FROM insights_cancellation_requests"),
    env.DB.prepare("DELETE FROM business_insights_intro_redemptions"),
    env.DB.prepare("DELETE FROM insights_billing_events WHERE event_type = 'payment_applied'"),
    env.DB.prepare("DELETE FROM insights_billing_events"),
    env.DB.prepare("DELETE FROM insights_subscriptions"),
    env.DB.prepare("DELETE FROM auth_request_limits"),
    env.DB.prepare("DELETE FROM provisioning_batch_cards"),
    env.DB.prepare("DELETE FROM provisioning_batches"),
    env.DB.prepare("DELETE FROM insights_entitlements"),
    env.DB.prepare("DELETE FROM tap_events"),
    env.DB.prepare("DELETE FROM cards"),
    env.DB.prepare("DELETE FROM locations"),
    env.DB.prepare("DELETE FROM businesses")
  ]);
}

async function seedCardOnlyOrder(cardCount = 2): Promise<{ batchId: string; businessId: string; locationId: string; placeId: string }> {
  const businessId = unique("business");
  const locationId = unique("location");
  const batchId = unique("batch");
  const placeId = unique("ChIJ-upgrade");
  const createdAt = NOW.toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO businesses (id, name, created_at) VALUES (?1, 'Verified Café', ?2)").bind(businessId, createdAt),
    env.DB.prepare(`
      INSERT INTO locations (id, business_id, business_name, business_address, google_place_id, google_review_url, active, created_at)
      VALUES (?1, ?2, 'Verified Café', '10 Test Street, Melbourne VIC', ?3, 'https://search.google.com/local/writereview?placeid=upgrade-test', 1, ?4)
    `).bind(locationId, businessId, placeId, createdAt),
    env.DB.prepare(`
      INSERT INTO provisioning_batches
        (id, source, external_order_reference, external_setup_reference, request_fingerprint, business_id, location_id, physical_card_count, customer_email, created_at)
      VALUES (?1, 'shopify_webhook', '#9001', ?2, ?3, ?4, ?5, ?6, 'owner@example.com', ?7)
    `).bind(batchId, unique("setup"), unique("fingerprint"), businessId, locationId, cardCount, createdAt)
  ];
  for (let index = 0; index < cardCount; index += 1) {
    const cardId = unique("card");
    statements.push(
      env.DB.prepare(`
        INSERT INTO cards (id, public_token, location_id, label, placement_type, active, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, 'counter', 1, ?5, ?5)
      `).bind(cardId, `TNT-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`, locationId, `Card ${index + 1}`, createdAt),
      env.DB.prepare("INSERT INTO provisioning_batch_cards (batch_id, card_id, card_ordinal) VALUES (?1, ?2, ?3)")
        .bind(batchId, cardId, index + 1)
    );
  }
  await env.DB.batch(statements);
  return { batchId, businessId, locationId, placeId };
}

async function call(path: string, init: RequestInit = {}, dependencies: InsightsUpgradeDependencies = {}) {
  const context = createExecutionContext();
  const testEnv = { ...env, SHOPIFY_INSIGHTS_INTRO_DISCOUNT_CODE: INTRO_CODE };
  const response = await handleRequest(
    new Request(`${WORKER_ORIGIN}${path}`, init),
    testEnv,
    context,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { now: () => NOW, ...dependencies }
  );
  return { response, context };
}

async function verifiedSession(placeId: string): Promise<string> {
  let magicUrl = "";
  const requested = await call("/api/storefront/insights-upgrade/request-link", {
    method: "POST",
    headers: { Origin: STOREFRONT_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ firstName: "Jamie", businessName: "Verified Café", googlePlaceId: placeId })
  }, {
    mailer: { async sendUpgradeLink(_email, _firstName, url) { magicUrl = url; } }
  });
  await waitOnExecutionContext(requested.context);
  const token = new URL(magicUrl).searchParams.get("token") || "";
  const confirmed = await call("/insights-upgrade/confirm", {
    method: "POST",
    headers: { Origin: WORKER_ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token })
  });
  expect(confirmed.response.status).toBe(303);
  return confirmed.response.headers.get("Set-Cookie")?.split(";", 1)[0] || "";
}

beforeEach(clearDatabase);

describe("existing-card Insights upgrade", () => {
  it("keeps business matching enumeration-safe and emails only the stored order address", async () => {
    const target = await seedCardOnlyOrder();
    const deliveries: Array<{ email: string; firstName: string; url: string }> = [];
    const found = await call("/api/storefront/insights-upgrade/request-link", {
      method: "POST",
      headers: { Origin: STOREFRONT_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Jamie", businessName: "Verified Café", googlePlaceId: target.placeId })
    }, {
      mailer: { async sendUpgradeLink(email, firstName, url) { deliveries.push({ email, firstName, url }); } }
    });
    await waitOnExecutionContext(found.context);
    expect(found.response.status).toBe(202);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ email: "owner@example.com", firstName: "Jamie" });

    const missing = await call("/api/storefront/insights-upgrade/request-link", {
      method: "POST",
      headers: { Origin: STOREFRONT_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Jamie", businessName: "Other", googlePlaceId: unique("ChIJ-missing") })
    }, { mailer: { async sendUpgradeLink() { throw new Error("must not send"); } } });
    expect(missing.response.status).toBe(202);
    expect(await missing.response.json()).toEqual(await found.response.json());
  });

  it("does not consume an email link on GET and reveals card status only after explicit confirmation", async () => {
    const target = await seedCardOnlyOrder(3);
    let magicUrl = "";
    const requested = await call("/api/storefront/insights-upgrade/request-link", {
      method: "POST",
      headers: { Origin: STOREFRONT_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Jamie", businessName: "Verified Café", googlePlaceId: target.placeId })
    }, { mailer: { async sendUpgradeLink(_email, _name, url) { magicUrl = url; } } });
    await waitOnExecutionContext(requested.context);
    const token = new URL(magicUrl).searchParams.get("token") || "";

    const preview = await call(`/insights-upgrade/verify?token=${encodeURIComponent(token)}`);
    expect(preview.response.status).toBe(200);
    expect(await preview.response.text()).not.toContain("3 Tapntrust cards");
    const linkBefore = await env.DB.prepare("SELECT used_at FROM insights_upgrade_magic_links LIMIT 1")
      .first<{ used_at: string | null }>();
    expect(linkBefore?.used_at).toBeNull();

    const confirmed = await call("/insights-upgrade/confirm", {
      method: "POST",
      headers: { Origin: WORKER_ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token })
    });
    const cookie = confirmed.response.headers.get("Set-Cookie")?.split(";", 1)[0] || "";
    const page = await call("/insights-upgrade", { headers: { Cookie: cookie } });
    const html = await page.response.text();
    expect(html).toContain("3 Tapntrust cards");
    expect(html).toContain("Not activated");
    expect(html).toContain("no shipping");

    const reused = await call("/insights-upgrade/confirm", {
      method: "POST",
      headers: { Origin: WORKER_ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token })
    });
    expect(reused.response.status).toBe(400);
  });

  it("creates an Insights-only Shopify cart with an opaque upgrade claim and no shippable variant", async () => {
    const target = await seedCardOnlyOrder();
    const cookie = await verifiedSession(target.placeId);
    const shopifyBodies: Array<Record<string, unknown>> = [];
    const checkout = await call("/api/insights-upgrade/checkout", {
      method: "POST",
      headers: { Origin: WORKER_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
      body: "{}"
    }, {
      shopifyFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        shopifyBodies.push(body);
        if (String(body.query).includes("UpgradeVariant")) {
          return Response.json({ data: { node: { id: env.SHOPIFY_INSIGHTS_VARIANT_ID, availableForSale: true, requiresShipping: false } } });
        }
        return Response.json({ data: { cartCreate: {
          cart: { checkoutUrl: "https://tapntrust-test.myshopify.com/checkouts/test", discountCodes: [{ code: INTRO_CODE, applicable: true }] },
          userErrors: [], warnings: []
        } } });
      }
    });

    expect(checkout.response.status).toBe(200);
    expect(await checkout.response.json()).toEqual({ checkoutUrl: "https://tapntrust-test.myshopify.com/checkouts/test" });
    const input = (shopifyBodies[1]?.variables as { input?: { lines?: Array<{ attributes?: Array<{ key: string; value: string }> }> } })?.input;
    const attributes = input?.lines?.[0]?.attributes || [];
    const setup = attributes.find((attribute) => attribute.key === "_Business Setup ID")?.value || "";
    expect(setup).toMatch(/^upgrade_[A-Za-z0-9_-]{40,100}$/);
    const claim = await env.DB.prepare(`
      SELECT provisioning_batch_id FROM insights_upgrade_checkout_claims WHERE setup_reference = ?1
    `).bind(setup).first<{ provisioning_batch_id: string }>();
    expect(claim?.provisioning_batch_id).toBe(target.batchId);

    const repeated = await call("/api/insights-upgrade/checkout", {
      method: "POST",
      headers: { Origin: WORKER_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
      body: "{}"
    }, {
      shopifyFetch: async () => { throw new Error("must reuse the existing checkout"); }
    });
    expect(await repeated.response.json()).toEqual({ checkoutUrl: "https://tapntrust-test.myshopify.com/checkouts/test" });
    const claimCount = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM insights_upgrade_checkout_claims WHERE provisioning_batch_id = ?1
    `).bind(target.batchId).first<{ count: number }>();
    expect(Number(claimCount?.count || 0)).toBe(1);
  });

  it("refuses checkout before claim creation when Shopify marks Insights as requiring shipping", async () => {
    const target = await seedCardOnlyOrder();
    const cookie = await verifiedSession(target.placeId);
    const checkout = await call("/api/insights-upgrade/checkout", {
      method: "POST",
      headers: { Origin: WORKER_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
      body: "{}"
    }, {
      shopifyFetch: async () => Response.json({
        data: { node: { id: env.SHOPIFY_INSIGHTS_VARIANT_ID, availableForSale: true, requiresShipping: true } }
      })
    });
    expect(checkout.response.status).toBe(503);
    expect(await checkout.response.json()).toMatchObject({ error: expect.stringContaining("shippable product") });
    const claims = await env.DB.prepare("SELECT COUNT(*) AS count FROM insights_upgrade_checkout_claims")
      .first<{ count: number }>();
    expect(Number(claims?.count || 0)).toBe(0);
  });
});
