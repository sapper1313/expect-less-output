-- A clip's channel link line (on by default for clips) and whether the owner has set the Related video by hand.
ALTER TABLE posts ADD COLUMN channel_link INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN related_done INTEGER NOT NULL DEFAULT 0;
