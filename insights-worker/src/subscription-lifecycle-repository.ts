export type LifecycleSubscriptionStatus =
  | "active"
  | "review"
  | "cancel_at_period_end"
  | "grace"
  | "past_due"
  | "cancelled"
  | "expired";

export type CancellationReason =
  | "Too expensive"
  | "Not using it enough"
  | "Did not see enough value"
  | "Business closed or paused"
  | "Switching to another solution"
  | "Other";

export const CANCELLATION_REASONS = new Set<CancellationReason>([
  "Too expensive",
  "Not using it enough",
  "Did not see enough value",
  "Business closed or paused",
  "Switching to another solution",
  "Other"
]);

interface SubscriptionRow {
  id: string;
  business_id: string;
  location_id: string;
  billing_email: string;
  plan_code: "intro" | "standard";
  status: LifecycleSubscriptionStatus;
  currency: string;
  most_recent_provider_order_reference: string;
  external_setup_reference: string;
  provider_customer_reference: string | null;
  provider_subscription_reference: string | null;
  review_required: number;
  last_access_billing_event_id: string | null;
  access_period_started_at: string | null;
  access_paid_through_at: string | null;
  grace_started_at: string | null;
  grace_ends_at: string | null;
  cancel_requested_at: string | null;
  cancel_confirmed_at: string | null;
  cancelled_at: string | null;
  expired_at: string | null;
}

interface CancellationRequestRow {
  id: string;
  subscription_id: string;
  business_id: string;
  location_id: string;
  customer_user_id: string;
  customer_email: string;
  reason: CancellationReason;
  note: string | null;
  status: "open" | "provider_cancelled" | "withdrawn" | "resolved";
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

interface LifecycleEventRow {
  id: string;
  event_type: string;
  applied_at: string | null;
}

interface ChangesResult {
  changes: number;
}

export interface CustomerBillingStatus {
  subscriptionId: string;
  businessId: string;
  locationId: string;
  planCode: "intro" | "standard";
  status: LifecycleSubscriptionStatus;
  accessPaidThroughAt: string | null;
  graceEndsAt: string | null;
  openCancellationRequest: {
    id: string;
    status: "open";
    createdAt: string;
  } | null;
}

export interface CancellationRequestView {
  id: string;
  subscriptionId: string;
  businessId: string;
  locationId: string;
  customerUserId: string;
  customerEmail: string;
  reason: CancellationReason;
  note: string | null;
  status: "open" | "provider_cancelled" | "withdrawn" | "resolved";
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface PaidAccessApplication {
  eventType: "access_period_started" | "renewal_applied" | "grace_recovered" | "reactivated" | "payment_after_cancellation";
  status: LifecycleSubscriptionStatus;
  accessPeriodStartedAt: string;
  accessPaidThroughAt: string;
  applied: boolean;
}

export interface LifecycleCandidate {
  id: string;
  locationId: string;
  status: LifecycleSubscriptionStatus;
  reviewRequired: boolean;
  accessPaidThroughAt: string | null;
  graceEndsAt: string | null;
}

export interface LifecycleBatchResult {
  scanned: number;
  graceStarted: number;
  expired: number;
  cancelled: number;
  failed: number;
}

function changes(result: D1Result): number {
  return Number((result.meta as ChangesResult).changes || 0);
}

function parseIso(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid lifecycle timestamp");
  return date;
}

function iso(date: Date): string {
  return date.toISOString();
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function addCalendarMonthUtc(value: string): string {
  const source = parseIso(value);
  const sourceYear = source.getUTCFullYear();
  const sourceMonth = source.getUTCMonth();
  const sourceDay = source.getUTCDate();
  const sourceMonthLength = daysInUtcMonth(sourceYear, sourceMonth);
  const sourceIsMonthEnd = sourceDay === sourceMonthLength;

  const targetMonthIndex = sourceMonth + 1;
  const targetYear = sourceYear + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const targetMonthLength = daysInUtcMonth(targetYear, targetMonth);
  const targetDay = sourceIsMonthEnd ? targetMonthLength : Math.min(sourceDay, targetMonthLength);

  return iso(new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds()
  )));
}

export function addGracePeriodUtc(value: string): string {
  const date = parseIso(value);
  date.setUTCDate(date.getUTCDate() + 3);
  return iso(date);
}

function mapCancellation(row: CancellationRequestRow): CancellationRequestView {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    businessId: row.business_id,
    locationId: row.location_id,
    customerUserId: row.customer_user_id,
    customerEmail: row.customer_email,
    reason: row.reason,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution
  };
}

