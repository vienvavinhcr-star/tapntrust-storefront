PRAGMA foreign_keys = ON;

CREATE TABLE provisioning_batches (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL
    CHECK (source IN ('admin_shopify', 'shopify_webhook')),
  external_order_reference TEXT NOT NULL,
  external_setup_reference TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  physical_card_count INTEGER NOT NULL CHECK (physical_card_count > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source, external_order_reference, external_setup_reference)
);

CREATE TABLE provisioning_batch_cards (
  batch_id TEXT NOT NULL REFERENCES provisioning_batches(id) ON DELETE RESTRICT,
  card_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE RESTRICT,
  card_ordinal INTEGER NOT NULL CHECK (card_ordinal > 0),
  PRIMARY KEY (batch_id, card_id),
  UNIQUE (batch_id, card_ordinal)
);

CREATE TABLE insights_entitlements (
  location_id TEXT PRIMARY KEY REFERENCES locations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  source TEXT NOT NULL,
  activated_at TEXT,
  deactivated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX provisioning_batches_created_idx
  ON provisioning_batches (created_at DESC);
CREATE INDEX provisioning_batches_location_idx
  ON provisioning_batches (location_id, created_at DESC);
CREATE INDEX insights_entitlements_status_idx
  ON insights_entitlements (status, location_id);

-- Existing Phase 2A access already represents an owner-approved Insights account.
-- Preserve that production visibility when location-level entitlements are introduced.
INSERT INTO insights_entitlements (
  location_id,
  status,
  source,
  activated_at,
  deactivated_at,
  updated_at
)
SELECT DISTINCT
  l.id,
  'active',
  'phase2a_backfill',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM locations l
JOIN customer_business_access a ON a.business_id = l.business_id;
