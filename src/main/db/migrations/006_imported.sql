-- Videos that were already on a channel before this app posted anything (Phase 7 extra).
CREATE TABLE imported_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube','facebook','instagram','tiktok')),
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  url TEXT,
  thumbnail_url TEXT,
  published_at_utc TEXT,
  imported_at_utc TEXT NOT NULL,
  UNIQUE (platform, external_id)
);
CREATE INDEX idx_imported_brand ON imported_videos(brand_id, published_at_utc);

CREATE TABLE imported_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_id INTEGER NOT NULL REFERENCES imported_videos(id) ON DELETE CASCADE,
  fetched_at_utc TEXT NOT NULL,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  extra_json TEXT
);
CREATE INDEX idx_imported_stats ON imported_stats(imported_id, fetched_at_utc);

CREATE TABLE imported_availability (
  imported_id INTEGER PRIMARY KEY REFERENCES imported_videos(id) ON DELETE CASCADE,
  available INTEGER NOT NULL,
  reason TEXT,
  checked_at TEXT NOT NULL
);
