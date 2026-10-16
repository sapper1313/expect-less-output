# Changelog

## 0.10.0 Workflow menu, one place to schedule, reliability and QA

- **Reconnect fixed.** The Mac's network had IPv6 addresses that resolve but never connect, so connections to Google and Meta timed out after 10 seconds about one time in eight ("fetch failed"). Lookups now prefer IPv4 (0 failures in 36 test calls, slowest 199 ms), calls that are safe to repeat are tried again after a network failure, and errors name the real cause.
- **Forms no longer revert.** Channel setup (slots and defaults), Schedule and Bulk keep your edits while the app reloads in the background (a shared `useDraft`).
- **Time pickers** (hour, minute, AM or PM drop-downs and a date pop-up) replace every typed time.
- **One pause:** a brand is paused only on Channel setup (it pauses posting and the Studio together). Pause everything is the left menu button and the menu bar icon.
- **One place to schedule:** Schedule (One video, Many videos). The Calendar starts a post from a clicked day or the New post button. The old New Post and Bulk Upload menu items are gone.
- **Menu and tabs follow the work:** Home, Create and schedule, Make, Results, Set up, Records. Studio tabs run Overview, Research, Bible, Library, Flagged, Publishing, Comments, Spend, Director's Log. Studio Insights moved into Analytics (What's working) and now counts every video.
- **Existing videos** are listed automatically for new accounts and then daily. Home shows the newest existing video for channels where the app has posted nothing newer (only one channel showed stats before).
- **New:** setup checklist on Home, Export CSV (Analytics and Queue).
- **Calendar + more pop-up** is solid. Buttons no longer wrap their text.
- **Privacy for a sale:** the owner's phone number is no longer a built-in default. New installs start with iMessage off and no number. An install already in use keeps its number (migration 015).
- **QA:** `scripts/e2e/tour.mjs` (every screen and tab, 69 checks) and `scripts/e2e/interactive.mjs` (scheduling, rescheduling, editing, settings and draft-keeping flows). Test timeout raised for ffmpeg tests.

## 0.9.8 Better Telegram commands

- New commands for the Telegram bot: `/last` (last post per platform for every brand, and the next one), `/stats` and `/stats 30`, `/today`, `/spend` (with every cap), `/flags` and `/brands`. The numbers come straight from the app's records, not from a language model.
- `/pause` and `/resume` can now take a brand name (`/resume The Math of It`, part of the name is enough). They still need a YES before anything changes. Without a name they pause or resume everything, as before.
- Plain questions such as "when was the last post" and "analytics" are answered from the records. Other questions still go to your text model.
- The phone dashboard, an iCloud report file and a weekly summary are saved in `docs/PHONE_DASHBOARD_PLAN.md` for when the dedicated server is ready.

## 0.9.7 Prompt caching for long episodes

- The Writer now uses Anthropic prompt caching for the scene parts of a long episode. The bible (about 30,000 tokens) is the same in every part, so the first part writes it to the cache and the later parts read it for a tenth of the price. A new attempt within five minutes reuses it too. This cuts the writing cost of a 7 minute episode by roughly 15 to 20 percent.
- The plan call is not cached (it runs once, and writing the cache costs a quarter more). Short form writing is not cached either, because each brand writes about once a day, so the cache would expire before it was reused.
- The spend ledger and the caps count cached tokens at their real price (writes 1.25 times, reads 0.1 times), so the numbers on the Spend tab stay honest.

## Unreleased Wonder Hollow keeps to Wednesday and Friday, and a video keeps its own text

- Wonder Hollow Workshop is a Wednesday and Friday show (it was seeded as Tuesday and Friday). Production windows are Sunday and Monday for Wednesday, Wednesday and Thursday for Friday. A new migration (014) moves the saved settings of this brand to that schedule and to YouTube only. No post is changed.
- Every "next open slot" lookup (the Inbox auto schedule, the agent API, the Studio) now honors a weekly schedule. Before, only the Studio's own date maths did, so a brand with Monday to Friday slots could still land on a Tuesday.
- A brand only gets targets for platforms it has an account for, and long form brands are always YouTube only when read.
- A post that already has a good future time keeps it when the Publisher runs again.
- A video stays bound to the title and text it arrived with: the Publisher refuses to rewrite the post of an episode that has moved on, the Writer and Rebuild refuse to rewrite an episode that already has a post or video, and a second video for the same episode is refused.

