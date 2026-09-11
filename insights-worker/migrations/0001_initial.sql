PRAGMA foreign_keys = ON;

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  business_name TEXT NOT NULL,
  business_address TEXT NOT NULL DEFAULT '',
  google_place_id TEXT NOT NULL DEFAULT '',
  google_review_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  public_token TEXT NOT NULL COLLATE NOCASE UNIQUE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  placement_type TEXT NOT NULL DEFAULT 'other'
    CHECK (placement_type IN ('counter', 'table', 'reception', 'register', 'other')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE tap_events (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  tapped_at TEXT NOT NULL
);

CREATE INDEX locations_business_id_idx ON locations (business_id);
CREATE INDEX cards_location_id_idx ON cards (location_id);
CREATE INDEX tap_events_card_time_idx ON tap_events (card_id, tapped_at DESC);
CREATE INDEX tap_events_time_idx ON tap_events (tapped_at DESC);
