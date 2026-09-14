import { getShopifyAdminAccessToken } from "./shopify-admin-token";
import {
  appendAppliedPaymentEvent,
  completeShopifyWebhookReceipt,
  findProvisioningTarget,
  findRenewalSubscriptionTarget,
  hasAppliedPaymentEvent,
  insertPaymentEvent,
  listUnappliedPaymentEventsForSetup,
  markSubscriptionForReview,
  recordBusinessIntroRedemption,
  reserveShopifyWebhookReceipt,
  upsertInsightsSubscription,
  type StoredPaymentEvent
} from "./billing-repository";
import { activateInsights } from "./provisioning-repository";
import { applySuccessfulPaymentAccessWindow } from "./subscription-lifecycle-repository";
import {
  createShopifyAdminProvider,
  ShopifyAdminProviderError,
  type ShopifyAdminBillingLine,
  type ShopifyAdminProvider
} from "./shopify-admin";
import {
  readShopifyOrdersPaidWebhook,
  shopifyIdentifiersMatch,
  ShopifyWebhookError,
  type NormalizedShopifyBillingLine,
  type NormalizedShopifyPaidOrder,
  type ShopifyBillingConfiguration
} from "./shopify-webhook";

const INTRO_PRICE_MINOR = 199;
const STANDARD_PRICE_MINOR = 699;

export interface BillingWorkerEnv {
  DB: D1Database;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  SHOPIFY_SHOP_DOMAIN: string;
  SHOPIFY_INSIGHTS_VARIANT_ID: string;
  SHOPIFY_INSIGHTS_INTRO_SELLING_PLAN_ID: string;
  SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID: string;
  SHOPIFY_ADMIN_API_VERSION: string;
}

export interface BillingDependencies {
  shopifyAdminProvider?: ShopifyAdminProvider;
}

export type BillingProcessingResult =
  | "activated"
  | "activated_intro_repeat_review"
  | "pending"
  | "duplicate"
  | "ignored"
  | "test_ignored"
  | "review";

interface LineDecision {
  result: string;
  apply: boolean;
  planCode: "intro" | "standard" | null;
  providerSubscriptionReference: string | null;
}

function json(data: unknown, status = 200, allow?: string): Response {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff"
  };
  if (allow) headers.Allow = allow;
  return Response.json(data, { status, headers });
}

function configuration(env: BillingWorkerEnv): ShopifyBillingConfiguration {
  return {
    webhookSecret: env.SHOPIFY_CLIENT_SECRET,
    shopDomain: env.SHOPIFY_SHOP_DOMAIN,
    insightsVariantId: env.SHOPIFY_INSIGHTS_VARIANT_ID,
    introSellingPlanId: env.SHOPIFY_INSIGHTS_INTRO_SELLING_PLAN_ID,
    standardSellingPlanId: env.SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID
  };
}

function decideLine(
  line: NormalizedShopifyBillingLine,
  authoritative: ShopifyAdminBillingLine | null,
  order: NormalizedShopifyPaidOrder,
  config: ShopifyBillingConfiguration
): LineDecision {
  const base = { planCode: null, providerSubscriptionReference: authoritative?.providerSubscriptionReference ?? null };
  if (order.testOrder) return { ...base, result: "test_ignored", apply: false };
  if (!line.moneyValid) return { ...base, result: "anomaly_invalid_amount", apply: false };
  if (line.currency !== "AUD") return { ...base, result: "anomaly_wrong_currency", apply: false };
  if (!authoritative || !shopifyIdentifiersMatch(authoritative.variantId, config.insightsVariantId)) {
    return { ...base, result: "anomaly_authoritative_line_mismatch", apply: false };
  }

  let planCode: "intro" | "standard" | null = null;
  if (shopifyIdentifiersMatch(authoritative.sellingPlanId, config.introSellingPlanId)) {
    if (line.amountMinor === INTRO_PRICE_MINOR) planCode = "intro";
    else if (line.amountMinor === STANDARD_PRICE_MINOR) planCode = "standard";
  } else if (
    shopifyIdentifiersMatch(authoritative.sellingPlanId, config.standardSellingPlanId)
    && line.amountMinor === STANDARD_PRICE_MINOR
  ) {
    planCode = "standard";
  }
  if (!authoritative.sellingPlanId) {
    return { ...base, result: "anomaly_missing_authoritative_plan", apply: false };
  }
  if (!planCode) {
    const recognizedPlan = shopifyIdentifiersMatch(authoritative.sellingPlanId, config.introSellingPlanId)
      || shopifyIdentifiersMatch(authoritative.sellingPlanId, config.standardSellingPlanId);
    return {
      ...base,
      result: recognizedPlan ? "anomaly_amount_mismatch" : "anomaly_unrecognized_plan",
      apply: false
    };
  }
  if (!order.billingEmail) return { ...base, planCode, result: "anomaly_missing_billing_email", apply: false };
  if (!line.externalSetupReference) return { ...base, planCode, result: "anomaly_missing_setup_reference", apply: false };
  return { ...base, planCode, result: "pending", apply: true };
}

