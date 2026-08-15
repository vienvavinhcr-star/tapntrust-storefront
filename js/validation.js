export function validHttpsUrl(value) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export function looksGoogleRelated(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "g.page"
      || host === "goo.gl"
      || host.endsWith(".goo.gl")
      || host === "google.com"
      || host.endsWith(".google.com")
      || host === "google.com.au"
      || host.endsWith(".google.com.au");
  } catch { return false; }
}
