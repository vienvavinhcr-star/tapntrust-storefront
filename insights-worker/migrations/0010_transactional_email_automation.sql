PRAGMA foreign_keys = ON;

CREATE TABLE transactional_email_deliveries (
  id TEXT PRIMARY KEY,
  provider_order_reference TEXT NOT NULL,
  email_kind TEXT NOT NULL
    CHECK (email_kind IN ('quick_setup', 'insights_welcome')),
  state TEXT NOT NULL
    CHECK (state IN ('accepted', 'tagged')),
  resend_email_id TEXT,
  accepted_at TEXT,
  tagged_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_order_reference, email_kind)
);

CREATE INDEX transactional_email_deliveries_state_time_idx
  ON transactional_email_deliveries (state, updated_at DESC);
