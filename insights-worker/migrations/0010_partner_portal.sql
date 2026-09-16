PRAGMA foreign_keys = ON;

-- Partner identities never reuse customer Insights sessions or the owner admin token.
CREATE TABLE sales_partners (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended','revoked')),
  tier TEXT NOT NULL DEFAULT 'silver' CHECK (tier IN ('silver','gold','diamond')),
  allowance_total INTEGER NOT NULL DEFAULT 0 CHECK (allowance_total >= 0),
  provisioned_count INTEGER NOT NULL DEFAULT 0 CHECK (provisioned_count >= 0 AND provisioned_count <= allowance_total),
  provision_enabled INTEGER NOT NULL DEFAULT 1 CHECK (provision_enabled IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE partner_magic_links (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES sales_partners(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX partner_magic_links_partner_idx ON partner_magic_links(partner_id, created_at DESC);

CREATE TABLE partner_sessions (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES sales_partners(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX partner_sessions_partner_idx ON partner_sessions(partner_id);

CREATE TABLE partner_inventory_events (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES sales_partners(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('set','add')),
  adjustment INTEGER NOT NULL,
  previous_total INTEGER NOT NULL,
  new_total INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL
);
CREATE INDEX partner_inventory_events_partner_idx ON partner_inventory_events(partner_id, created_at DESC);

CREATE TABLE partner_tier_events (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES sales_partners(id) ON DELETE RESTRICT,
  previous_tier TEXT NOT NULL,
  new_tier TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL
);
CREATE INDEX partner_tier_events_partner_idx ON partner_tier_events(partner_id, created_at DESC);

CREATE TABLE partner_account_events (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES sales_partners(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL
);

-- Batch ID points at the original immutable card tokens and programming manifest.
CREATE TABLE partner_provisionings (
  batch_id TEXT PRIMARY KEY REFERENCES provisioning_batches(id) ON DELETE RESTRICT,
  partner_id TEXT NOT NULL REFERENCES sales_partners(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0,1)),
  google_place_id TEXT NOT NULL,
  physical_card_count INTEGER NOT NULL CHECK (physical_card_count BETWEEN 1 AND 100),
  created_at TEXT NOT NULL,
  UNIQUE(partner_id, request_id)
);
CREATE INDEX partner_provisionings_partner_idx ON partner_provisionings(partner_id, created_at DESC);

-- D1.batch is transactional. The last attribution insert checks and debits allowance
-- in the same transaction as the original business/location/batch/cards inserts.
CREATE TRIGGER partner_provisioning_guard BEFORE INSERT ON partner_provisionings
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sales_partners p
    WHERE p.id = NEW.partner_id AND p.status = 'active' AND p.provision_enabled = 1
      AND p.allowance_total - p.provisioned_count >= NEW.physical_card_count
  ) THEN RAISE(ABORT, 'partner_quota_exceeded') END;
END;
CREATE TRIGGER partner_provisioning_debit AFTER INSERT ON partner_provisionings
BEGIN
  UPDATE sales_partners SET provisioned_count = provisioned_count + NEW.physical_card_count,
    updated_at = NEW.created_at WHERE id = NEW.partner_id;
END;

CREATE TABLE partner_activity (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES sales_partners(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN ('business_search','business_selected','cards_provisioned')),
  search_query TEXT,
  business_name TEXT,
  google_place_id TEXT,
  batch_id TEXT REFERENCES provisioning_batches(id) ON DELETE RESTRICT,
  physical_card_count INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX partner_activity_partner_time_idx ON partner_activity(partner_id, created_at DESC);
CREATE INDEX partner_activity_time_idx ON partner_activity(created_at DESC);
