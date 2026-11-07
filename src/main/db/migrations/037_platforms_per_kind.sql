-- Which platforms each kind posts to (JSON {platform: true|false}). Starts as the channel's old Studio platform ticks,
-- so nothing changes until Josh edits them. Null means follow the old Studio ticks.
ALTER TABLE brand_slot_kinds ADD COLUMN platforms TEXT;
UPDATE brand_slot_kinds SET platforms = (
  SELECT json_extract(s.config_json, '$.platforms') FROM studio_brands s WHERE s.brand_id = brand_slot_kinds.brand_id
) WHERE EXISTS (SELECT 1 FROM studio_brands s WHERE s.brand_id = brand_slot_kinds.brand_id AND json_extract(s.config_json, '$.platforms') IS NOT NULL);
