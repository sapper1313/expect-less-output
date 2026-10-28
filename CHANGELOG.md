# Changelog

## 0.16.1 Dropped episodes always get an Upcoming entry

- Cause of the missing entries: on Oct 25 an older copy of `upcoming.json` was put back on disk. ELO refused to load it, but the next bot write was built on that old file and quietly erased 13 entries (including The Math of It 0108). ELO now builds every write on its own latest copy when the file on disk is older, keeps any entry only the old file has, and shows a warning.
- A dropped episode with no Upcoming entry now gets one made by ELO, already marked dropped, with the title from the drop. This happens when the drop arrives, when ELO starts, and every 5 minutes.

## 0.16.0 TikTok text message, Snapchat removed

- When a channel sends a video to TikTok, you now get a message (iMessage, plus the other alert places you have on) with the **channel**, the **title** and the **description**. In Drafts mode it says the draft is waiting in your TikTok inbox. In Direct post mode it says the post went live. TikTok does not let an app fill in the description of a draft, so the message is there to copy from (ELO also still copies it to your clipboard).
- Snapchat is gone from ELO (it never allowed apps to post). Any Snapchat login or Snapchat post entry is removed when the app starts.

## 0.15.1 Website card keeps what you type

- The Website card used to reset to the saved copy about a minute after you started typing, because the whole page reloads when anything changes. It now keeps your typing until you press Save website details (same fix as the other forms). The website address box is fixed the same way.

## 0.15.0 Channels update the website

- New **Website** card on each channel (Channels, Channel setup): an **Add to website?** check mark, title, host, tagline, description, YouTube id and handle, links, accent color and a hero picture.
- ELO keeps its own clone of the website project, changes only `src/data/channels.json` (and adds the hero image), and pushes to GitHub, so Cloudflare publishes it. Adding, editing, unticking or archiving a channel updates the site about a minute later. Nothing else in the project is touched.
- **Fill ELO from the website** reads the cards already on the site into ELO so nothing is retyped. A change made in ELO and not yet sent is never overwritten by that read.
- Safeguards: a card must be complete before it goes up, no more than 2 channels may leave the site in one send, a push that loses a race with the video refresh job is retried, and git problems are shown in plain words.
- Migration 032 adds `website_profiles` and `website_state`. Setup and use are in `docs/USER_GUIDE.md` section 27.

## 0.14.5 The Fine button is now Save

- The main button on New Post, Bulk upload, the post editor and the TikTok demo says **Save** instead of "Fine." (Save as draft is unchanged). The wording lives in `COPY.publishButton`.

## 0.14.4 Long text is shortened at posting time

- Bluesky refuses text over 300 characters (counted as people count them, so an emoji is one). The Bluesky and X adapters now shorten a long description by whole sentences, keep the hashtags, and cut as a last resort, whatever put the text on the post. Before this a post that got its Bluesky tick in the editor sent the full description and failed with "grapheme too big".

## 0.14.3 Bluesky says when the email is not confirmed

- Bluesky only takes videos from an account whose email is confirmed. The failure used to read "refused the login (401)". It now says to confirm the email in the Bluesky app and press Retry.

## 0.14.2 Upcoming puts its file back

- If `Shared/upcoming.json` (or the whole Shared folder) is deleted or moved, ELO now writes its last good copy back right away instead of only warning, and tells you once. The file lives at `<Media Root>/Shared/upcoming.json` unless Settings, Pipeline, Upcoming file path says otherwise.

## 0.14.1 Finished posts no longer stay "scheduled"

- A post whose platforms are all done but whose status never moved on (for example a failed Facebook was taken off it by editing) is now marked posted and its file moved to Posted, quietly, on the next 30 second check. This fixed Mia & Chloe's `mia-chloe-2026-0102`, which was stuck as "scheduled" since Oct 21.
- Found while looking into a drop that skipped a Saturday slot: "Minimum gap between any two posts" (Settings, Pipeline) blocks a slot when another channel posts in the same minute. Set it to 0 if channels may share a posting time.

## 0.14.0 More platforms: Bluesky, X, LinkedIn, Pinterest, Snapchat

