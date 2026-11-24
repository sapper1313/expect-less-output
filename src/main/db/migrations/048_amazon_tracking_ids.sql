-- The Associates tracking ids the owner created on 2026-11-23, one per channel. Only fills a blank, so a later edit in
-- Setup Channels is never overwritten. The "Amazon lists are live" switch stays off until the owner turns it on.
INSERT INTO channel_rules (brand_id, max_per_day, blackout_json, amazon_tag)
  SELECT b.id, 1, '[]', 'expectless-typt-20' FROM brands b WHERE b.slug = 'teach-your-parents-tech'
  ON CONFLICT(brand_id) DO UPDATE SET amazon_tag = CASE WHEN amazon_tag = '' THEN excluded.amazon_tag ELSE amazon_tag END;
INSERT INTO channel_rules (brand_id, max_per_day, blackout_json, amazon_tag)
  SELECT b.id, 1, '[]', 'expectless-uu-20' FROM brands b WHERE b.slug = 'usefully-useless-info'
  ON CONFLICT(brand_id) DO UPDATE SET amazon_tag = CASE WHEN amazon_tag = '' THEN excluded.amazon_tag ELSE amazon_tag END;
INSERT INTO channel_rules (brand_id, max_per_day, blackout_json, amazon_tag)
  SELECT b.id, 1, '[]', 'expectless-mama-20' FROM brands b WHERE b.slug = 'mam-no-toques-eso'
  ON CONFLICT(brand_id) DO UPDATE SET amazon_tag = CASE WHEN amazon_tag = '' THEN excluded.amazon_tag ELSE amazon_tag END;
INSERT INTO channel_rules (brand_id, max_per_day, blackout_json, amazon_tag)
  SELECT b.id, 1, '[]', 'expectless-grandmas-20' FROM brands b WHERE b.slug = 'grandmas-scratch-pantry'
  ON CONFLICT(brand_id) DO UPDATE SET amazon_tag = CASE WHEN amazon_tag = '' THEN excluded.amazon_tag ELSE amazon_tag END;
