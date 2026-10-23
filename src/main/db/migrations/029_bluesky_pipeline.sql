-- Bluesky posts for pipeline drops: each one is tied to the ELO post it copies, one per post.
ALTER TABLE social_posts ADD COLUMN post_id INTEGER;
CREATE UNIQUE INDEX uq_social_post ON social_posts(post_id, platform) WHERE post_id IS NOT NULL;