- Five new platforms next to YouTube, Facebook, Instagram and TikTok. A channel uses one only when it has a login for it (Connections, More platforms). They show as BS, X, LI, PI and SC tags everywhere the other tags show, and in the post editor's platform list.
- Bot drops go to every extra platform a channel has a login for, with a caption written for that platform, a few minutes after the others. Bots do not choose them. `bluesky`, `x`, `linkedin`, `pinterest` and `snapchat` may appear in a sidecar's `platforms` and change nothing.
- Bluesky now posts like the other platforms (retries, alerts, staggering) instead of the separate Studio queue. The 0.13.1 and 0.13.2 Bluesky switch is replaced by the normal platform tick box.
- X (OAuth 2.0, chunked video upload), LinkedIn (Videos API, personal profile, 60 day login with a warning), Pinterest (video pin to a chosen board). Snapchat is a reminder because Snapchat has no posting API for creators.
- New database step: the accounts and post targets tables are rebuilt so they accept the new platforms. A copy of the real database was migrated first with every row kept.
- Setup steps: `docs/SETUP_MORE_PLATFORMS.md`.
- Not done: reading stats from these platforms, LinkedIn Company Pages, and Pinterest board creation.
- None of the new adapters has been run against the real platforms yet. They are tested against a local fake of each.

## 0.13.2 Bluesky switch in the post editor

- The post editor (Calendar and Queue) now shows **Bluesky** under Platforms for bot videos: on or off for that post (saved right away), when it will post, the link once posted, or why it is unavailable (no login, or over 3 minutes or 100 MB). Off stops a queued Bluesky post; on queues it again.

## 0.13.1 Bluesky for bot videos

- Accepted drops now go to Bluesky when the channel has a Bluesky login saved. No login means ignored. The Bluesky post follows the schedule (moves, stops, comes back with the ELO post), posts a few minutes after the last platform, and uses the existing retries and failure alert.
- A sidecar may list `bluesky` in `platforms`; it has no effect.
- Bluesky text: about 300 characters from the description, up to 3 hashtags. Videos over 3 minutes or 100 MB are not sent.
- Fixed a possible double post when two Bluesky passes overlapped.

## 0.13.0 Growth tools

- **Staggered posting** (Settings, Growth): YouTube on the slot, the other platforms a few minutes apart. Stored per platform, so a retry keeps its place.
- **Platform captions:** Facebook, Instagram and TikTok get their own version of a drop's description (a bot's own version is kept). A **Reformat for each platform** button in the post editor does it for any post.
- **Search tags:** YouTube autocomplete phrases are added to the YouTube tags (the bot can send `search_phrases`, or ELO asks for them). `GET /v1/seo/suggestions`.
- **New optional sidecar fields:** `topic`, `pinned_comment`, `community_poll`, `thumbnail_variants`, `search_phrases`.
- **After a video is live:** early checks at hours 1, 2 and 4 (slow start, rejected or non public on YouTube); the first comment posted on YouTube; a poll reminder after 30 minutes; a lesson from the audience curve after 48 hours, kept in Shared/learnings.md and `GET /v1/learnings`; viewer questions become Upcoming ideas (`community_request`); optional thumbnail rescue after 24 hours.
- **Topic rotation:** Issues warns about the same topic back to back.
- **Loudness:** every drop is measured (-14 LUFS target) and the drop log says when it is off. **Set sound to -14 LUFS** in the post editor.
- **Monday brief** (Settings, Growth; `GET /v1/brief`; files in Shared/Briefs).
- **Emergency take down:** `POST /v1/episodes/{episode_id}/retract` (owner and orchestrator tokens) and a button in Settings, Growth. YouTube goes private; the other platforms are listed for removal by hand.
- **Disk space** report and an opt-in H.265 shrink of old posted videos.
- `gemini` is a default allowed drop bot. The TikTok draft notice shows the episode id. Four new tools in the MCP list (37).
- Not possible through the platforms' APIs, so not built: pinning a comment, YouTube end screens, Community tab posts, hiding a Facebook, Instagram or TikTok video, Instagram mute detection, Google Drive backup.

## 0.12.0 Beth fixes posts, Calendar fills and warns, Issues can be cleared

