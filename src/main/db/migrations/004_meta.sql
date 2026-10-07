ALTER TABLE brand_defaults ADD COLUMN instagram_share_to_feed INTEGER NOT NULL DEFAULT 1;

-- One Meta login for everything. The long-lived user token itself lives in the secret store.
CREATE TABLE meta_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','needs_reauth')),
  token_expires_at TEXT,
  data_access_expires_at TEXT,
  granted_scopes TEXT NOT NULL DEFAULT '',
  connected_at TEXT NOT NULL,
  last_alert_day TEXT
);

-- Every Page this login can manage, with its linked Instagram account. Page tokens live in the secret store.
CREATE TABLE meta_pages (
  page_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  picture_url TEXT,
  ig_id TEXT,
  ig_username TEXT,
  ig_picture_url TEXT,
  updated_at TEXT NOT NULL
);

-- API publishes, used to respect Facebook's 30 Reels per Page per 24 hours.
CREATE TABLE meta_publishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL,
  ts_utc TEXT NOT NULL
);
CREATE INDEX idx_meta_publishes ON meta_publishes(page_id, ts_utc);
