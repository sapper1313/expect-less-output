-- A first comment per post (a question or call to action), posted right after the video goes live.
-- A platform can have its own text in the target's settings (firstComment). Otherwise the post's text is used.
ALTER TABLE posts ADD COLUMN first_comment TEXT;

-- One row per target that has a first comment to send. status: waiting, done, failed, skipped.
CREATE TABLE IF NOT EXISTS first_comment_jobs (
  target_id INTEGER PRIMARY KEY REFERENCES post_targets(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at_utc TEXT,
  last_error TEXT,
  done_at_utc TEXT
);
