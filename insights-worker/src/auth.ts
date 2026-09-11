const TOKEN_BYTES = 32;
export const SESSION_COOKIE_NAME = "__Host-tnt_insights_session";
export const PENDING_MAGIC_COOKIE_NAME = "__Host-tnt_magic_pending";

export interface MagicLinkMailer {
  sendMagicLink(email: string, magicUrl: string): Promise<void>;
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const email = normaliseEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function generateOpaqueToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readCookieToken(request: Request, expectedName: string): string | null {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === expectedName) {
      const value = valueParts.join("=");
      return /^[A-Za-z0-9_-]{40,100}$/.test(value) ? value : null;
    }
  }
  return null;
}

export function readSessionToken(request: Request): string | null {
  return readCookieToken(request, SESSION_COOKIE_NAME);
}

export function readPendingMagicToken(request: Request): string | null {
  return readCookieToken(request, PENDING_MAGIC_COOKIE_NAME);
}

export function createSessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function createPendingMagicCookie(token: string, maxAgeSeconds: number): string {
  return `${PENDING_MAGIC_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearPendingMagicCookie(): string {
  return `${PENDING_MAGIC_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] || character);
}

export function createCloudflareMagicLinkMailer(binding: SendEmail, fromEmail: string): MagicLinkMailer {
  return {
    async sendMagicLink(email, magicUrl) {
      const safeUrl = escapeHtml(magicUrl);
      await binding.send({
        to: email,
        from: { email: fromEmail, name: "Tapntrust Support" },
        replyTo: "contact@tapntrust.com",
        subject: "Your Tapntrust Insights sign-in link",
        text: `Open your Tapntrust Insights dashboard: ${magicUrl}\n\nThis single-use link expires in 15 minutes. If you did not request it, you can ignore this email.`,
        html: `<p>Open your Tapntrust Insights dashboard:</p><p><a href="${safeUrl}">Sign in to Tapntrust Insights</a></p><p>This single-use link expires in 15 minutes. If you did not request it, you can ignore this email.</p>`
      });
    }
  };
}
