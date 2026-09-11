import { ADMIN_PAGE } from "./admin-page";
import { handleCustomerRequest, type CustomerAuthDependencies } from "./customer-auth";
import { isAllowedGoogleReviewUrl, isValidPublicToken, normalisePublicToken } from "./destinations";
import { createD1Repository, type CardUpdate, type InsightsRepository, type PlacementType } from "./repository";

type WorkerEnv = Env & { ADMIN_API_TOKEN?: string };

const PLACEMENT_TYPES = new Set<PlacementType>(["counter", "table", "reception", "register", "other"]);
const HTML_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

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

function unavailable(status = 404): Response {
  return new Response("<!doctype html><title>Tapntrust</title><h1>This Tapntrust card is not available.</h1><p>Please contact the business for help.</p>", {
    status,
    headers: HTML_HEADERS
  });
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", { status: 405, headers: { Allow: allow } });
}

function monthStartUtc(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function readBoundedJson(request: Request, byteLimit: number): Promise<{ value?: unknown; status?: 400 | 413 }> {
  if (!request.body) return { status: 400 };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > byteLimit) {
      await reader.cancel();
      return { status: 413 };
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();

  try {
    return { value: JSON.parse(text) };
  } catch {
    return { status: 400 };
  }
}

async function secureEqual(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function isAdminRequest(request: Request, env: WorkerEnv): Promise<boolean> {
  const expected = env.ADMIN_API_TOKEN;
  const authorization = request.headers.get("Authorization") || "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expected || !provided) return false;
  return secureEqual(provided, expected);
}

async function handleTap(
  request: Request,
  token: string,
  repository: InsightsRepository,
  ctx: ExecutionContext
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
  if (!isValidPublicToken(token)) return unavailable();

  let card;
  try {
    card = await repository.findCardByToken(normalisePublicToken(token));
  } catch (error) {
    console.error(JSON.stringify({ message: "card lookup failed", error: error instanceof Error ? error.message : String(error) }));
    return unavailable(503);
  }

  if (!card || !card.active || !card.locationActive || !isAllowedGoogleReviewUrl(card.googleReviewUrl)) {
    return unavailable();
  }

  if (request.method === "GET") {
    const tappedAt = new Date().toISOString();
    ctx.waitUntil(repository.recordTap(card.id, tappedAt).catch((error) => {
      console.error(JSON.stringify({
        message: "tap event insert failed",
        cardId: card.id,
        error: error instanceof Error ? error.message : String(error)
      }));
    }));
  }

  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store, private",
      Location: card.googleReviewUrl,
      "Referrer-Policy": "no-referrer"
    }
  });
}

function parseCardUpdate(value: unknown): CardUpdate | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  const placementType = typeof record.placementType === "string" ? record.placementType : "";
  if (!label || label.length > 80 || !PLACEMENT_TYPES.has(placementType as PlacementType)) return null;
  return { label, placementType: placementType as PlacementType };
}

async function handleAdmin(
  request: Request,
  pathname: string,
  env: WorkerEnv,
  repository: InsightsRepository
): Promise<Response> {
  if (!(await isAdminRequest(request, env))) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (pathname === "/api/admin/summary") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return json(await repository.getSummary(monthStartUtc(new Date())));
  }

  const match = pathname.match(/^\/api\/admin\/cards\/([^/]+)$/);
  if (!match) return json({ error: "Not found" }, 404);
  if (request.method !== "PATCH") return methodNotAllowed("PATCH");

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 2048) return json({ error: "Request body too large" }, 413);

  const parsedBody = await readBoundedJson(request, 2048);
  if (parsedBody.status === 413) return json({ error: "Request body too large" }, 413);
  if (parsedBody.status === 400) return json({ error: "Invalid JSON" }, 400);

  const update = parseCardUpdate(parsedBody.value);
  const token = normalisePublicToken(decodeURIComponent(match[1] || ""));
  if (!isValidPublicToken(token) || !update) return json({ error: "Invalid card update" }, 400);

  const card = await repository.updateCard(token, update);
  return card ? json({ card }) : json({ error: "Not found" }, 404);
}

export async function handleRequest(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
  repository: InsightsRepository = createD1Repository(env.DB),
  customerDependencies: CustomerAuthDependencies = {}
): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname === "/admin") {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return new Response(ADMIN_PAGE, {
        headers: {
          ...HTML_HEADERS,
          "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        }
      });
    }
    if (url.pathname.startsWith("/api/admin/")) return handleAdmin(request, url.pathname, env, repository);

    const customerResponse = await handleCustomerRequest(request, url, env, ctx, customerDependencies);
    if (customerResponse) return customerResponse;

    const tapMatch = url.pathname.match(/^\/t\/([^/]+)\/?$/);
    if (tapMatch) return handleTap(request, decodeURIComponent(tapMatch[1] || ""), repository, ctx);

    return unavailable();
  } catch (error) {
    console.error(JSON.stringify({
      message: "unhandled insights request error",
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error)
    }));
    return url.pathname.startsWith("/api/")
      ? json({ error: "Internal server error" }, 500)
      : unavailable(503);
  }
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env as WorkerEnv, ctx);
  }
} satisfies ExportedHandler<Env>;