## 0.9.6 Agents can help with the Studio

- New agent API routes and MCP tools: `get_studio_spend`, `list_flagged_tasks`, `list_bible_skills` (always allowed), and `set_studio_caps`, `add_bible_skill`, `remove_bible_skill`, `retry_flagged_task`, `rebuild_episode`, `set_studio_brand_paused` (22 tools in all).
- The changing tools only work when **Settings, Agent API, Agents may change Studio settings** is ticked. It is off by default. Otherwise they answer `403 studio_locked` and change nothing.
- Removing a skill first saves its full text to a Markdown file in the Studio library (`removed-skills`). Caps are limited to 0 to 9999 dollars. Agents cannot approve a failed script or discard an episode. Every change is written to the Activity Log.

## 0.9.5 The bible beats the skill on length, and QC checks the script only

- Imported skill files can describe a production routine that disagrees with the bible (the Wonder Hollow skill says "plan every episode as 12 clips of 12 to 14 seconds", the bible asks for 7 minutes). Script QC had been failing every long draft with "regroup into 12 clips", which can never pass. Now the bible's Length targets and Formats win over a skill's clip count, and a skill's beat table is treated as story structure, not a clip count. The Writer gets the same rule.
- Script QC no longer asks for things a script cannot fix: reference image files, asset lists, a separate COUNT PLAN section (the counted objects list is the count plan), or a different runtime. It fails a script only for a real problem: a broken bible rule, a wrong count, something unsafe for the audience, or an off voice line.
- When the Writer redoes a long episode, every part now gets the problems from the last try, not only the plan. Before, a fix such as "rewrite scenes 4 and 5" could be lost when those scenes were written in a later part.

## 0.9.4 Long episodes: smaller parts that heal themselves

- The scenes are now written 10 at a time (was 12), with more room for each answer. The plan call has more room too, and is asked again with even more if it is still cut off.
- A part that is cut off is split in half and written again, so one long scene no longer costs the whole attempt. Before, a single cut off part threw away every part already written.
- Script QC, the Math Checker and the safety check have more room (16,000 tokens, was 8,000). One QC answer had been cut off at the old limit.

## 0.9.3 Long episodes are written in parts

- A long episode (more than 20 scenes, for example the 7 minute Wonder Hollow episodes) is no longer written as one huge answer, which kept running out of room ("The answer was cut off because it was too long"). The Writer now makes a short plan with one line for every scene, then writes the scenes 12 at a time, each part seeing the whole plan and the end of the part before it. Every part is a small answer, so the length of an episode no longer matters.
- If a part comes back short, the Writer tries again like it does for a cut off answer. Shorter episodes (a 3 minute Hollow episode, all the short form brands) are written exactly as before.

## 0.9.2 Command+Q keeps the app running

- Command+Q now hides the window like the red close button. The app keeps running from the menu bar, and only **Quit** in the menu bar icon menu really stops it. Shutting down, restarting or logging out still works.

## 0.9.1 Character reference images in the Bible

- Each character in the Bible now has its own **Reference images** strip. Add every angle, give each picture a label (front, side, smiling), and switch a picture off with **Retire** when the character changes. A retired picture stays in the Bible and can be switched back on.
- Characters have a permanent id, so renaming a character keeps its pictures. Removing a character stops its pictures from being sent.
- The Producer sends the pictures that are on (up to 14, characters taking turns so one character cannot crowd out another, brand wide pictures fill what is left). The character check uses up to 3 of them.
- Pictures you already added under Studio Settings still work as brand wide references.

## 0.9.0 Studio round two

