-- Autonomous Studio, Phase 5: analytics for Threads and Bluesky, brand insights, comment handling.

CREATE TABLE social_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  social_post_id INTEGER NOT NULL REFERENCES social_posts(id),
  fetched_utc TEXT NOT NULL,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER
);
CREATE INDEX idx_social_stats ON social_stats(social_post_id, fetched_utc);

-- What is working for each brand, computed from the numbers and summarized in plain words for the Writer.
CREATE TABLE brand_insights (
  brand_id INTEGER PRIMARY KEY,
  insights_json TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  updated_utc TEXT NOT NULL
);

CREATE TABLE comment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  episode_id TEXT,
  external_post_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','draft','replied','flagged','skipped','discarded','spam','failed')),
  reply_text TEXT,
  reply_id TEXT,
  reason TEXT,
  created_utc TEXT NOT NULL,
  replied_utc TEXT,
  UNIQUE (platform, comment_id)
);
CREATE INDEX idx_comments_status ON comment_items(brand_id, status);
