export type AdminUsagePeriod = "today" | "7d" | "30d" | "all";
export type AdminUsageRangePeriod = AdminUsagePeriod | "day";

export interface AdminUsageRange {
  period: AdminUsageRangePeriod;
  start: string;
  end: string;
  selectedDate: string | null;
  timezoneOffsetMinutes: number;
}

export interface AdminUsageCounts {
  dashboardOpens: number;
  googleSummaryClicks: number;
  googleReviewsClicks: number;
  googleSummaryProviderCalls: number;
  googleReviewsProviderCalls: number;
  totalProviderCalls: number;
  rateLimitedRequests: number;
  providerUnavailableRequests: number;
}

export interface AdminCustomerUsage {
  userId: string;
  email: string;
  nickname: string | null;
  customerActive: boolean;
  customerSince: string;
  businessId: string;
  businessName: string;
  locationId: string;
  locationName: string;
  businessAddress: string;
  locationActive: boolean;
  cardCount: number;
  insightsStatus: "active" | "inactive" | "not_configured";
  insightsSource: string | null;
  subscription: null | {
    status: string;
    planCode: string;
    billingEmail: string;
    currency: string;
    expectedRecurringPriceMinor: number;
    lastPaidAt: string;
    expectedNextBillingAt: string | null;
    accessPaidThroughAt: string | null;
  };
  reviewOpportunities: {
    sevenDays: number;
    thirtyDays: number;
    lifetime: number;
  };
  lastDashboardActivityAt: string | null;
  lastUsageAt: string | null;
  usage: AdminUsageCounts;
}

export interface AdminUsageSnapshot {
  generatedAt: string;
  range: AdminUsageRange;
  totals: AdminUsageCounts & {
    customers: number;
    locations: number;
    activeInsightsLocations: number;
  };
  customers: AdminCustomerUsage[];
}

interface AdminUsageRow {
  user_id: string;
  email: string;
  nickname: string | null;
  customer_active: number;
  customer_created_at: string;
  business_id: string;
  business_name: string;
  location_id: string;
  location_name: string;
  business_address: string;
  location_active: number;
  card_count: number;
  insights_status: "active" | "inactive" | "not_configured";
  insights_source: string | null;
  subscription_status: string | null;
  plan_code: string | null;
  billing_email: string | null;
  currency: string | null;
  expected_recurring_price_minor: number | null;
  last_paid_at: string | null;
  expected_next_billing_at: string | null;
  access_paid_through_at: string | null;
  opportunities_7d: number;
  opportunities_30d: number;
  opportunities_lifetime: number;
  last_dashboard_activity_at: string | null;
  last_usage_at: string | null;
  dashboard_opens: number;
  google_summary_clicks: number;
  google_reviews_clicks: number;
  google_summary_provider_calls: number;
  google_reviews_provider_calls: number;
  rate_limited_requests: number;
  provider_unavailable_requests: number;
}

const DAY_MS = 86_400_000;
const ADMIN_JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff"
};

export class AdminUsageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminUsageInputError";
  }
}

function safeNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseAdminTimezoneOffset(value: string | null): number {
  if (value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < -840 || parsed > 840) {
    throw new AdminUsageInputError("Invalid timezoneOffsetMinutes");
  }
  return parsed;
}

export function parseAdminUsagePeriod(value: string | null): AdminUsagePeriod {
  if (value === null || value === "") return "30d";
  if (value === "today" || value === "7d" || value === "30d" || value === "all") {
    return value;
  }
  throw new AdminUsageInputError("Invalid usage period");
}

function parseDateKey(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new AdminUsageInputError("Invalid date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1970
    || year > 2100
    || probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
  ) {
    throw new AdminUsageInputError("Invalid date");
  }
  return { year, month, day };
}

