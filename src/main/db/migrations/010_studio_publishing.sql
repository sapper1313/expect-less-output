-- Autonomous Studio, Phase 4: thumbnail guidelines history, thumbnail A/B variants, Threads and Bluesky posts.

CREATE TABLE guideline_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_utc TEXT NOT NULL,
  text TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'owner'
);

-- One row per thumbnail shown on a posted video, with what it earned. Kept forever.
CREATE TABLE thumb_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id TEXT NOT NULL,
  post_id INTEGER,
  brand_id INTEGER NOT NULL,
  video_id TEXT,
  variant TEXT NOT NULL,
  file_path TEXT NOT NULL,
  headline TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  impressions INTEGER,
  ctr REAL,
  avg_view_seconds REAL,
  shown_from_utc TEXT,
  shown_until_utc TEXT,
  winner INTEGER NOT NULL DEFAULT 0,
  created_utc TEXT NOT NULL
);
CREATE INDEX idx_thumb_episode ON thumb_variants(episode_id);

CREATE TABLE thumb_tests (
  episode_id TEXT PRIMARY KEY,
  brand_id INTEGER NOT NULL,
  video_id TEXT,
  account_id INTEGER,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running_a','running_b','done','skipped')),
  started_utc TEXT,
  swap_after_utc TEXT,
  finish_after_utc TEXT,
  note TEXT,
  extensions INTEGER NOT NULL DEFAULT 0
);

-- Threads and Bluesky are not platforms the scheduler knows, so their posts live here.
CREATE TABLE social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id TEXT,
  brand_id INTEGER NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('threads','bluesky')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','posting','posted','failed','skipped')),
  text TEXT NOT NULL,
  video_path TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  scheduled_at_utc TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_utc TEXT,
  external_id TEXT,
  external_url TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  mock INTEGER NOT NULL DEFAULT 0,
  created_utc TEXT NOT NULL,
  posted_utc TEXT
);
CREATE INDEX idx_social_due ON social_posts(status, scheduled_at_utc);
