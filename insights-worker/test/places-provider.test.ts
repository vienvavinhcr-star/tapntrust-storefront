import { describe, expect, it, vi } from "vitest";
import {
  GOOGLE_PLACE_REVIEWS_FIELD_MASK,
  GOOGLE_PLACE_SUMMARY_FIELD_MASK,
  GooglePlacesProviderError,
  createGooglePlacesProvider
} from "../src/places-provider";

const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const TEST_KEY = "test-key-that-must-never-appear-in-errors";

describe("Google Places provider", () => {
  it("uses the official Place Details endpoint and a minimal summary mask without reviews", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      rating: 4.8,
      userRatingCount: 186,
      googleMapsLinks: {
        placeUri: "https://www.google.com/maps/place/example",
        reviewsUri: "https://www.google.com/maps/place/example/reviews"
      }
    }));
    const provider = createGooglePlacesProvider(fetcher);

    const result = await provider.fetchSummary(PLACE_ID, TEST_KEY);

    expect(result).toEqual({
      rating: 4.8,
      userRatingCount: 186,
      placeUri: "https://www.google.com/maps/place/example"
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] || [];
    expect(url).toBe(`https://places.googleapis.com/v1/places/${PLACE_ID}`);
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Goog-Api-Key")).toBe(TEST_KEY);
    expect(headers.get("X-Goog-FieldMask")).toBe(GOOGLE_PLACE_SUMMARY_FIELD_MASK);
    expect(GOOGLE_PLACE_SUMMARY_FIELD_MASK.split(",")).not.toContain("reviews");
    expect(GOOGLE_PLACE_SUMMARY_FIELD_MASK).not.toContain("*");
  });

  it("requests reviews through a separate field mask and preserves provider attribution", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      googleMapsLinks: { reviewsUri: "https://www.google.com/maps/reviews/example" },
      reviews: [{
        rating: 5,
        text: { text: "Excellent service", languageCode: "en" },
        originalText: { text: "Excellent service", languageCode: "en" },
        publishTime: "2026-09-10T02:00:00Z",
        relativePublishTimeDescription: "2 days ago",
        googleMapsUri: "https://www.google.com/maps/reviews/source",
        visitDate: { year: 2026, month: 9 },
        authorAttribution: {
          displayName: "Alex",
          uri: "https://www.google.com/maps/contrib/example",
          photoUri: "https://lh3.googleusercontent.com/example"
        }
      }]
    }));
    const provider = createGooglePlacesProvider(fetcher);

    const result = await provider.fetchReviews(PLACE_ID, TEST_KEY);

    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]?.author).toEqual({
      displayName: "Alex",
      profileUri: "https://www.google.com/maps/contrib/example",
      photoUri: "https://lh3.googleusercontent.com/example"
    });
    expect(result.reviews[0]?.sourceUri).toBe("https://www.google.com/maps/reviews/source");
    expect(result.reviews[0]?.relativePublishTimeDescription).toBe("2 days ago");
    expect(result.reviews[0]?.visitDate).toBe("2026-09");
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("X-Goog-FieldMask")).toBe(GOOGLE_PLACE_REVIEWS_FIELD_MASK);
    expect(GOOGLE_PLACE_REVIEWS_FIELD_MASK).toContain("reviews");
    expect(GOOGLE_PLACE_REVIEWS_FIELD_MASK).not.toContain("rating,userRatingCount");
    expect(GOOGLE_PLACE_REVIEWS_FIELD_MASK).not.toContain("*");
  });

  it("turns provider failures into safe reason codes without response bodies or API keys", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      `provider body includes ${TEST_KEY}`,
      { status: 403 }
    ));
    const provider = createGooglePlacesProvider(fetcher);

    let thrown: unknown;
    try {
      await provider.fetchSummary(PLACE_ID, TEST_KEY);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GooglePlacesProviderError);
    expect((thrown as Error).message).toBe("provider_rejected");
    expect(String(thrown)).not.toContain(TEST_KEY);
    expect(String(thrown)).not.toContain("provider body includes");
  });

  it("rejects arbitrary malformed place IDs before making a provider request", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({}));
    const provider = createGooglePlacesProvider(fetcher);

    await expect(provider.fetchSummary("../../secrets?key=x", TEST_KEY))
      .rejects.toMatchObject({ code: "invalid_place_id" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
