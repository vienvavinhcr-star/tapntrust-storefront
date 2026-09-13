PRAGMA foreign_keys = ON;

ALTER TABLE customer_users ADD COLUMN nickname TEXT;
ALTER TABLE customer_users ADD COLUMN nickname_prompt_dismissed_at TEXT;
ALTER TABLE customer_users ADD COLUMN onboarding_dismissed_at TEXT;

CREATE TABLE customer_dashboard_visits (
  user_id TEXT NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  last_visited_at TEXT NOT NULL,
  PRIMARY KEY (user_id, location_id)
);

CREATE INDEX customer_dashboard_visits_location_idx
  ON customer_dashboard_visits (location_id, last_visited_at DESC);
