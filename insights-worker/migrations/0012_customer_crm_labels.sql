PRAGMA foreign_keys = ON;

-- Operational labels belong to a customer email + selected business, not an
-- individual Shopify order, batch, physical NFC card, or Insights entitlement.
-- The location: fallback distinguishes manual locations without a Place ID.
CREATE TABLE crm_customer_labels (
  business_identity TEXT NOT NULL,
  customer_email TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL CHECK (status IN ('active', 'cancel', 'test')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (business_identity, customer_email)
);

CREATE INDEX crm_customer_labels_status_idx ON crm_customer_labels(status, updated_at DESC);

-- Shopify's verified orders/paid handler is the only current code path which
-- sets customer_email on a non-manual Shopify provisioning batch. When the
-- same email + Google listing buys physical cards again after a cancellation,
-- re-activate that CRM label without touching any old orders or card URLs.
-- Do not change Test labels or reactivate for CTV/manual provisions.
CREATE TRIGGER crm_reactivate_after_paid_shopify_order
AFTER UPDATE OF customer_email ON provisioning_batches
WHEN NEW.customer_email IS NOT NULL
  AND NEW.source = 'admin_shopify'
  AND NEW.external_order_reference NOT LIKE 'MANUAL-%'
BEGIN
  UPDATE crm_customer_labels
  SET status = 'active', updated_at = NEW.created_at
  WHERE business_identity = (
    SELECT COALESCE(NULLIF(TRIM(l.google_place_id), ''), 'location:' || l.id)
    FROM locations l WHERE l.id = NEW.location_id
  )
    AND customer_email = LOWER(TRIM(NEW.customer_email))
    AND status = 'cancel'
    AND updated_at < NEW.created_at;
END;
