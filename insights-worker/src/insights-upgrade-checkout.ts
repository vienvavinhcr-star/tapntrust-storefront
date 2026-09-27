import { generateOpaqueToken, hashToken } from "./auth";
import {
  cleanUpgradeValue,
  findActiveUpgradeSession,
  isIntroEligible,
  normaliseUpgradeOrigin,
  upgradeJson,
  type InsightsUpgradeDependencies,
  type InsightsUpgradeEnv,
  type UpgradeSessionRow
} from "./insights-upgrade";

const CHECKOUT_CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface ShopifyPayload {
  data?: Record<string, unknown>;
  errors?: Array<{ message?: string }>;
}

function validShopDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) ? domain : null;
}

async function shopifyRequest(
  env: InsightsUpgradeEnv,
  fetcher: typeof fetch,
  query: string,
  variables: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const domain = validShopDomain(env.SHOPIFY_SHOP_DOMAIN);
  if (!domain || !/^\d{4}-(01|04|07|10)$/.test(env.SHOPIFY_STOREFRONT_API_VERSION) || !env.SHOPIFY_STOREFRONT_TOKEN) {
    throw new Error("Shopify checkout is not configured.");
  }
  const response = await fetcher(`https://${domain}/api/${env.SHOPIFY_STOREFRONT_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": env.SHOPIFY_STOREFRONT_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });
  if (!response.ok) throw new Error("Shopify checkout is temporarily unavailable.");
  const payload = await response.json() as ShopifyPayload;
  if (payload.errors?.length || !payload.data) {
    throw new Error(payload.errors?.[0]?.message || "Shopify checkout could not be prepared.");
  }
  return payload.data;
}

export const INSIGHTS_UPGRADE_VARIANT_QUERY = `
  query TapntrustInsightsUpgradeVariant($id: ID!) {
    node(id: $id) {
      ... on ProductVariant {
        id
        availableForSale
        requiresShipping
      }
    }
  }
`;

export const INSIGHTS_UPGRADE_CART_MUTATION = `
  mutation TapntrustInsightsUpgradeCartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        checkoutUrl
        discountCodes { code applicable }
      }
      userErrors { field message code }
      warnings { code message target }
    }
  }
`;

async function issueOfferReservation(
  env: InsightsUpgradeEnv,
  session: UpgradeSessionRow,
  setupReference: string,
  now: Date
): Promise<{ offerKind: "intro" | "standard"; offerId?: string; discountCode?: string }> {
  if (!(await isIntroEligible(env.DB, session.business_id))) return { offerKind: "standard" };
  const discountCode = cleanUpgradeValue(env.SHOPIFY_INSIGHTS_INTRO_DISCOUNT_CODE, 120);
  if (!discountCode || /\s/.test(discountCode)) {
    throw new Error("The A$1.99 first-month offer is temporarily unavailable.");
  }
  const identityKey = `place:${await hashToken(session.google_place_id || session.location_id)}`;
  const existing = await env.DB.prepare("SELECT id FROM insights_intro_offers WHERE identity_key = ?1 LIMIT 1")
    .bind(identityKey).first<{ id: string }>();
  const offerId = existing?.id || `offer_${crypto.randomUUID().replace(/-/g, "")}`;
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  if (existing) {
    await env.DB.prepare(`
      UPDATE insights_intro_offers
      SET business_id = ?1, setup_id = ?2, status = 'issued', discount_code = NULL,
          shopify_discount_node_id = NULL, expires_at = ?3, updated_at = ?4
      WHERE id = ?5
    `).bind(session.business_id, setupReference, expiresAt, now.toISOString(), offerId).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO insights_intro_offers
        (id, identity_key, business_id, setup_id, status, discount_code, shopify_discount_node_id, expires_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, 'issued', NULL, NULL, ?5, ?6, ?6)
    `).bind(offerId, identityKey, session.business_id, setupReference, expiresAt, now.toISOString()).run();
  }
  return { offerKind: "intro", offerId, discountCode };
}

