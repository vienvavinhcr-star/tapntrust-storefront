import { hashToken, isValidEmail, normaliseEmail } from "./auth";
import { generatePublicCardToken, normaliseGoogleReviewUrl, type ProvisioningManifest } from "./provisioning";
import { getProvisioningManifest } from "./provisioning-repository";
import type { AdminBusinessDetails } from "./admin-place-search";

export class PartnerProvisioningError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "PartnerProvisioningError"; }
}

export interface PartnerSetupInput {
  requestId: string;
  placeId: string;
  customerEmail: string;
  physicalCardCount: number;
  marketingConsent: boolean;
}

export function parsePartnerSetup(value: unknown): PartnerSetupInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const email = typeof item.customerEmail === "string" ? normaliseEmail(item.customerEmail) : "";
  if (!isValidEmail(email) || typeof item.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(item.requestId)
    || typeof item.placeId !== "string" || !/^[A-Za-z0-9_-]{3,300}$/.test(item.placeId)
    || !Number.isInteger(item.physicalCardCount) || Number(item.physicalCardCount) < 1 || Number(item.physicalCardCount) > 100
    || (item.marketingConsent !== undefined && typeof item.marketingConsent !== "boolean")) return null;
  return { requestId: item.requestId, placeId: item.placeId, customerEmail: email,
    physicalCardCount: Number(item.physicalCardCount), marketingConsent: item.marketingConsent === true };
}

interface PriorRow { batch_id: string; request_fingerprint: string; }
interface LocationRow { id: string; business_id: string; business_name: string; google_review_url: string; }

async function intentFingerprint(input: PartnerSetupInput): Promise<string> {
  return hashToken(JSON.stringify([input.placeId, input.customerEmail, input.physicalCardCount, input.marketingConsent]));
}

async function priorRequest(db: D1Database, partnerId: string, requestId: string): Promise<PriorRow | null> {
  return db.prepare(`SELECT pp.batch_id, pb.request_fingerprint FROM partner_provisionings pp
    JOIN provisioning_batches pb ON pb.id = pp.batch_id
    WHERE pp.partner_id = ?1 AND pp.request_id = ?2 LIMIT 1`)
    .bind(partnerId, requestId).first<PriorRow>();
}

async function replay(db: D1Database, prior: PriorRow, fingerprint: string): Promise<ProvisioningManifest> {
  if (prior.request_fingerprint !== fingerprint) throw new PartnerProvisioningError(409, "This request was already used for different setup details.");
  const manifest = await getProvisioningManifest(db, prior.batch_id);
  if (!manifest) throw new PartnerProvisioningError(503, "Existing programming URLs could not be loaded.");
  return manifest;
}