function localDateKey(now: Date, timezoneOffsetMinutes: number): string {
  return new Date(now.getTime() + timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function localDayBounds(dateKey: string, timezoneOffsetMinutes: number): { start: Date; end: Date } {
  const { year, month, day } = parseDateKey(dateKey);
  const startMs = Date.UTC(year, month - 1, day) - timezoneOffsetMinutes * 60_000;
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}

export function buildAdminUsageRange(
  periodValue: string | null,
  dateValue: string | null,
  timezoneOffsetValue: string | null,
  now: Date
): AdminUsageRange {
  const timezoneOffsetMinutes = parseAdminTimezoneOffset(timezoneOffsetValue);
  const todayKey = localDateKey(now, timezoneOffsetMinutes);

  if (dateValue) {
    parseDateKey(dateValue);
    if (dateValue > todayKey) throw new AdminUsageInputError("Date cannot be in the future");
    const bounds = localDayBounds(dateValue, timezoneOffsetMinutes);
    const end = dateValue === todayKey && bounds.end.getTime() > now.getTime() ? now : bounds.end;
    return {
      period: "day",
      start: bounds.start.toISOString(),
      end: end.toISOString(),
      selectedDate: dateValue,
      timezoneOffsetMinutes
    };
  }

  const period = parseAdminUsagePeriod(periodValue);
  if (period === "today") {
    const bounds = localDayBounds(todayKey, timezoneOffsetMinutes);
    return {
      period,
      start: bounds.start.toISOString(),
      end: now.toISOString(),
      selectedDate: todayKey,
      timezoneOffsetMinutes
    };
  }

  const start = period === "all"
    ? new Date(0)
    : new Date(now.getTime() - (period === "7d" ? 7 : 30) * DAY_MS);
  return {
    period,
    start: start.toISOString(),
    end: now.toISOString(),
    selectedDate: null,
    timezoneOffsetMinutes
  };
}

function zeroUsageCounts(): AdminUsageCounts {
  return {
    dashboardOpens: 0,
    googleSummaryClicks: 0,
    googleReviewsClicks: 0,
    googleSummaryProviderCalls: 0,
    googleReviewsProviderCalls: 0,
    totalProviderCalls: 0,
    rateLimitedRequests: 0,
    providerUnavailableRequests: 0
  };
}

function usageFromRow(row: AdminUsageRow): AdminUsageCounts {
  const googleSummaryProviderCalls = safeNumber(row.google_summary_provider_calls);
  const googleReviewsProviderCalls = safeNumber(row.google_reviews_provider_calls);
  return {
    dashboardOpens: safeNumber(row.dashboard_opens),
    googleSummaryClicks: safeNumber(row.google_summary_clicks),
    googleReviewsClicks: safeNumber(row.google_reviews_clicks),
    googleSummaryProviderCalls,
    googleReviewsProviderCalls,
    totalProviderCalls: googleSummaryProviderCalls + googleReviewsProviderCalls,
    rateLimitedRequests: safeNumber(row.rate_limited_requests),
    providerUnavailableRequests: safeNumber(row.provider_unavailable_requests)
  };
}

function addUsageCounts(target: AdminUsageCounts, source: AdminUsageCounts): void {
  target.dashboardOpens += source.dashboardOpens;
  target.googleSummaryClicks += source.googleSummaryClicks;
  target.googleReviewsClicks += source.googleReviewsClicks;
  target.googleSummaryProviderCalls += source.googleSummaryProviderCalls;
  target.googleReviewsProviderCalls += source.googleReviewsProviderCalls;
  target.totalProviderCalls += source.totalProviderCalls;
  target.rateLimitedRequests += source.rateLimitedRequests;
  target.providerUnavailableRequests += source.providerUnavailableRequests;
}

export function createAdminUsageRepository(db: D1Database) {
  return {
    async getSnapshot(range: AdminUsageRange, now: Date): Promise<AdminUsageSnapshot> {
      const sevenDayStart = new Date(now.getTime() - 7 * DAY_MS).toISOString();
      const thirtyDayStart = new Date(now.getTime() - 30 * DAY_MS).toISOString();
      const currentTime = now.toISOString();
      const result = await db.prepare(`
        SELECT
          u.id AS user_id,
          u.email,
          u.nickname,
          u.active AS customer_active,
          u.created_at AS customer_created_at,
          b.id AS business_id,
          b.name AS business_name,
          l.id AS location_id,
          l.business_name AS location_name,
          l.business_address,
          l.active AS location_active,
          (SELECT COUNT(*) FROM cards c WHERE c.location_id = l.id) AS card_count,
          CASE WHEN e.location_id IS NULL THEN 'not_configured' ELSE e.status END AS insights_status,
          e.source AS insights_source,
          s.status AS subscription_status,
          s.plan_code,
          s.billing_email,
          s.currency,
          s.expected_recurring_price_minor,
          s.last_paid_at,
          s.expected_next_billing_at,
          s.access_paid_through_at,
          (
            SELECT COUNT(*)
            FROM tap_events t
            JOIN cards c ON c.id = t.card_id
            WHERE c.location_id = l.id AND t.tapped_at >= ?3 AND t.tapped_at < ?5
          ) AS opportunities_7d,
          (
            SELECT COUNT(*)
            FROM tap_events t
            JOIN cards c ON c.id = t.card_id
            WHERE c.location_id = l.id AND t.tapped_at >= ?4 AND t.tapped_at < ?5
          ) AS opportunities_30d,
          (
            SELECT COUNT(*)
            FROM tap_events t
            JOIN cards c ON c.id = t.card_id
            WHERE c.location_id = l.id
          ) AS opportunities_lifetime,
          v.last_visited_at AS last_dashboard_activity_at,
          MAX(ue.created_at) AS last_usage_at,
          COALESCE(SUM(CASE WHEN ue.event_type = 'dashboard_open' THEN 1 ELSE 0 END), 0) AS dashboard_opens,
          COALESCE(SUM(CASE WHEN ue.event_type = 'google_summary' THEN 1 ELSE 0 END), 0) AS google_summary_clicks,
          COALESCE(SUM(CASE WHEN ue.event_type = 'google_reviews' THEN 1 ELSE 0 END), 0) AS google_reviews_clicks,
          COALESCE(SUM(CASE WHEN ue.event_type = 'google_summary' AND ue.provider_called = 1 THEN 1 ELSE 0 END), 0) AS google_summary_provider_calls,
          COALESCE(SUM(CASE WHEN ue.event_type = 'google_reviews' AND ue.provider_called = 1 THEN 1 ELSE 0 END), 0) AS google_reviews_provider_calls,
          COALESCE(SUM(CASE WHEN ue.outcome = 'rate_limited' THEN 1 ELSE 0 END), 0) AS rate_limited_requests,
          COALESCE(SUM(CASE WHEN ue.outcome = 'unavailable' THEN 1 ELSE 0 END), 0) AS provider_unavailable_requests
        FROM customer_users u
        JOIN customer_business_access a ON a.user_id = u.id
        JOIN businesses b ON b.id = a.business_id
        JOIN locations l ON l.business_id = b.id
        LEFT JOIN insights_entitlements e ON e.location_id = l.id
        LEFT JOIN insights_subscriptions s ON s.location_id = l.id AND s.provider = 'shopify'
        LEFT JOIN customer_dashboard_visits v ON v.user_id = u.id AND v.location_id = l.id
        LEFT JOIN customer_usage_events ue
          ON ue.user_id = u.id
          AND ue.location_id = l.id
          AND ue.created_at >= ?1
          AND ue.created_at < ?2
        GROUP BY
          u.id, u.email, u.nickname, u.active, u.created_at,
          b.id, b.name,
          l.id, l.business_name, l.business_address, l.active,
          e.location_id, e.status, e.source,
          s.status, s.plan_code, s.billing_email, s.currency,
          s.expected_recurring_price_minor, s.last_paid_at,
          s.expected_next_billing_at, s.access_paid_through_at,
          v.last_visited_at
        ORDER BY b.name COLLATE NOCASE ASC, l.business_name COLLATE NOCASE ASC, u.email COLLATE NOCASE ASC
      `).bind(
        range.start,
        range.end,
        sevenDayStart,
        thirtyDayStart,
        currentTime
      ).all<AdminUsageRow>();

      const customers = result.results.map<AdminCustomerUsage>((row) => ({
        userId: row.user_id,
        email: row.email,
        nickname: row.nickname,
        customerActive: row.customer_active === 1,
        customerSince: row.customer_created_at,
        businessId: row.business_id,
        businessName: row.business_name,
        locationId: row.location_id,
        locationName: row.location_name,
        businessAddress: row.business_address,
        locationActive: row.location_active === 1,
        cardCount: safeNumber(row.card_count),
        insightsStatus: row.insights_status,
        insightsSource: row.insights_source,
        subscription: row.subscription_status && row.plan_code && row.billing_email && row.currency && row.last_paid_at
          ? {
              status: row.subscription_status,
              planCode: row.plan_code,
              billingEmail: row.billing_email,
              currency: row.currency,
              expectedRecurringPriceMinor: safeNumber(row.expected_recurring_price_minor),
              lastPaidAt: row.last_paid_at,
              expectedNextBillingAt: row.expected_next_billing_at,
              accessPaidThroughAt: row.access_paid_through_at
            }
          : null,
        reviewOpportunities: {
          sevenDays: safeNumber(row.opportunities_7d),
          thirtyDays: safeNumber(row.opportunities_30d),
          lifetime: safeNumber(row.opportunities_lifetime)
        },
        lastDashboardActivityAt: row.last_dashboard_activity_at,
        lastUsageAt: row.last_usage_at,
        usage: usageFromRow(row)
      }));

      const usageTotals = zeroUsageCounts();
      const customerIds = new Set<string>();
      const locationIds = new Set<string>();
      const activeInsightsLocationIds = new Set<string>();
      for (const customer of customers) {
        customerIds.add(customer.userId);
        locationIds.add(customer.locationId);
        if (customer.insightsStatus === "active") activeInsightsLocationIds.add(customer.locationId);
        addUsageCounts(usageTotals, customer.usage);
      }

      return {
        generatedAt: currentTime,
        range,
        totals: {
          customers: customerIds.size,
          locations: locationIds.size,
          activeInsightsLocations: activeInsightsLocationIds.size,
          ...usageTotals
        },
        customers
      };
    }
  };
}

export async function handleAdminUsageRequest(
  request: Request,
  url: URL,
  db: D1Database,
  now: Date = new Date()
): Promise<Response | null> {
  if (url.pathname !== "/api/admin/usage") return null;
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...ADMIN_JSON_HEADERS, Allow: "GET" }
    });
  }

  let range: AdminUsageRange;
  try {
    range = buildAdminUsageRange(
      url.searchParams.get("period"),
      url.searchParams.get("date"),
      url.searchParams.get("timezoneOffsetMinutes"),
      now
    );
  } catch (error) {
    if (error instanceof AdminUsageInputError) {
      return Response.json({ error: error.message }, { status: 400, headers: ADMIN_JSON_HEADERS });
    }
    throw error;
  }

  const snapshot = await createAdminUsageRepository(db).getSnapshot(range, now);
  return Response.json(snapshot, { headers: ADMIN_JSON_HEADERS });
}
