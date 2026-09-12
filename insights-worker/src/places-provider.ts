export const GOOGLE_PLACE_SUMMARY_FIELD_MASK = [
  "rating",
  "userRatingCount",
  "googleMapsLinks.placeUri"
].join(",");

export const GOOGLE_PLACE_REVIEWS_FIELD_MASK = [
  "reviews",
  "googleMapsLinks.reviewsUri"
].join(",");

const GOOGLE_PLACES_ORIGIN = "https://places.googleapis.com";
const PROVIDER_TIMEOUT_MS = 8_000;
const MAX_PROVIDER_BODY_BYTES = 512 * 1024;

export interface GooglePlaceSummary {
  rating: number | null;
  userRatingCount: number | null;
  placeUri: string | null;
}

export interface GoogleReviewAttribution {
  displayName: string | null;
  profileUri: string | null;
  photoUri: string | null;
}

export interface GooglePlaceReview {
  rating: number | null;
  text: string | null;
  originalText: string | null;
  translated: boolean;
  publishTime: string | null;
  relativePublishTimeDescription: string | null;
  sourceUri: string | null;
  visitDate: string | null;
  author: GoogleReviewAttribution;
}

export interface GooglePlaceReviews {
  reviewsUri: string | null;
  reviews: GooglePlaceReview[];
}

export type GooglePlacesFailureCode =
  | "missing_configuration"
  | "invalid_place_id"
  | "not_found"
  | "provider_rejected"
  | "provider_unavailable"
  | "timeout"
  | "invalid_response";

export class GooglePlacesProviderError extends Error {
  constructor(readonly code: GooglePlacesFailureCode) {
    super(code);
    this.name = "GooglePlacesProviderError";
  }
}

export interface GooglePlacesProvider {
  fetchSummary(placeId: string, apiKey: string): Promise<GooglePlaceSummary>;
  fetchReviews(placeId: string, apiKey: string): Promise<GooglePlaceReviews>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isValidPlaceId(placeId: string): boolean {
  return /^[A-Za-z0-9_-]{3,300}$/.test(placeId);
}

function finiteNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function boundedText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function safeHttpsUrl(value: unknown, purpose: "google" | "photo"): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (purpose === "photo") {
      return host === "googleusercontent.com" || host.endsWith(".googleusercontent.com") ? url.toString() : null;
    }
    const allowed = host === "google.com"
      || host.endsWith(".google.com")
      || host === "google.com.au"
      || host.endsWith(".google.com.au")
      || host === "maps.app.goo.gl";
    return allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new GooglePlacesProviderError("invalid_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > MAX_PROVIDER_BODY_BYTES) {
      await reader.cancel();
      throw new GooglePlacesProviderError("invalid_response");
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();
  try {
    return JSON.parse(body);
  } catch {
    throw new GooglePlacesProviderError("invalid_response");
  }
}

function visitDate(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const date = value as Record<string, unknown>;
  const year = finiteInteger(date.year);
  const month = finiteInteger(date.month);
  if (!year || !month || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function localizedText(value: unknown): { text: string | null; languageCode: string | null } {
  if (!value || typeof value !== "object") return { text: null, languageCode: null };
  const record = value as Record<string, unknown>;
  return {
    text: boundedText(record.text, 10_000),
    languageCode: boundedText(record.languageCode, 35)
  };
}

function parseReview(value: unknown): GooglePlaceReview | null {
  if (!value || typeof value !== "object") return null;
  const review = value as Record<string, unknown>;
  const text = localizedText(review.text);
  const originalText = localizedText(review.originalText);
  const attribution = review.authorAttribution && typeof review.authorAttribution === "object"
    ? review.authorAttribution as Record<string, unknown>
    : {};
  const publishTime = boundedText(review.publishTime, 64);
  return {
    rating: finiteNumber(review.rating, 1, 5),
    text: text.text,
    originalText: originalText.text,
    translated: Boolean(text.text && originalText.text && (
      text.text !== originalText.text || text.languageCode !== originalText.languageCode
    )),
    publishTime: publishTime && !Number.isNaN(Date.parse(publishTime)) ? publishTime : null,
    relativePublishTimeDescription: boundedText(review.relativePublishTimeDescription, 160),
    sourceUri: safeHttpsUrl(review.googleMapsUri, "google"),
    visitDate: visitDate(review.visitDate),
    author: {
      displayName: boundedText(attribution.displayName, 300),
      profileUri: safeHttpsUrl(attribution.uri, "google"),
      photoUri: safeHttpsUrl(attribution.photoUri, "photo")
    }
  };
}

async function requestPlace(
  fetcher: Fetcher,
  placeId: string,
  apiKey: string,
  fieldMask: string
): Promise<Record<string, unknown>> {
  if (!apiKey) throw new GooglePlacesProviderError("missing_configuration");
  if (!isValidPlaceId(placeId)) throw new GooglePlacesProviderError("invalid_place_id");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetcher(`${GOOGLE_PLACES_ORIGIN}/v1/places/${encodeURIComponent(placeId)}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask
      },
      signal: controller.signal
    });
    if (!response.ok) {
      if (response.status === 404) throw new GooglePlacesProviderError("not_found");
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new GooglePlacesProviderError("provider_rejected");
      }
      throw new GooglePlacesProviderError("provider_unavailable");
    }
    const parsed = await readBoundedJson(response);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new GooglePlacesProviderError("invalid_response");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof GooglePlacesProviderError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new GooglePlacesProviderError("timeout");
    }
    throw new GooglePlacesProviderError("provider_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export function createGooglePlacesProvider(fetcher: Fetcher = fetch): GooglePlacesProvider {
  return {
    async fetchSummary(placeId, apiKey) {
      const place = await requestPlace(fetcher, placeId, apiKey, GOOGLE_PLACE_SUMMARY_FIELD_MASK);
      const links = place.googleMapsLinks && typeof place.googleMapsLinks === "object"
        ? place.googleMapsLinks as Record<string, unknown>
        : {};
      return {
        rating: finiteNumber(place.rating, 0, 5),
        userRatingCount: finiteInteger(place.userRatingCount),
        placeUri: safeHttpsUrl(links.placeUri, "google")
      };
    },

    async fetchReviews(placeId, apiKey) {
      const place = await requestPlace(fetcher, placeId, apiKey, GOOGLE_PLACE_REVIEWS_FIELD_MASK);
      const links = place.googleMapsLinks && typeof place.googleMapsLinks === "object"
        ? place.googleMapsLinks as Record<string, unknown>
        : {};
      return {
        reviewsUri: safeHttpsUrl(links.reviewsUri, "google"),
        reviews: Array.isArray(place.reviews)
          ? place.reviews.slice(0, 5).map(parseReview).filter((review): review is GooglePlaceReview => Boolean(review))
          : []
      };
    }
  };
}
