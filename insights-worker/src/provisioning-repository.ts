import { normaliseEmail } from "./auth";
import {
  fingerprintProvisioningIntent,
  generatePublicCardToken,
  normaliseGoogleReviewUrl,
  programmingUrl,
  ProvisioningError,
  type ProvisioningIntent,
  type ProvisioningManifest
} from "./provisioning";

const MAX_TOKEN_ATTEMPTS = 4;

interface BusinessRecord {
  id: string;
  name: string;
}

interface LocationRecord {
  id: string;
  business_id: string;
  business_name: string;
  business_address: string;
  google_review_url: string;
}

interface BatchRecord {
  id: string;
  source: string;
  external_order_reference: string;
  external_setup_reference: string;
  request_fingerprint: string;
  business_id: string;
  location_id: string;
  physical_card_count: number;
  created_at: string;
  business_name: string;
  business_address: string;
  google_review_url: string;
}

interface BatchCardRecord {
  id: string;
  card_ordinal: number;
  public_token: string;
  label: string;
}

interface ChangesResult {
  changes: number;
}

export interface ProvisioningResult {
  manifest: ProvisioningManifest;
  replayed: boolean;
}

export interface AdminBusinessOption {
  id: string;
  name: string;
  locations: Array<{
    id: string;
    businessName: string;
    businessAddress: string;
    googleReviewUrl: string;
    insightsStatus: "active" | "inactive";
  }>;
}

export interface ProvisioningBatchSummary {
  id: string;
  externalOrderReference: string;
  externalSetupReference: string;
  businessName: string;
  businessAddress: string;
  physicalCardCount: number;
  createdAt: string;
}

