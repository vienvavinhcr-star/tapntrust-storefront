const GOOGLE_HOSTS = new Set([
  "g.page",
  "google.com",
  "google.com.au",
  "maps.app.goo.gl"
]);

export function normalisePublicToken(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidPublicToken(value: string): boolean {
  return /^TNT-[A-Z0-9]{5,20}$/.test(normalisePublicToken(value));
}

export function isAllowedGoogleReviewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;

    const hostname = url.hostname.toLowerCase();
    return GOOGLE_HOSTS.has(hostname)
      || hostname.endsWith(".google.com")
      || hostname.endsWith(".google.com.au");
  } catch {
    return false;
  }
}
