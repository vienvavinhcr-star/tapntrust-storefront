PRAGMA foreign_keys = ON;

CREATE TABLE customer_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE customer_business_access (
  user_id TEXT NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, business_id)
);

CREATE TABLE auth_magic_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE customer_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE auth_request_limits (
  identifier_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  last_allowed_at TEXT NOT NULL
);

CREATE INDEX customer_business_access_business_idx
  ON customer_business_access (business_id, user_id);
CREATE INDEX auth_magic_links_user_created_idx
  ON auth_magic_links (user_id, created_at DESC);
CREATE INDEX auth_magic_links_expiry_idx
  ON auth_magic_links (expires_at);
CREATE INDEX customer_sessions_user_idx
  ON customer_sessions (user_id);
CREATE INDEX customer_sessions_expiry_idx
  ON customer_sessions (expires_at);
CREATE INDEX auth_request_limits_window_idx
  ON auth_request_limits (window_started_at);
