-- The public website (expectlessmedia.com) shows one card per channel. These rows are what ELO knows about each card.
-- add_to_site is the "Add to website?" check mark. dirty means ELO has a change the site does not have yet.
CREATE TABLE website_profiles (
  brand_id INTEGER PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  add_to_site INTEGER NOT NULL DEFAULT 0,
  site_slug TEXT,
  title TEXT NOT NULL DEFAULT '',
  host TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  youtube_channel_id TEXT NOT NULL DEFAULT '',
  youtube_handle TEXT NOT NULL DEFAULT '',
  links_json TEXT NOT NULL DEFAULT '{}',
  accent TEXT NOT NULL DEFAULT '',
  hero_image TEXT NOT NULL DEFAULT '',
  hero_local TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT
);

CREATE TABLE website_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
