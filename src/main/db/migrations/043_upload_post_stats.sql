-- Account level numbers per channel and platform, read through Upload-Post. One row per day, so changes can be shown.
CREATE TABLE IF NOT EXISTS up_account_stats (
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  day TEXT NOT NULL,
  fetched_at_utc TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  error TEXT,
  PRIMARY KEY (brand_id, platform, day)
);

-- Who follows a channel and when they are online (TikTok), kept as Upload-Post sent it.
CREATE TABLE IF NOT EXISTS up_audience (
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  fetched_at_utc TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (brand_id, platform)
);
