-- Comments on posted videos, read through Upload-Post for platforms ticked on the channel's Upload-Post card.
CREATE TABLE IF NOT EXISTS inbox_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  post_id INTEGER,
  target_id INTEGER,
  platform TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  commented_at_utc TEXT,
  -- new, replied, done, or mine (the channel's own first comment)
  status TEXT NOT NULL DEFAULT 'new',
  reply_text TEXT,
  replied_at_utc TEXT,
  fetched_at_utc TEXT NOT NULL,
  UNIQUE (platform, comment_id)
);
CREATE INDEX IF NOT EXISTS idx_inbox_comments_status ON inbox_comments (status, commented_at_utc);

-- When each posted target was last checked for comments.
CREATE TABLE IF NOT EXISTS inbox_sync (
  target_id INTEGER PRIMARY KEY REFERENCES post_targets(id) ON DELETE CASCADE,
  last_at_utc TEXT NOT NULL,
  last_error TEXT
);
