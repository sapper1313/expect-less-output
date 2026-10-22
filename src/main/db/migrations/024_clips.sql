-- Short clips: a show can post full episodes and vertical clips on separate schedules.
ALTER TABLE posts ADD COLUMN post_type TEXT NOT NULL DEFAULT 'episode';
ALTER TABLE posts ADD COLUMN source_episode_ref TEXT;
ALTER TABLE drops ADD COLUMN post_type TEXT NOT NULL DEFAULT 'episode';
CREATE INDEX idx_posts_type ON posts(brand_id, post_type, status);