async function applyStoredPaymentEvent(
  db: D1Database,
  event: StoredPaymentEvent,
  now: string
): Promise<BillingProcessingResult> {
  if (await hasAppliedPaymentEvent(db, event.id)) return "duplicate";
  if (event.result !== "pending" && event.result !== "ready") {
    return event.result === "test_ignored" ? "test_ignored" : "review";
  }
  if (
    !event.planCode
    || !event.billingEmail
    || !event.externalSetupReference
    || event.currency !== "AUD"
    || event.amountMinor !== (event.planCode === "intro" ? INTRO_PRICE_MINOR : STANDARD_PRICE_MINOR)
  ) return "review";

  const resolution = await findProvisioningTarget(
    db,
    event.externalOrderReference,
    event.externalSetupReference
  );
  if (resolution.ambiguous) return "review";
  let target = resolution.target;
  if (!target && event.planCode === "standard" && event.providerCustomerReference) {
    const renewal = await findRenewalSubscriptionTarget(
      db,
      event.externalSetupReference,
      event.providerCustomerReference
    );
    if (renewal.ambiguous) return "review";
    target = renewal.target;
  }
  if (!target) return "pending";

  let subscription = await upsertInsightsSubscription(db, {
    ...target,
    billingEmail: event.billingEmail,
    providerCustomerReference: event.providerCustomerReference,
    providerSubscriptionReference: event.providerSubscriptionReference,
    externalSetupReference: event.externalSetupReference,
    providerOrderReference: event.providerOrderReference,
    planCode: event.planCode,
    currency: event.currency,
    paidAt: event.occurredAt,
    reviewRequired: false,
    now
  });

  let result: BillingProcessingResult = "activated";
  if (event.planCode === "intro") {
    const redemption = await recordBusinessIntroRedemption(db, {
      businessId: target.businessId,
      subscriptionId: subscription.id,
      providerOrderReference: event.providerOrderReference,
      billingEventId: event.id,
      redeemedAt: event.occurredAt
    });
    if (redemption === "previous_event") {
      await markSubscriptionForReview(db, subscription.id, now);
      subscription = { ...subscription, status: "review", reviewRequired: true };
      result = "activated_intro_repeat_review";
    }
  }

  const access = await applySuccessfulPaymentAccessWindow(
    db,
    subscription.id,
    event.id,
    event.occurredAt,
    now
  );
  if (access.eventType === "payment_after_cancellation") {
    await markSubscriptionForReview(db, subscription.id, now);
    if (result === "activated") result = "review";
  }

  await activateInsights(db, {
    email: event.billingEmail,
    businessId: target.businessId,
    locationId: target.locationId
  }, now, "shopify_orders_paid");
  await appendAppliedPaymentEvent(db, event, subscription.id, result, now);
  return result;
}

function aggregateResults(results: BillingProcessingResult[]): BillingProcessingResult {
  if (results.includes("activated_intro_repeat_review")) return "activated_intro_repeat_review";
  if (results.includes("review")) return "review";
  if (results.includes("activated")) return "activated";
  if (results.includes("pending")) return "pending";
  if (results.includes("test_ignored")) return "test_ignored";
  if (results.length > 0 && results.every((result) => result === "duplicate")) return "duplicate";
  return "ignored";
}