- **Beth, every channel.** A bot's channel list can be "*" (all channels, now and later). The existing beth token is set to all channels. The Bots card has **Edit channels** and an **All channels** choice, and its channel list now comes from your real channels.
- **Beth can fix a post before it posts:** `POST /v1/posts/{id}/cancel` (take it out of the schedule, files kept), `PATCH /v1/posts/{id}` (title, caption, platforms; never a time), and `POST /v1/posts/{id}/media` (replace the video, title and description, keeping the slot; the old file goes to the Replaced folder). Refused when a platform already has the video. Every action is audited, and you get a Telegram message and an on-screen message.
- **Calendar:** **Fill with a waiting video** on an open slot (pick which video), **Fill all open slots** (oldest waiting videos into this month's open slots, with Undo), and **Episodes only / Clips only** to see clip gaps.
- **Empty slot warnings:** once a day (default 6:00 PM Eastern) a message lists the empty slots from now to the end of tomorrow, clips marked. Settings, Pipeline.
- **Inbox Issues:** **Dismiss** and **Clear all**. A dismissed message comes back only if the problem goes away and returns. **Check again** replaces Reconcile now.

## 0.11.5 The Calendar is one list, with the open slots

- The Calendar is now a day by day list only (the month grid, week view and drag to move are gone). Each day shows its posts, and every slot the channel settings offer that has nothing in it, as "<channel> has no videos scheduled" with an **Add a video** button (or "has no clips scheduled" for a clip slot). A slot shows how many finished videos wait for the channel in the Inbox, and a paused or on-hold channel's slot says so.
- Slots follow the same rules as the scheduler: the channel's slot times, its post days (Wonder Hollow is Wednesday and Friday), blackout dates and the daily limit. A day whose limit is used does not show an open slot.
- Filters: platform, status (new **Open slots only**) and brand. Previous and next month, and Today. The Studio's own planned days are no longer shown.

## 0.11.4 Thumbnail and title route for beth

- `POST /v1/posts/{id}/thumbnail` (MCP tool `set_post_thumbnail`): sets a custom thumbnail and/or title. Only the `beth` bot token and the owner token may call it.
- A post not posted yet keeps the picture for the upload and gets the new title. A video already inside YouTube or posted gets `thumbnails.set` on the live video (a posted video keeps its title). The picture is checked (absolute path, real JPG or PNG, under 2 MB) and copied next to the post. Audited. Obeys "Agents may create drafts only".
- Daily analytics keeps the numbers when the Claude API is off.

## 0.11.3 Clip channel link and Related video reminder

- Clips add the show's YouTube channel link to the end of the description on every platform, after the "Full episode on YouTube" line. Sidecar field `channel_link` (default true for clips, ignored on episodes).
- The YouTube Data API has no way to set a Short's Related video, so ELO cannot do it. A clip with a source episode now shows a **Related video** reminder in the Queue with the episode link (and **Done** to clear it), shows it in the API as `related_video`, and logs it when the clip posts and when its episode goes live.

## 0.11.2 Short clips

- A sidecar can say `"post_type": "clip"` (and optionally `"source_episode_id"`). Missing means an episode, exactly as before.
- Clips must be 9:16 and 5 to 90 seconds with sound, on any show. Clip ids may end in `-c1`, `-c2` and so on.
- Each show has **Clip post days**, a **clip time** and **clip platforms** (Channels, Studio settings per channel). Clips use their own slots, never use or move an episode slot, and do not count against the episode daily limit.
- Clips post to Instagram Reels, Facebook Reels, TikTok and YouTube Shorts unless switched off for the show. A YouTube clip is uploaded as a Short.
- A clip with a source episode gets "Full episode on YouTube" and the link in its description once the episode is live.
- A Clip tag in the Inbox, the Queue and Upcoming. The API has `post_type`, `source_episode_id`, `clip_post_days`, `clip_time`, `clip_platforms` and a `post_type` filter on posts.

## 0.11.1 Fresh start and the bot box connection

- **Fresh start** (Settings, Pipeline): makes a backup bundle (database, Upcoming file, the files being removed, inventory, restore steps, checksums), checks it, then clears every script, idea, task record and Upcoming entry, cancels unposted drafts and switches the Claude API and Studio production off. Posted videos, analytics, spend history, the audit log and the drop log stay. Upcoming restarts at revision 1.
- **Delete** for Upcoming entries (owner only, restorable).
- **Tailscale listening** (Settings, Agent API): the API can also listen on the Mac's Tailscale address for the bot box. Only that address, only with a token.
- **Heartbeat and changes:** `GET /v1/sync`, `GET /v1/changes`, `updated_after` on Upcoming, `past_due` on posts, and a `missed_slot` reconcile check.
- **Channel states:** active, paused, on-hold, archived, shown in `GET /v1/brands` with post days, daily cap, blackout dates and aliases. On hold is a switch on Channel setup. Archived channels refuse drops and Upcoming writes. The Complaint Department starts on hold.
- **Names:** old channel names (`the-math-of-it`, `wonder-hollow-workshop`, `the-complaint-department`) map to the canonical slugs.
- **Optional QC gate:** `qc` and `beth_signoff` in the sidecar, required when the new switch is on.
- Docs: `docs/SYNC_GUIDE.md`.

## 0.11.0 The bot pipeline: drops, Inbox, Upcoming and new switches

Bots now write and make the episodes. ELO takes finished videos, schedules them with the times the owner set, and posts them. The schedule is only ever what is set in the app; a bot never picks or promises a time.

- **Claude API switch** (Settings, Pipeline). Off means no call to Anthropic at all ("Writing comes from bots."). Local `ollama:` models still work. The key Test button says "Claude API is off". A startup log line states the setting.
- **Studio production switch.** Off stops the Director's runway and production planners, the Show Writer, the Producer and manual write, produce and rebuild. Buttons are disabled with a tooltip and the Studio shows a banner. Comments, Analytics, Research, Spend, Telegram and the Library keep working. Both switches start off on a new install and on for an install already in use (migration 016).
- **Channel slugs** (`trash-panda`, `clock-out-early`, `teach-your-parents-tech`, `math-of-it`, `wonder-hollow`, `backup-heroes`, `complaint-department`) shown in the agent API and editable on Channel setup (migration 017).
- **Pipeline drops.** A sidecar with `schema_version` is checked (fields, channel, episode id, bot allowlist, approval, SHA-256, video format and length per channel, duplicates) and then logged, filed and scheduled by the existing next open slot. `preferred_slot` is ignored and logged. `.ready` marker, `.reason.json` next to `.error.txt`. A `docs/sidecar.schema.json` is generated from the code.
- **Oct 13 safeguards.** Posts are keyed by `episode_ref` (unique per channel). The file name must contain the episode id. The file, checksum and title are checked when scheduling and again right before posting; a mismatch holds the post and tells the owner. The title, file and checksum sent are written to the Activity Log.
- **Drop log** (`drops` table and `logs/drops.jsonl`), filterable and exportable.
- **Inbox screen** with Waiting, Held, Rejected, Log and Issues tabs and a menu badge.
- **Waiting rule.** A drop for a paused channel, a channel with no connected account, or with automatic scheduling off waits. Resuming a channel schedules its waiting drops in arrival order, and is refused with "Connect an account first" when no account is connected. A platform with no real account (or TikTok on Direct post) is skipped with a note; TikTok is Drafts only.
- **Reconcile** (hourly, at start, after changes, and Reconcile now): double booking, over the daily limit, invalid slot, orphan post, open slot guard, file drift, waiting too long, stuck upload, and the Upcoming checks. Report only. Optional auto fix moves a second bot post out of a taken slot. Low queue alert replaces the Director's missed slot alert.
- **Slot rules.** Daily limit per channel (default 1), blackout dates (global and per channel), minimum gap between posts. Retry waits are a setting (default 5, 15, 60 minutes).
- **Upcoming** (menu Plan): the shared `Shared/upcoming.json` with a Board and Table, ownership rules, revisions and conflict handling, atomic writes, live watching with polling, Restore previous, and the one time move of Studio ideas. Agent API: `GET`, `POST`, `PATCH /v1/upcoming`.
- **Bots** card: one token per bot (stored hashed), allowed channels, role, revoke. Bot tokens can read, drop and use Upcoming.
- **Agent API:** `POST /v1/drops`, `GET /v1/drops`, `GET /v1/drops/{id}`, `GET /v1/reconcile`, slots by channel slug with `days`, posts filters `origin` and `held`. 29 MCP tools.
- **Audit log** (Records): settings, schedule edits, swaps, cancels, deletes, rejections, posts, retention deletions, bot and Upcoming changes, with before and after. CSV export.
- **Other:** Swap times in the Queue, Dry run everything, retention default 30 days with an audit row per file, `/queue` and an offline reply in Telegram, `add idea for <channel>: ...`, Use the local model for chat and the Director with a status light.
- **Docs:** `GROKBOT_GUIDE.md` and `GROKBOT_DROP_GUIDE.md` rewritten for the pipeline, `upcoming.schema.json`, `openapi.json`, User Guide section 21.

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
