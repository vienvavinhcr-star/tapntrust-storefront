import { generateOpaqueToken, hashToken, isValidEmail, isValidOpaqueToken, normaliseEmail } from "./auth";
import { ZEPTOMAIL_AU_EMAIL_ENDPOINT } from "./zeptomail";

export interface PartnerEnv {
  DB: D1Database;
  AUTH_BASE_URL: string;
  AUTH_FROM_EMAIL: string;
  ZEPTOMAIL_API_KEY: string;
  GOOGLE_PLACES_API_KEY?: string;
}

export interface PartnerIdentity {
  id: string;
  email: string;
  name: string;
  status: string;
  tier: "silver" | "gold" | "diamond";
  allowance_total: number;
  provisioned_count: number;
  provision_enabled: number;
}

export const PARTNER_COOKIE = "__Host-tnt_partner_session";
const LINK_TTL = 15 * 60 * 1000;
const SESSION_AGE = 30 * 24 * 60 * 60;

function response(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", ...headers } });
}
function htmlEscape(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c] || c);
}
function origin(env: PartnerEnv): string {
  try { const u = new URL(env.AUTH_BASE_URL); return u.protocol === "https:" ? u.origin : ""; } catch { return ""; }
}
export function partnerSafeSource(request: Request, env: PartnerEnv): boolean {
  const expected = origin(env);
  if (!expected || request.headers.get("Sec-Fetch-Site") === "cross-site") return false;
  const supplied = request.headers.get("Origin");
  if (supplied !== null) return supplied === expected;
  if (request.headers.get("Sec-Fetch-Site") === "same-origin") return true;
  const referer = request.headers.get("Referer");
  try { return Boolean(referer && new URL(referer).origin === expected); } catch { return false; }
}
export function partnerCookie(token: string): string {
  return `${PARTNER_COOKIE}=${token}; Path=/; Max-Age=${SESSION_AGE}; HttpOnly; Secure; SameSite=Lax`;
}
export function clearPartnerCookie(): string {
  return `${PARTNER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
function readCookie(request: Request): string | null {
  const entry = (request.headers.get("Cookie") || "").split(";").map(v => v.trim()).find(v => v.startsWith(PARTNER_COOKIE + "="));
  const value = entry?.slice(PARTNER_COOKIE.length + 1) || "";
  return isValidOpaqueToken(value) ? value : null;
}
export async function currentPartner(request: Request, db: D1Database, now = new Date()): Promise<PartnerIdentity | null> {
  const cookie = readCookie(request);
  if (!cookie) return null;
  return db.prepare(`SELECT p.id,p.email,p.name,p.status,p.tier,p.allowance_total,p.provisioned_count,p.provision_enabled
    FROM partner_sessions s JOIN sales_partners p ON p.id=s.partner_id
    WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>?2 AND p.status='active' LIMIT 1`)
    .bind(await hashToken(cookie), now.toISOString()).first<PartnerIdentity>();
}

export async function sendPartnerLink(env: PartnerEnv, email: string, url: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!env.ZEPTOMAIL_API_KEY || !env.AUTH_FROM_EMAIL || !origin(env)) throw new Error("partner_mail_not_configured");
  let sent: Response;
  try {
    sent = await fetcher(ZEPTOMAIL_AU_EMAIL_ENDPOINT, {
      method: "POST", headers: { Authorization: `Zoho-enczapikey ${env.ZEPTOMAIL_API_KEY}`,
        "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        from: { address: env.AUTH_FROM_EMAIL, name: "Tapntrust Partners" },
        to: [{ email_address: { address: email, name: "Sales partner" } }],
        reply_to: [{ address: env.AUTH_FROM_EMAIL, name: "Tapntrust Support" }],
        subject: "Your Tapntrust Partner Portal sign-in link",
        textbody: `Sign in to your Tapntrust Partner Portal: ${url}\n\nThis single-use link expires in 15 minutes.`,
        htmlbody: `<p>Sign in to your Tapntrust Partner Portal:</p><p><a href="${htmlEscape(url)}">Open Partner Portal</a></p><p>This link expires in 15 minutes.</p>`,
        track_clicks: false, track_opens: false
      })
    });
  } catch { throw new Error("partner_mail_unavailable"); }
  if (!sent.ok) throw new Error("partner_mail_unavailable");
}

export async function issuePartnerLink(db: D1Database, env: PartnerEnv, partnerId: string, email: string,
  send: (env: PartnerEnv, email: string, url: string) => Promise<void> = sendPartnerLink,
  now = new Date()): Promise<void> {
  const token = generateOpaqueToken();
  await db.prepare(`INSERT INTO partner_magic_links(id,partner_id,token_hash,expires_at,created_at)
    VALUES(?1,?2,?3,?4,?5)`).bind(crypto.randomUUID(), partnerId, await hashToken(token),
    new Date(now.getTime() + LINK_TTL).toISOString(), now.toISOString()).run();
  await send(env, email, `${origin(env)}/ctv/auth/verify?token=${encodeURIComponent(token)}`);
}

async function bodyJson(request: Request): Promise<Record<string, unknown> | null> {
  if ((request.headers.get("Content-Type") || "").split(";")[0]?.trim().toLowerCase() !== "application/json"
    || Number(request.headers.get("Content-Length") || 0) > 2048) return null;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 2048) return null;
    const data: unknown = JSON.parse(body);
    return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch { return null; }
}

export async function handlePartnerAuth(request: Request, pathname: string, env: PartnerEnv,
  send: (env: PartnerEnv, email: string, url: string) => Promise<void> = sendPartnerLink,
  now = new Date()): Promise<Response | null> {
  if (pathname === "/api/ctv/auth/request-link") {
    if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
    if (!partnerSafeSource(request, env)) return response({ error: "Forbidden" }, 403);
    const data = await bodyJson(request);
    if (!data || typeof data.email !== "string" || !isValidEmail(data.email)) return response({ error: "Enter a valid email address." }, 400);
    const email = normaliseEmail(data.email);
    const partner = await env.DB.prepare(`SELECT id FROM sales_partners WHERE email=?1 COLLATE NOCASE AND status IN ('invited','active') LIMIT 1`)
      .bind(email).first<{id:string}>();
    if (partner) {
      const count = await env.DB.prepare(`SELECT COUNT(*) AS n, MAX(created_at) AS latest FROM partner_magic_links
        WHERE partner_id=?1 AND created_at>=?2`).bind(partner.id, new Date(now.getTime() - LINK_TTL).toISOString())
        .first<{n:number;latest:string|null}>();
      if (Number(count?.n || 0) < 3 && (!count?.latest || now.getTime()-new Date(count.latest).getTime() >= 60_000)) {
        try { await issuePartnerLink(env.DB, env, partner.id, email, send, now); }
        catch { /* Avoid account enumeration and never log magic links. */ }
      }
    }
    return response({ message: "If this email has partner access, a sign-in link is on its way." });
  }

  if (pathname === "/ctv/auth/verify") {
    if (request.method !== "GET") return response({ error: "Method not allowed" }, 405);
    const token = new URL(request.url).searchParams.get("token") || "";
    if (!isValidOpaqueToken(token)) return new Response("Invalid or expired link", { status: 400 });
    const page = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="origin"><title>Tapntrust Partner Sign In</title><style>body{font:16px system-ui;background:#f4f7fb;color:#10254a;display:grid;place-items:center;min-height:100vh;margin:0}.box{background:#fff;border:1px solid #dce5f3;padding:32px;border-radius:20px;max-width:440px;margin:16px}button{background:#1769ed;color:#fff;border:0;border-radius:10px;padding:13px 18px;font:inherit;font-weight:700;cursor:pointer}</style></head><body><main class="box"><h1>Tapntrust Partner Portal</h1><p>Confirm this sign-in to access your partner account.</p><form method="POST" action="/ctv/auth/confirm"><input type="hidden" name="token" value="${htmlEscape(token)}"><button type="submit">Confirm sign in</button></form></main></body></html>`;
    return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "origin",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
  }

  if (pathname === "/ctv/auth/confirm") {
    if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
    if (!partnerSafeSource(request, env) || (request.headers.get("Content-Type") || "").split(";")[0] !== "application/x-www-form-urlencoded") return response({ error: "Forbidden" }, 403);
    if (Number(request.headers.get("Content-Length") || 0) > 1024) return response({ error: "Invalid link" }, 400);
    const text = await request.text();
    if (text.length > 1024) return response({ error: "Invalid link" }, 400);
    const raw = new URLSearchParams(text).get("token") || "";
    if (!isValidOpaqueToken(raw)) return response({ error: "Invalid link" }, 400);
    const linkHash = await hashToken(raw);
    const candidate = await env.DB.prepare(`SELECT m.partner_id FROM partner_magic_links m JOIN sales_partners p ON p.id=m.partner_id
      WHERE m.token_hash=?1 AND m.used_at IS NULL AND m.expires_at>?2 AND p.status IN ('invited','active') LIMIT 1`)
      .bind(linkHash, now.toISOString()).first<{partner_id:string}>();
    if (!candidate) return response({ error: "This link expired or was already used. Request another sign-in link." }, 400);
    const sessionToken = generateOpaqueToken();
    const sessionId = crypto.randomUUID();
    const hash = await hashToken(sessionToken);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO partner_sessions(id,partner_id,token_hash,expires_at,created_at)
        SELECT ?1,m.partner_id,?2,?3,?4 FROM partner_magic_links m JOIN sales_partners p ON p.id=m.partner_id
        WHERE m.token_hash=?5 AND m.used_at IS NULL AND m.expires_at>?4 AND p.status IN ('invited','active')`)
        .bind(sessionId, hash, new Date(now.getTime()+SESSION_AGE*1000).toISOString(), now.toISOString(), linkHash),
      env.DB.prepare(`UPDATE partner_magic_links SET used_at=?2 WHERE token_hash=?1 AND used_at IS NULL AND expires_at>?2`)
        .bind(linkHash, now.toISOString()),
      env.DB.prepare(`UPDATE sales_partners SET status='active', updated_at=?2 WHERE id=?1 AND status='invited'
        AND EXISTS(SELECT 1 FROM partner_sessions WHERE id=?3)`).bind(candidate.partner_id, now.toISOString(), sessionId)
    ]);
    const activeSession = await env.DB.prepare(`SELECT id FROM partner_sessions WHERE id=?1 LIMIT 1`).bind(sessionId).first();
    if (!activeSession) return response({ error: "This link expired or was already used." }, 400);
    return new Response(null, { status: 303, headers: { Location: "/ctv", "Set-Cookie": partnerCookie(sessionToken), "Cache-Control": "no-store" } });
  }

  if (pathname === "/api/ctv/auth/logout") {
    if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
    if (!partnerSafeSource(request, env)) return response({ error: "Forbidden" }, 403);
    const cookie = readCookie(request);
    if (cookie) await env.DB.prepare(`UPDATE partner_sessions SET revoked_at=?2 WHERE token_hash=?1 AND revoked_at IS NULL`)
      .bind(await hashToken(cookie), now.toISOString()).run();
    return response({ ok: true }, 200, { "Set-Cookie": clearPartnerCookie() });
  }
  return null;
}
