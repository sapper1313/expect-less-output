-- Long form channels may post to Instagram and TikTok as well as YouTube. Wonder Hollow starts with all three on.
UPDATE studio_brands
SET config_json = json_set(config_json, '$.platforms.instagram', json('true'), '$.platforms.tiktok', json('true'))
WHERE brand_id IN (SELECT id FROM brands WHERE slug = 'wonder-hollow')
  AND json_valid(config_json)
  AND json_extract(config_json, '$.format') = 'long';
