import {
  clearPendingMagicCookie,
  clearSessionCookie,
  createCloudflareMagicLinkMailer,
  createPendingMagicCookie,
  createSessionCookie,
  generateOpaqueToken,
  hashToken,
  isValidEmail,
  type MagicLinkMailer,
  normaliseEmail,
  readPendingMagicToken,
  readSessionToken
} from "./auth";
import { CUSTOMER_PAGE } from "./customer-page";
import { createCustomerRepository, type CustomerRepository } from "./customer-repository";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const MAGIC_LINK_TTL_SECONDS = MAGIC_LINK_TTL_MS / 1000;
const MAGIC_LINK_COOLDOWN_MS = 60 * 1000;
const MAGIC_LINK_RATE_WINDOW_MS = 15 * 60 * 1000;
const MAGIC_LINK_MAX_REQUESTS = 3;
const REQUEST_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const GENERIC_LINK_MESSAGE = "If this email has Tapntrust Insights access, a sign-in link is on its way.";

type CustomerEnv = Env & {
  AUTH_BASE_URL: string;
  AUTH_FROM_EMAIL: string;
  AUTH_EMAIL: SendEmail;
};

export interface CustomerAuthDependencies {
  repository?: CustomerRepository;
  mailer?: MagicLinkMailer;
  now?: () => Date;
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(data, { status, headers: { ...SECURITY_HEADERS, ...extraHeaders } });
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", { status: 405, headers: { ...SECURITY_HEADERS, Allow: allow } });
}

function monthStartUtc(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function readBoundedText(request: Request, byteLimit: number): Promise<{ text?: string; status?: 400 | 413 }> {
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

  return { text };
}

async function readBoundedJson(request: Request, byteLimit: number): Promise<{ value?: unknown; status?: 400 | 413 }> {
  const body = await readBoundedText(request, byteLimit);
  if (body.status || body.text === undefined) return { status: body.status || 400 };

  try {
    return { value: JSON.parse(body.text) };
  } catch {
    return { status: 400 };
  }
}

function safeBaseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function expectedAuthOrigin(env: CustomerEnv): string | null {
  return safeBaseUrl(env.AUTH_BASE_URL)?.origin || null;
}

function hasExpectedOrigin(request: Request, env: CustomerEnv): boolean {
  const expectedOrigin = expectedAuthOrigin(env);
  return Boolean(expectedOrigin && request.headers.get("Origin") === expectedOrigin);
}

function hasContentType(request: Request, expected: string): boolean {
  const mediaType = (request.headers.get("Content-Type") || "").split(";", 1)[0] || "";
  return mediaType.trim().toLowerCase() === expected;
}

function invalidLinkPage(clearPending = false): Response {
  const headers = new Headers({
    ...SECURITY_HEADERS,
    "Content-Type": "text/html; charset=utf-8"
  });
  if (clearPending) headers.append("Set-Cookie", clearPendingMagicCookie());
  return new Response("<!doctype html><title>Tapntrust Insights</title><h1>This sign-in link is invalid or has expired.</h1><p>Return to the Tapntrust Insights sign-in page and request a new link.</p>", {
    status: 401,
    headers
  });
}

function confirmationPage(): Response {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Continue to Tapntrust Insights</title><style>body{margin:0;background:#f4f7fb;color:#061a45;font:16px/1.5 system-ui,sans-serif}.panel{width:min(560px,calc(100% - 32px));margin:12vh auto;background:#fff;border:1px solid #d7e2f1;border-radius:22px;box-shadow:0 18px 45px rgba(6,26,69,.08);padding:32px;box-sizing:border-box}h1{font-size:clamp(2rem,7vw,3.2rem);line-height:1.05;letter-spacing:-.04em}.button{width:100%;border:0;border-radius:12px;background:#1769ed;color:#fff;padding:14px 18px;font:inherit;font-weight:800;cursor:pointer}</style></head><body><main class="panel"><p>Tapntrust Insights</p><h1>Continue to your dashboard</h1><p>Confirm below to securely sign in. This keeps automated email scanners from using your one-time link.</p><form method="post" action="/auth/confirm"><input type="hidden" name="confirm" value="1"><button class="button" type="submit">Continue to Insights</button></form></main></body></html>`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function authenticateCustomer(
  request: Request,
  repository: CustomerRepository,
  now: Date
) {
  const rawToken = readSessionToken(request);
  if (!rawToken) return null;
  return repository.findActiveSession(await hashToken(rawToken), now.toISOString());
}

async function requestMagicLink(
  request: Request,
  env: CustomerEnv,
  ctx: ExecutionContext,
  repository: CustomerRepository,
  mailer: MagicLinkMailer,
  now: Date
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!hasContentType(request, "application/json")) {
    return json({ error: "Content-Type must be application/json" }, 415);
  }
  if (!hasExpectedOrigin(request, env)) return json({ error: "Forbidden" }, 403);

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 1024) return json({ error: "Request body too large" }, 413);

  const parsed = await readBoundedJson(request, 1024);
  if (parsed.status === 413) return json({ error: "Request body too large" }, 413);
  if (parsed.status === 400 || !parsed.value || typeof parsed.value !== "object") {
    return json({ error: "Invalid request" }, 400);
  }

  const emailValue = (parsed.value as Record<string, unknown>).email;
  if (typeof emailValue !== "string" || !isValidEmail(emailValue)) {
    return json({ error: "Enter a valid email address" }, 400);
  }

  const email = normaliseEmail(emailValue);
  const createdAt = now.toISOString();
  const requestAllowed = await repository.reserveMagicLinkRequest({
    identifierHash: await hashToken(email),
    now: createdAt,
    cooldownCutoff: new Date(now.getTime() - MAGIC_LINK_COOLDOWN_MS).toISOString(),
    windowResetCutoff: new Date(now.getTime() - MAGIC_LINK_RATE_WINDOW_MS).toISOString(),
    maxRequests: MAGIC_LINK_MAX_REQUESTS
  });
  ctx.waitUntil(repository.deleteExpiredAuthRecords(
    createdAt,
    new Date(now.getTime() - REQUEST_LIMIT_RETENTION_MS).toISOString()
  ).catch(() => undefined));
  if (!requestAllowed) return json({ message: GENERIC_LINK_MESSAGE }, 202);

  const user = await repository.findActiveUserByEmail(email);
  if (!user) {
    return json({ message: GENERIC_LINK_MESSAGE }, 202);
  }

  const baseUrl = safeBaseUrl(env.AUTH_BASE_URL);
  if (!baseUrl) {
    console.error(JSON.stringify({ message: "invalid AUTH_BASE_URL configuration" }));
    return json({ message: GENERIC_LINK_MESSAGE }, 202);
  }

  const rawToken = generateOpaqueToken();
  const tokenHash = await hashToken(rawToken);
  await repository.createMagicLink({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash,
    createdAt,
    expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString()
  });

  const magicUrl = new URL("/auth/verify", baseUrl);
  magicUrl.searchParams.set("token", rawToken);
  ctx.waitUntil(mailer.sendMagicLink(user.email, magicUrl.toString()).catch(async (error) => {
    await repository.deleteMagicLink(tokenHash).catch(() => undefined);
    console.error(JSON.stringify({
      message: "magic link email failed",
      userId: user.id,
      error: error instanceof Error ? error.message : String(error)
    }));
  }));

  return json({ message: GENERIC_LINK_MESSAGE }, 202);
}

