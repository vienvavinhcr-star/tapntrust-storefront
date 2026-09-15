export type AdminAnalyticsPeriod = "today" | "7d" | "30d" | "all";

export interface AdminAnalyticsRange {
  period: AdminAnalyticsPeriod | "day";
  start: string;
  end: string;
  selectedDate: string | null;
  timezoneOffsetMinutes: number;
}

export interface AdminAnalyticsCard {
  id: string;
  publicToken: string;
  label: string;
  placementType: string;
  active: boolean;
  tapsInRange: number;
  lifetimeTaps: number;
  lastTapAt: string | null;
  programmingUrl: string;
}

export interface AdminAnalyticsLocation {
  businessId: string;
  businessName: string;
  locationId: string;
  locationName: string;
  businessAddress: string;
  googlePlaceId: string;
  customerEmail: string | null;
  accountEmail: string | null;
  orderReference: string | null;
  setupReference: string | null;
  provisionedAt: string | null;
  purchasedCardCount: number | null;
  cardCount: number;
  activeCardCount: number;
  tapsInRange: number;
  lifetimeTaps: number;
  lastTapAt: string | null;
  insightsStatus: "active" | "inactive" | "not_configured";
  subscription: null | {
    status: string;
    planCode: string;
    billingEmail: string;
    currency: string;
    recurringPriceMinor: number;
    lastPaidAt: string;
    nextBillingAt: string | null;
    accessPaidThroughAt: string | null;
  };
  dashboardUsage: {
    opens: number;
    refreshGoogleDataClicks: number;
    showGoogleReviewsClicks: number;
    googleProviderCalls: number;
    rateLimited: number;
    providerUnavailable: number;
    lastActivityAt: string | null;
  };
  cards: AdminAnalyticsCard[];
}

export interface AdminAnalyticsSnapshot {
  generatedAt: string;
  range: AdminAnalyticsRange;
  totals: {
    customersWithEmail: number;
    businesses: number;
    locations: number;
    cards: number;
    activeCards: number;
    tapsInRange: number;
    lifetimeTaps: number;
    activeInsightsLocations: number;
    activePaidSubscriptions: number;
    dashboardOpens: number;
    refreshGoogleDataClicks: number;
    showGoogleReviewsClicks: number;
    googleProviderCalls: number;
  };
  locations: AdminAnalyticsLocation[];
}

interface LocationRow {
  business_id: string;
  business_name: string;
  location_id: string;
  location_name: string;
  business_address: string;
  google_place_id: string;
  customer_email: string | null;
  account_email: string | null;
  order_reference: string | null;
  setup_reference: string | null;
  provisioned_at: string | null;
  purchased_card_count: number | null;
  card_count: number;
  active_card_count: number;
  taps_in_range: number;
  lifetime_taps: number;
  last_tap_at: string | null;
  insights_status: "active" | "inactive" | "not_configured";
  subscription_status: string | null;
  plan_code: string | null;
  billing_email: string | null;
  currency: string | null;
  expected_recurring_price_minor: number | null;
  last_paid_at: string | null;
  expected_next_billing_at: string | null;
  access_paid_through_at: string | null;
  dashboard_opens: number;
  google_summary_clicks: number;
  google_reviews_clicks: number;
  provider_calls: number;
  rate_limited_requests: number;
  provider_unavailable_requests: number;
  last_usage_at: string | null;
}

interface CardRow {
  id: string;
  public_token: string;
  location_id: string;
  label: string;
  placement_type: string;
  active: number;
  taps_in_range: number;
  lifetime_taps: number;
  last_tap_at: string | null;
}

const DAY_MS = 86_400_000;

export class AdminAnalyticsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminAnalyticsInputError";
  }
}

function safeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTimezoneOffset(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < -840 || parsed > 840) {
    throw new AdminAnalyticsInputError("Invalid timezone offset");
  }
  return parsed;
}

