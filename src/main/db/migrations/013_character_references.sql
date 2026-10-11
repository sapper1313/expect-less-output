-- Reference images can belong to one character of a series bible, with a label and an on/off switch
-- so an old look can be retired when a character changes without deleting the picture.
ALTER TABLE brand_assets ADD COLUMN character_id TEXT;
ALTER TABLE brand_assets ADD COLUMN label TEXT;
ALTER TABLE brand_assets ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
