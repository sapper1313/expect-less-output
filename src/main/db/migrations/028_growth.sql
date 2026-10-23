-- Growth features: staggered posting, topic tags, pinned comments, thumbnail variants, learnings, early checks, viewer questions.
ALTER TABLE post_targets ADD COLUMN stagger_offset_min INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN topic TEXT;
ALTER TABLE posts ADD COLUMN pinned_comment TEXT;
ALTER TABLE posts ADD COLUMN community_poll TEXT;
ALTER TABLE posts ADD COLUMN thumb_variants_json TEXT;
ALTER TABLE posts ADD COLUMN loudness_json TEXT;

CREATE TABLE learnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER,
  post_id INTEGER NOT NULL,
  episode_ref TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (post_id, kind)
);

CREATE TABLE velocity_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_target_id INTEGER NOT NULL REFERENCES post_targets(id) ON DELETE CASCADE,
  hour INTEGER NOT NULL,
  views INTEGER,
  baseline_mean REAL,
  flagged INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  checked_at TEXT NOT NULL,
  UNIQUE (post_target_id, hour)
);

CREATE TABLE fan_ideas (
  comment_id TEXT PRIMARY KEY,
  brand_id INTEGER NOT NULL,
  post_id INTEGER,
  author TEXT,
  text TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  upcoming_episode_id TEXT,
  created_at TEXT NOT NULL
);
