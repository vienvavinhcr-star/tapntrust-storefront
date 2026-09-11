import {
  clearSessionCookie,
  createCloudflareMagicLinkMailer,
  createSessionCookie,
  generateOpaqueToken,
  hashToken,
  isValidEmail,
  type MagicLinkMailer,
  normaliseEmail,
  readSessionToken
} from "./auth";
import { CUSTOMER_PAGE } from "./customer-page";
import { createCustomerRepository, type CustomerRepository } from "./customer-repository";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const MAGIC_LINK_COOLDOWN_MS = 60 * 1000;
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

function safeBaseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function invalidLinkPage(): Response {
  return new Response("<!doctype html><title>Tapntrust Insights</title><h1>This sign-in link is invalid or has expired.</h1><p>Return to the Tapntrust Insights sign-in page and request a new link.</p>", {
    status: 401,
    headers: { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8" }
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
  const user = await repository.findActiveUserByEmail(email);
  if (!user) {
    await hashToken(email);
    return json({ message: GENERIC_LINK_MESSAGE }, 202);
  }

  const cooldownStart = new Date(now.getTime() - MAGIC_LINK_COOLDOWN_MS).toISOString();
  if (await repository.hasMagicLinkSince(user.id, cooldownStart)) {
    return json({ message: GENERIC_LINK_MESSAGE }, 202);
  }

  const baseUrl = safeBaseUrl(env.AUTH_BASE_URL);
  if (!baseUrl) {
    console.error(JSON.stringify({ message: "invalid AUTH_BASE_URL configuration" }));
    return json({ message: GENERIC_LINK_MESSAGE }, 202);
  }

  const rawToken = generateOpaqueToken();
  const tokenHash = await hashToken(rawToken);
  const createdAt = now.toISOString();
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
  ctx.waitUntil(repository.deleteExpiredAuthRecords(createdAt).catch(() => undefined));

  return json({ message: GENERIC_LINK_MESSAGE }, 202);
}

async function verifyMagicLink(
  request: Request,
  url: URL,
  repository: CustomerRepository,
  now: Date
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const rawToken = url.searchParams.get("token") || "";
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(rawToken)) return invalidLinkPage();

  const sessionToken = generateOpaqueToken();
  const createdAt = now.toISOString();
  const consumed = await repository.consumeMagicLink(await hashToken(rawToken), createdAt, {
    id: crypto.randomUUID(),
    tokenHash: await hashToken(sessionToken),
    createdAt,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString()
  });
  if (!consumed) return invalidLinkPage();

  return new Response(null, {
    status: 303,
    headers: {
      ...SECURITY_HEADERS,
      Location: "/app",
      "Set-Cookie": createSessionCookie(sessionToken, SESSION_TTL_SECONDS)
    }
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
  if (url.pathname === "/auth/verify") return verifyMagicLink(request, url, repository, now);
  if (url.pathname === "/api/auth/request-link") {
    const mailer = dependencies.mailer || createCloudflareMagicLinkMailer(env.AUTH_EMAIL, env.AUTH_FROM_EMAIL);
    return requestMagicLink(request, env, ctx, repository, mailer, now);
  }
  if (url.pathname === "/api/auth/logout") return logoutCustomer(request, repository, now);
  if (url.pathname === "/api/customer/summary") return customerSummary(request, repository, now);
  return null;
}
