PRAGMA foreign_keys = ON;

-- CRM-only annotations: never change billing, NFC card availability or Shopify status.
-- A location can serve more than one email; do not conflate those customers.
CREATE TABLE customer_crm_labels (
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  customer_email TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL CHECK (status IN ('active', 'cancel', 'test')),
  last_paid_batch_id TEXT REFERENCES provisioning_batches(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (location_id, customer_email)
);
