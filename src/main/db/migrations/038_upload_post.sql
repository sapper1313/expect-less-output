-- Upload-Post: one row per channel. `profile_user` is the name of the profile on Upload-Post.
-- `platforms` is JSON like {"tiktok":true,"instagram":true}. A ticked platform is "active": ELO may use it.
-- Only TikTok posts through Upload-Post. The other ticked platforms are for comments, first comments and stats.
CREATE TABLE IF NOT EXISTS upload_post_links (
  brand_id INTEGER PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  profile_user TEXT NOT NULL DEFAULT '',
  platforms TEXT NOT NULL DEFAULT '{}'
);
