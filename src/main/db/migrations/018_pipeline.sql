-- Bot pipeline: drops, channel rules, audit events, reconcile issues, and the fields a pipeline post carries.
ALTER TABLE posts ADD COLUMN episode_ref TEXT;
ALTER TABLE posts ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE posts ADD COLUMN checksum TEXT;
ALTER TABLE posts ADD COLUMN hold_reason TEXT;
ALTER TABLE posts ADD COLUMN sidecar_title TEXT;
ALTER TABLE posts ADD COLUMN source_bot TEXT;
ALTER TABLE posts ADD COLUMN video_basename TEXT;
-- One post per channel and episode (a canceled one does not count, so it can be dropped again).
CREATE UNIQUE INDEX idx_posts_episode_ref ON posts(brand_id, episode_ref)
  WHERE episode_ref IS NOT NULL AND status != 'canceled';

CREATE TABLE drops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drop_id TEXT NOT NULL UNIQUE,
  received_at TEXT NOT NULL,
  source_bot TEXT,
  file_name TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  file_size INTEGER,
  sha256 TEXT,
  brand_id INTEGER,
  channel TEXT,
  episode_id TEXT,
  title TEXT,
  sidecar_valid INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL CHECK (result IN ('accepted','rejected','duplicate','held')),
  reason TEXT,
  scheduled_slot TEXT,
  post_id INTEGER,
  approved_by TEXT,
  approved_at TEXT,
  render_json TEXT,
  notes TEXT
);
CREATE INDEX idx_drops_received ON drops(received_at);
CREATE INDEX idx_drops_sha ON drops(sha256);

-- Rules that belong to one channel. Daily cap 0 means no cap.
CREATE TABLE channel_rules (
  brand_id INTEGER PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  max_per_day INTEGER NOT NULL DEFAULT 1,
  blackout_json TEXT NOT NULL DEFAULT '[]',
  low_queue_days INTEGER,
  min_seconds INTEGER,
  max_seconds INTEGER
);
INSERT INTO channel_rules (brand_id) SELECT id FROM brands;

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  before_json TEXT,
  after_json TEXT
);
CREATE INDEX idx_audit_events_at ON audit_events(at);

CREATE TABLE reconcile_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  brand_id INTEGER,
  post_id INTEGER,
  detail TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  resolved_at TEXT,
  notified INTEGER NOT NULL DEFAULT 0
);

-- Pipeline channels start with Inbox watching and automatic scheduling on. An install that already chose keeps its choice.
INSERT OR IGNORE INTO settings (key, value_json)
SELECT 'inboxAutoScheduleBrandIds', (SELECT json_group_array(id) FROM brands);
INSERT OR IGNORE INTO settings (key, value_json)
SELECT 'inboxBrandIds', (SELECT json_group_array(id) FROM brands);
