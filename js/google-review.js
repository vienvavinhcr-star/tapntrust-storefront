export const NFC_REVIEW_URL_BYTE_LIMIT = 100;

const PLACE_ID_REVIEW_URL = "https://search.google.com/local/writereview?placeid=";

function clean(value) {
  return String(value || "").trim();
}

export function utf8ByteLength(value) {
  return new TextEncoder().encode(clean(value)).byteLength;
}

export function reviewUrlFromPlaceId(placeId) {
  const value = clean(placeId);
  return value ? `${PLACE_ID_REVIEW_URL}${encodeURIComponent(value)}` : "";
}

export function shortestGoogleReviewUrl({ placeId = "", directReviewUrl = "" } = {}) {
  const candidates = [
    clean(directReviewUrl),
    reviewUrlFromPlaceId(placeId)
  ].filter(Boolean);

  return candidates.sort((left, right) => utf8ByteLength(left) - utf8ByteLength(right))[0] || "";
}

export function isNfcReadyReviewUrl(value) {
  const url = clean(value);
  return Boolean(url) && utf8ByteLength(url) < NFC_REVIEW_URL_BYTE_LIMIT;
}
