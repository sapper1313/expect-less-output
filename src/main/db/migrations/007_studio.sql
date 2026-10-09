-- Autonomous Studio, Phase 1: per brand studio settings, spend ledger, agent framework, episode library.

-- One JSON document per brand (format, cadence, platforms, flags, caps). Brands stay data.
CREATE TABLE studio_brands (
  brand_id INTEGER PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  config_json TEXT NOT NULL
);

-- Every paid call, real or mock. Mock rows never count against caps.
CREATE TABLE spend_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_utc TEXT NOT NULL,
  month_et TEXT NOT NULL,
  brand_id INTEGER,
  episode_id TEXT,
  task_id INTEGER,
  vendor TEXT NOT NULL CHECK (vendor IN ('xai','anthropic')),
  model TEXT NOT NULL DEFAULT '',
  resolution TEXT,
  units REAL NOT NULL DEFAULT 0,
  unit_kind TEXT NOT NULL DEFAULT 'seconds' CHECK (unit_kind IN ('seconds','images','tokens')),
  unit_price REAL NOT NULL DEFAULT 0,
  dollars REAL NOT NULL DEFAULT 0,
  request_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'ok',
  purpose TEXT NOT NULL DEFAULT 'first take',
  mock INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_spend_month ON spend_ledger(month_et, mock);
CREATE INDEX idx_spend_brand ON spend_ledger(brand_id, month_et);
CREATE INDEX idx_spend_episode ON spend_ledger(episode_id);
-- A resumed job must not be paid for twice.
CREATE UNIQUE INDEX idx_spend_request ON spend_ledger(vendor, request_id, purpose) WHERE request_id IS NOT NULL;

-- Which cap thresholds were already announced this month (50, 80, 100), and cap stops already announced today.
CREATE TABLE spend_alerts (
  period TEXT NOT NULL,
  cap_key TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  ts_utc TEXT NOT NULL,
  PRIMARY KEY (period, cap_key, threshold)
);

CREATE TABLE agent_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  brand_id INTEGER,
  episode_id TEXT,
  parent_id INTEGER,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','waiting','done','failed','stopped','flagged')),
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  error TEXT,
  dedupe_key TEXT,
  not_before_utc TEXT,
  created_utc TEXT NOT NULL,
  started_utc TEXT,
  finished_utc TEXT
);
CREATE INDEX idx_tasks_status ON agent_tasks(status, not_before_utc);
CREATE INDEX idx_tasks_brand ON agent_tasks(brand_id, type);
CREATE UNIQUE INDEX idx_tasks_dedupe ON agent_tasks(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running','waiting');

CREATE TABLE agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_utc TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  prompt_hash TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  dollars REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'ok',
  task_id INTEGER,
  brand_id INTEGER,
  mock INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_utc TEXT NOT NULL,
  brand_id INTEGER,
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  task_id INTEGER,
  episode_id TEXT,
  detail_json TEXT
);
CREATE INDEX idx_audit_ts ON audit_log(ts_utc);
CREATE INDEX idx_audit_brand ON audit_log(brand_id, agent);

-- Episode index. The full package is a .json.gz file. Rows are never deleted.
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  series TEXT NOT NULL DEFAULT '',
  number INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Idea',
  tags TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'studio',
  slot_date TEXT,
  scheduled_at_utc TEXT,
  posted_at_utc TEXT,
  post_id INTEGER,
  package_path TEXT,
  preview_path TEXT,
  video_path TEXT,
  thumb_path TEXT,
  media_purged_at TEXT,
  flagged_reason TEXT,
  embedding_json TEXT,
  created_utc TEXT NOT NULL,
  updated_utc TEXT NOT NULL
);
CREATE INDEX idx_episodes_brand ON episodes(brand_id, status);
CREATE INDEX idx_episodes_slot ON episodes(brand_id, slot_date);

-- The tiny row kept forever after the video and full size thumbnail are purged.
CREATE TABLE stats_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  post_id INTEGER,
  episode_id TEXT,
  posted_at_utc TEXT,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  ctr REAL,
  avg_view_seconds REAL,
  thumbnail_variant TEXT,
  archived_utc TEXT NOT NULL,
  UNIQUE (post_id, platform)
);

-- Set when the video file was removed by retention. The post row stays so its stats stay.
ALTER TABLE posts ADD COLUMN media_purged_at TEXT;