async function findSubscriptionById(db: D1Database, subscriptionId: string): Promise<SubscriptionRow | null> {
  return db.prepare(`
    SELECT
      id, business_id, location_id, billing_email, plan_code, status, currency,
      most_recent_provider_order_reference, external_setup_reference,
      provider_customer_reference, provider_subscription_reference, review_required,
      last_access_billing_event_id, access_period_started_at, access_paid_through_at,
      grace_started_at, grace_ends_at,
      cancel_requested_at, cancel_confirmed_at, cancelled_at, expired_at
    FROM insights_subscriptions
    WHERE id = ?1
    LIMIT 1
  `).bind(subscriptionId).first<SubscriptionRow>();
}

export async function findCustomerSubscriptionForLocation(
  db: D1Database,
  userId: string,
  locationId: string
): Promise<SubscriptionRow | null> {
  return db.prepare(`
    SELECT
      s.id, s.business_id, s.location_id, s.billing_email, s.plan_code, s.status, s.currency,
      s.most_recent_provider_order_reference, s.external_setup_reference,
      s.provider_customer_reference, s.provider_subscription_reference, s.review_required,
      s.last_access_billing_event_id, s.access_period_started_at, s.access_paid_through_at,
      s.grace_started_at, s.grace_ends_at,
      s.cancel_requested_at, s.cancel_confirmed_at, s.cancelled_at, s.expired_at
    FROM insights_subscriptions s
    JOIN locations l ON l.id = s.location_id AND l.business_id = s.business_id
    JOIN customer_business_access a ON a.business_id = s.business_id
    JOIN customer_users u ON u.id = a.user_id AND u.active = 1
    WHERE a.user_id = ?1
      AND s.location_id = ?2
      AND s.provider = 'shopify'
    LIMIT 1
  `).bind(userId, locationId).first<SubscriptionRow>();
}

