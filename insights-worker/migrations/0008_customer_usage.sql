PRAGMA foreign_keys = ON;

CREATE TABLE customer_usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('dashboard_open', 'google_summary', 'google_reviews')),
  outcome TEXT NOT NULL,
  provider_called INTEGER NOT NULL DEFAULT 0 CHECK (provider_called IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX customer_usage_events_user_time_idx
  ON customer_usage_events (user_id, created_at DESC);
CREATE INDEX customer_usage_events_location_time_idx
  ON customer_usage_events (location_id, created_at DESC);
CREATE INDEX customer_usage_events_type_time_idx
  ON customer_usage_events (event_type, created_at DESC);
CREATE INDEX customer_usage_events_user_type_time_idx
  ON customer_usage_events (user_id, event_type, created_at DESC);
