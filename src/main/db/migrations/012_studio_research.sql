-- Research, retention, chapters and captions, re-posts. Studio round two.

CREATE TABLE competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,
  channel_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  subscribers INTEGER,
  videos_json TEXT NOT NULL DEFAULT '[]',
  checked_utc TEXT,
  created_utc TEXT NOT NULL,
  UNIQUE (brand_id, handle)
);

CREATE TABLE trend_cache (
  brand_id INTEGER PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  videos_json TEXT NOT NULL,
  fetched_utc TEXT NOT NULL
);

CREATE TABLE video_retention (
  post_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  video_id TEXT NOT NULL,
  fetched_utc TEXT NOT NULL,
  minutes_watched REAL,
  avg_view_seconds REAL,
  avg_view_percent REAL,
  curve_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (post_id, platform)
);

CREATE TABLE episode_chapters (
  episode_id TEXT PRIMARY KEY,
  chapters_json TEXT NOT NULL,
  created_utc TEXT NOT NULL
);

CREATE TABLE episode_captions (
  episode_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  srt TEXT NOT NULL,
  created_utc TEXT NOT NULL,
  PRIMARY KEY (episode_id, lang)
);

CREATE TABLE repost_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_post_id INTEGER NOT NULL,
  brand_id INTEGER NOT NULL,
  platforms TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','scheduled','skipped')),
  new_post_id INTEGER,
  note TEXT,
  created_utc TEXT NOT NULL
);
