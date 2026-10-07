# Changelog

## 0.7.2 Best times and recommended slots

- **Best times to post** on the Stats screen: top hours, a typical views by hour chart and a day by hour heat map (Eastern time), per brand and platform. Only videos at least 7 days old are compared. With more than one brand or platform the numbers are shown as "times your typical video".
- **Recommended** times on each brand's Posting slots card, split into weekdays and weekends, each with an Add button. Nothing changes until you click Add and then Save slots.
- Both need at least 10 videos with numbers. Use Import existing videos to add the ones already on your channels.

## 0.7.1 Stats for existing videos

- **Import existing videos** on the Stats screen finds videos that were on your channels before this app and reads their numbers. YouTube (uploads list), Instagram (videos and Reels) and Facebook Page Reels. TikTok waits for video.list approval.
- Imported videos are read once, then daily for 90 days after they were published. They count in the brand totals and a new **All time** range was added.
- Profile pictures on Connections now load (the page security rule allows secure web images).

## 0.7.0 Phase 7: Basic stats

- Views, likes, comments and shares per posted video, saved over time in `post_stats`. Read every 6 hours for posts under 7 days old, daily from 7 to 30 days, then never again. A Refresh stats button reads them right now.
- YouTube: `videos.list` statistics, up to 50 videos per call (1 quota unit). No share count exists there. Instagram: insights (views, likes, comments, shares, plus reach and saved). Facebook Reels: `blue_reels_play_count` for views, reactions summed for likes, comments from the video, shares approximate (marked with ~). TikTok: `/v2/video/query/`, needs the `video.list` scope and a real video id.
- A platform that gives no numbers shows "Not available" with the reason (for example "Reconnect Meta for stats") and is retried at most once a day. Dry run posts show that nothing real was posted.
- Mark as posted now reads the video id from a pasted YouTube or TikTok link, which is how manual and TikTok Drafts posts get stats.
- Queue columns (totals, per platform on hover), a Stats section with a views chart in the post editor, and a new Stats screen with a brand picker and Last 7 or 30 days totals per platform.
- Agent API: `GET /v1/posts/{id}/stats` and `GET /v1/brands/{id}/stats?range=7d|30d`, plus MCP tools `get_post_stats` and `get_brand_stats` (eleven tools now).
- Meta now asks for `pages_manage_engagement`. A "Also ask for video.list (stats)" box was added for TikTok.

## 0.6.0 Phase 6: Local agent API and MCP

- Local HTTP API on 127.0.0.1 only (default port 47821), off by default, bearer token (shown once, regenerate to cancel), Host and Origin checks, every call logged. Endpoints for brands, next open slots, posts (create, list, get, change, cancel, retry), calendar, activity and health.
- Requests, responses, the OpenAPI file (`docs/openapi.json`) and the MCP tools are all generated from one set of zod schemas. A test fails if the OpenAPI file is out of date.
- "Agents may create drafts only" (on by default). Asking to schedule returns 403 `drafts_only`. Nothing is silently downgraded. Agents have no way to connect accounts, change credentials, delete files or change settings.
- Watched Inbox folder per brand with optional JSON sidecars. Files are moved into Queue, unusable ones go to `Inbox/Rejected` with an explanation.
- MCP server (`mcp/elo-mcp.ts`, built to `mcp/dist/elo-mcp.mjs`) with nine tools, plus ready-to-paste setup for Claude Code and Claude Desktop in Settings.
- Local AI text assist (OpenAI compatible: Ollama, LM Studio) with Suggest buttons, off by default, limited to this Mac unless the network box is ticked.

## 0.5.0 Phase 5: Alerts and polish

- Alert service: failures, missed posts, logins needing renewal, Meta expiry within 7 days, daily limits and a missing Media Root. Always a macOS notification, plus iMessage (AppleScript through Messages, both current forms tried) and optional Gmail email (app password, nodemailer).
- Short messages under 300 characters in the required format. More than 3 alerts in 5 minutes: the first 3 go out, the rest are combined. Quiet hours hold iMessage and email and send one summary. Send test alert for each channel.
- Reconcile on start and wake. Pause per brand. Health panel on Connections.
- Backup and restore (zip with database, settings, thumbnails and a folder manifest; no tokens, no videos). Restore remaps the Media Root, flags accounts to reconnect, and keeps a safety copy.
- Keyboard shortcuts, duplicate post, per-platform preview, Queue search.