export interface InsightsActivationInput {
  email: string;
  businessId: string;
  locationId: string;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

async function findBatchByKey(db: D1Database, intent: ProvisioningIntent): Promise<BatchRecord | null> {
  return db.prepare(`
    SELECT
      p.id,
      p.source,
      p.external_order_reference,
      p.external_setup_reference,
      p.request_fingerprint,
      p.business_id,
      p.location_id,
      p.physical_card_count,
      p.created_at,
      b.name AS business_name,
      l.business_address,
      l.google_review_url
    FROM provisioning_batches p
    JOIN businesses b ON b.id = p.business_id
    JOIN locations l ON l.id = p.location_id
    WHERE p.source = ?1
      AND p.external_order_reference = ?2
      AND p.external_setup_reference = ?3
    LIMIT 1
  `).bind(
    intent.source,
    intent.externalOrderReference,
    intent.externalSetupReference
  ).first<BatchRecord>();
}

async function findBatchById(db: D1Database, batchId: string): Promise<BatchRecord | null> {
  return db.prepare(`
    SELECT
      p.id,
      p.source,
      p.external_order_reference,
      p.external_setup_reference,
      p.request_fingerprint,
      p.business_id,
      p.location_id,
      p.physical_card_count,
      p.created_at,
      b.name AS business_name,
      l.business_address,
      l.google_review_url
    FROM provisioning_batches p
    JOIN businesses b ON b.id = p.business_id
    JOIN locations l ON l.id = p.location_id
    WHERE p.id = ?1
    LIMIT 1
  `).bind(batchId).first<BatchRecord>();
}

async function loadManifest(db: D1Database, batch: BatchRecord): Promise<ProvisioningManifest> {
  const cards = await db.prepare(`
    SELECT c.id, pc.card_ordinal, c.public_token, c.label
    FROM provisioning_batch_cards pc
    JOIN cards c ON c.id = pc.card_id
    WHERE pc.batch_id = ?1
    ORDER BY pc.card_ordinal ASC
  `).bind(batch.id).all<BatchCardRecord>();

  return {
    id: batch.id,
    source: batch.source,
    externalOrderReference: batch.external_order_reference,
    externalSetupReference: batch.external_setup_reference,
    businessId: batch.business_id,
    businessName: batch.business_name,
    locationId: batch.location_id,
    businessAddress: batch.business_address,
    googleReviewUrl: batch.google_review_url,
    physicalCardCount: Number(batch.physical_card_count),
    createdAt: batch.created_at,
    cards: cards.results.map((card) => ({
      id: card.id,
      ordinal: Number(card.card_ordinal),
      publicToken: card.public_token,
      programmingUrl: programmingUrl(card.public_token),
      label: card.label
    }))
  };
}

async function replayOrConflict(
  db: D1Database,
  batch: BatchRecord,
  fingerprint: string
): Promise<ProvisioningResult> {
  if (batch.request_fingerprint !== fingerprint) {
    throw new ProvisioningError(
      "intent_conflict",
      "That order and setup reference was already provisioned with different details.",
      409
    );
  }
  return { manifest: await loadManifest(db, batch), replayed: true };
}

export async function provisionPhysicalCards(
  db: D1Database,
  intent: ProvisioningIntent,
  now: string
): Promise<ProvisioningResult> {
  const fingerprint = await fingerprintProvisioningIntent(intent);
  const existing = await findBatchByKey(db, intent);
  if (existing) return replayOrConflict(db, existing, fingerprint);

  let business: BusinessRecord;
  if (intent.business.mode === "existing") {
    const found = await db.prepare("SELECT id, name FROM businesses WHERE id = ?1 LIMIT 1")
      .bind(intent.business.id)
      .first<BusinessRecord>();
    if (!found) throw new ProvisioningError("not_found", "The selected business was not found.", 404);
    business = found;
  } else {
    business = { id: crypto.randomUUID(), name: intent.business.name };
  }

  let location: LocationRecord;
  if (intent.location.mode === "existing") {
    const found = await db.prepare(`
      SELECT id, business_id, business_name, business_address, google_review_url
      FROM locations
      WHERE id = ?1 AND business_id = ?2
      LIMIT 1
    `).bind(intent.location.id, business.id).first<LocationRecord>();
    if (!found) throw new ProvisioningError("not_found", "The selected location was not found for that business.", 404);
    const storedDestination = normaliseGoogleReviewUrl(found.google_review_url);
    if (!storedDestination || storedDestination !== intent.location.googleReviewUrl) {
      throw new ProvisioningError(
        "destination_mismatch",
        "The confirmed destination does not match the selected location.",
        409
      );
    }
    location = found;
  } else {
    location = {
      id: crypto.randomUUID(),
      business_id: business.id,
      business_name: business.name,
      business_address: intent.location.businessAddress,
      google_review_url: intent.location.googleReviewUrl
    };
  }

  const batchId = crypto.randomUUID();
  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
    const cards = Array.from({ length: intent.physicalCardCount }, (_, index) => ({
      id: crypto.randomUUID(),
      ordinal: index + 1,
      publicToken: generatePublicCardToken(),
      label: `Card ${index + 1}`
    }));
    const statements: D1PreparedStatement[] = [];

    if (intent.business.mode === "new") {
      statements.push(db.prepare(`
        INSERT INTO businesses (id, name, created_at) VALUES (?1, ?2, ?3)
      `).bind(business.id, business.name, now));
    }
    if (intent.location.mode === "new") {
      statements.push(db.prepare(`
        INSERT INTO locations (
          id, business_id, business_name, business_address, google_place_id,
          google_review_url, active, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)
      `).bind(
        location.id,
        business.id,
        business.name,
        intent.location.businessAddress,
        intent.location.googlePlaceId,
        intent.location.googleReviewUrl,
        now
      ));
    }
    statements.push(db.prepare(`
      INSERT INTO provisioning_batches (
        id, source, external_order_reference, external_setup_reference,
        request_fingerprint, business_id, location_id, physical_card_count, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    `).bind(
      batchId,
      intent.source,
      intent.externalOrderReference,
      intent.externalSetupReference,
      fingerprint,
      business.id,
      location.id,
      intent.physicalCardCount,
      now
    ));
    for (const card of cards) {
      statements.push(db.prepare(`
        INSERT INTO cards (
          id, public_token, location_id, label, placement_type, active, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, 'other', 1, ?5, ?5)
      `).bind(card.id, card.publicToken, location.id, card.label, now));
      statements.push(db.prepare(`
        INSERT INTO provisioning_batch_cards (batch_id, card_id, card_ordinal)
        VALUES (?1, ?2, ?3)
      `).bind(batchId, card.id, card.ordinal));
    }

    try {
      await db.batch(statements);
      const created = await findBatchById(db, batchId);
      if (!created) throw new Error("Provisioning batch was not readable after creation");
      return { manifest: await loadManifest(db, created), replayed: false };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const racedBatch = await findBatchByKey(db, intent);
      if (racedBatch) return replayOrConflict(db, racedBatch, fingerprint);
      if (attempt === MAX_TOKEN_ATTEMPTS - 1) throw error;
    }
  }

  throw new Error("Could not allocate unique card tokens");
}

export async function getProvisioningManifest(
  db: D1Database,
  batchId: string
): Promise<ProvisioningManifest | null> {
  const batch = await findBatchById(db, batchId);
  return batch ? loadManifest(db, batch) : null;
}

export async function listProvisioningBatches(db: D1Database): Promise<ProvisioningBatchSummary[]> {
  const result = await db.prepare(`
    SELECT
      p.id,
      p.external_order_reference,
      p.external_setup_reference,
      b.name AS business_name,
      l.business_address,
      p.physical_card_count,
      p.created_at
    FROM provisioning_batches p
    JOIN businesses b ON b.id = p.business_id
    JOIN locations l ON l.id = p.location_id
    ORDER BY p.created_at DESC
    LIMIT 30
  `).all<{
    id: string;
    external_order_reference: string;
    external_setup_reference: string;
    business_name: string;
    business_address: string;
    physical_card_count: number;
    created_at: string;
  }>();
  return result.results.map((row) => ({
    id: row.id,
    externalOrderReference: row.external_order_reference,
    externalSetupReference: row.external_setup_reference,
    businessName: row.business_name,
    businessAddress: row.business_address,
    physicalCardCount: Number(row.physical_card_count),
    createdAt: row.created_at
  }));
}

