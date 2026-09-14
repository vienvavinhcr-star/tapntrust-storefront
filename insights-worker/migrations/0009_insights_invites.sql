PRAGMA foreign_keys = ON;

ALTER TABLE provisioning_batches
  ADD COLUMN customer_email TEXT COLLATE NOCASE;

CREATE INDEX provisioning_batches_customer_email_idx
  ON provisioning_batches (customer_email, created_at DESC);

CREATE TABLE shopify_order_contacts (
  external_order_reference TEXT NOT NULL,
  external_setup_reference TEXT NOT NULL,
  provider_order_reference TEXT NOT NULL,
  customer_email TEXT NOT NULL COLLATE NOCASE,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (external_order_reference, external_setup_reference)
);

CREATE INDEX shopify_order_contacts_email_idx
  ON shopify_order_contacts (customer_email, updated_at DESC);
CREATE INDEX shopify_order_contacts_setup_idx
  ON shopify_order_contacts (external_setup_reference, updated_at DESC);

CREATE TRIGGER provisioning_batches_apply_shopify_contact_after_insert
AFTER INSERT ON provisioning_batches
WHEN NEW.customer_email IS NULL
BEGIN
  UPDATE provisioning_batches
  SET customer_email = (
    SELECT customer_email
    FROM shopify_order_contacts
    WHERE external_order_reference = NEW.external_order_reference
      AND external_setup_reference = NEW.external_setup_reference
    LIMIT 1
  )
  WHERE id = NEW.id
    AND EXISTS (
      SELECT 1
      FROM shopify_order_contacts
      WHERE external_order_reference = NEW.external_order_reference
        AND external_setup_reference = NEW.external_setup_reference
    );
END;

CREATE TABLE insights_invite_deliveries (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
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