## 0.4.0 Phase 4: TikTok

- TikTok Client Key, Client Secret and Redirect URI saved in the encrypted secret store. Optional video.publish scope toggle.
- Login Kit with PKCE and state. The website bounce page returns to the app through `expectless://`, with a Paste code fallback. Tokens refresh automatically (24 hour access tokens, 365 day refresh tokens), `needs_reauth` with an alert when refresh fails.
- Drafts mode (upload to inbox): chunked upload (5 to 64 MB chunks, remainder in the last), status polling, `needs_action` with a notification, Mark as posted.
- Direct post mode, unlocked only after the owner confirms the audit: creator_info re-checked right before publishing, privacy, interaction and commercial content fields, AI flag via `is_aigc`.
- Posting screen follows TikTok's Content Sharing Guidelines: nickname shown, privacy from creator_info with no default, interactions unchecked and greyed when off in TikTok, commercial disclosure with required notices, consent line with links. Same section in New Post, Bulk Upload and the post editor.
- Daily limit handling: a post is pushed an hour later (up to 24 times) without using up retries, with one alert.
- Hidden TikTok demo screen (Command+Shift+D) for recording the review video. It never posts.
- TikTok brand defaults removed from the Brands screen (guidelines forbid defaults).

## 0.3.0 Phase 3: Facebook Pages (Reels) and Instagram (Reels)

- Meta App ID and Secret saved in the encrypted secret store. One Meta login (Graph API v25.0, fixed localhost port) gives a long-lived token and every Page with its Instagram account. Page tokens stored encrypted.
- Match each brand to a Page and an Instagram account, pre-matched by name similarity.
- Facebook Reels: start, resumable upload, finish. Early handoff with SCHEDULED and an exact publish time (15 minute minimum lead, Meta requires 10). Less lead publishes at the scheduled time. 30 Reels per Page per day guard.
- Instagram Reels: resumable upload of the local file (no Cloudflare R2 needed), status polling every scheduler tick, publish once, permalink saved. content_publishing_limit respected. Cover frame offset and brand share to feed setting.
- AI label: Instagram uses Meta's `is_ai_generated` field. Facebook has no documented field, so the post gets an Add AI label in app checklist and a notification.
- Duration limits enforced for Facebook (3 to 90 seconds) and Instagram (3 seconds to 15 minutes), when scheduling and again before upload.
- Token health: real expiry read from Meta, 7 day warning (notification, sidebar banner, Connections warning), needs_reauth with an alert when Meta rejects the login.
- Meta error codes classified into temporary (retry) and permanent (stop and explain).

## 0.2.0 Phase 2: YouTube (Shorts)

- Google credentials (Client ID and Secret) saved in the encrypted secret store, shown masked.
- Connect a YouTube channel per brand with the installed-app loopback flow (PKCE, offline access). Brand Account channel picker. Connect, Reconnect and Disconnect.
- Per channel modes: Manual assist (notify, copy title and description, open Studio, Mark as posted), Test private, Auto (early handoff with publishAt, public upload when under 15 minutes away).
- Resumable uploads with progress, resume after dropped connections, token refresh, and duplicate protection.
- Token health: automatic refresh, needs_reauth on invalid_grant with an alert, daily channel check.
- Quota guard with two buckets (uploads, everything else), Pacific day reset, warning at 80 percent.
- Brand settings: YouTube category list from YouTube, playlist picker, Append #Shorts.
- Docs check: quota costs changed (videos.insert is 1 unit in its own 100 per day bucket). Unverified projects are still locked to private.

## 0.1.0 Phase 1: core app (dry run only)

- Electron, React, Tailwind, SQLite app shell with a menu bar icon. Closing the window keeps the scheduler running.
- Brands with editable slots, defaults and hashtag sets. The 4 launch brands are seeded as editable data.
- New Post, Bulk Upload, Calendar (month and week, drag to reschedule), Queue, Activity Log, Settings.
- Slot engine with Eastern time and daylight saving tests.
- Scheduler on a 30 second tick with locking, early handoff, retries (2, 10, 30 minutes), missed post handling, keep awake, and file move to `Posted/YYYY-MM`.
- Dry run adapters for YouTube, Facebook, Instagram and TikTok. No real API calls yet.
- Encrypted secret store (Keychain backed) with masked previews.
- Branding: icon, menu bar icon, dark theme, fonts, voice copy.
