PRAGMA foreign_keys = ON;

CREATE TABLE insights_intro_offers (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  business_id TEXT REFERENCES businesses(id) ON DELETE RESTRICT,
  setup_id TEXT NOT NULL,
  discount_code TEXT UNIQUE,
  shopify_discount_node_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('creating', 'issued', 'failed', 'superseded')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX insights_intro_offers_status_expiry_idx
  ON insights_intro_offers (status, expires_at);
CREATE INDEX insights_intro_offers_business_idx
  ON insights_intro_offers (business_id, updated_at DESC);
CREATE INDEX insights_intro_offers_setup_idx
  ON insights_intro_offers (setup_id, updated_at DESC);
