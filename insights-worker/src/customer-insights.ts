export type InsightsPeriod = "7d" | "30d" | "all";

export interface EntitledLocation {
  id: string;
  businessId: string;
  businessName: string;
  businessAddress: string;
  googlePlaceId: string;
}

export type CustomerLocationView = Omit<EntitledLocation, "googlePlaceId">;

export interface TrendPoint {
  label: string;
  count: number;
}

export interface CardPerformance {
  id: string;
  label: string;
  placementType: string;
  active: boolean;
  periodTaps: number;
  previousPeriodTaps: number | null;
  lifetimeTaps: number;
  sharePercent: number;
  lastActivityAt: string | null;
}

export interface WeekdayActivity {
  weekday: number;
  count: number;
}

export interface CustomerLocationInsights {
  availableLocations: CustomerLocationView[];
  location: CustomerLocationView;
  period: InsightsPeriod;
  timezoneLabel: string;
  reviewOpportunities: number;
  previousPeriodOpportunities: number | null;
  allTimeOpportunities: number;
  activeCardCount: number;
  trendPercent: number | null;
  trendDirection: "up" | "down" | "steady" | "new" | "unavailable";
  trend: TrendPoint[];
  cards: CardPerformance[];
  weekdayActivity: WeekdayActivity[];
  peakWindow: string | null;
  primaryInsight: { title: string; body: string };
  recentActivity: Array<{ cardId: string; label: string; tappedAt: string }>;
}

interface EntitledLocationRow {
  id: string;
  business_id: string;
  business_name: string;
  business_address: string;
  google_place_id: string;
}

interface TotalRow {
  period_taps: number;
  previous_taps: number;
  all_time_taps: number;
}

interface TrendRow {
  bucket: string;
  tap_count: number;
}

interface CardRow {
  id: string;
  label: string;
  placement_type: string;
  active: number;
  period_taps: number;
  previous_taps: number;
  lifetime_taps: number;
  last_activity_at: string | null;
}

interface TimingRow {
  weekday: number;
  hour: number;
  tap_count: number;
}

interface RecentRow {
  card_id: string;
  label: string;
  tapped_at: string;
}

interface PeriodBounds {
  start: string;
  previousStart: string | null;
  bucketFormat: "%Y-%m-%d" | "%Y-%m";
}

export interface CustomerInsightsRepository {
  listEntitledLocations(userId: string): Promise<EntitledLocation[]>;
  reserveGoogleProviderRequest(limit: GoogleProviderRateLimit): Promise<boolean>;
  getLocationInsights(
    location: EntitledLocation,
    availableLocations: EntitledLocation[],
    period: InsightsPeriod,
    timezoneOffsetMinutes: number,
    now: Date
  ): Promise<CustomerLocationInsights>;
}

export interface GoogleProviderRateLimit {
  identifierHash: string;
  now: string;
  cooldownCutoff: string;
  windowResetCutoff: string;
  maxRequests: number;
}

function mapLocation(row: EntitledLocationRow): EntitledLocation {
  return {
    id: row.id,
    businessId: row.business_id,
    businessName: row.business_name,
    businessAddress: row.business_address,
    googlePlaceId: row.google_place_id
  };
}

function customerLocationView(location: EntitledLocation): CustomerLocationView {
  const { googlePlaceId: _googlePlaceId, ...view } = location;
  return view;
}

function periodBounds(period: InsightsPeriod, now: Date): PeriodBounds {
  const milliseconds = period === "7d" ? 7 * 86_400_000 : 30 * 86_400_000;
  if (period === "all") {
    return { start: "1970-01-01T00:00:00.000Z", previousStart: null, bucketFormat: "%Y-%m" };
  }
  const start = new Date(now.getTime() - milliseconds);
  return {
    start: start.toISOString(),
    previousStart: new Date(start.getTime() - milliseconds).toISOString(),
    bucketFormat: "%Y-%m-%d"
  };
}

function timezoneDetails(offsetMinutes: number): { modifier: string; label: string } {
  const safeOffset = Number.isInteger(offsetMinutes) && offsetMinutes >= -840 && offsetMinutes <= 840
    ? offsetMinutes
    : 0;
  const hours = Math.floor(Math.abs(safeOffset) / 60);
  const minutes = Math.abs(safeOffset) % 60;
  const sign = safeOffset >= 0 ? "+" : "-";
  return {
    modifier: `${safeOffset >= 0 ? "+" : ""}${safeOffset * 60} seconds`,
    label: `Your browser time (UTC${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")})`
  };
}

function calculateTrend(current: number, previous: number | null) {
  if (previous === null) return { percent: null, direction: "unavailable" as const };
  if (previous === 0) {
    return current === 0
      ? { percent: 0, direction: "steady" as const }
      : { percent: null, direction: "new" as const };
  }
  const percent = Math.round(((current - previous) / previous) * 100);
  return {
    percent,
    direction: percent > 0 ? "up" as const : percent < 0 ? "down" as const : "steady" as const
  };
}

