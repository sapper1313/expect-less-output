-- A post the owner switched off for Bluesky in the editor.
ALTER TABLE posts ADD COLUMN bluesky_off INTEGER NOT NULL DEFAULT 0;
