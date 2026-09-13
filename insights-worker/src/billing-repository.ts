import type { ShopifyPlanCode } from "./shopify-webhook";

interface ChangesResult {
  changes: number;
}

interface WebhookReceiptRow {
  webhook_id: string;
  payload_hash: string;
  processed_at: string | null;
}

interface ProvisioningTargetRow {
  business_id: string;
  location_id: string;
}

interface BillingEventRow {
  id: string;
  provider_webhook_id: string;
  provider_event_id: string | null;
  provider_order_reference: string;
  provider_line_reference: string;
  external_order_reference: string;
  external_setup_reference: string | null;
  provider_customer_reference: string | null;
  provider_subscription_reference: string | null;
  billing_email: string | null;
  plan_code: ShopifyPlanCode | null;
  amount_minor: number;
  currency: string;
  occurred_at: string;
  payload_hash: string;
  result: string;
}

type SubscriptionStatus =
  | "active"
  | "review"
  | "cancel_at_period_end"
  | "grace"
  | "past_due"
  | "cancelled"
  | "expired";

interface SubscriptionRow {
  id: string;
  business_id: string;
  location_id: string;
  status: SubscriptionStatus;
  review_required: number;
}

export interface WebhookReceiptInput {
  webhookId: string;
  eventId: string | null;
  topic: string;
  shopDomain: string;
  payloadHash: string;
  receivedAt: string;
}

export interface WebhookReceiptReservation {
  receiptWebhookId: string;
  alreadyProcessed: boolean;
  payloadConflict: boolean;
}

export interface PaymentEventInput {
  providerWebhookId: string;
  providerEventId: string | null;
  providerOrderReference: string;
  providerLineReference: string;
  externalOrderReference: string;
  externalSetupReference: string | null;
  providerCustomerReference: string | null;
  providerSubscriptionReference: string | null;
  billingEmail: string | null;
  planCode: ShopifyPlanCode | null;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  payloadHash: string;
  result: string;
  createdAt: string;
}

export interface StoredPaymentEvent {
  id: string;
  providerWebhookId: string;
  providerEventId: string | null;
  providerOrderReference: string;
  providerLineReference: string;
  externalOrderReference: string;
  externalSetupReference: string | null;
  providerCustomerReference: string | null;
  providerSubscriptionReference: string | null;
  billingEmail: string | null;
  planCode: ShopifyPlanCode | null;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  payloadHash: string;
  result: string;
}

export interface ProvisioningTarget {
  businessId: string;
  locationId: string;
}

export interface SubscriptionUpsertInput extends ProvisioningTarget {
  billingEmail: string;
  providerCustomerReference: string | null;
  providerSubscriptionReference: string | null;
  externalSetupReference: string;
  providerOrderReference: string;
  planCode: ShopifyPlanCode;
  currency: string;
  paidAt: string;
  reviewRequired: boolean;
  now: string;
}

export interface StoredSubscription {
  id: string;
  businessId: string;
  locationId: string;
  status: SubscriptionStatus;
  reviewRequired: boolean;
}

function changes(result: D1Result): number {
  return Number((result.meta as ChangesResult).changes || 0);
}

function mapBillingEvent(row: BillingEventRow): StoredPaymentEvent {
  return {
    id: row.id,
    providerWebhookId: row.provider_webhook_id,
    providerEventId: row.provider_event_id,
    providerOrderReference: row.provider_order_reference,
    providerLineReference: row.provider_line_reference,
    externalOrderReference: row.external_order_reference,
    externalSetupReference: row.external_setup_reference,
    providerCustomerReference: row.provider_customer_reference,
    providerSubscriptionReference: row.provider_subscription_reference,
    billingEmail: row.billing_email,
    planCode: row.plan_code,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    occurredAt: row.occurred_at,
    payloadHash: row.payload_hash,
    result: row.result
  };
}

const BILLING_EVENT_COLUMNS = `
  id,
  provider_webhook_id,
  provider_event_id,
  provider_order_reference,
  provider_line_reference,
  external_order_reference,
  external_setup_reference,
  provider_customer_reference,
  provider_subscription_reference,
  billing_email,
  plan_code,
  amount_minor,
  currency,
  occurred_at,
  payload_hash,
  result
`;

