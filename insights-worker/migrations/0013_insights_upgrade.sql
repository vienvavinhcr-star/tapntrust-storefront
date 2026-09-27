CREATE TABLE insights_upgrade_magic_links (
  id TEXT PRIMARY KEY,
  provisioning_batch_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (provisioning_batch_id) REFERENCES provisioning_batches(id) ON DELETE CASCADE
);

CREATE INDEX insights_upgrade_magic_links_batch_idx
  ON insights_upgrade_magic_links (provisioning_batch_id, created_at DESC);

CREATE TABLE insights_upgrade_sessions (
  id TEXT PRIMARY KEY,
  provisioning_batch_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (provisioning_batch_id) REFERENCES provisioning_batches(id) ON DELETE CASCADE
);

CREATE INDEX insights_upgrade_sessions_expiry_idx
  ON insights_upgrade_sessions (expires_at, revoked_at);

CREATE TABLE insights_upgrade_checkout_claims (
  id TEXT PRIMARY KEY,
  provisioning_batch_id TEXT NOT NULL,
  setup_reference TEXT NOT NULL UNIQUE,
  provider_order_reference TEXT,
  checkout_url TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (provisioning_batch_id) REFERENCES provisioning_batches(id) ON DELETE CASCADE
);

CREATE INDEX insights_upgrade_checkout_claims_batch_idx
  ON insights_upgrade_checkout_claims (provisioning_batch_id, created_at DESC);

CREATE UNIQUE INDEX insights_upgrade_checkout_claims_open_batch_idx
  ON insights_upgrade_checkout_claims (provisioning_batch_id)
  WHERE provider_order_reference IS NULL;
