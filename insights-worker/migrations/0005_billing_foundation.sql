PRAGMA foreign_keys = ON;

CREATE TABLE insights_subscriptions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('shopify')),
  billing_email TEXT NOT NULL COLLATE NOCASE,
  provider_customer_reference TEXT,
  provider_subscription_reference TEXT,
  external_setup_reference TEXT NOT NULL,
  first_provider_order_reference TEXT NOT NULL,
  most_recent_provider_order_reference TEXT NOT NULL,
  plan_code TEXT NOT NULL CHECK (plan_code IN ('intro', 'standard')),
  status TEXT NOT NULL CHECK (status IN (
    'active',
    'review',
    'cancel_at_period_end',
    'grace',
    'past_due',
    'cancelled',
    'expired'
  )),
  currency TEXT NOT NULL,
  expected_intro_price_minor INTEGER NOT NULL CHECK (expected_intro_price_minor >= 0),
  expected_recurring_price_minor INTEGER NOT NULL CHECK (expected_recurring_price_minor >= 0),
  started_at TEXT NOT NULL,
  last_paid_at TEXT NOT NULL,
  expected_next_billing_at TEXT,
  current_period_started_at TEXT NOT NULL,
  current_period_ends_at TEXT,
  review_required INTEGER NOT NULL DEFAULT 0 CHECK (review_required IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, location_id)
);

CREATE TABLE shopify_webhook_receipts (
  webhook_id TEXT PRIMARY KEY,
  event_id TEXT,
  topic TEXT NOT NULL,
  shop_domain TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  result TEXT NOT NULL,
  UNIQUE (shop_domain, topic, event_id)
);

CREATE TABLE insights_billing_events (
  id TEXT PRIMARY KEY,
  subscription_id TEXT REFERENCES insights_subscriptions(id) ON DELETE RESTRICT,
  source_event_id TEXT REFERENCES insights_billing_events(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('shopify')),
  provider_webhook_id TEXT NOT NULL,
  provider_event_id TEXT,
  provider_order_reference TEXT NOT NULL,
  provider_line_reference TEXT NOT NULL,
  external_order_reference TEXT NOT NULL,
  external_setup_reference TEXT,
  provider_customer_reference TEXT,
  provider_subscription_reference TEXT,
  billing_email TEXT COLLATE NOCASE,
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 64),
  plan_code TEXT CHECK (plan_code IN ('intro', 'standard')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, provider_order_reference, provider_line_reference, event_type),
  UNIQUE (source_event_id, event_type)
);

CREATE TABLE business_insights_intro_redemptions (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE RESTRICT,
  subscription_id TEXT NOT NULL REFERENCES insights_subscriptions(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('shopify')),
  provider_order_reference TEXT NOT NULL,
  billing_event_id TEXT NOT NULL UNIQUE REFERENCES insights_billing_events(id) ON DELETE RESTRICT,
  redeemed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX insights_subscriptions_business_idx
  ON insights_subscriptions (business_id, updated_at DESC);
CREATE INDEX insights_subscriptions_location_idx
  ON insights_subscriptions (location_id, updated_at DESC);
CREATE INDEX shopify_webhook_receipts_received_idx
  ON shopify_webhook_receipts (received_at DESC);
CREATE INDEX insights_billing_events_reconcile_idx
  ON insights_billing_events (event_type, result, external_setup_reference, created_at);
CREATE INDEX insights_billing_events_subscription_idx
  ON insights_billing_events (subscription_id, occurred_at DESC);