export async function reserveShopifyWebhookReceipt(
  db: D1Database,
  input: WebhookReceiptInput
): Promise<WebhookReceiptReservation> {
  await db.prepare(`
    INSERT INTO shopify_webhook_receipts (
      webhook_id, event_id, topic, shop_domain, payload_hash,
      received_at, processed_at, result
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 'received')
    ON CONFLICT DO NOTHING
  `).bind(
    input.webhookId,
    input.eventId,
    input.topic,
    input.shopDomain,
    input.payloadHash,
    input.receivedAt
  ).run();

  const receipt = await db.prepare(`
    SELECT webhook_id, payload_hash, processed_at
    FROM shopify_webhook_receipts
    WHERE webhook_id = ?1
       OR (?2 IS NOT NULL AND shop_domain = ?3 AND topic = ?4 AND event_id = ?2)
    ORDER BY CASE WHEN webhook_id = ?1 THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(input.webhookId, input.eventId, input.shopDomain, input.topic).first<WebhookReceiptRow>();
  if (!receipt) throw new Error("Webhook receipt was not readable after reservation");
  return {
    receiptWebhookId: receipt.webhook_id,
    alreadyProcessed: Boolean(receipt.processed_at),
    payloadConflict: receipt.payload_hash !== input.payloadHash
  };
}

export async function completeShopifyWebhookReceipt(
  db: D1Database,
  webhookId: string,
  result: string,
  processedAt: string
): Promise<void> {
  await db.prepare(`
    UPDATE shopify_webhook_receipts
    SET processed_at = COALESCE(processed_at, ?2),
        result = CASE
          WHEN processed_at IS NULL THEN ?3
          WHEN result = 'duplicate' AND ?3 <> 'duplicate' THEN ?3
          ELSE result
        END
    WHERE webhook_id = ?1
  `).bind(webhookId, processedAt, result).run();
}

export async function insertPaymentEvent(
  db: D1Database,
  input: PaymentEventInput
): Promise<{ event: StoredPaymentEvent; inserted: boolean }> {
  const eventId = crypto.randomUUID();
  const insert = await db.prepare(`
    INSERT INTO insights_billing_events (
      id, subscription_id, source_event_id, provider,
      provider_webhook_id, provider_event_id, provider_order_reference,
      provider_line_reference, external_order_reference, external_setup_reference,
      provider_customer_reference, provider_subscription_reference,
      billing_email, event_type, plan_code,
      amount_minor, currency, occurred_at, payload_hash, result, created_at
    ) VALUES (
      ?1, NULL, NULL, 'shopify',
      ?2, ?3, ?4,
      ?5, ?6, ?7,
      ?8, ?9,
      ?10, 'orders_paid', ?11,
      ?12, ?13, ?14, ?15, ?16, ?17
    )
    ON CONFLICT DO NOTHING
  `).bind(
    eventId,
    input.providerWebhookId,
    input.providerEventId,
    input.providerOrderReference,
    input.providerLineReference,
    input.externalOrderReference,
    input.externalSetupReference,
    input.providerCustomerReference,
    input.providerSubscriptionReference,
    input.billingEmail,
    input.planCode,
    input.amountMinor,
    input.currency,
    input.occurredAt,
    input.payloadHash,
    input.result,
    input.createdAt
  ).run();
  const inserted = changes(insert) === 1;
  const row = await db.prepare(`
    SELECT ${BILLING_EVENT_COLUMNS}
    FROM insights_billing_events
    WHERE provider = 'shopify'
      AND provider_order_reference = ?1
      AND provider_line_reference = ?2
      AND event_type = 'orders_paid'
    LIMIT 1
  `).bind(input.providerOrderReference, input.providerLineReference).first<BillingEventRow>();
  if (!row) throw new Error("Billing event was not readable after insertion");
  return { event: mapBillingEvent(row), inserted };
}

export async function findProvisioningTarget(
  db: D1Database,
  externalOrderReference: string,
  externalSetupReference: string
): Promise<{ target: ProvisioningTarget | null; ambiguous: boolean }> {
  const exact = await db.prepare(`
    SELECT DISTINCT p.business_id, p.location_id
    FROM provisioning_batches p
    JOIN locations l ON l.id = p.location_id AND l.business_id = p.business_id
    WHERE p.external_order_reference = ?1
      AND p.external_setup_reference = ?2
    LIMIT 2
  `).bind(externalOrderReference, externalSetupReference).all<ProvisioningTargetRow>();
  if (exact.results.length === 1) {
    return {
      target: {
        businessId: exact.results[0]?.business_id || "",
        locationId: exact.results[0]?.location_id || ""
      },
      ambiguous: false
    };
  }
  if (exact.results.length > 1) return { target: null, ambiguous: true };

  const setupMatches = await db.prepare(`
    SELECT DISTINCT p.business_id, p.location_id
    FROM provisioning_batches p
    JOIN locations l ON l.id = p.location_id AND l.business_id = p.business_id
    WHERE p.external_setup_reference = ?1
    LIMIT 2
  `).bind(externalSetupReference).all<ProvisioningTargetRow>();
  return { target: null, ambiguous: setupMatches.results.length > 1 };
}

export async function findRenewalSubscriptionTarget(
  db: D1Database,
  externalSetupReference: string,
  providerCustomerReference: string
): Promise<{ target: ProvisioningTarget | null; ambiguous: boolean }> {
  const rows = await db.prepare(`
    SELECT DISTINCT s.business_id, s.location_id
    FROM insights_subscriptions s
    JOIN locations l ON l.id = s.location_id AND l.business_id = s.business_id
    WHERE s.provider = 'shopify'
      AND s.external_setup_reference = ?1
      AND s.provider_customer_reference = ?2
    LIMIT 2
  `).bind(externalSetupReference, providerCustomerReference).all<ProvisioningTargetRow>();
  if (rows.results.length !== 1) {
    return { target: null, ambiguous: rows.results.length > 1 };
  }
  return {
    target: {
      businessId: rows.results[0]?.business_id || "",
      locationId: rows.results[0]?.location_id || ""
    },
    ambiguous: false
  };
}

export async function listUnappliedPaymentEventsForSetup(
  db: D1Database,
  externalOrderReference: string,
  externalSetupReference: string
): Promise<StoredPaymentEvent[]> {
  const result = await db.prepare(`
    SELECT ${BILLING_EVENT_COLUMNS}
    FROM insights_billing_events payment
    WHERE payment.event_type = 'orders_paid'
      AND payment.result IN ('ready', 'pending')
      AND payment.external_setup_reference = ?2
      AND (
        payment.external_order_reference = ?1
        OR NOT EXISTS (
          SELECT 1 FROM provisioning_batches exact_batch
          WHERE exact_batch.external_order_reference = payment.external_order_reference
            AND exact_batch.external_setup_reference = payment.external_setup_reference
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM insights_billing_events applied
        WHERE applied.source_event_id = payment.id
          AND applied.event_type = 'payment_applied'
      )
    ORDER BY payment.occurred_at ASC, payment.created_at ASC
  `).bind(externalOrderReference, externalSetupReference).all<BillingEventRow>();
  return result.results.map(mapBillingEvent);
}

export async function hasAppliedPaymentEvent(db: D1Database, sourceEventId: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT id FROM insights_billing_events
    WHERE source_event_id = ?1 AND event_type = 'payment_applied'
    LIMIT 1
  `).bind(sourceEventId).first<{ id: string }>();
  return Boolean(row);
}

export async function upsertInsightsSubscription(
  db: D1Database,
  input: SubscriptionUpsertInput
): Promise<StoredSubscription> {
  const subscriptionId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO insights_subscriptions (
      id, business_id, location_id, provider, billing_email,
      provider_customer_reference, provider_subscription_reference,
      external_setup_reference,
      first_provider_order_reference, most_recent_provider_order_reference,
      plan_code, status, currency,
      expected_intro_price_minor, expected_recurring_price_minor,
      started_at, last_paid_at, expected_next_billing_at,
      current_period_started_at, current_period_ends_at,
      review_required, created_at, updated_at
    ) VALUES (
      ?1, ?2, ?3, 'shopify', ?4,
      ?5, ?6,
      ?7,
      ?8, ?8,
      ?9, ?10, ?11,
      199, 999,
      ?12, ?12, NULL,
      ?12, NULL,
      ?13, ?14, ?14
    )
    ON CONFLICT(provider, location_id) DO UPDATE SET
      billing_email = CASE
        WHEN excluded.last_paid_at >= insights_subscriptions.last_paid_at THEN excluded.billing_email
        ELSE insights_subscriptions.billing_email
      END,
      provider_customer_reference = CASE
        WHEN excluded.last_paid_at >= insights_subscriptions.last_paid_at
          THEN COALESCE(excluded.provider_customer_reference, insights_subscriptions.provider_customer_reference)
        ELSE insights_subscriptions.provider_customer_reference
      END,
      provider_subscription_reference = CASE
        WHEN excluded.last_paid_at >= insights_subscriptions.last_paid_at
          THEN COALESCE(excluded.provider_subscription_reference, insights_subscriptions.provider_subscription_reference)
        ELSE insights_subscriptions.provider_subscription_reference
      END,
      external_setup_reference = CASE
        WHEN excluded.last_paid_at >= insights_subscriptions.last_paid_at THEN excluded.external_setup_reference
        ELSE insights_subscriptions.external_setup_reference
      END,
      most_recent_provider_order_reference = CASE
        WHEN excluded.last_paid_at >= insights_subscriptions.last_paid_at THEN excluded.most_recent_provider_order_reference
        ELSE insights_subscriptions.most_recent_provider_order_reference
      END,
      plan_code = CASE
        WHEN excluded.last_paid_at >= insights_subscriptions.last_paid_at THEN excluded.plan_code
        ELSE insights_subscriptions.plan_code
      END,
      status = CASE
        WHEN insights_subscriptions.review_required = 1 OR excluded.review_required = 1 THEN 'review'
        ELSE 'active'
      END,
      currency = CASE
        WHEN excluded.last_paid_at >= insights_subscriptions.last_paid_at THEN excluded.currency
        ELSE insights_subscriptions.currency
      END,
      last_paid_at = MAX(insights_subscriptions.last_paid_at, excluded.last_paid_at),
      current_period_started_at = CASE
        WHEN excluded.last_paid_at >= insights_subscriptions.last_paid_at THEN excluded.current_period_started_at
        ELSE insights_subscriptions.current_period_started_at
      END,
      review_required = MAX(insights_subscriptions.review_required, excluded.review_required),
      updated_at = excluded.updated_at
    WHERE insights_subscriptions.business_id = excluded.business_id
  `).bind(
    subscriptionId,
    input.businessId,
    input.locationId,
    input.billingEmail,
    input.providerCustomerReference,
    input.providerSubscriptionReference,
    input.externalSetupReference,
    input.providerOrderReference,
    input.planCode,
    input.reviewRequired ? "review" : "active",
    input.currency,
    input.paidAt,
    input.reviewRequired ? 1 : 0,
    input.now
  ).run();

  const row = await db.prepare(`
    SELECT id, business_id, location_id, status, review_required
    FROM insights_subscriptions
    WHERE provider = 'shopify' AND location_id = ?1
    LIMIT 1
  `).bind(input.locationId).first<SubscriptionRow>();
  if (!row || row.business_id !== input.businessId) {
    throw new Error("Billing subscription did not resolve to the expected business and location");
  }
  return {
    id: row.id,
    businessId: row.business_id,
    locationId: row.location_id,
    status: row.status,
    reviewRequired: row.review_required === 1
  };
}

export async function recordBusinessIntroRedemption(
  db: D1Database,
  input: {
    businessId: string;
    subscriptionId: string;
    providerOrderReference: string;
    billingEventId: string;
    redeemedAt: string;
  }
): Promise<"recorded" | "same_event" | "previous_event"> {
  const result = await db.prepare(`
    INSERT INTO business_insights_intro_redemptions (
      business_id, subscription_id, provider, provider_order_reference,
      billing_event_id, redeemed_at, created_at
    ) VALUES (?1, ?2, 'shopify', ?3, ?4, ?5, ?5)
    ON CONFLICT DO NOTHING
  `).bind(
    input.businessId,
    input.subscriptionId,
    input.providerOrderReference,
    input.billingEventId,
    input.redeemedAt
  ).run();
  if (changes(result) === 1) return "recorded";
  const existing = await db.prepare(`
    SELECT billing_event_id
    FROM business_insights_intro_redemptions
    WHERE business_id = ?1
    LIMIT 1
  `).bind(input.businessId).first<{ billing_event_id: string }>();
  return existing?.billing_event_id === input.billingEventId ? "same_event" : "previous_event";
}

export async function markSubscriptionForReview(
  db: D1Database,
  subscriptionId: string,
  now: string
): Promise<void> {
  await db.prepare(`
    UPDATE insights_subscriptions
    SET review_required = 1, status = 'review', updated_at = ?2
    WHERE id = ?1
  `).bind(subscriptionId, now).run();
}

export async function appendAppliedPaymentEvent(
  db: D1Database,
  source: StoredPaymentEvent,
  subscriptionId: string,
  result: string,
  createdAt: string
): Promise<boolean> {
  const insert = await db.prepare(`
    INSERT INTO insights_billing_events (
      id, subscription_id, source_event_id, provider,
      provider_webhook_id, provider_event_id, provider_order_reference,
      provider_line_reference, external_order_reference, external_setup_reference,
      provider_customer_reference, provider_subscription_reference,
      billing_email, event_type, plan_code,
      amount_minor, currency, occurred_at, payload_hash, result, created_at
    ) VALUES (
      ?1, ?2, ?3, 'shopify',
      ?4, ?5, ?6,
      ?7, ?8, ?9,
      ?10, ?11,
      ?12, 'payment_applied', ?13,
      ?14, ?15, ?16, ?17, ?18, ?19
    )
    ON CONFLICT DO NOTHING
  `).bind(
    crypto.randomUUID(),
    subscriptionId,
    source.id,
    source.providerWebhookId,
    source.providerEventId,
    source.providerOrderReference,
    source.providerLineReference,
    source.externalOrderReference,
    source.externalSetupReference,
    source.providerCustomerReference,
    source.providerSubscriptionReference,
    source.billingEmail,
    source.planCode,
    source.amountMinor,
    source.currency,
    source.occurredAt,
    source.payloadHash,
    result,
    createdAt
  ).run();
  return changes(insert) === 1;
}