export async function processShopifyPaidOrder(
  db: D1Database,
  order: NormalizedShopifyPaidOrder,
  now: string,
  provider: ShopifyAdminProvider,
  config: ShopifyBillingConfiguration
): Promise<BillingProcessingResult> {
  const reservation = await reserveShopifyWebhookReceipt(db, {
    webhookId: order.webhookId,
    eventId: order.eventId,
    topic: order.topic,
    shopDomain: order.shopDomain,
    payloadHash: order.payloadHash,
    receivedAt: now
  });
  if (reservation.payloadConflict) {
    await completeShopifyWebhookReceipt(db, reservation.receiptWebhookId, "payload_conflict", now);
    return "review";
  }
  if (reservation.alreadyProcessed) return "duplicate";

  if (order.billingLines.length === 0) {
    await completeShopifyWebhookReceipt(db, reservation.receiptWebhookId, "ignored", now);
    return "ignored";
  }

  const authoritativeLines = order.testOrder
    ? []
    : await provider.getOrderBillingLines(order.providerOrderReference);

  const results: BillingProcessingResult[] = [];
  for (const line of order.billingLines) {
    const authoritative = authoritativeLines.find((candidate) => (
      shopifyIdentifiersMatch(candidate.providerLineReference, line.providerLineReference)
    )) || null;
    const decision = decideLine(line, authoritative, order, config);
    const inserted = await insertPaymentEvent(db, {
      providerWebhookId: order.webhookId,
      providerEventId: order.eventId,
      providerOrderReference: order.providerOrderReference,
      providerLineReference: line.providerLineReference,
      externalOrderReference: order.externalOrderReference,
      externalSetupReference: line.externalSetupReference,
      providerCustomerReference: order.providerCustomerReference,
      providerSubscriptionReference: decision.providerSubscriptionReference,
      billingEmail: order.billingEmail,
      planCode: decision.planCode,
      amountMinor: line.amountMinor,
      currency: line.currency,
      occurredAt: order.occurredAt,
      payloadHash: order.payloadHash,
      result: decision.result,
      createdAt: now
    });
    if (!decision.apply) {
      results.push(decision.result === "test_ignored" ? "test_ignored" : "review");
      continue;
    }
    results.push(await applyStoredPaymentEvent(db, inserted.event, now));
  }

  const result = aggregateResults(results);
  await completeShopifyWebhookReceipt(db, reservation.receiptWebhookId, result, now);
  return result;
}

export async function reconcileBillingAfterProvisioning(
  db: D1Database,
  externalOrderReference: string,
  externalSetupReference: string,
  now: string
): Promise<BillingProcessingResult> {
  const events = await listUnappliedPaymentEventsForSetup(
    db,
    externalOrderReference,
    externalSetupReference
  );
  if (events.length === 0) return "ignored";
  const results: BillingProcessingResult[] = [];
  for (const event of events) results.push(await applyStoredPaymentEvent(db, event, now));
  return aggregateResults(results);
}

function safeOrderReference(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 20)}…`;
}

export async function handleShopifyOrdersPaidWebhook(
  request: Request,
  env: BillingWorkerEnv,
  now: () => Date = () => new Date(),
  dependencies: BillingDependencies = {}
): Promise<Response> {
  const receivedAt = now().toISOString();
  try {
    const config = configuration(env);
    const order = await readShopifyOrdersPaidWebhook(request, config, receivedAt);
    const provider = dependencies.shopifyAdminProvider || createShopifyAdminProvider({
      shopDomain: env.SHOPIFY_SHOP_DOMAIN,
      accessToken: await getShopifyAdminAccessToken({
        shopDomain: env.SHOPIFY_SHOP_DOMAIN,
        clientId: env.SHOPIFY_CLIENT_ID,
        clientSecret: env.SHOPIFY_CLIENT_SECRET
      }),
      apiVersion: env.SHOPIFY_ADMIN_API_VERSION
    });
    const result = await processShopifyPaidOrder(env.DB, order, receivedAt, provider, config);
    console.log(JSON.stringify({
      event: "shopify_orders_paid",
      orderReference: safeOrderReference(order.providerOrderReference),
      result
    }));
    return json({ ok: true, result });
  } catch (error) {
    if (error instanceof ShopifyWebhookError) {
      console.warn(JSON.stringify({ event: "shopify_orders_paid_rejected", reason: error.code }));
      if (error.code === "method_not_allowed") {
        return json({ error: "Method not allowed" }, error.status, "POST");
      }
      return json(
        { error: error.code === "configuration_error" ? "Webhook unavailable" : "Webhook rejected" },
        error.status
      );
    }
    if (error instanceof ShopifyAdminProviderError) {
      console.warn(JSON.stringify({
        event: "shopify_admin_lookup_failed",
        reason: error.code,
        providerStatus: error.providerStatus
      }));
      return json({ error: "Webhook temporarily unavailable" }, 503);
    }
    console.error(JSON.stringify({ event: "shopify_orders_paid_failed", reason: "internal_error" }));
    return json({ error: "Webhook unavailable" }, 500);
  }
}