async function findOpenCancellation(db: D1Database, subscriptionId: string): Promise<CancellationRequestRow | null> {
  return db.prepare(`
    SELECT id, subscription_id, business_id, location_id, customer_user_id, customer_email,
           reason, note, status, created_at, updated_at, resolved_at, resolution
    FROM insights_cancellation_requests
    WHERE subscription_id = ?1 AND status = 'open'
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(subscriptionId).first<CancellationRequestRow>();
}

export async function getCustomerBillingStatus(
  db: D1Database,
  userId: string,
  locationId: string
): Promise<CustomerBillingStatus | null> {
  const subscription = await findCustomerSubscriptionForLocation(db, userId, locationId);
  if (!subscription) return null;
  const open = await findOpenCancellation(db, subscription.id);
  return {
    subscriptionId: subscription.id,
    businessId: subscription.business_id,
    locationId: subscription.location_id,
    planCode: subscription.plan_code,
    status: subscription.status,
    accessPaidThroughAt: subscription.access_paid_through_at,
    graceEndsAt: subscription.grace_ends_at,
    openCancellationRequest: open ? { id: open.id, status: "open", createdAt: open.created_at } : null
  };
}

async function insertLifecycleEvent(
  db: D1Database,
  input: {
    subscriptionId: string;
    sourceBillingEventId?: string | null;
    eventKey: string;
    eventType: string;
    providerReference?: string | null;
    amountMinor?: number | null;
    currency?: string | null;
    occurredAt: string;
    result: string;
    createdAt: string;
  }
): Promise<LifecycleEventRow> {
  await db.prepare(`
    INSERT INTO insights_subscription_lifecycle_events (
      id, subscription_id, source_billing_event_id, event_key, event_type,
      provider_reference, amount_minor, currency, occurred_at, result, applied_at, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11)
    ON CONFLICT(event_key) DO NOTHING
  `).bind(
    crypto.randomUUID(),
    input.subscriptionId,
    input.sourceBillingEventId ?? null,
    input.eventKey,
    input.eventType,
    input.providerReference ?? null,
    input.amountMinor ?? null,
    input.currency ?? null,
    input.occurredAt,
    input.result,
    input.createdAt
  ).run();
  const row = await db.prepare(`
    SELECT id, event_type, applied_at
    FROM insights_subscription_lifecycle_events
    WHERE event_key = ?1
    LIMIT 1
  `).bind(input.eventKey).first<LifecycleEventRow>();
  if (!row) throw new Error("Lifecycle event was not readable after insertion");
  return row;
}

export async function applySuccessfulPaymentAccessWindow(
  db: D1Database,
  subscriptionId: string,
  sourceBillingEventId: string,
  paidAt: string,
  now: string
): Promise<PaidAccessApplication> {
  // Parse eagerly so malformed provider timestamps cannot partially mutate lifecycle state.
  const paidAtMs = parseIso(paidAt).getTime();
  const eventKey = `payment:${sourceBillingEventId}`;

  const initial = await findSubscriptionById(db, subscriptionId);
  if (!initial) throw new Error("Subscription not found for paid access application");
  const existing = await insertLifecycleEvent(db, {
    subscriptionId,
    sourceBillingEventId,
    eventKey,
    eventType: "renewal_applied",
    providerReference: initial.most_recent_provider_order_reference,
    occurredAt: paidAt,
    result: "pending",
    createdAt: now
  });

  // Retry a small bounded number of times if a concurrent support/scheduler transition
  // changes the row between our read and conditional update. The source billing event is
  // also written onto the subscription so a crash cannot extend the same payment twice.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const subscription = await findSubscriptionById(db, subscriptionId);
    if (!subscription) throw new Error("Subscription disappeared during paid access application");

    if (subscription.last_access_billing_event_id === sourceBillingEventId) {
      if (!subscription.access_period_started_at || !subscription.access_paid_through_at) {
        throw new Error("Applied billing event is missing its access window");
      }
      if (!existing.applied_at) {
        await db.prepare(`
          UPDATE insights_subscription_lifecycle_events
          SET applied_at = COALESCE(applied_at, ?2),
              result = CASE WHEN result = 'pending' THEN ?3 ELSE result END
          WHERE event_key = ?1
        `).bind(eventKey, now, subscription.status).run();
      }
      const appliedEvent = await db.prepare(`
        SELECT event_type FROM insights_subscription_lifecycle_events WHERE event_key = ?1 LIMIT 1
      `).bind(eventKey).first<{ event_type: string }>();
      return {
        eventType: (appliedEvent?.event_type as PaidAccessApplication["eventType"]) || "renewal_applied",
        status: subscription.status,
        accessPeriodStartedAt: subscription.access_period_started_at,
        accessPaidThroughAt: subscription.access_paid_through_at,
        applied: false
      };
    }

    if (existing.applied_at) {
      if (!subscription.access_period_started_at || !subscription.access_paid_through_at) {
        throw new Error("Applied lifecycle event is missing its access window");
      }
      return {
        eventType: (existing.event_type as PaidAccessApplication["eventType"]) || "renewal_applied",
        status: subscription.status,
        accessPeriodStartedAt: subscription.access_period_started_at,
        accessPaidThroughAt: subscription.access_paid_through_at,
        applied: false
      };
    }

    const currentPaidThrough = subscription.access_paid_through_at;
    const currentPaidThroughMs = currentPaidThrough ? parseIso(currentPaidThrough).getTime() : 0;
    const anchor = currentPaidThrough && currentPaidThroughMs > paidAtMs ? currentPaidThrough : paidAt;
    const nextPaidThrough = addCalendarMonthUtc(anchor);
    const restarting = subscription.status === "expired" || subscription.status === "cancelled";
    const recoveringGrace = subscription.status === "grace" || subscription.status === "past_due";
    const cancelConfirmedAtMs = subscription.cancel_confirmed_at
      ? parseIso(subscription.cancel_confirmed_at).getTime()
      : null;
    const paymentAfterCancellation = !restarting && (
      (cancelConfirmedAtMs !== null && paidAtMs >= cancelConfirmedAtMs)
      || (subscription.status === "cancel_at_period_end" && cancelConfirmedAtMs === null)
    );
    const paymentBeforeConfirmedCancellation = !restarting
      && subscription.status === "cancel_at_period_end"
      && cancelConfirmedAtMs !== null
      && paidAtMs < cancelConfirmedAtMs;
    const firstAccessWindow = !subscription.access_period_started_at || !subscription.access_paid_through_at;
    const accessPeriodStartedAt = restarting || firstAccessWindow
      ? paidAt
      : (subscription.access_period_started_at || paidAt);

    let eventType: PaidAccessApplication["eventType"] = "renewal_applied";
    if (restarting) eventType = "reactivated";
    else if (paymentAfterCancellation) eventType = "payment_after_cancellation";
    else if (recoveringGrace) eventType = "grace_recovered";
    else if (firstAccessWindow) eventType = "access_period_started";

    const nextStatus: LifecycleSubscriptionStatus = paymentAfterCancellation
      ? "review"
      : paymentBeforeConfirmedCancellation
        ? "cancel_at_period_end"
        : subscription.review_required === 1 ? "review" : "active";
    const lifecycleReason = paymentAfterCancellation
      ? "payment_after_cancellation"
      : paymentBeforeConfirmedCancellation
        ? "provider_cancelled_by_support"
        : null;

    const expectedStatus = subscription.status;
    const expectedPaidThrough = subscription.access_paid_through_at;
    const expectedCancelConfirmedAt = subscription.cancel_confirmed_at;
    const results = await db.batch([
      db.prepare(`
        UPDATE insights_subscriptions
        SET access_period_started_at = ?2,
            access_paid_through_at = ?3,
            last_access_billing_event_id = ?7,
            grace_started_at = NULL,
            grace_ends_at = NULL,
            cancel_requested_at = CASE WHEN ?8 = 1 THEN NULL ELSE cancel_requested_at END,
            cancel_confirmed_at = CASE WHEN ?8 = 1 THEN NULL ELSE cancel_confirmed_at END,
            cancelled_at = CASE WHEN ?8 = 1 OR ?4 IN ('active','review') THEN NULL ELSE cancelled_at END,
            expired_at = CASE WHEN ?8 = 1 OR ?4 IN ('active','review') THEN NULL ELSE expired_at END,
            status = ?4,
            lifecycle_reason = ?5,
            updated_at = ?6
        WHERE id = ?1
          AND status = ?9
          AND COALESCE(access_paid_through_at, '') = COALESCE(?10, '')
          AND COALESCE(cancel_confirmed_at, '') = COALESCE(?11, '')
          AND COALESCE(last_access_billing_event_id, '') <> ?7
          AND EXISTS (
            SELECT 1 FROM insights_subscription_lifecycle_events e
            WHERE e.event_key = ?12 AND e.applied_at IS NULL
          )
      `).bind(
        subscriptionId,
        accessPeriodStartedAt,
        nextPaidThrough,
        nextStatus,
        lifecycleReason,
        now,
        sourceBillingEventId,
        restarting ? 1 : 0,
        expectedStatus,
        expectedPaidThrough,
        expectedCancelConfirmedAt,
        eventKey
      ),
      db.prepare(`
        UPDATE insights_subscription_lifecycle_events
        SET event_type = ?2, result = ?3, applied_at = ?4
        WHERE event_key = ?1 AND applied_at IS NULL
          AND EXISTS (
            SELECT 1 FROM insights_subscriptions s
            WHERE s.id = ?5 AND s.last_access_billing_event_id = ?6
          )
      `).bind(eventKey, eventType, nextStatus, now, subscriptionId, sourceBillingEventId)
    ]);

    if (changes(results[0] as D1Result) === 1) {
      return {
        eventType,
        status: nextStatus,
        accessPeriodStartedAt,
        accessPaidThroughAt: nextPaidThrough,
        applied: true
      };
    }
  }

  throw new Error("Could not apply paid access after concurrent lifecycle changes");
}

export async function createCancellationRequest(
  db: D1Database,
  input: {
    userId: string;
    userEmail: string;
    locationId: string;
    reason: CancellationReason;
    note: string | null;
    now: string;
  }
): Promise<CancellationRequestView | null> {
  const subscription = await findCustomerSubscriptionForLocation(db, input.userId, input.locationId);
  if (!subscription) return null;
  if (["cancel_at_period_end", "expired", "cancelled"].includes(subscription.status)) return null;

  const existing = await findOpenCancellation(db, subscription.id);
  if (existing) return mapCancellation(existing);

  const requestId = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare(`
        INSERT INTO insights_cancellation_requests (
          id, subscription_id, business_id, location_id, customer_user_id,
          customer_email, reason, note, status, created_at, updated_at, resolved_at, resolution
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'open', ?9, ?9, NULL, NULL)
      `).bind(
        requestId,
        subscription.id,
        subscription.business_id,
        subscription.location_id,
        input.userId,
        input.userEmail,
        input.reason,
        input.note,
        input.now
      ),
      db.prepare(`
        UPDATE insights_subscriptions
        SET cancel_requested_at = COALESCE(cancel_requested_at, ?2), updated_at = ?2
        WHERE id = ?1
      `).bind(subscription.id, input.now),
      db.prepare(`
        INSERT INTO insights_subscription_lifecycle_events (
          id, subscription_id, source_billing_event_id, event_key, event_type,
          provider_reference, amount_minor, currency, occurred_at, result, applied_at, created_at
        ) VALUES (?1, ?2, NULL, ?3, 'cancellation_requested', ?4, NULL, NULL, ?5, 'open', ?5, ?5)
        ON CONFLICT(event_key) DO NOTHING
      `).bind(crypto.randomUUID(), subscription.id, `cancel-request:${requestId}`, requestId, input.now)
    ]);
  } catch (error) {
    const raced = await findOpenCancellation(db, subscription.id);
    if (raced) return mapCancellation(raced);
    throw error;
  }

  const created = await db.prepare(`
    SELECT id, subscription_id, business_id, location_id, customer_user_id, customer_email,
           reason, note, status, created_at, updated_at, resolved_at, resolution
    FROM insights_cancellation_requests
    WHERE id = ?1
  `).bind(requestId).first<CancellationRequestRow>();
  return created ? mapCancellation(created) : null;
}

export async function confirmCancellationRequest(
  db: D1Database,
  requestId: string,
  now: string
): Promise<CancellationRequestView | null> {
  const row = await db.prepare(`
    SELECT id, subscription_id, business_id, location_id, customer_user_id, customer_email,
           reason, note, status, created_at, updated_at, resolved_at, resolution
    FROM insights_cancellation_requests
    WHERE id = ?1
    LIMIT 1
  `).bind(requestId).first<CancellationRequestRow>();
  if (!row) return null;
  if (row.status === "provider_cancelled" || row.status === "resolved") return mapCancellation(row);
  if (row.status !== "open") return null;

  await db.batch([
    db.prepare(`
      UPDATE insights_cancellation_requests
      SET status = 'provider_cancelled', updated_at = ?2, resolved_at = ?2,
          resolution = 'provider_cancelled_by_support'
      WHERE id = ?1 AND status = 'open'
    `).bind(requestId, now),
    db.prepare(`
      UPDATE insights_subscriptions
      SET status = 'cancel_at_period_end', cancel_confirmed_at = ?2,
          lifecycle_reason = 'provider_cancelled_by_support', updated_at = ?2
      WHERE id = ?1 AND status NOT IN ('cancelled','expired')
    `).bind(row.subscription_id, now),
    db.prepare(`
      INSERT INTO insights_subscription_lifecycle_events (
        id, subscription_id, source_billing_event_id, event_key, event_type,
        provider_reference, amount_minor, currency, occurred_at, result, applied_at, created_at
      ) VALUES (?1, ?2, NULL, ?3, 'cancel_at_period_end', ?4, NULL, NULL, ?5, 'confirmed', ?5, ?5)
      ON CONFLICT(event_key) DO NOTHING
    `).bind(crypto.randomUUID(), row.subscription_id, `cancel-confirm:${requestId}`, requestId, now)
  ]);

  const updated = await db.prepare(`
    SELECT id, subscription_id, business_id, location_id, customer_user_id, customer_email,
           reason, note, status, created_at, updated_at, resolved_at, resolution
    FROM insights_cancellation_requests WHERE id = ?1
  `).bind(requestId).first<CancellationRequestRow>();
  return updated ? mapCancellation(updated) : null;
}

export async function withdrawCancellationRequest(
  db: D1Database,
  requestId: string,
  now: string
): Promise<CancellationRequestView | null> {
  const row = await db.prepare(`
    SELECT id, subscription_id, business_id, location_id, customer_user_id, customer_email,
           reason, note, status, created_at, updated_at, resolved_at, resolution
    FROM insights_cancellation_requests
    WHERE id = ?1
    LIMIT 1
  `).bind(requestId).first<CancellationRequestRow>();
  if (!row || row.status !== "open") return null;

  await db.batch([
    db.prepare(`
      UPDATE insights_cancellation_requests
      SET status = 'withdrawn', updated_at = ?2, resolved_at = ?2,
          resolution = 'withdrawn_by_support'
      WHERE id = ?1 AND status = 'open'
    `).bind(requestId, now),
    db.prepare(`
      UPDATE insights_subscriptions
      SET cancel_requested_at = NULL, updated_at = ?2
      WHERE id = ?1 AND cancel_confirmed_at IS NULL
    `).bind(row.subscription_id, now),
    db.prepare(`
      INSERT INTO insights_subscription_lifecycle_events (
        id, subscription_id, source_billing_event_id, event_key, event_type,
        provider_reference, amount_minor, currency, occurred_at, result, applied_at, created_at
      ) VALUES (?1, ?2, NULL, ?3, 'cancellation_withdrawn', ?4, NULL, NULL, ?5, 'withdrawn', ?5, ?5)
      ON CONFLICT(event_key) DO NOTHING
    `).bind(crypto.randomUUID(), row.subscription_id, `cancel-withdraw:${requestId}`, requestId, now)
  ]);

  const updated = await db.prepare(`
    SELECT id, subscription_id, business_id, location_id, customer_user_id, customer_email,
           reason, note, status, created_at, updated_at, resolved_at, resolution
    FROM insights_cancellation_requests WHERE id = ?1
  `).bind(requestId).first<CancellationRequestRow>();
  return updated ? mapCancellation(updated) : null;
}

export async function listLifecycleCandidates(
  db: D1Database,
  now: string,
  limit = 100
): Promise<LifecycleCandidate[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await db.prepare(`
    SELECT id, location_id, status, review_required, access_paid_through_at, grace_ends_at
    FROM insights_subscriptions
    WHERE
      (status IN ('active','review') AND access_paid_through_at IS NOT NULL AND access_paid_through_at <= ?1)
      OR (status = 'grace' AND grace_ends_at IS NOT NULL AND grace_ends_at <= ?1)
      OR (status = 'cancel_at_period_end' AND access_paid_through_at IS NOT NULL AND access_paid_through_at <= ?1)
    ORDER BY COALESCE(grace_ends_at, access_paid_through_at) ASC, id ASC
    LIMIT ?2
  `).bind(now, safeLimit).all<{
    id: string;
    location_id: string;
    status: LifecycleSubscriptionStatus;
    review_required: number;
    access_paid_through_at: string | null;
    grace_ends_at: string | null;
  }>();
  return result.results.map((row) => ({
    id: row.id,
    locationId: row.location_id,
    status: row.status,
    reviewRequired: row.review_required === 1,
    accessPaidThroughAt: row.access_paid_through_at,
    graceEndsAt: row.grace_ends_at
  }));
}

async function startGrace(db: D1Database, candidate: LifecycleCandidate, now: string): Promise<boolean> {
  if (!candidate.accessPaidThroughAt) return false;
  const graceEndsAt = addGracePeriodUtc(candidate.accessPaidThroughAt);
  const eventKey = `grace:${candidate.id}:${candidate.accessPaidThroughAt}`;
  const event = await insertLifecycleEvent(db, {
    subscriptionId: candidate.id,
    eventKey,
    eventType: "grace_started",
    occurredAt: candidate.accessPaidThroughAt,
    result: "grace",
    createdAt: now
  });
  if (event.applied_at) return false;
  const results = await db.batch([
    db.prepare(`
      UPDATE insights_subscriptions
      SET status = 'grace', grace_started_at = ?2, grace_ends_at = ?3,
          lifecycle_reason = 'renewal_not_observed', updated_at = ?4
      WHERE id = ?1 AND status IN ('active','review')
        AND access_paid_through_at = ?2
    `).bind(candidate.id, candidate.accessPaidThroughAt, graceEndsAt, now),
    db.prepare(`
      UPDATE insights_subscription_lifecycle_events
      SET applied_at = ?2
      WHERE event_key = ?1 AND applied_at IS NULL
    `).bind(eventKey, now)
  ]);
  return changes(results[0] as D1Result) === 1;
}

async function expireGrace(db: D1Database, candidate: LifecycleCandidate, now: string): Promise<boolean> {
  if (!candidate.graceEndsAt) return false;
  const eventKey = `expired:${candidate.id}:${candidate.graceEndsAt}`;
  const event = await insertLifecycleEvent(db, {
    subscriptionId: candidate.id,
    eventKey,
    eventType: "access_expired",
    occurredAt: candidate.graceEndsAt,
    result: "expired",
    createdAt: now
  });
  if (event.applied_at) return false;
  const results = await db.batch([
    db.prepare(`
      UPDATE insights_subscriptions
      SET status = 'expired', expired_at = ?2, lifecycle_reason = 'grace_elapsed', updated_at = ?3
      WHERE id = ?1 AND status = 'grace' AND grace_ends_at = ?2
    `).bind(candidate.id, candidate.graceEndsAt, now),
    db.prepare(`
      UPDATE insights_entitlements
      SET status = 'inactive', deactivated_at = ?2, updated_at = ?2
      WHERE location_id = ?1 AND status = 'active'
        AND EXISTS (
          SELECT 1 FROM insights_subscriptions s
          WHERE s.id = ?3 AND s.location_id = ?1
            AND s.status = 'expired' AND s.expired_at = ?4
        )
    `).bind(candidate.locationId, now, candidate.id, candidate.graceEndsAt),
    db.prepare(`
      UPDATE insights_subscription_lifecycle_events
      SET applied_at = ?2
      WHERE event_key = ?1 AND applied_at IS NULL
    `).bind(eventKey, now)
  ]);
  return changes(results[0] as D1Result) === 1;
}

async function cancelAtPeriodEnd(db: D1Database, candidate: LifecycleCandidate, now: string): Promise<boolean> {
  if (!candidate.accessPaidThroughAt) return false;
  const eventKey = `cancelled:${candidate.id}:${candidate.accessPaidThroughAt}`;
  const event = await insertLifecycleEvent(db, {
    subscriptionId: candidate.id,
    eventKey,
    eventType: "cancelled_at_period_end",
    occurredAt: candidate.accessPaidThroughAt,
    result: "cancelled",
    createdAt: now
  });
  if (event.applied_at) return false;
  const results = await db.batch([
    db.prepare(`
      UPDATE insights_subscriptions
      SET status = 'cancelled', cancelled_at = ?2, lifecycle_reason = 'cancelled_at_period_end', updated_at = ?3
      WHERE id = ?1 AND status = 'cancel_at_period_end' AND access_paid_through_at = ?2
    `).bind(candidate.id, candidate.accessPaidThroughAt, now),
    db.prepare(`
      UPDATE insights_entitlements
      SET status = 'inactive', deactivated_at = ?2, updated_at = ?2
      WHERE location_id = ?1 AND status = 'active'
        AND EXISTS (
          SELECT 1 FROM insights_subscriptions s
          WHERE s.id = ?3 AND s.location_id = ?1
            AND s.status = 'cancelled' AND s.cancelled_at = ?4
        )
    `).bind(candidate.locationId, now, candidate.id, candidate.accessPaidThroughAt),
    db.prepare(`
      UPDATE insights_subscription_lifecycle_events
      SET applied_at = ?2
      WHERE event_key = ?1 AND applied_at IS NULL
    `).bind(eventKey, now)
  ]);
  return changes(results[0] as D1Result) === 1;
}

export async function processLifecycleBatch(
  db: D1Database,
  now: string,
  limit = 100
): Promise<LifecycleBatchResult> {
  const candidates = await listLifecycleCandidates(db, now, limit);
  const result: LifecycleBatchResult = {
    scanned: candidates.length,
    graceStarted: 0,
    expired: 0,
    cancelled: 0,
    failed: 0
  };
  for (const candidate of candidates) {
    try {
      if (candidate.status === "active" || candidate.status === "review") {
        if (await startGrace(db, candidate, now)) result.graceStarted += 1;
      } else if (candidate.status === "grace") {
        if (await expireGrace(db, candidate, now)) result.expired += 1;
      } else if (candidate.status === "cancel_at_period_end") {
        if (await cancelAtPeriodEnd(db, candidate, now)) result.cancelled += 1;
      }
    } catch (error) {
      result.failed += 1;
      console.error(JSON.stringify({
        event: "subscription_lifecycle_item_failed",
        subscriptionId: candidate.id,
        status: candidate.status,
        reason: error instanceof Error ? error.message : "unknown"
      }));
    }
  }
  return result;
}

export async function findBillingEventForProviderLine(
  db: D1Database,
  providerOrderReference: string,
  providerLineReference: string
): Promise<{ billingEventId: string; subscriptionId: string } | null> {
  return db.prepare(`
    SELECT applied.source_event_id AS billingEventId, applied.subscription_id AS subscriptionId
    FROM insights_billing_events applied
    JOIN insights_billing_events payment ON payment.id = applied.source_event_id
    WHERE applied.event_type = 'payment_applied'
      AND payment.provider_order_reference = ?1
      AND payment.provider_line_reference = ?2
      AND applied.subscription_id IS NOT NULL
    ORDER BY applied.created_at DESC
    LIMIT 1
  `).bind(providerOrderReference, providerLineReference).first<{ billingEventId: string; subscriptionId: string }>();
}

export async function recordRefundObserved(
  db: D1Database,
  input: {
    subscriptionId: string;
    sourceBillingEventId: string;
    refundReference: string;
    providerLineReference: string;
    amountMinor: number | null;
    currency: string | null;
    occurredAt: string;
    now: string;
  }
): Promise<boolean> {
  const eventKey = `refund:${input.refundReference}:${input.providerLineReference}`;
  const event = await insertLifecycleEvent(db, {
    subscriptionId: input.subscriptionId,
    sourceBillingEventId: input.sourceBillingEventId,
    eventKey,
    eventType: "refund_observed",
    providerReference: input.refundReference,
    amountMinor: input.amountMinor,
    currency: input.currency,
    occurredAt: input.occurredAt,
    result: "review",
    createdAt: input.now
  });
  if (event.applied_at) return false;
  await db.batch([
    db.prepare(`
      UPDATE insights_subscriptions
      SET status = CASE WHEN status IN ('active','review') THEN 'review' ELSE status END,
          review_required = 1,
          lifecycle_reason = CASE WHEN status IN ('active','review') THEN 'refund_observed' ELSE lifecycle_reason END,
          updated_at = ?2
      WHERE id = ?1
    `).bind(input.subscriptionId, input.now),
    db.prepare(`
      UPDATE insights_subscription_lifecycle_events
      SET applied_at = ?2
      WHERE event_key = ?1 AND applied_at IS NULL
    `).bind(eventKey, input.now)
  ]);
  return true;
}
