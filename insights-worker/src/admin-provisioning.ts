import { isValidEmail, normaliseEmail } from "./auth";
import {
  activateInsights,
  deactivateInsightsEntitlement,
  getProvisioningManifest,
  listAdminBusinessOptions,
  listProvisioningBatches,
  provisionPhysicalCards,
  revokeCustomerBusinessAccess
} from "./provisioning-repository";
import { parseProvisioningIntent, ProvisioningError } from "./provisioning";

const MAX_ADMIN_BODY_BYTES = 16_384;

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

function cleanIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= 160 ? cleaned : null;
}

function hasSafeAdminSource(request: Request, authBaseUrl: string): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return origin === new URL(authBaseUrl).origin;
  } catch {
    return false;
  }
}

function isJsonRequest(request: Request): boolean {
  return (request.headers.get("Content-Type") || "").split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new ProvisioningError("invalid_request", "A JSON request body is required.");
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_ADMIN_BODY_BYTES) {
    throw new ProvisioningError("invalid_request", "The request body is too large.");
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > MAX_ADMIN_BODY_BYTES) {
      await reader.cancel();
      throw new ProvisioningError("invalid_request", "The request body is too large.");
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();

  try {
    return JSON.parse(body);
  } catch {
    throw new ProvisioningError("invalid_request", "The request body is not valid JSON.");
  }
}

function parseActivation(value: unknown): { email: string; businessId: string; locationId: string } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const email = typeof record.email === "string" ? normaliseEmail(record.email) : "";
  const businessId = cleanIdentifier(record.businessId);
  const locationId = cleanIdentifier(record.locationId);
  return isValidEmail(email) && businessId && locationId ? { email, businessId, locationId } : null;
}

function parseAccessRevocation(value: unknown): { email: string; businessId: string } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const email = typeof record.email === "string" ? normaliseEmail(record.email) : "";
  const businessId = cleanIdentifier(record.businessId);
  return isValidEmail(email) && businessId ? { email, businessId } : null;
}

function parseEntitlementChange(value: unknown): { locationId: string } | null {
  if (!value || typeof value !== "object") return null;
  const locationId = cleanIdentifier((value as Record<string, unknown>).locationId);
  return locationId ? { locationId } : null;
}

async function readAdminPost(request: Request, authBaseUrl: string): Promise<unknown | Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  if (!hasSafeAdminSource(request, authBaseUrl)) return json({ error: "Forbidden" }, 403);
  if (!isJsonRequest(request)) return json({ error: "Expected application/json" }, 415);
  return readBoundedJson(request);
}

export async function handleAdminProvisioningRequest(
  request: Request,
  pathname: string,
  db: D1Database,
  authBaseUrl: string,
  now: () => Date = () => new Date()
): Promise<Response | null> {
  try {
    if (pathname === "/api/admin/provisioning/options") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      return json({ businesses: await listAdminBusinessOptions(db) });
    }

    if (pathname === "/api/admin/provisioning/batches") {
      if (request.method === "GET") return json({ batches: await listProvisioningBatches(db) });
      const body = await readAdminPost(request, authBaseUrl);
      if (body instanceof Response) return body;
      const intent = parseProvisioningIntent(body);
      if (!intent) return json({ error: "Invalid provisioning request" }, 400);
      const result = await provisionPhysicalCards(db, intent, now().toISOString());
      return json(result, result.replayed ? 200 : 201);
    }

    const batchMatch = pathname.match(/^\/api\/admin\/provisioning\/batches\/([^/]+)$/);
    if (batchMatch) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      const batchId = cleanIdentifier(decodeURIComponent(batchMatch[1] || ""));
      if (!batchId) return json({ error: "Invalid provisioning batch" }, 400);
      const manifest = await getProvisioningManifest(db, batchId);
      return manifest ? json({ manifest }) : json({ error: "Not found" }, 404);
    }

    if (pathname === "/api/admin/insights/activations") {
      const body = await readAdminPost(request, authBaseUrl);
      if (body instanceof Response) return body;
      const input = parseActivation(body);
      if (!input) return json({ error: "Invalid Insights activation" }, 400);
      return json({ activation: await activateInsights(db, input, now().toISOString()) });
    }

    if (pathname === "/api/admin/insights/access/revoke") {
      const body = await readAdminPost(request, authBaseUrl);
      if (body instanceof Response) return body;
      const input = parseAccessRevocation(body);
      if (!input) return json({ error: "Invalid access revocation" }, 400);
      const revoked = await revokeCustomerBusinessAccess(db, input.email, input.businessId);
      return revoked ? json({ revoked: true }) : json({ error: "Access was not found" }, 404);
    }

    if (pathname === "/api/admin/insights/entitlements/deactivate") {
      const body = await readAdminPost(request, authBaseUrl);
      if (body instanceof Response) return body;
      const input = parseEntitlementChange(body);
      if (!input) return json({ error: "Invalid entitlement change" }, 400);
      const deactivated = await deactivateInsightsEntitlement(db, input.locationId, now().toISOString());
      return deactivated ? json({ deactivated: true }) : json({ error: "Active entitlement was not found" }, 404);
    }

    return null;
  } catch (error) {
    if (error instanceof ProvisioningError) return json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
}