export async function createInsightsUpgradeCheckout(
  request: Request,
  env: InsightsUpgradeEnv,
  dependencies: InsightsUpgradeDependencies,
  now: Date
): Promise<Response> {
  if (request.method !== "POST") return upgradeJson({ error: "Method not allowed" }, 405);
  if (normaliseUpgradeOrigin(request.headers.get("Origin") || "") !== normaliseUpgradeOrigin(env.AUTH_BASE_URL)) {
    return upgradeJson({ error: "Request not allowed" }, 403);
  }
  const session = await findActiveUpgradeSession(env.DB, request, now);
  if (!session) return upgradeJson({ error: "Your secure session has expired. Start again to receive a new link." }, 401);
  if (session.entitlement_status === "active") return upgradeJson({ error: "Tapntrust Insights is already active for this location." }, 409);

  try {
    await env.DB.prepare(`
      DELETE FROM insights_upgrade_checkout_claims
      WHERE provisioning_batch_id = ?1
        AND provider_order_reference IS NULL
        AND expires_at <= ?2
    `).bind(session.provisioning_batch_id, now.toISOString()).run();
    const existing = await env.DB.prepare(`
      SELECT checkout_url FROM insights_upgrade_checkout_claims
      WHERE provisioning_batch_id = ?1
        AND provider_order_reference IS NULL
        AND expires_at > ?2
      LIMIT 1
    `).bind(session.provisioning_batch_id, now.toISOString()).first<{ checkout_url: string | null }>();
    if (existing?.checkout_url) {
      const savedCheckout = new URL(existing.checkout_url);
      if (savedCheckout.protocol === "https:" && !savedCheckout.username && !savedCheckout.password) {
        return upgradeJson({ checkoutUrl: savedCheckout.toString() });
      }
    }

    const fetcher = dependencies.shopifyFetch || fetch;
    const variantData = await shopifyRequest(env, fetcher, INSIGHTS_UPGRADE_VARIANT_QUERY, {
      id: env.SHOPIFY_INSIGHTS_VARIANT_ID
    });
    const variant = variantData.node as { id?: unknown; availableForSale?: unknown; requiresShipping?: unknown } | null;
    if (!variant || variant.id !== env.SHOPIFY_INSIGHTS_VARIANT_ID || variant.availableForSale !== true) {
      throw new Error("Tapntrust Insights is temporarily unavailable in Shopify.");
    }
    if (variant.requiresShipping !== false) {
      throw new Error("Insights-only checkout is paused because Shopify is currently treating it as a shippable product.");
    }

    const claimId = crypto.randomUUID();
    const setupReference = `upgrade_${generateOpaqueToken()}`;
    await env.DB.prepare(`
      INSERT INTO insights_upgrade_checkout_claims
        (id, provisioning_batch_id, setup_reference, expires_at, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).bind(
      claimId,
      session.provisioning_batch_id,
      setupReference,
      new Date(now.getTime() + CHECKOUT_CLAIM_TTL_MS).toISOString(),
      now.toISOString()
    ).run();

    try {
      const offer = await issueOfferReservation(env, session, setupReference, now);
      const attributes = [
        { key: "_Business Setup ID", value: setupReference },
        { key: "_Item Role", value: "insights" },
        { key: "_Insights Offer", value: offer.offerKind },
        ...(offer.offerId ? [{ key: "_Insights Offer ID", value: offer.offerId }] : [])
      ];
      const data = await shopifyRequest(env, fetcher, INSIGHTS_UPGRADE_CART_MUTATION, {
        input: {
          lines: [{
            merchandiseId: env.SHOPIFY_INSIGHTS_VARIANT_ID,
            quantity: 1,
            sellingPlanId: env.SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID,
            attributes
          }],
          discountCodes: offer.discountCode ? [offer.discountCode] : []
        }
      });
      const result = data.cartCreate as {
        cart?: { checkoutUrl?: unknown; discountCodes?: Array<{ code?: unknown; applicable?: unknown }> } | null;
        userErrors?: Array<{ message?: unknown }>;
      } | null;
      const userError = cleanUpgradeValue(result?.userErrors?.[0]?.message, 240);
      if (userError || !result?.cart) throw new Error(userError || "Shopify checkout could not be prepared.");
      if (offer.discountCode) {
        const applied = (result.cart.discountCodes || []).some((entry) => (
          String(entry.code || "").toLowerCase() === offer.discountCode?.toLowerCase() && entry.applicable === true
        ));
        if (!applied) throw new Error("Shopify could not apply the A$1.99 first-month offer. Please try again.");
      }
      const checkoutUrl = cleanUpgradeValue(result.cart.checkoutUrl, 2000);
      const parsed = new URL(checkoutUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        throw new Error("Shopify returned an invalid checkout link.");
      }
      await env.DB.prepare(`
        UPDATE insights_upgrade_checkout_claims SET checkout_url = ?1 WHERE id = ?2
      `).bind(parsed.toString(), claimId).run();
      return upgradeJson({ checkoutUrl });
    } catch (error) {
      await env.DB.prepare("DELETE FROM insights_upgrade_checkout_claims WHERE id = ?1")
        .bind(claimId).run().catch(() => undefined);
      throw error;
    }
  } catch (error) {
    console.error(JSON.stringify({
      message: "insights upgrade checkout failed",
      error: error instanceof Error ? error.message : String(error)
    }));
    return upgradeJson({ error: error instanceof Error ? error.message : "Checkout is temporarily unavailable." }, 503);
  }
}
