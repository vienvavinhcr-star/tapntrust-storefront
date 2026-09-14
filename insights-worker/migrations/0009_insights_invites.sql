PRAGMA foreign_keys = ON;

ALTER TABLE provisioning_batches
  ADD COLUMN customer_email TEXT COLLATE NOCASE;

CREATE INDEX provisioning_batches_customer_email_idx
  ON provisioning_batches (customer_email, created_at DESC);

CREATE TABLE insights_invite_deliveries (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'zoho',
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'suppressed')),
  provider_message_id TEXT,
  last_attempt_at TEXT NOT NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  UNIQUE (email, location_id)
);

CREATE INDEX insights_invite_deliveries_status_idx
  ON insights_invite_deliveries (status, location_id);
CREATE INDEX insights_invite_deliveries_email_idx
  ON insights_invite_deliveries (email, updated_at DESC);