function parseDateKey(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new AdminAnalyticsInputError("Invalid date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1970 || year > 2100
    || probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
  ) throw new AdminAnalyticsInputError("Invalid date");
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

export function buildAdminAnalyticsRange(url: URL, now: Date): AdminAnalyticsRange {
  const timezoneOffsetMinutes = parseTimezoneOffset(url.searchParams.get("timezoneOffsetMinutes"));
  const date = url.searchParams.get("date");
  const today = localDateKey(now, timezoneOffsetMinutes);
  if (date) {
    parseDateKey(date);
    if (date > today) throw new AdminAnalyticsInputError("Date cannot be in the future");
    const bounds = localDayBounds(date, timezoneOffsetMinutes);
    return {
      period: "day",
      start: bounds.start.toISOString(),
      end: (date === today && bounds.end > now ? now : bounds.end).toISOString(),
      selectedDate: date,
      timezoneOffsetMinutes
    };
  }

  const rawPeriod = url.searchParams.get("period") || "30d";
  if (rawPeriod !== "today" && rawPeriod !== "7d" && rawPeriod !== "30d" && rawPeriod !== "all") {
    throw new AdminAnalyticsInputError("Invalid period");
  }
  if (rawPeriod === "today") {
    const bounds = localDayBounds(today, timezoneOffsetMinutes);
    return {
      period: rawPeriod,
      start: bounds.start.toISOString(),
      end: now.toISOString(),
      selectedDate: today,
      timezoneOffsetMinutes
    };
  }
  return {
    period: rawPeriod,
    start: rawPeriod === "all"
      ? new Date(0).toISOString()
      : new Date(now.getTime() - (rawPeriod === "7d" ? 7 : 30) * DAY_MS).toISOString(),
    end: now.toISOString(),
    selectedDate: null,
    timezoneOffsetMinutes
  };
}

export function createAdminAnalyticsRepository(db: D1Database, baseUrl: string) {
  return {
    async getSnapshot(range: AdminAnalyticsRange, now: Date): Promise<AdminAnalyticsSnapshot> {
      const locationResult = await db.prepare(`
        SELECT
          b.id AS business_id,
          b.name AS business_name,
          l.id AS location_id,
          l.business_name AS location_name,
          l.business_address,
          l.google_place_id,
          COALESCE(
            (SELECT pb.customer_email FROM provisioning_batches pb WHERE pb.location_id = l.id AND pb.customer_email IS NOT NULL ORDER BY pb.created_at DESC LIMIT 1),
            s.billing_email,
            (SELECT u.email FROM customer_business_access a JOIN customer_users u ON u.id = a.user_id WHERE a.business_id = b.id AND u.active = 1 ORDER BY a.created_at ASC LIMIT 1)
          ) AS customer_email,
          (SELECT u.email FROM customer_business_access a JOIN customer_users u ON u.id = a.user_id WHERE a.business_id = b.id AND u.active = 1 ORDER BY a.created_at ASC LIMIT 1) AS account_email,
          (SELECT pb.external_order_reference FROM provisioning_batches pb WHERE pb.location_id = l.id ORDER BY pb.created_at DESC LIMIT 1) AS order_reference,
          (SELECT pb.external_setup_reference FROM provisioning_batches pb WHERE pb.location_id = l.id ORDER BY pb.created_at DESC LIMIT 1) AS setup_reference,
          (SELECT pb.created_at FROM provisioning_batches pb WHERE pb.location_id = l.id ORDER BY pb.created_at DESC LIMIT 1) AS provisioned_at,
          (SELECT pb.physical_card_count FROM provisioning_batches pb WHERE pb.location_id = l.id ORDER BY pb.created_at DESC LIMIT 1) AS purchased_card_count,
          (SELECT COUNT(*) FROM cards c WHERE c.location_id = l.id) AS card_count,
          (SELECT COUNT(*) FROM cards c WHERE c.location_id = l.id AND c.active = 1) AS active_card_count,
          (SELECT COUNT(*) FROM tap_events t JOIN cards c ON c.id = t.card_id WHERE c.location_id = l.id AND t.tapped_at >= ?1 AND t.tapped_at < ?2) AS taps_in_range,
          (SELECT COUNT(*) FROM tap_events t JOIN cards c ON c.id = t.card_id WHERE c.location_id = l.id) AS lifetime_taps,
          (SELECT MAX(t.tapped_at) FROM tap_events t JOIN cards c ON c.id = t.card_id WHERE c.location_id = l.id) AS last_tap_at,
          CASE WHEN e.location_id IS NULL THEN 'not_configured' ELSE e.status END AS insights_status,
          s.status AS subscription_status,
          s.plan_code,
          s.billing_email,
          s.currency,
          s.expected_recurring_price_minor,
          s.last_paid_at,
          s.expected_next_billing_at,
          s.access_paid_through_at,
          (SELECT COUNT(*) FROM customer_usage_events ue WHERE ue.location_id = l.id AND ue.event_type = 'dashboard_open' AND ue.created_at >= ?1 AND ue.created_at < ?2) AS dashboard_opens,
          (SELECT COUNT(*) FROM customer_usage_events ue WHERE ue.location_id = l.id AND ue.event_type = 'google_summary' AND ue.created_at >= ?1 AND ue.created_at < ?2) AS google_summary_clicks,
          (SELECT COUNT(*) FROM customer_usage_events ue WHERE ue.location_id = l.id AND ue.event_type = 'google_reviews' AND ue.created_at >= ?1 AND ue.created_at < ?2) AS google_reviews_clicks,
          (SELECT COUNT(*) FROM customer_usage_events ue WHERE ue.location_id = l.id AND ue.provider_called = 1 AND ue.created_at >= ?1 AND ue.created_at < ?2) AS provider_calls,
          (SELECT COUNT(*) FROM customer_usage_events ue WHERE ue.location_id = l.id AND ue.outcome = 'rate_limited' AND ue.created_at >= ?1 AND ue.created_at < ?2) AS rate_limited_requests,
          (SELECT COUNT(*) FROM customer_usage_events ue WHERE ue.location_id = l.id AND ue.outcome = 'unavailable' AND ue.created_at >= ?1 AND ue.created_at < ?2) AS provider_unavailable_requests,
          (SELECT MAX(ue.created_at) FROM customer_usage_events ue WHERE ue.location_id = l.id) AS last_usage_at
        FROM locations l
        JOIN businesses b ON b.id = l.business_id
        LEFT JOIN insights_entitlements e ON e.location_id = l.id
        LEFT JOIN insights_subscriptions s ON s.location_id = l.id AND s.provider = 'shopify'
        ORDER BY COALESCE(provisioned_at, l.created_at) DESC, b.name COLLATE NOCASE ASC
      `).bind(range.start, range.end).all<LocationRow>();

      const cardResult = await db.prepare(`
        SELECT
          c.id,
          c.public_token,
          c.location_id,
          c.label,
          c.placement_type,
          c.active,
          (SELECT COUNT(*) FROM tap_events t WHERE t.card_id = c.id AND t.tapped_at >= ?1 AND t.tapped_at < ?2) AS taps_in_range,
          (SELECT COUNT(*) FROM tap_events t WHERE t.card_id = c.id) AS lifetime_taps,
          (SELECT MAX(t.tapped_at) FROM tap_events t WHERE t.card_id = c.id) AS last_tap_at
        FROM cards c
        ORDER BY c.location_id, c.created_at, c.id
      `).bind(range.start, range.end).all<CardRow>();

      const cardsByLocation = new Map<string, AdminAnalyticsCard[]>();
      for (const row of cardResult.results) {
        const cards = cardsByLocation.get(row.location_id) || [];
        cards.push({
          id: row.id,
          publicToken: row.public_token,
          label: row.label,
          placementType: row.placement_type,
          active: row.active === 1,
          tapsInRange: safeNumber(row.taps_in_range),
          lifetimeTaps: safeNumber(row.lifetime_taps),
          lastTapAt: row.last_tap_at,
          programmingUrl: `${baseUrl.replace(/\/$/, "")}/t/${encodeURIComponent(row.public_token)}`
        });
        cardsByLocation.set(row.location_id, cards);
      }

      const locations = locationResult.results.map<AdminAnalyticsLocation>((row) => ({
        businessId: row.business_id,
        businessName: row.business_name,
        locationId: row.location_id,
        locationName: row.location_name,
        businessAddress: row.business_address,
        googlePlaceId: row.google_place_id,
        customerEmail: row.customer_email,
        accountEmail: row.account_email,
        orderReference: row.order_reference,
        setupReference: row.setup_reference,
        provisionedAt: row.provisioned_at,
        purchasedCardCount: row.purchased_card_count === null ? null : safeNumber(row.purchased_card_count),
        cardCount: safeNumber(row.card_count),
        activeCardCount: safeNumber(row.active_card_count),
        tapsInRange: safeNumber(row.taps_in_range),
        lifetimeTaps: safeNumber(row.lifetime_taps),
        lastTapAt: row.last_tap_at,
        insightsStatus: row.insights_status,
        subscription: row.subscription_status && row.plan_code && row.billing_email && row.currency && row.last_paid_at
          ? {
              status: row.subscription_status,
              planCode: row.plan_code,
              billingEmail: row.billing_email,
              currency: row.currency,
              recurringPriceMinor: safeNumber(row.expected_recurring_price_minor),
              lastPaidAt: row.last_paid_at,
              nextBillingAt: row.expected_next_billing_at,
              accessPaidThroughAt: row.access_paid_through_at
            }
          : null,
        dashboardUsage: {
          opens: safeNumber(row.dashboard_opens),
          refreshGoogleDataClicks: safeNumber(row.google_summary_clicks),
          showGoogleReviewsClicks: safeNumber(row.google_reviews_clicks),
          googleProviderCalls: safeNumber(row.provider_calls),
          rateLimited: safeNumber(row.rate_limited_requests),
          providerUnavailable: safeNumber(row.provider_unavailable_requests),
          lastActivityAt: row.last_usage_at
        },
        cards: cardsByLocation.get(row.location_id) || []
      }));

      const emailSet = new Set<string>();
      const businessSet = new Set<string>();
      let cards = 0;
      let activeCards = 0;
      let tapsInRange = 0;
      let lifetimeTaps = 0;
      let activeInsightsLocations = 0;
      let activePaidSubscriptions = 0;
      let dashboardOpens = 0;
      let refreshGoogleDataClicks = 0;
      let showGoogleReviewsClicks = 0;
      let googleProviderCalls = 0;
      for (const location of locations) {
        if (location.customerEmail) emailSet.add(location.customerEmail.toLowerCase());
        businessSet.add(location.businessId);
        cards += location.cardCount;
        activeCards += location.activeCardCount;
        tapsInRange += location.tapsInRange;
        lifetimeTaps += location.lifetimeTaps;
        if (location.insightsStatus === "active") activeInsightsLocations += 1;
        if (location.subscription?.status === "active") activePaidSubscriptions += 1;
        dashboardOpens += location.dashboardUsage.opens;
        refreshGoogleDataClicks += location.dashboardUsage.refreshGoogleDataClicks;
        showGoogleReviewsClicks += location.dashboardUsage.showGoogleReviewsClicks;
        googleProviderCalls += location.dashboardUsage.googleProviderCalls;
      }

      return {
        generatedAt: now.toISOString(),
        range,
        totals: {
          customersWithEmail: emailSet.size,
          businesses: businessSet.size,
          locations: locations.length,
          cards,
          activeCards,
          tapsInRange,
          lifetimeTaps,
          activeInsightsLocations,
          activePaidSubscriptions,
          dashboardOpens,
          refreshGoogleDataClicks,
          showGoogleReviewsClicks,
          googleProviderCalls
        },
        locations
      };
    }
  };
}

export async function handleAdminAnalyticsRequest(
  request: Request,
  db: D1Database,
  baseUrl: string,
  now: Date = new Date()
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/analytics") return null;
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  }
  try {
    const range = buildAdminAnalyticsRange(url, now);
    const snapshot = await createAdminAnalyticsRepository(db, baseUrl).getSnapshot(range, now);
    return Response.json(snapshot, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof AdminAnalyticsInputError) {
      return Response.json({ error: error.message }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    throw error;
  }
}
