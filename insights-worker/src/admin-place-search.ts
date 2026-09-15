const GOOGLE_PLACES_ORIGIN = "https://places.googleapis.com";
const PROVIDER_TIMEOUT_MS = 8_000;
const MAX_PROVIDER_BODY_BYTES = 256 * 1024;

export interface AdminBusinessSuggestion {
  placeId: string;
  name: string;
  address: string;
}

export interface AdminBusinessDetails {
  businessName: string;
  businessAddress: string;
  googlePlaceId: string;
  googleMapsUrl: string;
  reviewUrl: string;
  category: string;
}

export interface AdminPlaceSearchProvider {
  search(input: string, apiKey: string): Promise<AdminBusinessSuggestion[]>;
  getDetails(placeId: string, apiKey: string): Promise<AdminBusinessDetails>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class AdminPlaceSearchError extends Error {
  constructor(readonly code: "invalid_request" | "missing_configuration" | "provider_rejected" | "provider_unavailable" | "timeout" | "invalid_response" | "not_found") {
    super(code);
    this.name = "AdminPlaceSearchError";
  }
}

function clean(value: unknown, maxLength: number): string {
  return typeof value === "string" && value.trim().length <= maxLength ? value.trim() : "";
}

function localizedText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return clean((value as Record<string, unknown>).text, 500);
}

function isValidPlaceId(placeId: string): boolean {
  return /^[A-Za-z0-9_-]{3,300}$/.test(placeId);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new AdminPlaceSearchError("invalid_response");
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
      throw new AdminPlaceSearchError("invalid_response");
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();
  try {
    return JSON.parse(body);
  } catch {
    throw new AdminPlaceSearchError("invalid_response");
  }
}

async function providerRequest(fetcher: Fetcher, input: RequestInfo | URL, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetcher(input, { ...init, signal: controller.signal });
    if (!response.ok) {
      if (response.status === 404) throw new AdminPlaceSearchError("not_found");
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new AdminPlaceSearchError("provider_rejected");
      }
      throw new AdminPlaceSearchError("provider_unavailable");
    }
    return await readBoundedJson(response);
  } catch (error) {
    if (error instanceof AdminPlaceSearchError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new AdminPlaceSearchError("timeout");
    throw new AdminPlaceSearchError("provider_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

function reviewUrlFromPlaceId(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

export function createAdminPlaceSearchProvider(fetcher: Fetcher = fetch): AdminPlaceSearchProvider {
  return {
    async search(input, apiKey) {
      const query = clean(input, 120);
      if (query.length < 3) throw new AdminPlaceSearchError("invalid_request");
      if (!apiKey) throw new AdminPlaceSearchError("missing_configuration");
      const parsed = await providerRequest(fetcher, `${GOOGLE_PLACES_ORIGIN}/v1/places:autocomplete`, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text,suggestions.placePrediction.text.text"
        },
        body: JSON.stringify({
          input: query,
          includedRegionCodes: ["au"],
          languageCode: "en-AU",
          regionCode: "AU"
        })
      });
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AdminPlaceSearchError("invalid_response");
      const suggestions = Array.isArray((parsed as Record<string, unknown>).suggestions)
        ? (parsed as Record<string, unknown>).suggestions as unknown[]
        : [];
      return suggestions.flatMap((item): AdminBusinessSuggestion[] => {
        if (!item || typeof item !== "object") return [];
        const prediction = (item as Record<string, unknown>).placePrediction;
        if (!prediction || typeof prediction !== "object") return [];
        const record = prediction as Record<string, unknown>;
        const placeId = clean(record.placeId, 300);
        if (!isValidPlaceId(placeId)) return [];
        const structured = record.structuredFormat && typeof record.structuredFormat === "object"
          ? record.structuredFormat as Record<string, unknown>
          : {};
        const name = localizedText(structured.mainText) || localizedText(record.text) || "Business location";
        const address = localizedText(structured.secondaryText);
        return [{ placeId, name, address }];
      }).slice(0, 6);
    },

    async getDetails(placeId, apiKey) {
      const id = clean(placeId, 300);
      if (!isValidPlaceId(id)) throw new AdminPlaceSearchError("invalid_request");
      if (!apiKey) throw new AdminPlaceSearchError("missing_configuration");
      const parsed = await providerRequest(fetcher, `${GOOGLE_PLACES_ORIGIN}/v1/places/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "id,displayName,formattedAddress,shortFormattedAddress,primaryTypeDisplayName,googleMapsUri"
        }
      });
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AdminPlaceSearchError("invalid_response");
      const place = parsed as Record<string, unknown>;
      const returnedId = clean(place.id, 300) || id;
      if (!isValidPlaceId(returnedId)) throw new AdminPlaceSearchError("invalid_response");
      const businessName = localizedText(place.displayName);
      if (!businessName) throw new AdminPlaceSearchError("invalid_response");
      return {
        businessName,
        businessAddress: clean(place.formattedAddress || place.shortFormattedAddress, 300),
        googlePlaceId: returnedId,
        googleMapsUrl: clean(place.googleMapsUri, 2048),
        reviewUrl: reviewUrlFromPlaceId(returnedId),
        category: localizedText(place.primaryTypeDisplayName)
      };
    }
  };
}
