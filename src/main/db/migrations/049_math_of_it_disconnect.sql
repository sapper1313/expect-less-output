-- The Math of It was archived and its Meta (Facebook and Instagram) assets were deleted, so it can no longer be
-- disconnected from the screen. This does what the Disconnect buttons do for every platform on that channel:
-- the row stays (old posts point at it) but becomes a dry run placeholder with no login.
UPDATE accounts
   SET external_id = NULL, display_name = 'Dry run account', avatar_url = NULL, token_ref = NULL,
       token_expires_at = NULL, status = 'connected', mode = 'dry_run', last_checked_at = NULL
 WHERE brand_id IN (SELECT id FROM brands WHERE slug = 'math-of-it');
UPDATE upload_post_links SET platforms = '{}'
 WHERE brand_id IN (SELECT id FROM brands WHERE slug = 'math-of-it');