export async function provisionPartnerCards(
  db: D1Database, partnerId: string, input: PartnerSetupInput,
  detailsProvider: () => Promise<AdminBusinessDetails>, now: Date = new Date()
): Promise<{ manifest: ProvisioningManifest; replayed: boolean }> {
  const fingerprint = await intentFingerprint(input);
  const prior = await priorRequest(db, partnerId, input.requestId);
  if (prior) return { manifest: await replay(db, prior, fingerprint), replayed: true };

  const partner = await db.prepare(`SELECT status, provision_enabled, allowance_total, provisioned_count FROM sales_partners WHERE id=?1`)
    .bind(partnerId).first<{ status: string; provision_enabled: number; allowance_total: number; provisioned_count: number }>();
  if (!partner || partner.status !== "active") throw new PartnerProvisioningError(403, "Your partner account is not active.");
  if (partner.provision_enabled !== 1) throw new PartnerProvisioningError(403, "Your provisioning access is paused.");
  if (partner.allowance_total - partner.provisioned_count < input.physicalCardCount) {
    throw new PartnerProvisioningError(409, "Not enough card allowance. Contact TapNTrust for more physical cards.");
  }

  // Always resolve Place ID on the server. Never trust client-supplied business names or URLs.
  const details = await detailsProvider();
  if (details.googlePlaceId !== input.placeId || !details.businessName || !normaliseGoogleReviewUrl(details.reviewUrl)) {
    throw new PartnerProvisioningError(400, "The selected Google business could not be verified.");
  }
  const existing = await db.prepare(`SELECT id, business_id, business_name, google_review_url FROM locations
    WHERE google_place_id=?1 ORDER BY created_at ASC LIMIT 2`).bind(input.placeId).all<LocationRow>();
  if (existing.results.length > 1) throw new PartnerProvisioningError(409, "Multiple existing locations match this Google listing. Contact TapNTrust.");
  const matched = existing.results[0];
  const reviewUrl = matched ? normaliseGoogleReviewUrl(matched.google_review_url) : normaliseGoogleReviewUrl(details.reviewUrl);
  if (!reviewUrl) throw new PartnerProvisioningError(409, "This business has an invalid review destination. Contact TapNTrust.");

  const timestamp = now.toISOString();
  const businessId = matched?.business_id || crypto.randomUUID();
  const locationId = matched?.id || crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const ref = `CTV-${partnerId}-${input.requestId}`;
  const cards = Array.from({ length: input.physicalCardCount }, (_, i) => ({
    id: crypto.randomUUID(), ordinal: i + 1, token: generatePublicCardToken(), label: `Card ${i + 1}`
  }));
  const statements: D1PreparedStatement[] = [];
  if (!matched) {
    statements.push(db.prepare(`INSERT INTO businesses(id,name,created_at) VALUES(?1,?2,?3)`)
      .bind(businessId, details.businessName, timestamp));
    statements.push(db.prepare(`INSERT INTO locations(id,business_id,business_name,business_address,google_place_id,google_review_url,active,created_at)
      VALUES(?1,?2,?3,?4,?5,?6,1,?7)`)
      .bind(locationId, businessId, details.businessName, details.businessAddress, input.placeId, reviewUrl, timestamp));
  }
  statements.push(db.prepare(`INSERT INTO provisioning_batches(id,source,external_order_reference,external_setup_reference,request_fingerprint,business_id,location_id,physical_card_count,created_at)
    VALUES(?1,'admin_shopify',?2,?2,?3,?4,?5,?6,?7)`)
    .bind(batchId, ref, fingerprint, businessId, locationId, input.physicalCardCount, timestamp));
  for (const card of cards) {
    statements.push(db.prepare(`INSERT INTO cards(id,public_token,location_id,label,placement_type,active,created_at,updated_at)
      VALUES(?1,?2,?3,?4,'other',1,?5,?5)`).bind(card.id, card.token, locationId, card.label, timestamp));
    statements.push(db.prepare(`INSERT INTO provisioning_batch_cards(batch_id,card_id,card_ordinal) VALUES(?1,?2,?3)`)
      .bind(batchId, card.id, card.ordinal));
  }
  // The migration's BEFORE/AFTER INSERT triggers validate and debit the quota
  // atomically with all above inserts. Any failure rolls back the entire D1 batch.
  statements.push(db.prepare(`INSERT INTO partner_provisionings(batch_id,partner_id,request_id,customer_email,marketing_consent,google_place_id,physical_card_count,created_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`)
    .bind(batchId, partnerId, input.requestId, input.customerEmail, input.marketingConsent ? 1 : 0,
      input.placeId, input.physicalCardCount, timestamp));
  statements.push(db.prepare(`INSERT INTO partner_activity(id,partner_id,event_type,business_name,google_place_id,batch_id,physical_card_count,created_at)
    VALUES(?1,?2,'cards_provisioned',?3,?4,?5,?6,?7)`)
    .bind(crypto.randomUUID(), partnerId, details.businessName, input.placeId, batchId, input.physicalCardCount, timestamp));

  try {
    await db.batch(statements);
  } catch (error) {
    // A concurrent replay is safe: the UNIQUE request key decides who won.
    const raced = await priorRequest(db, partnerId, input.requestId);
    if (raced) return { manifest: await replay(db, raced, fingerprint), replayed: true };
    if (error instanceof Error && error.message.includes("partner_quota_exceeded")) {
      throw new PartnerProvisioningError(409, "Not enough card allowance or provisioning access was paused.");
    }
    throw error;
  }
  const manifest = await getProvisioningManifest(db, batchId);
  if (!manifest) throw new PartnerProvisioningError(503, "Card setup was saved but its programming URLs could not be loaded. Contact TapNTrust; do not provision again.");
  return { manifest, replayed: false };
}
