PRAGMA foreign_keys = ON;

ALTER TABLE insights_subscriptions ADD COLUMN last_access_billing_event_id TEXT;
ALTER TABLE insights_subscriptions ADD COLUMN access_period_started_at TEXT;
ALTER TABLE insights_subscriptions ADD COLUMN access_paid_through_at TEXT;
ALTER TABLE insights_subscriptions ADD COLUMN grace_started_at TEXT;
ALTER TABLE insights_subscriptions ADD COLUMN grace_ends_at TEXT;
ALTER TABLE insights_subscriptions ADD COLUMN cancel_requested_at TEXT;
ALTER TABLE insights_subscriptions ADD COLUMN cancel_confirmed_at TEXT;
ALTER TABLE insights_subscriptions ADD COLUMN cancelled_at TEXT;
ALTER TABLE insights_subscriptions ADD COLUMN expired_at TEXT;
ALTER TABLE insights_subscriptions ADD COLUMN lifecycle_reason TEXT;

CREATE TABLE insights_cancellation_requests (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES insights_subscriptions(id) ON DELETE RESTRICT,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  customer_user_id TEXT NOT NULL REFERENCES customer_users(id) ON DELETE RESTRICT,
  customer_email TEXT NOT NULL COLLATE NOCASE,
  reason TEXT NOT NULL CHECK (reason IN (
    'Too expensive',
    'Not using it enough',
    'Did not see enough value',
    'Business closed or paused',
    'Switching to another solution',
    'Other'
  )),
  note TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'provider_cancelled', 'withdrawn', 'resolved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT
);

CREATE UNIQUE INDEX insights_cancellation_requests_open_idx
  ON insights_cancellation_requests (subscription_id)
  WHERE status = 'open';

CREATE INDEX insights_cancellation_requests_customer_idx
  ON insights_cancellation_requests (customer_user_id, created_at DESC);
CREATE INDEX insights_cancellation_requests_status_idx
  ON insights_cancellation_requests (status, created_at ASC);

CREATE TABLE insights_subscription_lifecycle_events (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES insights_subscriptions(id) ON DELETE RESTRICT,
  source_billing_event_id TEXT REFERENCES insights_billing_events(id) ON DELETE RESTRICT,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 64),
  provider_reference TEXT,
  amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency TEXT,
  occurred_at TEXT NOT NULL,
  result TEXT NOT NULL,
  applied_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX insights_subscription_lifecycle_events_subscription_idx
  ON insights_subscription_lifecycle_events (subscription_id, occurred_at DESC);
CREATE INDEX insights_subscription_lifecycle_events_type_idx
  ON insights_subscription_lifecycle_events (event_type, occurred_at DESC);

CREATE INDEX insights_subscriptions_lifecycle_paid_idx
  ON insights_subscriptions (status, access_paid_through_at);
CREATE INDEX insights_subscriptions_lifecycle_grace_idx
  ON insights_subscriptions (status, grace_ends_at);

-- Phase 4A intentionally did not claim an authoritative provider billing period.
-- Existing rows remain NULL until a verified payment is processed under Phase 4B.