export async function listAdminBusinessOptions(db: D1Database): Promise<AdminBusinessOption[]> {
  const result = await db.prepare(`
    SELECT
      b.id AS business_id,
      b.name AS business_name,
      l.id AS location_id,
      l.business_name AS location_business_name,
      l.business_address,
      l.google_review_url,
      COALESCE(e.status, 'inactive') AS insights_status
    FROM businesses b
    LEFT JOIN locations l ON l.business_id = b.id
    LEFT JOIN insights_entitlements e ON e.location_id = l.id
    ORDER BY b.created_at ASC, l.created_at ASC
  `).all<{
    business_id: string;
    business_name: string;
    location_id: string | null;
    location_business_name: string | null;
    business_address: string | null;
    google_review_url: string | null;
    insights_status: "active" | "inactive";
  }>();

  const businesses = new Map<string, AdminBusinessOption>();
  for (const row of result.results) {
    const business = businesses.get(row.business_id) || {
      id: row.business_id,
      name: row.business_name,
      locations: []
    };
    if (row.location_id && row.location_business_name && row.google_review_url) {
      business.locations.push({
        id: row.location_id,
        businessName: row.location_business_name,
        businessAddress: row.business_address || "",
        googleReviewUrl: row.google_review_url,
        insightsStatus: row.insights_status
      });
    }
    businesses.set(row.business_id, business);
  }
  return Array.from(businesses.values());
}

export async function activateInsights(
  db: D1Database,
  input: InsightsActivationInput,
  now: string
): Promise<{ userId: string; businessId: string; locationId: string }> {
  const location = await db.prepare(`
    SELECT id FROM locations WHERE id = ?1 AND business_id = ?2 LIMIT 1
  `).bind(input.locationId, input.businessId).first<{ id: string }>();
  if (!location) throw new ProvisioningError("not_found", "The selected location was not found for that business.", 404);

  const email = normaliseEmail(input.email);
  const newUserId = crypto.randomUUID();
  await db.batch([
    db.prepare(`
      INSERT INTO customer_users (id, email, active, created_at, updated_at)
      VALUES (?1, ?2, 1, ?3, ?3)
      ON CONFLICT(email) DO UPDATE SET active = 1, updated_at = excluded.updated_at
    `).bind(newUserId, email, now),
    db.prepare(`
      INSERT INTO customer_business_access (user_id, business_id, role, created_at)
      SELECT id, ?2, 'owner', ?3 FROM customer_users WHERE email = ?1 COLLATE NOCASE
      ON CONFLICT(user_id, business_id) DO NOTHING
    `).bind(email, input.businessId, now),
    db.prepare(`
      INSERT INTO insights_entitlements (
        location_id, status, source, activated_at, deactivated_at, updated_at
      ) VALUES (?1, 'active', 'admin', ?2, NULL, ?2)
      ON CONFLICT(location_id) DO UPDATE SET
        status = 'active',
        source = 'admin',
        activated_at = CASE
          WHEN insights_entitlements.status = 'active' THEN insights_entitlements.activated_at
          ELSE excluded.activated_at
        END,
        deactivated_at = NULL,
        updated_at = excluded.updated_at
    `).bind(input.locationId, now)
  ]);

  const user = await db.prepare("SELECT id FROM customer_users WHERE email = ?1 COLLATE NOCASE LIMIT 1")
    .bind(email)
    .first<{ id: string }>();
  if (!user) throw new Error("Insights customer was not readable after activation");
  return { userId: user.id, businessId: input.businessId, locationId: input.locationId };
}

export async function revokeCustomerBusinessAccess(
  db: D1Database,
  email: string,
  businessId: string
): Promise<boolean> {
  const result = await db.prepare(`
    DELETE FROM customer_business_access
    WHERE business_id = ?2
      AND user_id = (
        SELECT id FROM customer_users WHERE email = ?1 COLLATE NOCASE LIMIT 1
      )
  `).bind(normaliseEmail(email), businessId).run();
  return Number((result.meta as ChangesResult).changes || 0) === 1;
}

export async function deactivateInsightsEntitlement(
  db: D1Database,
  locationId: string,
  now: string
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE insights_entitlements
    SET status = 'inactive', deactivated_at = ?2, updated_at = ?2
    WHERE location_id = ?1 AND status = 'active'
  `).bind(locationId, now).run();
  return Number((result.meta as ChangesResult).changes || 0) === 1;
}
