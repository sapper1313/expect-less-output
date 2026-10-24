-- More platforms: Bluesky, X, LinkedIn, Pinterest and Snapchat join the original four.
-- SQLite cannot change a CHECK in place, so the two tables are rebuilt with their rows copied across.
-- The migration runner switches foreign keys off for this (the standard way to rebuild a table).
CREATE TABLE accounts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube','facebook','instagram','tiktok','bluesky','x','linkedin','pinterest','snapchat')),
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
INSERT INTO accounts_new (id, brand_id, platform, external_id, display_name, avatar_url, token_ref, token_expires_at, status, mode, last_checked_at)
  SELECT id, brand_id, platform, external_id, display_name, avatar_url, token_ref, token_expires_at, status, mode, last_checked_at FROM accounts;
DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

CREATE TABLE post_targets_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube','facebook','instagram','tiktok','bluesky','x','linkedin','pinterest','snapchat')),
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
  stagger_offset_min INTEGER NOT NULL DEFAULT 0,
  UNIQUE (post_id, platform)
);
INSERT INTO post_targets_new (id, post_id, platform, account_id, caption_override, settings_json, ai_flag, status, external_id, external_url, attempts, next_attempt_at_utc, last_error, handed_off_at_utc, posted_at_utc, locked_at_utc, lock_token, stagger_offset_min)
  SELECT id, post_id, platform, account_id, caption_override, settings_json, ai_flag, status, external_id, external_url, attempts, next_attempt_at_utc, last_error, handed_off_at_utc, posted_at_utc, locked_at_utc, lock_token, stagger_offset_min FROM post_targets;
DROP TABLE post_targets;
ALTER TABLE post_targets_new RENAME TO post_targets;
CREATE INDEX idx_targets_post ON post_targets(post_id);
CREATE INDEX idx_targets_status ON post_targets(status);