function peakWindow(rows: TimingRow[]): string | null {
  const hourTotals = Array.from({ length: 24 }, () => 0);
  for (const row of rows) {
    const hour = Number(row.hour) || 0;
    hourTotals[hour] = (hourTotals[hour] || 0) + Number(row.tap_count || 0);
  }
  if (!hourTotals.some(Boolean)) return null;
  let bestHour = 0;
  let bestCount = -1;
  for (let hour = 0; hour < 24; hour += 1) {
    const count = (hourTotals[hour] || 0)
      + (hourTotals[(hour + 1) % 24] || 0)
      + (hourTotals[(hour + 2) % 24] || 0);
    if (count > bestCount) {
      bestCount = count;
      bestHour = hour;
    }
  }
  const format = (hour: number) => {
    const normalized = hour % 24;
    const suffix = normalized >= 12 ? "pm" : "am";
    const display = normalized % 12 || 12;
    return `${display}${suffix}`;
  };
  return `${format(bestHour)}–${format(bestHour + 3)}`;
}

function primaryInsight(
  cards: CardPerformance[],
  current: number,
  previous: number | null,
  window: string | null
): { title: string; body: string } {
  if (current === 0) {
    return {
      title: "Your next review opportunity starts with visibility.",
      body: "No taps were recorded in this period. Keep your card visible at the point where customers finish their experience."
    };
  }
  const strongest = cards[0];
  if (strongest && strongest.sharePercent >= 45 && current >= 4) {
    return {
      title: `${strongest.label} is your strongest placement.`,
      body: `It created ${strongest.sharePercent}% of your review opportunities in this period. Keep it easy to see and tap.`
    };
  }
  if (previous !== null && previous > 0 && current >= previous * 1.2) {
    const increase = Math.round(((current - previous) / previous) * 100);
    return {
      title: "Customer engagement is building.",
      body: `Review opportunities increased ${increase}% compared with the previous matching period.`
    };
  }
  if (window) {
    return {
      title: `${window} is your strongest engagement window.`,
      body: "Make sure your Tapntrust cards are prominent and staff prompts are consistent during this time."
    };
  }
  return {
    title: "Your Tapntrust signal is taking shape.",
    body: "Keep collecting activity and this recommendation will become more specific as patterns emerge."
  };
}

