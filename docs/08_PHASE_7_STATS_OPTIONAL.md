# Phase 7 (Optional): Basic Stats

Only build this when the owner asks. Keep it simple: numbers per post and per brand, no inbox or comment management.

## Before you write code

Read `docs/01_PROJECT_SPEC.md`. Fetch current docs for YouTube `videos.list` statistics, Facebook Reels insights, Instagram media insights for Reels, and TikTok Display API `video.list` / `video.query` (requires the `video.list` scope and may need an additional review). Tell the owner which TikTok steps he must do in the developer portal. Ask questions, then build.

## Build

1. `fetchStats(target)` in each adapter: views (or plays), likes, comments, shares where available. Store rows in `post_stats`.
2. Refresh schedule: every 6 hours for posts under 7 days old, daily for 7 to 30 days, then stop. Manual "Refresh stats" button.
3. Quota care: batch YouTube ids (up to 50 per call).
4. UI: stats columns in Queue, a Stats tab per post (simple line chart of views over time using a lightweight chart library), and a Brand Summary page (last 7 and 30 days totals per platform).
5. Expose stats in the agent API: `GET /v1/posts/{id}/stats`, `GET /v1/brands/{id}/stats?range=`.

## Acceptance checklist

- [ ] Stats appear for a real posted video on each connected platform that supports it.
- [ ] Platforms without approved stats access show "Not available" instead of errors.
- [ ] USER_GUIDE.md updated.
- [ ] Committed to git.