function prepareMagicLink(
  request: Request,
  url: URL
): Response {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const rawToken = url.searchParams.get("token") || "";
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(rawToken)) return invalidLinkPage();

  return new Response(null, {
    status: 303,
    headers: {
      ...SECURITY_HEADERS,
      Location: "/auth/confirm",
      "Set-Cookie": createPendingMagicCookie(rawToken, MAGIC_LINK_TTL_SECONDS)
    }
  });
}

async function confirmMagicLink(
  request: Request,
  env: CustomerEnv,
  repository: CustomerRepository,
  now: Date
): Promise<Response> {
  const rawToken = readPendingMagicToken(request);
  if (request.method === "GET") return rawToken ? confirmationPage() : invalidLinkPage();
  if (request.method !== "POST") return methodNotAllowed("GET, POST");
  if (!hasContentType(request, "application/x-www-form-urlencoded")) {
    return invalidLinkPage(true);
  }
  if (!hasExpectedOrigin(request, env)) return invalidLinkPage(true);
  if (!rawToken) return invalidLinkPage(true);
  const confirmation = await readBoundedText(request, 64);
  if (confirmation.status || new URLSearchParams(confirmation.text || "").get("confirm") !== "1") {
    return invalidLinkPage(true);
  }

  const sessionToken = generateOpaqueToken();
  const createdAt = now.toISOString();
  const consumed = await repository.consumeMagicLink(await hashToken(rawToken), createdAt, {
    id: crypto.randomUUID(),
    tokenHash: await hashToken(sessionToken),
    createdAt,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString()
  });
  if (!consumed) return invalidLinkPage(true);

  const headers = new Headers({ ...SECURITY_HEADERS, Location: "/app" });
  headers.append("Set-Cookie", createSessionCookie(sessionToken, SESSION_TTL_SECONDS));
  headers.append("Set-Cookie", clearPendingMagicCookie());
  return new Response(null, {
    status: 303,
    headers
  });
}

async function customerSummary(
  request: Request,
  repository: CustomerRepository,
  now: Date
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const customer = await authenticateCustomer(request, repository, now);
  if (!customer) return json({ error: "Unauthorized" }, 401);
  return json(await repository.getCustomerSummary(customer, monthStartUtc(now)));
}

async function logoutCustomer(
  request: Request,
  repository: CustomerRepository,
  now: Date
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const rawToken = readSessionToken(request);
  if (rawToken) await repository.revokeSession(await hashToken(rawToken), now.toISOString());
  return new Response(null, {
    status: 204,
    headers: { ...SECURITY_HEADERS, "Set-Cookie": clearSessionCookie() }
  });
}

export async function handleCustomerRequest(
  request: Request,
  url: URL,
  env: CustomerEnv,
  ctx: ExecutionContext,
  dependencies: CustomerAuthDependencies = {}
): Promise<Response | null> {
  const repository = dependencies.repository || createCustomerRepository(env.DB);
  const now = (dependencies.now || (() => new Date()))();

  if (url.pathname === "/app") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return new Response(CUSTOMER_PAGE, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }
  if (url.pathname === "/auth/verify") return prepareMagicLink(request, url);
  if (url.pathname === "/auth/confirm") return confirmMagicLink(request, env, repository, now);
  if (url.pathname === "/api/auth/request-link") {
    const mailer = dependencies.mailer || createCloudflareMagicLinkMailer(env.AUTH_EMAIL, env.AUTH_FROM_EMAIL);
    return requestMagicLink(request, env, ctx, repository, mailer, now);
  }
  if (url.pathname === "/api/auth/logout") return logoutCustomer(request, repository, now);
  if (url.pathname === "/api/customer/summary") return customerSummary(request, repository, now);
  return null;
}
