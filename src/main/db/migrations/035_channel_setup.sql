-- Setup Channels: a channel can post Shorts, Long form, or both. Each posting time belongs to one kind.
-- Every time that exists today is copied to both kinds, so nothing about where a post lands changes until Josh edits.
ALTER TABLE brand_slots ADD COLUMN kind TEXT NOT NULL DEFAULT 'short' CHECK (kind IN ('short','long'));
INSERT INTO brand_slots (brand_id, day_type, time_local, enabled, kind)
  SELECT brand_id, day_type, time_local, enabled, 'long' FROM brand_slots;

-- Which kinds a channel makes, and the days each kind posts on (JSON list of ISO weekdays, null means the channel's usual days).
CREATE TABLE brand_slot_kinds (
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('short','long')),
  enabled INTEGER NOT NULL DEFAULT 1,
  days TEXT,
  PRIMARY KEY (brand_id, kind)
);
-- The ticks start from what each channel makes today (its Studio format), so nothing changes until Josh edits them.
INSERT INTO brand_slot_kinds (brand_id, kind, enabled)
  SELECT b.id, 'short',
    CASE WHEN COALESCE((SELECT json_extract(s.config_json, '$.format') FROM studio_brands s WHERE s.brand_id = b.id), 'short') = 'long' THEN 0 ELSE 1 END
  FROM brands b;
INSERT INTO brand_slot_kinds (brand_id, kind, enabled)
  SELECT b.id, 'long',
    CASE WHEN COALESCE((SELECT json_extract(s.config_json, '$.format') FROM studio_brands s WHERE s.brand_id = b.id), 'short') = 'long' THEN 1 ELSE 0 END
  FROM brands b;

-- Settings that used to be one value for every channel. A row here is that channel's own value.
-- No row means the channel follows the app wide setting, so every channel starts with exactly today's value.
CREATE TABLE brand_overrides (
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (brand_id, key)
);