- **Home** is the new first screen: a Liquid Glass dashboard with the whole pipeline, one card per channel (connection health, latest post numbers, days of episodes ahead), spend with a monthly projection, what is coming up and what just posted.
- **Left menu:** red counts next to Studio (flagged items), Queue (failed or missed posts) and Channels (logins that need attention). **Search everything** with Command K.
- **Channels** holds channel setup, Connections and the studio settings per channel. **Settings** is grouped in tabs: General, Studio, AI models and Local AI, Alerts and backup, Agent API, Testing tools.
- **Models:** an editable price for each Claude model, free local Ollama models for any text agent, a model picker that shows cost and what each model is good for, and cut-off calls are now billed into the ledger. Text suggestions use the Ollama machine from the Local AI settings and set themselves up once.
- **Director chat** on the Studio Overview: ask questions and get buttons for pause, resume, add an idea, retry flagged, write now, rebuild one episode, or rebuild every episode of a channel that has no video yet.
- **Calendar and Home pop-ups** are large and show the title, where it is posting, the video, the numbers and any error. Posted YouTube and Facebook videos can be edited live from the pop-up.
- **Library:** a video player, what each episode cost, chapters for the YouTube description, captions in other languages (English plus the ones you choose), and cut vertical shorts from long videos as drafts.
- **Research tab:** Title Lab, competitor watching, trends and ideas from research. **Insights** has a re-post queue. Posts show watch time and the retention curve.
- **Telegram:** chat with the studio from your phone. It answers from a plain snapshot of the studio with your own model, and pause or resume need a YES.
- Text can be highlighted and copied everywhere, with a right-click menu.
- Fixes: Bible edits are no longer wiped by background refreshes, switching channels in the Bible shows that channel, the writer and checkers have room to finish, Wonder Hollow scripts get the scene count they need, and a script that runs longer than the target is no longer rejected.

## 0.8.0 Autonomous Studio

- New **Studio** screen: a Director, Show Writers, Script QC, Math Checker, Hollow Safety Checker, Producer (xAI Grok Imagine), Video QC, Compliance, Thumbnail, Publisher, Comments and Analytics agents. Starts paused and in mock mode.
- Spend ledger and hard caps (global, per brand, per episode, AI text), checked before every paid call. Mock spend never counts.
- Episode Library (small gzip packages, kept forever), a calendar that shows posted, scheduled, in production, awaiting video, flagged, failed and planned items, and a retention purge that never deletes packages or stats.
- Wonder Hollow Workshop: ELO writes the full package for Muse (read only `GET /v1/episodes` and a ready folder), and a video sent back with an `episode_id` is attached, checked and scheduled for Tuesday or Friday.
- Bluesky publishing (one account per brand), a public host (Cloudflare R2) for Instagram covers, custom thumbnails for long YouTube videos, Instagram cover support, TikTok cover timestamp, a thumbnail A/B swap test.
- Morning digest, a launchd watchdog, nightly backups, per agent switches, and a real Dry run day.
- A post made from a mock mode placeholder video always uses the dry run adapter and is never published for real.

## 0.7.5 No Intel code in the app

- The video inspection tool (ffprobe) is now the real Apple silicon build. The old package shipped an Intel program in its arm64 folder, which made macOS say "Support Ending for Intel-based Apps". The built app now has no Intel programs inside.

## 0.7.4 TikTok upload fix

- A video of 64 MB or less is now uploaded to TikTok whole, as one chunk of the full file size. Before, a 14 MB video was announced as one 10 MB chunk and TikTok refused it as `invalid_params` (chunk size invalid). Larger files still use 5 to 64 MB chunks.

## 0.7.3 Automatic scheduling for Inbox videos

- New per brand switch on the Brands screen: **Schedule Inbox videos automatically (next open slot)**. A video dropped in that brand's Inbox, with or without a .json file that leaves out the status, goes to the next open slot instead of waiting as a draft. A .json file that sets `status` itself always wins.
- It only works while "Agents may create drafts only" is unticked in Settings. Otherwise the video still becomes a draft. Off by default.

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
