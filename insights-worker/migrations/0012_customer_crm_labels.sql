PRAGMA foreign_keys = ON;

-- Owner-only operational labels. These are not Shopify payment status,
-- Insights entitlements or the active flag on physical NFC cards.
CREATE TABLE crm_customer_labels (
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  customer_email TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL CHECK (status IN ('active', 'cancel', 'test')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (location_id, customer_email)
);

CREATE INDEX crm_customer_labels_status_idx ON crm_customer_labels(status, updated_at DESC);
