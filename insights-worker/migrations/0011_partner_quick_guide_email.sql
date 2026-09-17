PRAGMA foreign_keys = ON;

-- Partner card setups already store the verified email in partner_provisionings.
-- Mirror it into the existing CRM email field for batches provisioned before this fix.
UPDATE provisioning_batches
SET customer_email = (
  SELECT pp.customer_email FROM partner_provisionings pp
  WHERE pp.batch_id = provisioning_batches.id
)
WHERE customer_email IS NULL
  AND id IN (SELECT batch_id FROM partner_provisionings);

-- Keep the existing CRM and email-action lookup working for future CTV batches.
-- This trigger runs in the same D1 transaction as partner provisioning.
CREATE TRIGGER partner_provisioning_customer_email
AFTER INSERT ON partner_provisionings
BEGIN
  UPDATE provisioning_batches
  SET customer_email = NEW.customer_email
  WHERE id = NEW.batch_id;
END;

-- CTV/manual batches do not have Shopify order tags. Track their Quick Guide
-- delivery independently and never create a fake Shopify order for them.
CREATE TABLE partner_quick_guide_sends (
  batch_id TEXT PRIMARY KEY REFERENCES partner_provisionings(batch_id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL COLLATE NOCASE,
  sent_at TEXT NOT NULL
);
