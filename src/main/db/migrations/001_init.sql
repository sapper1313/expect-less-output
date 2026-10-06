CREATE TABLE brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE brand_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  day_type TEXT NOT NULL CHECK (day_type IN ('weekday','weekend')),
  time_local TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_brand_slots_brand ON brand_slots(brand_id);

CREATE TABLE hashtag_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tags_text TEXT NOT NULL DEFAULT ''
);

CREATE TABLE brand_defaults (
  brand_id INTEGER PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  caption_template TEXT NOT NULL DEFAULT '{title}\n\n{hashtags}',
  default_hashtag_set_id INTEGER REFERENCES hashtag_sets(id) ON DELETE SET NULL,
  youtube_category_id TEXT NOT NULL DEFAULT '28',
  youtube_made_for_kids INTEGER NOT NULL DEFAULT 0,
  youtube_playlist_id TEXT,
  ai_flag_youtube INTEGER NOT NULL DEFAULT 0,
  ai_flag_tiktok INTEGER NOT NULL DEFAULT 0,
  ai_flag_facebook INTEGER NOT NULL DEFAULT 0,
  ai_flag_instagram INTEGER NOT NULL DEFAULT 0,
  tiktok_privacy_default TEXT,
  tiktok_allow_comments INTEGER NOT NULL DEFAULT 1,
  tiktok_allow_duet INTEGER NOT NULL DEFAULT 0,
  tiktok_allow_stitch INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube','facebook','instagram','tiktok')),
  external_id TEXT,
  display_name TEXT,
  avatar_url TEXT,
  token_ref TEXT,
  token_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','needs_reauth','error')),
  mode TEXT NOT NULL DEFAULT 'dry_run',
  last_checked_at TEXT,
  UNIQUE (brand_id, platform)
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  video_path TEXT NOT NULL,
  video_meta_json TEXT NOT NULL DEFAULT '{}',
  poster_path TEXT,
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  scheduled_at_utc TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','scheduled','in_progress','partial','posted','failed','missed','canceled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_posts_brand_time ON posts(brand_id, scheduled_at_utc);
CREATE INDEX idx_posts_status ON posts(status);

CREATE TABLE post_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube','facebook','instagram','tiktok')),
  account_id INTEGER REFERENCES accounts(id),
  caption_override TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  ai_flag INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','handed_off','uploading','processing','posted','needs_action','failed','skipped')),
  external_id TEXT,
  external_url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_utc TEXT,
  last_error TEXT,
  handed_off_at_utc TEXT,
  posted_at_utc TEXT,
  locked_at_utc TEXT,
  lock_token TEXT,
  UNIQUE (post_id, platform)
);
CREATE INDEX idx_targets_post ON post_targets(post_id);
CREATE INDEX idx_targets_status ON post_targets(status);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  level TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  post_id INTEGER,
  platform TEXT,
  message TEXT NOT NULL,
  detail_json TEXT
);
CREATE INDEX idx_log_ts ON activity_log(ts_utc);

CREATE TABLE post_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_target_id INTEGER NOT NULL REFERENCES post_targets(id) ON DELETE CASCADE,
  fetched_at_utc TEXT NOT NULL,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  extra_json TEXT
);
