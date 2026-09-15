PRAGMA foreign_keys = ON;

ALTER TABLE provisioning_batches
  ADD COLUMN customer_email TEXT COLLATE NOCASE;

CREATE INDEX provisioning_batches_customer_email_idx
  ON provisioning_batches (customer_email, created_at DESC);
