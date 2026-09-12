import { isAllowedGoogleReviewUrl } from "./destinations";

const PUBLIC_TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PUBLIC_TOKEN_LENGTH = 20;

export type ProvisioningBusinessIntent =
  | { mode: "new"; name: string }
  | { mode: "existing"; id: string };

export type ProvisioningLocationIntent =
  | {
      mode: "new";
      businessAddress: string;
      googlePlaceId: string;
      googleReviewUrl: string;
    }
  | { mode: "existing"; id: string; googleReviewUrl: string };

export interface ProvisioningIntent {
  source: "admin_shopify";
  externalOrderReference: string;
  externalSetupReference: string;
  business: ProvisioningBusinessIntent;
  location: ProvisioningLocationIntent;
  physicalCardCount: number;
}

export interface ProvisionedCard {
  id: string;
  ordinal: number;
  publicToken: string;
  programmingUrl: string;
  label: string;
}

export interface ProvisioningManifest {
  id: string;
  source: string;
  externalOrderReference: string;
  externalSetupReference: string;
  businessId: string;
  businessName: string;
  locationId: string;
  businessAddress: string;
  googleReviewUrl: string;
  physicalCardCount: number;
  createdAt: string;
  cards: ProvisionedCard[];
}

export class ProvisioningError extends Error {
  constructor(
    public readonly code:
      | "invalid_request"
      | "not_found"
      | "intent_conflict"
      | "destination_mismatch",
    message: string,
    public readonly status: 400 | 404 | 409 = 400
  ) {
    super(message);
    this.name = "ProvisioningError";
  }
}

function cleanText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned && cleaned.length <= maximumLength ? cleaned : null;
}

function optionalText(value: unknown, maximumLength: number): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.length <= maximumLength ? cleaned : null;
}

export function normaliseGoogleReviewUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || !isAllowedGoogleReviewUrl(value)) return null;
  return new URL(value).toString();
}

export function parseProvisioningIntent(value: unknown): ProvisioningIntent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const externalOrderReference = cleanText(record.externalOrderReference, 160);
  const externalSetupReference = cleanText(record.externalSetupReference, 160);
  const businessMode = record.businessMode;
  const locationMode = record.locationMode;
  const physicalCardCount = record.physicalCardCount;
  const googleReviewUrl = normaliseGoogleReviewUrl(record.googleReviewUrl);

  if (
    !externalOrderReference
    || !externalSetupReference
    || !Number.isInteger(physicalCardCount)
    || Number(physicalCardCount) < 1
    || Number(physicalCardCount) > 100
    || !googleReviewUrl
  ) return null;

  let business: ProvisioningBusinessIntent;
  if (businessMode === "new") {
    const name = cleanText(record.businessName, 160);
    if (!name) return null;
    business = { mode: "new", name };
  } else if (businessMode === "existing") {
    const id = cleanText(record.businessId, 160);
    if (!id) return null;
    business = { mode: "existing", id };
  } else {
    return null;
  }

  let location: ProvisioningLocationIntent;
  if (locationMode === "new") {
    const businessAddress = optionalText(record.businessAddress, 300);
    const googlePlaceId = optionalText(record.googlePlaceId, 200);
    if (businessAddress === null || googlePlaceId === null) return null;
    location = { mode: "new", businessAddress, googlePlaceId, googleReviewUrl };
  } else if (locationMode === "existing") {
    const id = cleanText(record.locationId, 160);
    if (!id || business.mode !== "existing") return null;
    location = { mode: "existing", id, googleReviewUrl };
  } else {
    return null;
  }

  return {
    source: "admin_shopify",
    externalOrderReference,
    externalSetupReference,
    business,
    location,
    physicalCardCount: Number(physicalCardCount)
  };
}

export async function fingerprintProvisioningIntent(intent: ProvisioningIntent): Promise<string> {
  const canonicalFields = {
    version: 1,
    source: intent.source,
    externalOrderReference: intent.externalOrderReference,
    externalSetupReference: intent.externalSetupReference,
    business: intent.business,
    location: intent.location,
    physicalCardCount: intent.physicalCardCount
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonicalFields))
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generatePublicCardToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PUBLIC_TOKEN_LENGTH));
  let suffix = "";
  for (const byte of bytes) suffix += PUBLIC_TOKEN_ALPHABET[byte & 31];
  return `TNT-${suffix}`;
}

export function programmingUrl(publicToken: string): string {
  return `https://go.tapntrust.com/t/${publicToken}`;
}
