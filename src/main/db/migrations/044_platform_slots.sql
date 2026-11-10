-- Posting times per platform. A channel has, for each platform and each kind (Shorts or Long form), its own weekday and
-- weekend times. brand_slots stays as the channel's combined view (the earliest time of each position across platforms),
-- which the Home week map and the bots read.
CREATE TABLE IF NOT EXISTS brand_platform_slots (
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('short','long')),
  day_type TEXT NOT NULL CHECK (day_type IN ('weekday','weekend')),
  time_local TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (brand_id, platform, kind, day_type, time_local)
);
CREATE INDEX IF NOT EXISTS idx_bps_brand ON brand_platform_slots(brand_id);

-- Each target may have its own absolute time. Null means it follows the post's time (plus its small stagger).
ALTER TABLE post_targets ADD COLUMN target_at_utc TEXT;

-- Every platform that a kind posts to (ticked, or not switched off) gets the channel's current times for that kind.
INSERT OR IGNORE INTO brand_platform_slots (brand_id, platform, kind, day_type, time_local, enabled)
SELECT s.brand_id, p.platform, s.kind, s.day_type, s.time_local, s.enabled
FROM brand_slots s
CROSS JOIN (SELECT 'youtube' AS platform UNION ALL SELECT 'instagram' UNION ALL SELECT 'facebook'
            UNION ALL SELECT 'tiktok' UNION ALL SELECT 'bluesky') p
LEFT JOIN brand_slot_kinds k ON k.brand_id = s.brand_id AND k.kind = s.kind
WHERE k.platforms IS NULL OR COALESCE(json_extract(k.platforms, '$.' || p.platform), 1) != 0;
