import { isValidEmail, normaliseEmail } from "./auth";
import { buildAdminAnalyticsRange, AdminAnalyticsInputError } from "./admin-analytics";
import { createAdminPlaceSearchProvider, AdminPlaceSearchError, type AdminPlaceSearchProvider } from "./admin-place-search";
import { currentPartner, issuePartnerLink, partnerSafeSource, type PartnerEnv, type PartnerIdentity } from "./partner-auth";
import { parsePartnerSetup, PartnerProvisioningError, provisionPartnerCards } from "./partner-provisioning";
import { getProvisioningManifest } from "./provisioning-repository";

const TIERS = { silver: 45, gold: 50, diamond: 55 } as const;
const STATUSES = new Set(["invited", "active", "suspended", "revoked"]);
const MAX_BODY = 4096;
const MAX_ALLOWANCE = 100_000;
const MAX_SEARCHES_HOUR = 60;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "X-Content-Type-Options": "nosniff" } });
}
function failure(status: number, error: string): Response { return json({ error }, status); }
function tierRate(tier: string): number { return TIERS[tier as keyof typeof TIERS] || 45; }
function partnerView(row: PartnerIdentity): Record<string, unknown> {
  return { id: row.id, name: row.name, email: row.email, status: row.status, tier: row.tier,
    commissionPercent: tierRate(row.tier), allocated: Number(row.allowance_total),
    provisioned: Number(row.provisioned_count), remaining: Number(row.allowance_total) - Number(row.provisioned_count),
    provisionEnabled: row.provision_enabled === 1 };
}
async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if ((request.headers.get("Content-Type") || "").split(";")[0]?.trim().toLowerCase() !== "application/json"
    || Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return null;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
function cleanName(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().replace(/\s+/g, " ");
  return s.length && s.length <= max ? s : null;
}
function pageParams(url: URL): { page: number; limit: number; offset: number } | null {
  const page = Number(url.searchParams.get("page") || "1");
  const limit = Number(url.searchParams.get("pageSize") || "30");
  return Number.isInteger(page) && page >= 1 && page <= 100_000 && Number.isInteger(limit) && limit >= 1 && limit <= 100
    ? { page, limit, offset: (page - 1) * limit } : null;
}
async function findPartner(db: D1Database, id: string): Promise<PartnerIdentity | null> {
  return db.prepare(`SELECT id,email,name,status,tier,allowance_total,provisioned_count,provision_enabled FROM sales_partners WHERE id=?1`)
    .bind(id).first<PartnerIdentity>();
}
function uuidParam(id: string): boolean { return /^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(id); }

export async function handleOwnerPartners(request: Request, pathname: string, env: PartnerEnv,
  now = new Date(), sendLink?: (env: PartnerEnv, email: string, url: string) => Promise<void>): Promise<Response | null> {
  if (!pathname.startsWith("/api/admin/partners")) return null;
  const db = env.DB;
  const url = new URL(request.url);
  if (request.method !== "GET" && !partnerSafeSource(request, env)) return failure(403, "Forbidden");

  if (pathname === "/api/admin/partners") {
    if (request.method === "GET") {
      const paging = pageParams(url);
      if (!paging) return failure(400, "Invalid pagination");
      const search = (url.searchParams.get("search") || "").trim().slice(0, 120);
      const status = url.searchParams.get("status") || "all";
      const tier = url.searchParams.get("tier") || "all";
      if ((status !== "all" && !STATUSES.has(status)) || (tier !== "all" && !(tier in TIERS))) return failure(400, "Invalid filter");
      const query = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      const where = `WHERE (name LIKE ?1 ESCAPE '\\' OR email LIKE ?1 ESCAPE '\\') AND (?2='all' OR status=?2) AND (?3='all' OR tier=?3)`;
      const [rows, total] = await Promise.all([
        db.prepare(`SELECT id,email,name,status,tier,allowance_total,provisioned_count,provision_enabled,created_at,updated_at
          FROM sales_partners ${where} ORDER BY created_at DESC, id DESC LIMIT ?4 OFFSET ?5`)
          .bind(query, status, tier, paging.limit, paging.offset).all<PartnerIdentity & {created_at:string;updated_at:string}>(),
        db.prepare(`SELECT COUNT(*) AS n FROM sales_partners ${where}`).bind(query, status, tier).first<{n:number}>()
      ]);
      return json({ partners: rows.results.map(p => ({ ...partnerView(p), createdAt: p.created_at, updatedAt: p.updated_at })),
        total: Number(total?.n || 0), page: paging.page, pageSize: paging.limit });
    }
    if (request.method !== "POST") return failure(405, "Method not allowed");
    const data = await readJson(request);
    const name = cleanName(data?.name, 120);
    const email = typeof data?.email === "string" ? normaliseEmail(data.email) : "";
    if (!name || !isValidEmail(email)) return failure(400, "A partner name and valid email are required.");
    const id = crypto.randomUUID();
    try {
      await db.batch([
        db.prepare(`INSERT INTO sales_partners(id,email,name,status,tier,allowance_total,provisioned_count,provision_enabled,created_at,updated_at)
          VALUES(?1,?2,?3,'invited','silver',0,0,1,?4,?4)`).bind(id, email, name, now.toISOString()),
        db.prepare(`INSERT INTO partner_account_events(id,partner_id,action,created_at) VALUES(?1,?2,'invited',?3)`)
          .bind(crypto.randomUUID(), id, now.toISOString())
      ]);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return failure(409, "A partner with this email already exists.");
      throw error;
    }
    let emailSent = true;
    try { await issuePartnerLink(db, env, id, email, sendLink, now); }
    catch { emailSent = false; }
    return json({ partner: partnerView((await findPartner(db, id)) as PartnerIdentity), emailSent,
      message: emailSent ? "Invitation sent." : "Partner saved, but email delivery failed. Use Resend invitation." }, 201);
  }

  const match = pathname.match(/^\/api\/admin\/partners\/([^/]+)(?:\/(inventory|tier|status|invite|activity))?$/);
  if (!match || !uuidParam(match[1] || "")) return failure(404, "Partner not found");
  const id = match[1] as string;
  const action = match[2];
  const partner = await findPartner(db, id);
  if (!partner) return failure(404, "Partner not found");

  if (!action && request.method === "GET") {
    const [batches, inventory, tiers, accounts] = await Promise.all([
      db.prepare(`SELECT pp.batch_id,pp.customer_email,pp.google_place_id,pp.physical_card_count,pp.created_at,
        b.name AS business_name,l.business_address FROM partner_provisionings pp
        JOIN provisioning_batches pb ON pb.id=pp.batch_id JOIN businesses b ON b.id=pb.business_id
        JOIN locations l ON l.id=pb.location_id WHERE pp.partner_id=?1 ORDER BY pp.created_at DESC LIMIT 50`).bind(id).all(),
      db.prepare(`SELECT kind,adjustment,previous_total,new_total,note,created_at FROM partner_inventory_events WHERE partner_id=?1 ORDER BY created_at DESC LIMIT 50`).bind(id).all(),
      db.prepare(`SELECT previous_tier,new_tier,created_at FROM partner_tier_events WHERE partner_id=?1 ORDER BY created_at DESC LIMIT 50`).bind(id).all(),
      db.prepare(`SELECT action,created_at FROM partner_account_events WHERE partner_id=?1 ORDER BY created_at DESC LIMIT 50`).bind(id).all()
    ]);
    return json({ partner: partnerView(partner), batches: batches.results, inventory: inventory.results,
      membershipHistory: tiers.results, accountHistory: accounts.results });
  }

  if (action === "activity" && request.method === "GET") {
    const paging = pageParams(url);
    if (!paging) return failure(400, "Invalid pagination");
    const search = (url.searchParams.get("search") || "").trim();
    if (search.length > 120) return failure(400, "Search is too long");
    let range;
    try { range = buildAdminAnalyticsRange(url, now); } catch (error) {
      if (error instanceof AdminAnalyticsInputError) return failure(400, error.message);
      throw error;
    }
    const needle = `%${search.replace(/[\\%_]/g,"\\$&")}%`;
    const where = `WHERE partner_id=?1 AND created_at>=?2 AND created_at<=?3
      AND (COALESCE(business_name,'') LIKE ?4 ESCAPE '\\' OR COALESCE(search_query,'') LIKE ?4 ESCAPE '\\' OR COALESCE(google_place_id,'') LIKE ?4 ESCAPE '\\' OR event_type LIKE ?4 ESCAPE '\\')`;
    const [events, count, searches, selections, unique, cards] = await Promise.all([
      db.prepare(`SELECT event_type,search_query,business_name,google_place_id,batch_id,physical_card_count,created_at
        FROM partner_activity ${where} ORDER BY created_at DESC,id DESC LIMIT ?5 OFFSET ?6`)
        .bind(id, range.start, range.end, needle, paging.limit, paging.offset).all(),
      db.prepare(`SELECT COUNT(*) AS n FROM partner_activity ${where}`).bind(id, range.start, range.end, needle).first<{n:number}>(),
      db.prepare(`SELECT COUNT(*) AS n FROM partner_activity WHERE partner_id=?1 AND event_type='business_search' AND created_at>=?2 AND created_at<=?3`).bind(id,range.start,range.end).first<{n:number}>(),
      db.prepare(`SELECT COUNT(*) AS n FROM partner_activity WHERE partner_id=?1 AND event_type='business_selected' AND created_at>=?2 AND created_at<=?3`).bind(id,range.start,range.end).first<{n:number}>(),
      db.prepare(`SELECT COUNT(DISTINCT COALESCE(NULLIF(google_place_id,''),business_name)) AS n FROM partner_activity WHERE partner_id=?1 AND event_type='business_selected' AND created_at>=?2 AND created_at<=?3`).bind(id,range.start,range.end).first<{n:number}>(),
      db.prepare(`SELECT COALESCE(SUM(physical_card_count),0) AS n FROM partner_activity WHERE partner_id=?1 AND event_type='cards_provisioned' AND created_at>=?2 AND created_at<=?3`).bind(id,range.start,range.end).first<{n:number}>()
    ]);
    return json({ range, totals: { searches: Number(searches?.n||0), selections: Number(selections?.n||0),
      uniqueBusinesses: Number(unique?.n||0), cardsProvisioned: Number(cards?.n||0) },
      activity: events.results, total: Number(count?.n||0), page: paging.page, pageSize: paging.limit });
  }

  if (request.method !== "POST") return failure(405, "Method not allowed");
  const data = await readJson(request);
  if (!data) return failure(400, "Invalid JSON request");
  const timestamp = now.toISOString();

  if (action === "inventory") {
    const kind = data.kind;
    const count = data.count;
    const note = typeof data.note === "string" ? data.note.trim() : "";
    if ((kind !== "add" && kind !== "set") || !Number.isInteger(count) || Number(count) < (kind === "add" ? 1 : 0)
      || Number(count) > MAX_ALLOWANCE || note.length > 200) return failure(400, "Invalid card allocation");
    const previous = Number(partner.allowance_total);
    const next = kind === "add" ? previous + Number(count) : Number(count);
    if (next > MAX_ALLOWANCE || next < partner.provisioned_count) return failure(409, "Allowance cannot be lower than cards already provisioned.");
    const eventId = crypto.randomUUID();
    try {
      await db.batch([
        db.prepare(`UPDATE sales_partners SET allowance_total=?2,updated_at=?3 WHERE id=?1 AND allowance_total=?4 AND provisioned_count<=?2`)
          .bind(id,next,timestamp,previous),
        db.prepare(`INSERT INTO partner_inventory_events(id,partner_id,kind,adjustment,previous_total,new_total,note,created_at)
          SELECT ?1,?2,?3,?4,?5,?6,?7,?8 FROM sales_partners WHERE id=?2 AND allowance_total=?6`)
          .bind(eventId,id,kind,next-previous,previous,next,note,timestamp)
      ]);
    } catch { return failure(409, "Inventory changed. Reload this partner and retry."); }
    const applied = await db.prepare(`SELECT id FROM partner_inventory_events WHERE id=?1`).bind(eventId).first();
    if (!applied) return failure(409, "Inventory changed. Reload this partner and retry.");
    return json({ partner: partnerView((await findPartner(db,id)) as PartnerIdentity) });
  }
  if (action === "tier") {
    if (typeof data.tier !== "string" || !(data.tier in TIERS)) return failure(400, "Invalid tier");
    const next = data.tier;
    if (next === partner.tier) return json({ partner: partnerView(partner) });
    const eventId = crypto.randomUUID();
    await db.batch([
      db.prepare(`UPDATE sales_partners SET tier=?2,updated_at=?3 WHERE id=?1 AND tier=?4`).bind(id,next,timestamp,partner.tier),
      db.prepare(`INSERT INTO partner_tier_events(id,partner_id,previous_tier,new_tier,created_at)
        SELECT ?1,?2,?3,?4,?5 FROM sales_partners WHERE id=?2 AND tier=?4`)
        .bind(eventId,id,partner.tier,next,timestamp)
    ]);
    if (!(await db.prepare(`SELECT id FROM partner_tier_events WHERE id=?1`).bind(eventId).first())) return failure(409, "Membership changed. Reload and retry.");
    return json({ partner: partnerView((await findPartner(db,id)) as PartnerIdentity) });
  }
  if (action === "status") {
    const status = data.status;
    const enabled = data.provisionEnabled;
    if (status !== undefined && (typeof status !== "string" || !STATUSES.has(status))) return failure(400, "Invalid status");
    if (enabled !== undefined && typeof enabled !== "boolean") return failure(400, "Invalid provisioning permission");
    if (status === undefined && enabled === undefined) return failure(400, "Nothing to change");
    if (partner.status === "revoked" && status !== "revoked" && status !== undefined) return failure(409, "Revoked partners cannot be reactivated. Invite a new account.");
    const newStatus = status || partner.status;
    const newEnabled = enabled === undefined ? partner.provision_enabled : enabled ? 1 : 0;
    const actionText = `status:${partner.status}->${newStatus};provision:${partner.provision_enabled}->${newEnabled}`;
    await db.batch([
      db.prepare(`UPDATE sales_partners SET status=?2,provision_enabled=?3,updated_at=?4 WHERE id=?1`)
        .bind(id,newStatus,newEnabled,timestamp),
      db.prepare(`INSERT INTO partner_account_events(id,partner_id,action,created_at) VALUES(?1,?2,?3,?4)`)
        .bind(crypto.randomUUID(),id,actionText,timestamp),
      ...(newStatus === "suspended" || newStatus === "revoked" ? [db.prepare(`UPDATE partner_sessions SET revoked_at=?2 WHERE partner_id=?1 AND revoked_at IS NULL`).bind(id,timestamp)] : [])
    ]);
    return json({ partner: partnerView((await findPartner(db,id)) as PartnerIdentity) });
  }
  if (action === "invite") {
    if (partner.status === "revoked" || partner.status === "suspended") return failure(409, "This account cannot receive invitations in its current state.");
    try { await issuePartnerLink(db,env,id,partner.email,sendLink,now); }
    catch { return failure(502, "Invitation delivery failed. Please retry."); }
    return json({ sent: true });
  }
  return failure(404, "Not found");
}

export async function handlePartnerOperations(request: Request, pathname: string, env: PartnerEnv,
  now = new Date(), places: AdminPlaceSearchProvider = createAdminPlaceSearchProvider()): Promise<Response | null> {
  if (!pathname.startsWith("/api/ctv/")) return null;
  const partner = await currentPartner(request,env.DB,now);
  if (!partner) return failure(401, "Sign in to the Partner Portal.");
  if (request.method !== "GET" && !partnerSafeSource(request,env)) return failure(403, "Forbidden");
  const db = env.DB;
  const url = new URL(request.url);

  if (pathname === "/api/ctv/me") {
    if (request.method !== "GET") return failure(405, "Method not allowed");
    const latest = await db.prepare(`SELECT pp.batch_id,pp.physical_card_count,pp.created_at,b.name AS business_name
      FROM partner_provisionings pp JOIN provisioning_batches pb ON pb.id=pp.batch_id JOIN businesses b ON b.id=pb.business_id
      WHERE pp.partner_id=?1 ORDER BY pp.created_at DESC LIMIT 5`).bind(partner.id).all();
    return json({ partner: partnerView(partner), recent: latest.results });
  }

  if (pathname === "/api/ctv/places/search") {
    if (request.method !== "GET") return failure(405, "Method not allowed");
    const query = (url.searchParams.get("q") || "").trim();
    if (query.length < 3 || query.length > 120) return failure(400, "Enter at least 3 characters.");
    const hourAgo = new Date(now.getTime()-3_600_000).toISOString();
    const recent = await db.prepare(`SELECT COUNT(*) AS n FROM partner_activity WHERE partner_id=?1
      AND event_type='business_search' AND created_at>?2`).bind(partner.id,hourAgo).first<{n:number}>();
    if (Number(recent?.n||0) >= MAX_SEARCHES_HOUR) return failure(429, "Search limit reached. Try again later.");
    if (!env.GOOGLE_PLACES_API_KEY) return failure(503, "Google business search is not configured.");
    let suggestions;
    try { suggestions = await places.search(query,env.GOOGLE_PLACES_API_KEY); }
    catch { return failure(503, "Business search is temporarily unavailable."); }
    await db.prepare(`INSERT INTO partner_activity(id,partner_id,event_type,search_query,created_at)
      VALUES(?1,?2,'business_search',?3,?4)`).bind(crypto.randomUUID(),partner.id,query,now.toISOString()).run();
    return json({ suggestions });
  }

  const placeMatch = pathname.match(/^\/api\/ctv\/places\/([A-Za-z0-9_-]{3,300})$/);
  if (placeMatch) {
    if (request.method !== "GET") return failure(405, "Method not allowed");
    if (!env.GOOGLE_PLACES_API_KEY) return failure(503, "Google business search is not configured.");
    let details;
    try { details = await places.getDetails(placeMatch[1] as string,env.GOOGLE_PLACES_API_KEY); }
    catch { return failure(503, "This Google business could not be verified."); }
    await db.prepare(`INSERT INTO partner_activity(id,partner_id,event_type,business_name,google_place_id,created_at)
      VALUES(?1,?2,'business_selected',?3,?4,?5)`).bind(crypto.randomUUID(),partner.id,details.businessName,details.googlePlaceId,now.toISOString()).run();
    return json({ business: details });
  }

  if (pathname === "/api/ctv/provision") {
    if (request.method !== "POST") return failure(405, "Method not allowed");
    const data = await readJson(request);
    const input = parsePartnerSetup(data);
    if (!input) return failure(400, "Choose a Google business, enter a customer email and select a valid card quantity.");
    if (!env.GOOGLE_PLACES_API_KEY) return failure(503, "Google business verification is not configured.");
    try {
      const result = await provisionPartnerCards(db,partner.id,input,()=>places.getDetails(input.placeId,env.GOOGLE_PLACES_API_KEY as string),now);
      return json(result,result.replayed?200:201);
    } catch (error) {
      if (error instanceof PartnerProvisioningError) return failure(error.status,error.message);
      if (error instanceof AdminPlaceSearchError) return failure(503,"Business verification is temporarily unavailable.");
      throw error;
    }
  }

  if (pathname === "/api/ctv/batches") {
    if (request.method !== "GET") return failure(405, "Method not allowed");
    const paging = pageParams(url);
    if (!paging) return failure(400,"Invalid pagination");
    const rows = await db.prepare(`SELECT pp.batch_id,pp.physical_card_count,pp.created_at,b.name AS business_name,
      l.business_address,pp.customer_email FROM partner_provisionings pp
      JOIN provisioning_batches pb ON pb.id=pp.batch_id JOIN businesses b ON b.id=pb.business_id
      JOIN locations l ON l.id=pb.location_id WHERE pp.partner_id=?1
      ORDER BY pp.created_at DESC,pp.batch_id DESC LIMIT ?2 OFFSET ?3`)
      .bind(partner.id,paging.limit,paging.offset).all();
    return json({ batches: rows.results, page: paging.page, pageSize: paging.limit });
  }
  const batchMatch = pathname.match(/^\/api\/ctv\/batches\/([0-9a-f-]{36})$/i);
  if (batchMatch) {
    if (request.method !== "GET") return failure(405, "Method not allowed");
    const found = await db.prepare(`SELECT batch_id FROM partner_provisionings WHERE partner_id=?1 AND batch_id=?2 LIMIT 1`)
      .bind(partner.id,batchMatch[1]).first();
    if (!found) return failure(404,"Batch not found");
    const manifest = await getProvisioningManifest(db,batchMatch[1] as string);
    return manifest ? json({ manifest }) : failure(404,"Batch not found");
  }
  return failure(404,"Not found");
}
