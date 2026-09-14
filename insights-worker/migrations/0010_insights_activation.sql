PRAGMA foreign_keys = ON;

CREATE TABLE insights_activation_magic_links (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX insights_activation_magic_links_email_idx
  ON insights_activation_magic_links (email, created_at DESC);
CREATE INDEX insights_activation_magic_links_expiry_idx
  ON insights_activation_magic_links (expires_at);

CREATE TABLE insights_activation_sessions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX insights_activation_sessions_email_idx
  ON insights_activation_sessions (email, created_at DESC);
CREATE INDEX insights_activation_sessions_expiry_idx
  ON insights_activation_sessions (expires_at);

CREATE TABLE insights_activation_checkouts (
  id TEXT PRIMARY KEY,
  setup_reference TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  offer_kind TEXT NOT NULL CHECK (offer_kind IN ('intro', 'standard')),
  offer_id TEXT,
  discount_code TEXT,
  provider_order_reference TEXT,
  checkout_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('creating', 'ready', 'failed', 'paid')),
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);

CREATE INDEX insights_activation_checkouts_email_idx
  ON insights_activation_checkouts (email, created_at DESC);
CREATE INDEX insights_activation_checkouts_location_idx
  ON insights_activation_checkouts (location_id, created_at DESC);
CREATE INDEX insights_activation_checkouts_status_idx
  ON insights_activation_checkouts (status, expires_at);
