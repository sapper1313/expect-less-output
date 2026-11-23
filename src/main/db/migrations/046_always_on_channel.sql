-- A 24/7 stream channel (rain, fireplace) never needs episodes. This flag stops the low queue alert and the open slot cards.
ALTER TABLE channel_rules ADD COLUMN always_on INTEGER NOT NULL DEFAULT 0;
-- Tin Roof Rainy Nights already ran as a stream by having every time switched off. Mark it so it keeps working the same way.
INSERT INTO channel_rules (brand_id, max_per_day, blackout_json, always_on)
  SELECT b.id, 1, '[]', 1 FROM brands b WHERE b.slug = 'tin-roof-rainy-nights'
  ON CONFLICT(brand_id) DO UPDATE SET always_on = 1;
