ALTER TABLE brand_defaults ADD COLUMN youtube_append_shorts INTEGER NOT NULL DEFAULT 0;

-- Estimated YouTube API quota use per Pacific day. Two buckets: video uploads and everything else.
CREATE TABLE youtube_quota (
  day_pt TEXT NOT NULL,
  bucket TEXT NOT NULL CHECK (bucket IN ('uploads','other')),
  used INTEGER NOT NULL DEFAULT 0,
  warned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day_pt, bucket)
);
