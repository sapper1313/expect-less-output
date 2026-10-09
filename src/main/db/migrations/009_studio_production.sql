-- Autonomous Studio, Phase 3: video jobs (resumable, never paid twice) and brand assets.

CREATE TABLE video_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id TEXT NOT NULL,
  brand_id INTEGER NOT NULL,
  clip_n INTEGER NOT NULL,
  take INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','started','downloaded','passed','failed','expired','flagged','approved','discarded')),
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  resolution TEXT NOT NULL,
  aspect TEXT NOT NULL,
  generate_seconds REAL NOT NULL,
  keep_seconds REAL NOT NULL,
  request_id TEXT,
  file_path TEXT,
  image_ref TEXT,
  purpose TEXT NOT NULL DEFAULT 'first take',
  qc_json TEXT,
  error TEXT,
  created_utc TEXT NOT NULL,
  updated_utc TEXT NOT NULL,
  UNIQUE (episode_id, clip_n, take)
);
CREATE INDEX idx_video_jobs_status ON video_jobs(status);
CREATE INDEX idx_video_jobs_episode ON video_jobs(episode_id);

-- Reference images, voice references and the shared opening and outro for each brand.
CREATE TABLE brand_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('opening','outro','reference_image','voice_reference')),
  path TEXT NOT NULL,
  prompt TEXT,
  description TEXT,
  created_utc TEXT NOT NULL
);
CREATE INDEX idx_brand_assets ON brand_assets(brand_id, kind);
