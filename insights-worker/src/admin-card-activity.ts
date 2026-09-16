import { AdminAnalyticsInputError, buildAdminAnalyticsRange } from "./admin-analytics";

export type AdminCardSort = "newest" | "oldest" | "most_taps" | "business";

interface CardActivityRow {
  id: string;
  public_token: string;
  label: string;
  placement_type: string;
  active: number;
  created_at: string;
  business_name: string;
  business_address: string;
  taps_in_period: number;
  lifetime_taps: number;
  last_tap_at: string | null;
}

interface ActivityRow {
  id: string;
  tapped_at: string;
  public_token: string;
  label: string;
  placement_type: string;
  business_name: string;
}

interface CountRow {
  count: number;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function parseSearch(url: URL): string {
  const value = (url.searchParams.get("search") || "").trim();
  if (value.length > 100) throw new AdminAnalyticsInputError("Search is too long");
  return value.toLowerCase();
}

function parseSort(url: URL): AdminCardSort {
  const value = url.searchParams.get("sort") || "newest";
  if (value !== "newest" && value !== "oldest" && value !== "most_taps" && value !== "business") {
    throw new AdminAnalyticsInputError("Invalid card sort");
  }
  return value;
}

function parsePositiveInteger(value: string | null, fallback: number, maximum: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new AdminAnalyticsInputError("Invalid pagination value");
  }
  return parsed;
}

function cardOrder(sort: AdminCardSort): string {
  if (sort === "oldest") return "c.created_at ASC, c.id ASC";
  if (sort === "most_taps") return "taps_in_period DESC, c.created_at DESC, c.id DESC";
  if (sort === "business") return "LOWER(l.business_name) ASC, c.created_at DESC, c.id DESC";
  return "c.created_at DESC, c.id DESC";
}

export async function handleAdminCardActivityRequest(
  request: Request,
  pathname: string,
  db: D1Database,
  now: Date = new Date()
): Promise<Response | null> {
  if (pathname !== "/api/admin/card-activity") return null;
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  }

  try {
    const url = new URL(request.url);
    const range = buildAdminAnalyticsRange(url, now);
    if (range.period === "day") throw new AdminAnalyticsInputError("Date filter is not supported here");
    const search = parseSearch(url);
    const sort = parseSort(url);
    const page = parsePositiveInteger(url.searchParams.get("page"), 1, 10_000);
    const pageSize = parsePositiveInteger(url.searchParams.get("pageSize"), 50, 100);
    const offset = (page - 1) * pageSize;
    const searchPattern = `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const hasSearch = search.length > 0;
    const searchClause = hasSearch
      ? "AND (LOWER(c.public_token) LIKE ?3 ESCAPE '\\' OR LOWER(c.label) LIKE ?3 ESCAPE '\\' OR LOWER(c.placement_type) LIKE ?3 ESCAPE '\\' OR LOWER(l.business_name) LIKE ?3 ESCAPE '\\')"
      : "";

    const cardStatement = db.prepare(`
      SELECT
        c.id,
        c.public_token,
        c.label,
        c.placement_type,
        c.active,
        c.created_at,
        l.business_name,
        l.business_address,
        SUM(CASE WHEN t.tapped_at >= ?1 AND t.tapped_at < ?2 THEN 1 ELSE 0 END) AS taps_in_period,
        COUNT(t.id) AS lifetime_taps,
        MAX(t.tapped_at) AS last_tap_at
      FROM cards c
      JOIN locations l ON l.id = c.location_id
      LEFT JOIN tap_events t ON t.card_id = c.id
      WHERE 1 = 1
      ${searchClause}
      GROUP BY c.id
      ORDER BY ${cardOrder(sort)}
    `);
    const cardsResult = hasSearch
      ? await cardStatement.bind(range.start, range.end, searchPattern).all<CardActivityRow>()
      : await cardStatement.bind(range.start, range.end).all<CardActivityRow>();

    const activityWhere = ["t.tapped_at >= ?1", "t.tapped_at < ?2"];
    if (hasSearch) {
      activityWhere.push("(LOWER(c.public_token) LIKE ?3 ESCAPE '\\' OR LOWER(c.label) LIKE ?3 ESCAPE '\\' OR LOWER(c.placement_type) LIKE ?3 ESCAPE '\\' OR LOWER(l.business_name) LIKE ?3 ESCAPE '\\')");
    }
    const whereSql = activityWhere.join(" AND ");
    const activityStatement = db.prepare(`
      SELECT
        t.id,
        t.tapped_at,
        c.public_token,
        c.label,
        c.placement_type,
        l.business_name
      FROM tap_events t
      JOIN cards c ON c.id = t.card_id
      JOIN locations l ON l.id = c.location_id
      WHERE ${whereSql}
      ORDER BY t.tapped_at DESC, t.id DESC
      LIMIT ?${hasSearch ? 4 : 3} OFFSET ?${hasSearch ? 5 : 4}
    `);
    const countStatement = db.prepare(`
      SELECT COUNT(*) AS count
      FROM tap_events t
      JOIN cards c ON c.id = t.card_id
      JOIN locations l ON l.id = c.location_id
      WHERE ${whereSql}
    `);

    const [activityResult, countRow] = hasSearch
      ? await Promise.all([
          activityStatement.bind(range.start, range.end, searchPattern, pageSize, offset).all<ActivityRow>(),
          countStatement.bind(range.start, range.end, searchPattern).first<CountRow>()
        ])
      : await Promise.all([
          activityStatement.bind(range.start, range.end, pageSize, offset).all<ActivityRow>(),
          countStatement.bind(range.start, range.end).first<CountRow>()
        ]);

    const total = Number(countRow?.count || 0);
    const newCutoff = now.getTime() - 24 * 60 * 60 * 1000;

    return json({
      generatedAt: now.toISOString(),
      range,
      cards: cardsResult.results.map((row) => ({
        id: row.id,
        publicToken: row.public_token,
        label: row.label,
        placementType: row.placement_type,
        active: row.active === 1,
        createdAt: row.created_at,
        isNew: Number.isFinite(Date.parse(row.created_at)) && Date.parse(row.created_at) >= newCutoff,
        businessName: row.business_name,
        businessAddress: row.business_address,
        tapsInPeriod: Number(row.taps_in_period || 0),
        lifetimeTaps: Number(row.lifetime_taps || 0),
        lastTapAt: row.last_tap_at,
        programmingUrl: `https://go.tapntrust.com/t/${row.public_token}`
      })),
      activity: {
        items: activityResult.results.map((row) => ({
          id: row.id,
          tappedAt: row.tapped_at,
          publicToken: row.public_token,
          label: row.label,
          placementType: row.placement_type,
          businessName: row.business_name
        })),
        total,
        page,
        pageSize,
        hasMore: offset + activityResult.results.length < total
      }
    });
  } catch (error) {
    if (error instanceof AdminAnalyticsInputError) return json({ error: error.message }, 400);
    throw error;
  }
}
