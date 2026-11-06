-- The Studio's weekly "post days" used to limit which days a channel posts on, hidden from Setup Channels.
-- Copy them into the channel's own Shorts and Long form days so they are visible and editable there.
UPDATE brand_slot_kinds
SET days = (
  SELECT json_extract(s.config_json, '$.postDays')
  FROM studio_brands s
  WHERE s.brand_id = brand_slot_kinds.brand_id
    AND json_extract(s.config_json, '$.cadenceMode') = 'weekly'
    AND json_type(s.config_json, '$.postDays') = 'array'
    AND json_array_length(json_extract(s.config_json, '$.postDays')) > 0
)
WHERE days IS NULL;
