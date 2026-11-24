-- Amazon product lists. Each channel has its own Associates tracking id, and the lines that go in its descriptions.
ALTER TABLE channel_rules ADD COLUMN amazon_tag TEXT NOT NULL DEFAULT '';
ALTER TABLE channel_rules ADD COLUMN amazon_pointer TEXT NOT NULL DEFAULT '';
ALTER TABLE channel_rules ADD COLUMN amazon_disclosure TEXT NOT NULL DEFAULT '';
-- The picks that came with a post (bot drop or manual), and where its list page stands.
ALTER TABLE posts ADD COLUMN products_json TEXT;
ALTER TABLE posts ADD COLUMN list_id TEXT;
ALTER TABLE posts ADD COLUMN list_state TEXT;
ALTER TABLE posts ADD COLUMN list_error TEXT;
ALTER TABLE posts ADD COLUMN list_video_id TEXT;
-- The Spanish channel gets Spanish lines from the start.
INSERT INTO channel_rules (brand_id, max_per_day, blackout_json, amazon_pointer, amazon_disclosure)
  SELECT b.id, 1, '[]', 'Productos de este video:', 'Como Asociado de Amazon, gano por compras que cumplen los requisitos.'
  FROM brands b WHERE b.slug = 'mam-no-toques-eso'
  ON CONFLICT(brand_id) DO UPDATE SET amazon_pointer = excluded.amazon_pointer, amazon_disclosure = excluded.amazon_disclosure;