export function createCustomerInsightsRepository(db: D1Database): CustomerInsightsRepository {
  return {
    async listEntitledLocations(userId) {
      const result = await db.prepare(`
        SELECT
          l.id,
          l.business_id,
          l.business_name,
          l.business_address,
          l.google_place_id
        FROM customer_business_access a
        JOIN businesses b ON b.id = a.business_id
        JOIN locations l ON l.business_id = b.id AND l.active = 1
        JOIN insights_entitlements e ON e.location_id = l.id AND e.status = 'active'
        WHERE a.user_id = ?1
        ORDER BY b.created_at ASC, l.created_at ASC, l.id ASC
      `).bind(userId).all<EntitledLocationRow>();
      return result.results.map(mapLocation);
    },

    async reserveGoogleProviderRequest(limit) {
      const [, reservation] = await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO auth_request_limits (
            identifier_hash, window_started_at, request_count, last_allowed_at
          ) VALUES (?1, ?2, 0, '1970-01-01T00:00:00.000Z')
        `).bind(limit.identifierHash, limit.now),
        db.prepare(`
          UPDATE auth_request_limits
          SET
            window_started_at = CASE
              WHEN window_started_at <= ?2 THEN ?3
              ELSE window_started_at
            END,
            request_count = CASE
              WHEN window_started_at <= ?2 THEN 1
              ELSE request_count + 1
            END,
            last_allowed_at = ?3
          WHERE identifier_hash = ?1
            AND (
              window_started_at <= ?2
              OR (request_count < ?4 AND last_allowed_at <= ?5)
            )
        `).bind(
          limit.identifierHash,
          limit.windowResetCutoff,
          limit.now,
          limit.maxRequests,
          limit.cooldownCutoff
        )
      ]);
      return Number(reservation?.meta.changes || 0) === 1;
    },

    async getLocationInsights(location, availableLocations, period, timezoneOffsetMinutes, now) {
      const bounds = periodBounds(period, now);
      const timezone = timezoneDetails(timezoneOffsetMinutes);
      const end = now.toISOString();
      const previousStart = bounds.previousStart || bounds.start;
      const batchResults = await db.batch([
        db.prepare(`
          SELECT
            SUM(CASE WHEN t.tapped_at >= ?2 AND t.tapped_at < ?3 THEN 1 ELSE 0 END) AS period_taps,
            SUM(CASE WHEN ?4 = 1 AND t.tapped_at >= ?5 AND t.tapped_at < ?2 THEN 1 ELSE 0 END) AS previous_taps,
            COUNT(t.id) AS all_time_taps
          FROM cards c
          LEFT JOIN tap_events t ON t.card_id = c.id
          WHERE c.location_id = ?1
        `).bind(location.id, bounds.start, end, bounds.previousStart ? 1 : 0, previousStart),
        db.prepare(`
          SELECT strftime(?4, datetime(t.tapped_at, ?5)) AS bucket, COUNT(*) AS tap_count
          FROM tap_events t
          JOIN cards c ON c.id = t.card_id
          WHERE c.location_id = ?1 AND t.tapped_at >= ?2 AND t.tapped_at < ?3
          GROUP BY bucket
          ORDER BY bucket ASC
        `).bind(location.id, bounds.start, end, bounds.bucketFormat, timezone.modifier),
        db.prepare(`
          SELECT
            c.id,
            c.label,
            c.placement_type,
            c.active,
            SUM(CASE WHEN t.tapped_at >= ?2 AND t.tapped_at < ?3 THEN 1 ELSE 0 END) AS period_taps,
            SUM(CASE WHEN ?4 = 1 AND t.tapped_at >= ?5 AND t.tapped_at < ?2 THEN 1 ELSE 0 END) AS previous_taps,
            COUNT(t.id) AS lifetime_taps,
            MAX(t.tapped_at) AS last_activity_at
          FROM cards c
          LEFT JOIN tap_events t ON t.card_id = c.id
          WHERE c.location_id = ?1
          GROUP BY c.id
          ORDER BY period_taps DESC, lifetime_taps DESC, c.created_at ASC, c.id ASC
        `).bind(location.id, bounds.start, end, bounds.previousStart ? 1 : 0, previousStart),
        db.prepare(`
          SELECT
            CAST(strftime('%w', datetime(t.tapped_at, ?4)) AS INTEGER) AS weekday,
            CAST(strftime('%H', datetime(t.tapped_at, ?4)) AS INTEGER) AS hour,
            COUNT(*) AS tap_count
          FROM tap_events t
          JOIN cards c ON c.id = t.card_id
          WHERE c.location_id = ?1 AND t.tapped_at >= ?2 AND t.tapped_at < ?3
          GROUP BY weekday, hour
          ORDER BY weekday, hour
        `).bind(location.id, bounds.start, end, timezone.modifier),
        db.prepare(`
          SELECT t.card_id, c.label, t.tapped_at
          FROM tap_events t
          JOIN cards c ON c.id = t.card_id
          WHERE c.location_id = ?1
          ORDER BY t.tapped_at DESC
          LIMIT 12
        `).bind(location.id)
      ]);
      const totalsResult = batchResults[0]!;
      const trendResult = batchResults[1]!;
      const cardsResult = batchResults[2]!;
      const timingResult = batchResults[3]!;
      const recentResult = batchResults[4]!;

      const totals = (totalsResult.results[0] || {}) as unknown as TotalRow;
      const reviewOpportunities = Number(totals.period_taps || 0);
      const previousPeriodOpportunities = bounds.previousStart ? Number(totals.previous_taps || 0) : null;
      const trend = calculateTrend(reviewOpportunities, previousPeriodOpportunities);
      const cards = (cardsResult.results as unknown as CardRow[]).map((row) => ({
        id: row.id,
        label: row.label,
        placementType: row.placement_type,
        active: Number(row.active) === 1,
        periodTaps: Number(row.period_taps || 0),
        previousPeriodTaps: bounds.previousStart ? Number(row.previous_taps || 0) : null,
        lifetimeTaps: Number(row.lifetime_taps || 0),
        sharePercent: reviewOpportunities > 0
          ? Math.round((Number(row.period_taps || 0) / reviewOpportunities) * 100)
          : 0,
        lastActivityAt: row.last_activity_at || null
      }));
      const timingRows = timingResult.results as unknown as TimingRow[];
      const weekdayActivity = Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        count: timingRows
          .filter((row) => Number(row.weekday) === weekday)
          .reduce((sum, row) => sum + Number(row.tap_count || 0), 0)
      }));
      const window = peakWindow(timingRows);

      return {
        availableLocations: availableLocations.map(customerLocationView),
        location: customerLocationView(location),
        period,
        timezoneLabel: timezone.label,
        reviewOpportunities,
        previousPeriodOpportunities,
        allTimeOpportunities: Number(totals.all_time_taps || 0),
        activeCardCount: cards.filter((card) => card.active).length,
        trendPercent: trend.percent,
        trendDirection: trend.direction,
        trend: (trendResult.results as unknown as TrendRow[]).map((row) => ({
          label: row.bucket,
          count: Number(row.tap_count || 0)
        })),
        cards,
        weekdayActivity,
        peakWindow: window,
        primaryInsight: primaryInsight(cards, reviewOpportunities, previousPeriodOpportunities, window),
        recentActivity: (recentResult.results as unknown as RecentRow[]).map((row) => ({
          cardId: row.card_id,
          label: row.label,
          tappedAt: row.tapped_at
        }))
      };
    }
  };
}

export function parseInsightsPeriod(value: string | null): InsightsPeriod {
  return value === "7d" || value === "all" ? value : "30d";
}

export function parseTimezoneOffset(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= -840 && parsed <= 840 ? parsed : 0;
}

export function selectCustomerLocation(
  locations: EntitledLocation[],
  requestedLocationId: string | null
): EntitledLocation | null {
  if (!requestedLocationId) return locations[0] || null;
  return locations.find((location) => location.id === requestedLocationId) || null;
}
