import { hashToken, readSessionToken } from "./auth";

export type CustomerUsageEventType = "dashboard_open" | "google_summary" | "google_reviews";

interface UsageEnv extends Env {
  GOOGLE_PLACES_API_KEY?: string;
}

interface UsageActorRow {
  user_id: string;
  location_id: string;
  google_place_id: string;
}

interface UsageTarget {
  eventType: CustomerUsageEventType;
  requestedLocationId: string | null;
  responseForTracking: Response | null;
}

const GOOGLE_PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{3,300}$/;
const GOOGLE_OUTCOMES = new Set(["available", "unavailable", "rate_limited"]);

function usageTarget(
  request: Request,
  url: URL,
  response: Response
): UsageTarget | null {
  const visitMatch = url.pathname.match(/^\/api\/customer\/locations\/([^/]+)\/visit$/);
  if (visitMatch && request.method === "POST" && response.status === 200) {
    try {
      return {
        eventType: "dashboard_open",
        requestedLocationId: decodeURIComponent(visitMatch[1] || ""),
        responseForTracking: null
      };
    } catch {
      return null;
    }
  }

  if (request.method !== "GET" || (response.status !== 200 && response.status !== 429)) {
    return null;
  }

  const eventType = url.pathname === "/api/customer/google-place/summary"
    ? "google_summary"
    : url.pathname === "/api/customer/google-place/reviews"
      ? "google_reviews"
      : null;
  if (!eventType) return null;

  return {
    eventType,
    requestedLocationId: url.searchParams.get("locationId"),
    responseForTracking: response.clone()
  };
}

async function resolveUsageActor(
  db: D1Database,
  rawSessionToken: string,
  requestedLocationId: string | null,
  now: string
): Promise<UsageActorRow | null> {
  const tokenHash = await hashToken(rawSessionToken);
  return db.prepare(`
    SELECT
      s.user_id,
      l.id AS location_id,
      l.google_place_id
    FROM customer_sessions s
    JOIN customer_users u ON u.id = s.user_id AND u.active = 1
    JOIN customer_business_access a ON a.user_id = s.user_id
    JOIN businesses b ON b.id = a.business_id
    JOIN locations l ON l.business_id = b.id AND l.active = 1
    JOIN insights_entitlements e ON e.location_id = l.id AND e.status = 'active'
    WHERE s.token_hash = ?1
      AND s.revoked_at IS NULL
      AND s.expires_at > ?2
      AND (?3 IS NULL OR l.id = ?3)
    ORDER BY b.created_at ASC, l.created_at ASC, l.id ASC
    LIMIT 1
  `).bind(tokenHash, now, requestedLocationId).first<UsageActorRow>();
}

async function googleOutcome(response: Response): Promise<string> {
  if (response.status === 429) return "rate_limited";
  try {
    const payload = await response.json() as { status?: unknown };
    return typeof payload.status === "string" && GOOGLE_OUTCOMES.has(payload.status)
      ? payload.status
      : `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}

async function recordUsage(
  db: D1Database,
  actor: UsageActorRow,
  eventType: CustomerUsageEventType,
  outcome: string,
  providerCalled: boolean,
  createdAt: string
): Promise<void> {
  await db.prepare(`
    INSERT INTO customer_usage_events (
      id, user_id, location_id, event_type, outcome, provider_called, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).bind(
    crypto.randomUUID(),
    actor.user_id,
    actor.location_id,
    eventType,
    outcome,
    providerCalled ? 1 : 0,
    createdAt
  ).run();
}

async function trackCustomerUsage(
  rawSessionToken: string,
  target: UsageTarget,
  env: UsageEnv
): Promise<void> {
  const createdAt = new Date().toISOString();
  const actor = await resolveUsageActor(
    env.DB,
    rawSessionToken,
    target.requestedLocationId,
    createdAt
  );
  if (!actor) return;

  if (target.eventType === "dashboard_open") {
    await recordUsage(env.DB, actor, target.eventType, "opened", false, createdAt);
    return;
  }

  const outcome = target.responseForTracking
    ? await googleOutcome(target.responseForTracking)
    : "unknown";
  const providerConfigured = Boolean(
    env.GOOGLE_PLACES_API_KEY
    && GOOGLE_PLACE_ID_PATTERN.test(actor.google_place_id || "")
  );
  const providerCalled = providerConfigured
    && target.responseForTracking?.status === 200
    && (outcome === "available" || outcome === "unavailable");

  await recordUsage(
    env.DB,
    actor,
    target.eventType,
    outcome,
    providerCalled,
    createdAt
  );
}

export function queueCustomerUsageTracking(
  request: Request,
  url: URL,
  response: Response,
  env: UsageEnv,
  ctx: ExecutionContext
): void {
  const rawSessionToken = readSessionToken(request);
  if (!rawSessionToken) return;
  const target = usageTarget(request, url, response);
  if (!target) return;

  ctx.waitUntil(trackCustomerUsage(rawSessionToken, target, env).catch((error) => {
    console.error(JSON.stringify({
      message: "customer usage tracking failed",
      eventType: target.eventType,
      error: error instanceof Error ? error.message : String(error)
    }));
  }));
}
