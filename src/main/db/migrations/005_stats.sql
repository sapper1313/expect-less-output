CREATE INDEX IF NOT EXISTS idx_post_stats_target ON post_stats(post_target_id, fetched_at_utc);

-- Whether stats can be read for a posted target, and why not when they cannot.
CREATE TABLE stats_availability (
  post_target_id INTEGER PRIMARY KEY REFERENCES post_targets(id) ON DELETE CASCADE,
  available INTEGER NOT NULL,
  reason TEXT,
  checked_at TEXT NOT NULL
);
