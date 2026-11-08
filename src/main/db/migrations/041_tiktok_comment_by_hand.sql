-- A first comment that failed on a TikTok post finished by hand from a draft: ELO has no video id for it. Show it as not sent.
UPDATE first_comment_jobs
   SET status = 'skipped',
       last_error = 'This TikTok post was finished by hand from a draft, so ELO does not know its video id. Add the comment by hand, or mark it posted with the video link.'
 WHERE platform = 'tiktok' AND status = 'failed' AND last_error LIKE '%VideoId expected int%';
