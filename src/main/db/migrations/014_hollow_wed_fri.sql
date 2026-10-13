-- Wonder Hollow Workshop posts on Wednesday and Friday, on YouTube only. Older rows were seeded with Tuesday and Friday
-- and could carry platforms the brand has no account for. Only this brand's studio settings change. No post is touched.
UPDATE studio_brands
SET config_json = json_set(
  config_json,
  '$.cadenceMode', 'weekly',
  '$.postDays', json('[3,5]'),
  '$.windows', json('[{"days":[7,1],"forPostDay":3},{"days":[3,4],"forPostDay":5}]'),
  '$.platforms.youtube', json('true'),
  '$.platforms.facebook', json('false'),
  '$.platforms.instagram', json('false'),
  '$.platforms.tiktok', json('false'),
  '$.platforms.bluesky', json('false')
)
WHERE brand_id IN (SELECT id FROM brands WHERE lower(name) LIKE 'wonder hollow%')
  AND json_valid(config_json);
