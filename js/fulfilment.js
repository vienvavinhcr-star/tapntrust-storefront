import { validHttpsUrl } from "./validation.js";
import { shortestGoogleReviewUrl } from "./google-review.js";

export const FULFILMENT_KEYS = Object.freeze({
  businessName: "_Business Name",
  businessAddress: "_Business Address",
  googlePlaceId: "_Google Place ID",
  reviewLink: "_Review Link",
  googleMapsUrl: "_Google Maps URL",
  reviewLinkStatus: "_Review Link Status",
  reviewLinkSource: "_Review Link Source",
  setupId: "_Business Setup ID",
  itemRole: "_Item Role"
});

// Public keys used by carts created before private checkout metadata was enabled.
export const LEGACY_FULFILMENT_KEYS = Object.freeze({
  businessName: "Business Name",
  businessAddress: "Business Address",
  googlePlaceId: "Google Place ID",
  reviewLink: "Review Link",
  googleMapsUrl: "Google Maps URL",
  reviewLinkStatus: "Review Link Status",
  reviewLinkSource: "Review Link Source",
  setupId: "Business Setup ID",
  itemRole: "Item Role"
});

export const ITEM_ROLES = Object.freeze({
  primary: "Primary Card Package",
  extra: "Extra NFC Card",
  stand: "Counter Stand"
});

function clean(value) {
  return String(value || "").trim();
}

export function businessDetailsFromAttributes(attributes = {}) {
  return {
    businessName: clean(attributes[FULFILMENT_KEYS.businessName] || attributes[LEGACY_FULFILMENT_KEYS.businessName]),
    businessAddress: clean(attributes[FULFILMENT_KEYS.businessAddress] || attributes[LEGACY_FULFILMENT_KEYS.businessAddress]),
    googlePlaceId: clean(attributes[FULFILMENT_KEYS.googlePlaceId] || attributes[LEGACY_FULFILMENT_KEYS.googlePlaceId]),
    reviewUrl: clean(attributes[FULFILMENT_KEYS.reviewLink] || attributes[LEGACY_FULFILMENT_KEYS.reviewLink] || attributes["Review URL"]),
    googleMapsUrl: clean(attributes[FULFILMENT_KEYS.googleMapsUrl] || attributes[LEGACY_FULFILMENT_KEYS.googleMapsUrl]),
    reviewLinkStatus: clean(attributes[FULFILMENT_KEYS.reviewLinkStatus] || attributes[LEGACY_FULFILMENT_KEYS.reviewLinkStatus]) || "Ready",
    reviewLinkSource: clean(attributes[FULFILMENT_KEYS.reviewLinkSource] || attributes[LEGACY_FULFILMENT_KEYS.reviewLinkSource])
      || (attributes[FULFILMENT_KEYS.googlePlaceId] || attributes[LEGACY_FULFILMENT_KEYS.googlePlaceId] ? "Google Places" : "Manual"),
    setupId: clean(attributes[FULFILMENT_KEYS.setupId] || attributes[LEGACY_FULFILMENT_KEYS.setupId])
  };
}

export function validateBusinessDetails(details = {}) {
  const source = clean(details.reviewLinkSource || (details.googlePlaceId ? "Google Places" : "Manual"));
  const googlePlaceId = clean(details.googlePlaceId);
  const suppliedReviewUrl = clean(details.reviewUrl);
  const normalised = {
    businessName: clean(details.businessName),
    businessAddress: clean(details.businessAddress),
    googlePlaceId,
    reviewUrl: source === "Google Places"
      ? shortestGoogleReviewUrl({ placeId: googlePlaceId, directReviewUrl: suppliedReviewUrl })
      : suppliedReviewUrl,
    googleMapsUrl: clean(details.googleMapsUrl),
    reviewLinkStatus: clean(details.reviewLinkStatus) || "Ready",
    reviewLinkSource: source
  };

  if (!normalised.businessName) throw new Error("Business Name is required for card programming.");
  if (!validHttpsUrl(normalised.reviewUrl)) throw new Error("A complete secure Review Link is required for card programming.");
  if (source === "Google Places" && !normalised.googlePlaceId) throw new Error("Google Place ID is required for a Google-selected business.");
  if (normalised.googleMapsUrl && !validHttpsUrl(normalised.googleMapsUrl)) throw new Error("Google Maps URL must be a complete secure URL.");

  return normalised;
}

export function buildFulfilmentAttributes(details, { itemRole, setupId = "" } = {}) {
  if (itemRole === ITEM_ROLES.stand) {
    return { [FULFILMENT_KEYS.itemRole]: ITEM_ROLES.stand };
  }

  const value = validateBusinessDetails(details);
  return {
    [FULFILMENT_KEYS.businessName]: value.businessName,
    [FULFILMENT_KEYS.businessAddress]: value.businessAddress,
    [FULFILMENT_KEYS.googlePlaceId]: value.googlePlaceId,
    [FULFILMENT_KEYS.reviewLink]: value.reviewUrl,
    [FULFILMENT_KEYS.googleMapsUrl]: value.googleMapsUrl,
    [FULFILMENT_KEYS.reviewLinkStatus]: value.reviewLinkStatus,
    [FULFILMENT_KEYS.reviewLinkSource]: value.reviewLinkSource,
    [FULFILMENT_KEYS.setupId]: clean(setupId),
    [FULFILMENT_KEYS.itemRole]: itemRole
  };
}

export function hasBusinessMetadata(attributes = {}) {
  return Boolean(
    attributes[FULFILMENT_KEYS.businessName]
    || attributes[FULFILMENT_KEYS.reviewLink]
    || attributes[LEGACY_FULFILMENT_KEYS.businessName]
    || attributes[LEGACY_FULFILMENT_KEYS.reviewLink]
    || attributes["Review URL"]
  );
}

export function mergeFulfilmentAttributes(existing = {}, fulfilment = {}) {
  const managed = new Set([
    ...Object.values(FULFILMENT_KEYS),
    ...Object.values(LEGACY_FULFILMENT_KEYS),
    "Review URL"
  ]);
  return Object.fromEntries([
    ...Object.entries(existing).filter(([key]) => !managed.has(key)),
    ...Object.entries(fulfilment)
  ]);
}
