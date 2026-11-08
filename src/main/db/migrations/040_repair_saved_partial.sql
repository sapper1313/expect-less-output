-- Saving the editor on a partly posted post used to put its finished TikTok draft back to pending and mark the post missed.
-- Put those back: the draft is waiting for the owner again, and the post is partial again.
UPDATE post_targets SET status = 'needs_action'
 WHERE status = 'pending' AND attempts = 0 AND external_id IS NOT NULL AND platform = 'tiktok'
   AND post_id IN (
     SELECT p.id FROM posts p WHERE p.status = 'missed'
       AND EXISTS (SELECT 1 FROM post_targets x WHERE x.post_id = p.id AND x.status = 'posted'));

UPDATE posts SET status = 'partial'
 WHERE status = 'missed'
   AND EXISTS (SELECT 1 FROM post_targets x WHERE x.post_id = posts.id AND x.status = 'needs_action')
   AND EXISTS (SELECT 1 FROM post_targets x WHERE x.post_id = posts.id AND x.status = 'posted')
   AND NOT EXISTS (SELECT 1 FROM post_targets x WHERE x.post_id = posts.id AND x.status = 'pending');
