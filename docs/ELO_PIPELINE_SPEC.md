# ELO Pipeline Spec: Bot-Written, LTX-Rendered, Josh-Approved Drops (matched to ELO 0.10.0)

Target: ELO (Expect Less Output), the Electron app in `~/Projects/expect-less-output`, version 0.10.0.
Audience: Claude Code. This replaces the first draft of the spec. The first draft was written by a bot that could only see what it was told, so it asked for several things ELO already does, and it assumed a few things that are not true. This version says, for every requirement, what already exists and what is genuinely new.

Rules for the work:
- Make changes behind settings or flags. Do not delete a working code path without a flag.
- Reuse what exists. Do not write a second scheduler, a second log, a second settings system or a second pause.
- No em dashes in any text. Every UI string lives in `src/shared/copy.ts`. Times are stored as UTC and shown as America/New_York.
- Never log or show secrets.

Status tags used below: **EXISTS** (nothing to build, maybe a test), **EXTEND** (small change to something that exists), **NEW** (build it).

---

## 0. What the first draft got wrong or did not know

| # | First draft said | What ELO really has | What to do |
|---|---|---|---|
| 1 | Guide is `docs/GROKBOT_DROP_GUIDE.md` | There are two guides, both for Wonder Hollow: `docs/GROKBOT_GUIDE.md` (read an episode, make the video) and `docs/GROKBOT_DROP_GUIDE.md` (hand the video back by link). Both describe the current flow where **ELO writes the episode** and Grok Bot only makes the video. | Update both (section 9). |
| 2 | WhatsApp notifications and commands | **There is no WhatsApp in ELO.** Notifications are the macOS notification, **iMessage**, email, and a **Telegram bot** that answers questions and takes commands. | Use Telegram for everything the draft calls WhatsApp. Building WhatsApp is a separate, larger job (see question Q1). |
| 3 | "Gate every Claude call site" (writing, titles, tags, director, WhatsApp) | Every Claude call already goes through **one gateway** (`src/main/studio/agents/llm.ts`). About 14 modules use it: Show Writer, Script QC, Math and Safety checkers, Publisher (titles, descriptions, tags), Captions and translation, Research, Comments agent, Analytics summary, Thumbnails, Clips, Repetition guard, Producer prompt fixer, Director chat and the Telegram assistant. | One switch at the gateway, not a switch per call site (R1). |
| 4 | A local LLM must be added (OpenAI-compatible endpoint) | A local LLM route **exists**: any agent can be pointed at a model named `ollama:<model>` and it goes to the Ollama machine set in Settings, free, no Claude. The Telegram assistant is the agent called `Assistant`. A separate "Text assist" uses an OpenAI-compatible endpoint (Ollama or LM Studio). | EXTEND (R6). Ollama also serves an OpenAI-compatible address, so the laptop server can serve both. |
| 5 | Wonder Hollow Wed/Fri must be enforced "via channel settings", add a guard test | **Done** (migration 014, commit 777c13b). A brand with a weekly Studio cadence lists its `postDays` (Hollow: Wednesday and Friday). Every way of picking the next slot (`PostService.nextSlots` to `getNextOpenSlots({ weekdays })`) honors it. Test: `tests/studio/hollowSchedule.test.ts`. | EXISTS. Add a test for the drop path only. |
| 6 | Per-channel "days, times, cadence, timezone" in channel settings | Times are per brand **weekday and weekend slot lists** (Channels, Channel setup, Posting slots). Allowed days exist only through the Studio weekly cadence. **Timezone is global: America/New_York.** There is no per-channel timezone. | Reuse as is. Per-channel timezone is out of scope. |
| 7 | Slugs `trash-panda`, etc. must map to channel records | Channels are `brands` rows with numeric ids (1 to 7). There is **no slug** field. | NEW: add a `slug` column (alias) to brands. See section 2. |
| 8 | A vertical 5 to 180 second video, with audio, for every channel | Wrong for **Wonder Hollow**: it is a **16:9 long-form** brand, about 3 minutes by the show skill and up to 7 to 9.5 minutes by its Bible. The other six are 9:16 shorts. ELO already checks aspect and audio per brand format for Studio ingest. | The probe rules are **per channel format** (section 3), not one rule. |
| 9 | The drop log, Inbox Queue, audit log and reconcile are all new | Parts exist: Inbox folder with `Rejected` folder and `.error.txt`, the Activity Log, the Studio `audit_log`, `reconcile()` for stuck uploads, retention (Archivist), CSV export, per-brand auto-schedule. | Each requirement below says exactly what to reuse. |
| 10 | "Calendar entries" and "queue items" are separate stores that can disagree | The calendar is **computed from the `posts` table** (plus Studio episodes). There is no separate calendar store, so "orphan calendar entry" cannot occur in the way the draft describes. | R3 is rewritten to checks that can really fail. |
| 11 | Retry 3 tries, 5/15/60 minutes | Retry exists: 3 retries after 2, 10 and 30 minutes (4 attempts), then the post is marked failed and an alert is sent. Already never double-posts (per target state and locks). | EXTEND: make the backoff a setting, default as the draft asks. |
| 12 | Titles/descriptions/tags come only from the sidecar | True for **plain drops** already (the sidecar's `title` and `caption` are used). **Studio episodes** (the `episode_id` path) take their text from the episode package ELO wrote. | Pipeline drops use the sidecar text only. See section 3. |
| 13 | `ELO_API_TOKEN` in Settings > Agents | The token is **generated in Settings, Agent API**, shown once, and can be regenerated. `ELO_API_TOKEN` is only the name of the variable the MCP server reads. | Nothing to build. Use "Make a new token" for rotation. |
| 14 | Settings > Pipeline | There is no Pipeline tab. Settings has General, Studio, AI models and Local AI, Alerts and backup, Agent API, Testing tools. Per-channel switches live on **Channels, Channel setup**. | New switches go where they belong (section 5), plus one new read-only **Inbox** screen. |

---

## 1. ELO today (so the bot can see it)

**Menu (0.10.0):** Home; Create and schedule (Schedule, Calendar, Queue); Make (Studio); Results (Analytics); Set up (Channels, Settings); Records (Activity Log).

**The seven channels as they are now**

| id | Channel | Proposed slug | Format | Real platforms connected | Paused |
|---|---|---|---|---|---|
| 1 | Trash Panda | `trash-panda` | Short 9:16 | YouTube (auto), Facebook, Instagram, TikTok (drafts) | no |
| 2 | Clock Out Early | `clock-out-early` | Short 9:16 | YouTube (auto), Facebook, Instagram, TikTok (drafts) | no |
| 3 | Teach Your Parents Tech | `teach-your-parents-tech` | Short 9:16 | YouTube (auto), Facebook, Instagram. TikTok is a dry run | **yes** |
| 4 | The Math of It | `math-of-it` | Short 9:16 | YouTube (auto), Facebook, Instagram. TikTok is a dry run | no |
| 5 | Wonder Hollow Workshop | `wonder-hollow` | **Long 16:9** | **YouTube only** (auto). Facebook, Instagram, TikTok are dry runs | no |
| 6 | Backup Heroes | `backup-heroes` | Short 9:16 | **None connected** (all dry runs) | **yes** |
| 7 | The Complaint Department | `complaint-department` | Short 9:16 | **None connected** (all dry runs) | **yes** |

Consequences the draft did not know: a drop for Backup Heroes or The Complaint Department cannot post anywhere until real accounts are connected (Channels, Connections). A `tiktok` platform on channels 1 and 2 goes to the TikTok **inbox as a draft** that Josh finishes in the TikTok app (the app is not approved for Direct post). Wonder Hollow posts to YouTube only.

**What exists that the spec touches**

- **Schedule screen** (One video, Many videos), **Queue** (list, reschedule, edit, cancel, Export CSV), **Calendar** (click a day to start a post).
- **Slots:** per channel weekday and weekend times, and the "next open slot" function (`PostService.nextSlots`, `src/shared/slots.ts`). Slots already taken are skipped. Hollow's Wednesday and Friday rule is applied inside it.
- **Inbox folder per channel** (`<Media Root>/<Channel>/Inbox`), switched on per channel (Channels, Channel setup, "Watch this channel's Inbox folder"). Waits until a file stops growing (5 seconds), gives a bare video 10 seconds for its sidecar, then creates a post. A second switch, "Schedule Inbox videos automatically (next open slot)", sends it to the next slot instead of waiting as a draft. Anything refused goes to `Inbox/Rejected` with an `.error.txt`. A `video_url` sidecar makes ELO download the video itself (http or https, MP4 or MOV, under 2 GB, 10 minutes).
- **Studio ingest** (the `episode_id` path used for Wonder Hollow now): checks the video (aspect, audio, length against the episode, black or frozen stretches), refuses a second video for an episode, binds the post to the episode text, writes the title, description and thumbnail, and schedules it.
- **Agent API** on `127.0.0.1:47821`, bearer token, off by default. Routes: brands, `GET /v1/slots/next-open`, posts (create, list, get, change, cancel, retry, stats), calendar, activity, health, episodes (list, get), brand stats, and Studio routes (spend, caps, Bible skills, flagged tasks, retry, rebuild, pause a brand). Two switches: "Agents may create drafts only" (default on) and "Agents may change Studio settings" (default off). MCP tools wrap the same routes.
- **Alerts:** macOS notification always, plus iMessage, email and Telegram. Kinds: failure, missed, reauth, expiry, cap, media root. Quiet hours. A morning digest.
- **Telegram bot:** paired once. Commands `/last`, `/stats`, `/today`, `/spend`, `/flags`, `/brands`, `/status`, `/latest`, `/pause`, `/resume` (all or one channel, after YES). Plain questions go to the `Assistant` model.
- **One pause:** per channel on Channels, Channel setup; **Pause everything** at the bottom of the left menu and in the menu bar icon. Both pause posting and the Studio together.
- **Retention (Archivist):** removes the video and the full thumbnail of anything posted more than `retentionDays` (default 60) ago, keeps the package and the stats, has a dry-run report.
- **Dry run:** an account in `dry_run` mode acts like a platform and never contacts it. Per account, not one global switch.
- **Logs:** `activity_log` (plain language, shown in Activity Log) and `audit_log` (Studio and agent actions: pause, flag, rebuild...). Settings changes are not audited today.
- **Backups, search (Command K), Analytics, Best times, existing video import, CSV export, setup checklist** (not part of this spec).

---

## 2. Channel slugs (NEW, small)

- Migration: `brands.slug TEXT` (unique, lowercase, `a-z0-9-`), filled for the seven channels with the slugs in the table above. Slugs are an alias. Do not rename channels or change ids.
- A new channel gets a slug generated from its name (editable on Channels, Channel setup).
- The Inbox folder already decides the channel. A sidecar `channel` must equal that folder's slug, or the drop is rejected (the existing "sidecar names another channel" rule, with the slug).
- Expose the slug in `GET /v1/brands`.

---

## 3. Sidecar and intake (EXTEND the existing Inbox watcher)

### 3.1 Two sidecar modes, one file name rule
The watcher already accepts `<name>.mp4` plus `<name>.json`. Keep that. Add a **pipeline sidecar** recognized by `"schema_version"` being present.

| Sidecar | Detected by | Behavior |
|---|---|---|
| Plain (today) | no `schema_version`, no `episode_id` | Unchanged. Fields: `title, caption, platforms, caption_overrides, ai_flags, tiktok, thumb_offset_ms, scheduled_at, next_slot, status`. |
| Studio episode (today) | `episode_id` and no `schema_version` | Unchanged (Studio ingest, section 1). |
| **Pipeline (new)** | `schema_version` present | New validation and the safeguards below. Not allowed to mix with the Studio path. |

Today the watcher **rejects unknown fields** in a plain sidecar. A pipeline sidecar must be parsed by its own schema (`docs/sidecar.schema.json`) so `approval`, `checksum`, `source_bot`, `render` and the rest are accepted and recorded.

### 3.2 Pipeline sidecar fields and how each maps to ELO

```json
{
  "schema_version": "1.0",
  "channel": "clock-out-early",
  "episode_id": "COE-E007",
  "title": "Find Any Chrome Tab Instantly",
  "description": "...",
  "tags": ["chrome", "productivity"],
  "thumbnail_path": "COE-E007_thumb.jpg",
  "video_file": "COE-E007.mp4",
  "platforms": ["youtube", "tiktok", "instagram"],
  "preferred_slot": "2026-10-20T12:00:00-04:00",
  "approval": { "approved_by": "Josh", "approved_at": "2026-10-16T15:30:00-04:00" },
  "checksum": { "algo": "sha256", "value": "<hex of mp4>" },
  "source_bot": "grok-bot",
  "render": { "model": "LTX-2.5", "resolution": "720x1280", "fps": 24, "duration_s": 29.8, "segments": 4, "segment_len_s": 8, "render_job_id": "...", "rendered_at": "...", "gpu": "...", "cost_usd": 0.05 }
}
```

| Sidecar field | Maps to | Status |
|---|---|---|
| `schema_version` | Pipeline mode switch. `"1.0"` only, others rejected. | NEW |
| `channel` | Slug alias (section 2). Must match the Inbox folder's channel. | NEW |
| `episode_id` | **New `posts.episode_ref`** (text), unique per channel. It is the pipeline's id, **not** a Studio episode id (those look like `wonder-hollow-workshop-2026-0003`). A pipeline drop creates no Studio episode. | NEW |
| `title` | `posts.title`. Limits: 100 characters (existing YouTube limit). | EXISTS |
| `description` | `posts.caption` (the shared caption, used as the YouTube description and the Instagram and TikTok caption). Per platform text stays possible through `caption_overrides` (optional extra field, existing). | EXISTS |
| `tags` | **EXTEND.** ELO has no tag field on a post today (YouTube tags come from the Studio package or hashtag sets). Store `tags` on the post, send them as YouTube tags, and append as hashtags to the Instagram and TikTok caption only if the caption does not already contain them. Maximum 30. Decision in Q4. | EXTEND |
| `thumbnail_path` | **EXTEND.** Custom thumbnails exist for Studio episodes (YouTube) but not for plain posts. Accept a relative JPG or PNG (under 2 MB), store it, set it on YouTube after upload. Instagram keeps `thumb_offset_ms` (optional extra field, existing). | EXTEND |
| `video_file` | Must equal the video's basename in the Inbox. | NEW check |
| `platforms` | `post_targets` (existing). Platforms the channel has no real connected account for are an error (see Backup Heroes, Complaint Department), not a silent dry-run post. | EXTEND |
| `preferred_slot` | Today `scheduled_at` is accepted at any time. Pipeline rule: honored **only** if it is an open slot per the channel's slots and weekday rule (use `nextSlots` and compare), otherwise fall back to the next slot and log why. | NEW rule |
| `approval.approved_by`, `approved_at` | Stored in the drop log. Missing means reject. | NEW |
| `checksum` | SHA-256 of the mp4, verified at intake, before scheduling and again before posting. | NEW |
| `source_bot` | Allowlist (`grok-bot`, `kids-comedy`, `beth`), a setting. Stored in the drop log. | NEW |
| `render.*` | Stored as JSON in the drop log. Not shown anywhere else. | NEW |

Required: `schema_version, channel, episode_id, title, description, platforms, approval.approved_by, approval.approved_at, checksum, source_bot, video_file`. Optional: `tags, thumbnail_path, preferred_slot, render`.
Extra ELO fields stay allowed in a pipeline sidecar: `caption_overrides, ai_flags, tiktok, thumb_offset_ms`.

### 3.3 Probe rules are per channel format (corrects the first draft)
Use the existing channel `format` (`short` or `long`) and the existing `probe()` helper (`src/main/studio/ffmpeg.ts`):
- **Short:** aspect 9:16 within 3 percent (existing tolerance), duration 5 to 180 seconds, has audio.
- **Long (Wonder Hollow):** aspect 16:9 within 3 percent, duration 60 to 720 seconds (settable per channel), has audio.
- A failure rejects the drop with the reason. (The Studio's "length close to the script target" check applies only to Studio episodes.)

### 3.4 Intake order (reuses the watcher)
1. Wait until the mp4 and json are both there and the sizes are stable for 5 seconds (**EXISTS**). Add an optional `<name>.ready` marker, which skips the wait (**NEW, optional**).
2. Validate the sidecar schema, then the checksum, then probe (**NEW** for pipeline mode).
3. Duplicate check: same SHA-256, or the same channel and `episode_id` in the queue or posted (**NEW**). Result `duplicate`, not scheduled.
4. The Oct 13 safeguards (3.5).
5. Create the post as today. The accepted video moves to the channel's **Queue** folder (not an `accepted` subfolder: ELO already moves accepted files there, and `Inbox` only ever holds files still waiting). A refused drop moves to `Inbox/Rejected` with the existing `.error.txt` **plus** a machine readable `<name>.reason.json` (**EXTEND**).
6. Write the drop log row, send the notification, schedule if the channel's auto-schedule is on (existing switch).

### 3.5 Oct 13 safeguards (wrong episode or title scheduled)
What already exists for **Studio episodes**: one video per episode (a second one is refused), the post is bound to the title and text written when its video arrived, and later runs cannot overwrite them (commit 777c13b). The pipeline path has none of this, so add:
- Scheduling and posting are keyed by `posts.episode_ref` only. No fuzzy match by file name or title, and no "latest file" picking.
- The Inbox file name must contain the `episode_id` (for example `COE-E007*.mp4`), else hold.
- Store `checksum`, `video_file` and the title on the post at scheduling time. **Before the scheduled time and again right before posting**, re-read the file: the checksum and basename must match and the stored title must equal the title in the sidecar copy kept with the post. A mismatch **holds** the post (status stays scheduled but flagged, not posted) and sends a notification.
- The post payload is built from the stored record. Log the title, file and checksum that were actually sent (one line per platform).

---

## 4. Requirements (matched)

### R1: Disable the Claude API  (EXTEND)
- New setting `ai.claudeApi.enabled`, default **off for the pipeline build** (default on elsewhere would change today's behavior, so ship it as a switch in Settings, Studio, with the current value kept on for the owner until Josh turns it off).
- One check inside the gateway (`LlmGateway.call`, `src/main/studio/agents/llm.ts`): when off and the model is not local (`ollama:`), throw a plain error "Writing comes from bots." before any network call. Every caller already handles a gateway error as a flagged task, so nothing else changes.
- Because the Studio Writer, Script QC, Publisher text and Director all use Claude by default, turning it off stops **Studio writing** for Hollow. That is the intent of the new pipeline, but it means Hollow episodes will no longer be written inside ELO. See Q2.
- UI: the Studio "Write an episode now" button and the Bible's Suggest buttons are disabled with the tooltip "Writing comes from bots." when the switch is off.
- Startup log line: "Claude API is off." or "Claude API is on."
- The only other place that touches Anthropic is the key **Test** button (Settings, Studio, keys: `AnthropicClient.test()` calls `/v1/models`, no tokens spent). When the switch is off, that button says "Claude API is off" and makes no call.
- Test: a source scan that `api.anthropic.com` appears only in the Anthropic client (it does today, and the test keeps it that way), and a drop to dry-run post run that makes zero requests to `api.anthropic.com` (fetch mock).

### R2: Schedule with the existing next-slot algorithm  (EXISTS + one rule)
- Accepted drops with auto-schedule on go through `PostService.nextSlots(brandId)` (existing), which already skips slots taken by other posts and honors Hollow's Wednesday and Friday rule.
- `preferred_slot`: NEW rule in 3.2.
- Daily cap and blackout dates: see section 5 (both NEW). `nextSlots` must respect them, so add the two inputs to `getNextOpenSlots` (it already takes `taken` and `weekdays`).
- Test: three Hollow drops on a Monday land on Wednesday, Friday and the next Wednesday (an equivalent test already exists for the Studio path in `tests/studio/hollowSchedule.test.ts`; add the same for the pipeline drop).

### R3: Reconciliation  (NEW, rewritten to what can actually fail)
Run on startup, after every schedule change, hourly, and on a **Reconcile now** button (Settings, Agent API or Queue). `Scheduler.reconcile()` exists but only repairs targets stuck uploading; keep it, add a separate read-only `Reconciler` service that reports and never deletes.

| Check | Meaning in ELO |
| --- | --- |
| Double-booking | Two posts for one channel at the same time slot, or more posts on a day than the daily cap. |
| Invalid slot | A scheduled post on a weekday the channel no longer allows (Hollow on a Monday), on a blackout date, or at a time that is not one of the channel's slots (unless it was set by hand). |
| Orphan Studio episode | A Studio episode in status Scheduled whose post is missing, canceled or posted. |
| Orphan post | A scheduled post with no targets, or whose channel is archived or paused for a long time. |
| Open-slot mismatch | The open slots the Calendar draws differ from `nextSlots` for the same window. (Both come from the same function, so this is a regression guard.) |
| File drift | The queue video is missing, or its SHA-256 differs from the one stored at drop time (pipeline posts). |
| Stuck upload | Already handled by `Scheduler.reconcile()`. Include its result in the report. |

- Output: a list of issues (kind, channel, post id, plain message), stored for the Inbox screen and `GET /v1/reconcile`, plus an alert of kind `other` when a new issue appears (not on every run).
- Auto-fix only with `reconcile.autoFix` (default off), and only for the unambiguous case: re-create the Studio episode link for a valid post. Everything else is reported only. Never delete.

### R4: Drop log  (NEW)
- Table `drops` (append only): `drop_id, received_at (ISO UTC, shown Eastern), source_bot, file_name, file_path, file_size, sha256, channel (slug), episode_id, title, sidecar_valid, result (accepted|rejected|duplicate|held), reason, scheduled_slot (nullable), post_id (nullable), approved_by, approved_at, render_json`.
- Also append each row to `logs/drops.jsonl` inside the ELO data folder.
- Reuse the Activity Log writer for the human line ("Drop accepted: COE-E007 for Clock Out Early"). The drop log is the machine record.
- Viewable and filterable on the **Inbox** screen (R5), Export CSV (the shared `toCsv` helper and Save dialog exist).

### R5: "Dropped, not scheduled" view  (NEW screen, mostly a view over existing data)
- A new menu item **Inbox** under **Create and schedule**, with tabs **Waiting** (accepted, no slot yet: these are posts with status `draft` that came from the Inbox, so add `posts.origin` = `inbox`), **Held**, **Rejected** (read from the drop log), **Log** (R4) and **Issues** (R3).
- Columns: thumbnail (the existing poster frame), channel, episode id, title, source bot, dropped at, duration, status, reason. Filters: channel, bot, status. Badge on the menu item (the existing red badge mechanism).
- Row actions: **Schedule (next slot)** (existing `posts.schedule` with `nextSlots`), **Pick slot** (existing Schedule picker), **Hold**, **Reject with a note** (moves the files to `Rejected`), **Open file** (existing reveal in Finder).
- Today an Inbox video that waits is just a draft in the **Queue**. The Queue keeps showing it. The Inbox screen is the focused view the spec asks for.

### R6: Local LLM for the chat and the Director  (EXTEND, replaces the WhatsApp wording)
- What exists: per agent model choice (Settings, AI models and Local AI) with `ollama:<model>` routing to the Ollama host, a health test on that screen, and the Telegram assistant and Director chat both use the `Assistant` agent.
- Add: a **master default** "Use the local model for: chat and the Director" that sets the `Assistant` model to the local one in one click, plus the status light (Home and the Telegram card) from the existing Ollama test.
- Add: if the endpoint is down, **Telegram currently sends nothing** (the error is only logged). Send a fixed reply "The local model is offline. These still work: /status /last /today /stats /spend /flags /pause /resume." The fixed commands never need a model.
- Command words from the draft map to Telegram: `status` is `/status`, `pause` is `/pause`, `resume` is `/resume`, `queue` is `/today` (add a `/queue` alias).
- Question Q3: is the laptop server an Ollama server (works today) or another OpenAI-compatible server (needs a small client)?

---

## 5. Controls (matched to where they live)

| Control (first draft) | Status in ELO | Where / change |
| --- | --- | --- |
| Global pause (kill switch) | **EXISTS** | **Pause everything** (left menu, menu bar icon, Telegram `/pause`). Also pauses the Studio. |
| Per-channel pause | **EXISTS** | Channels, Channel setup, Pause this brand (one place). |
| Per-channel auto-schedule | **EXISTS** | Channels, Channel setup, "Schedule Inbox videos automatically (next open slot)" (off by default). The draft wants it **on** for pipeline channels: set it on for the seven when the pipeline ships. |
| Per-channel by platform toggle | **EXISTS** (Studio) / EXTEND | Studio settings per channel has platform ticks. The Inbox watcher should also skip a platform the channel has switched off, not only one with no account. |
| Claude API enabled | NEW | R1. |
| Local LLM | EXISTS / EXTEND | R6. |
| Drop intake enabled | **EXISTS** per channel | "Watch this channel's Inbox folder" is the intake switch. Add a global one (`pipeline.intake.enabled`) so one tick stops all seven. |
| Agent API enabled, rotate token | **EXISTS** | Settings, Agent API (Turn on, Make a new token). |
| Duplicate detection | NEW | 3.4. |
| Sidecar validation strict | NEW | `pipeline.sidecar.strict` (default on). Off means warnings are logged instead of rejected, for testing only. |
| Require approval block | NEW | `pipeline.requireApproval` (default on). |
| Notifications per event | EXTEND | Alert kinds today: failure, missed, reauth, expiry, cap, media root, other. Add kinds `drop_accepted`, `drop_rejected`, `scheduled`, `posted`, `reconcile`, and a daily summary (the morning digest exists and can be extended). Each has a switch under Alerts and backup. Delivery: macOS, iMessage, email, Telegram (no WhatsApp). |
| Post retry policy | EXISTS / EXTEND | 3 retries after 2, 10, 30 minutes today. Make the minutes a setting (default 5, 15, 60 as the draft asks). Idempotency already exists per post target (a target that posted is never posted again). Add the key `channel+episode_ref+platform` as a unique index for pipeline posts. |
| Manual reschedule, unschedule, swap | **EXISTS** | Queue (bulk reschedule), post editor, Calendar drag. Add a "swap" button (swap two posts' times) in the Queue. Run the reconcile after each (R3). |
| Holiday and blackout dates | NEW | Today there are Studio holidays (for tie-in ideas only). New: `blackoutDates` global and per channel, in Channels, Channel setup. `getNextOpenSlots` skips them. |
| Daily post cap per channel | NEW (hard) | Today only a soft warning at 4 posts a day. New: per channel `maxPostsPerDay` (default 1 for pipeline channels). |
| Minimum gap between posts | NEW | Global minutes, default 0. |
| Reconcile auto-fix | NEW | R3. |
| Retention of posted files | **EXISTS** (Archivist) | Default is 60 days and it keeps the package and stats. Change the default to 30 days if Josh wants, keep the sidecar copy and the drop log. It never touches unposted media. |
| Dry-run mode | EXTEND | Today an account can be in dry-run mode. Add one global switch "Dry run: schedule and log, never call a platform" that makes every adapter behave as the dry run adapter (the adapter exists, `src/main/adapters/dryRun.ts`). |

### Audit log  (EXTEND)
- `audit_log` exists (columns: time, brand, agent, action, task, episode, detail). Today it records Studio and agent actions only.
- Add rows (actor `josh`, `agent:<bot>` or `system`, action, target, before, after) for: every settings change, every schedule edit (create, reschedule, cancel, hold), every rejection, every post, every deletion by retention. Reuse `AuditLog.write`. The actor for API calls is the token's bot name; add an optional `X-ELO-Bot` request header (the token itself is shared).
- A new **Records, Audit log** tab next to the Activity Log, with a filter and Export CSV.

---

## 6. Agent API (matched to the routes that exist)

All under `/v1`, same bearer token, same localhost only rule, same "Agents may create drafts only" and "Agents may change Studio settings" switches. Nothing here needs a second API.

| First draft | In ELO |
| --- | --- |
| `POST /drops` | NEW: `POST /v1/drops` registers a file path already on the Mac (or uploads a small sidecar with `video_url`), runs the same intake as the folder watcher and returns the drop result. Needs "Agents may create drafts only" off when it asks to schedule (existing gate). |
| `GET /queue?status=` | EXISTS as `GET /v1/posts?status=` (draft, scheduled, ...). Add `origin=inbox` and `held`. |
| `GET /slots/open?channel=&days=14` | EXISTS as `GET /v1/slots/next-open?brand_id=&count=` (by id). Add `channel` slug and a `days` range. |
| `GET /reconcile` | NEW: `GET /v1/reconcile` returns the latest issues. |
| `GET /drops/:id` | NEW: `GET /v1/drops` (list, filters) and `GET /v1/drops/{id}`. |
| `agent.canSchedule` toggle | EXISTS as "Agents may create drafts only" (off means agents may schedule). |

Add matching MCP tools (the tool list is generated from the route table, so each new route gets a tool by adding `tool:` to it) and regenerate `docs/openapi.json` (a test fails if it is stale).

---

## 7. Acceptance tests (matched)

Each line says whether a similar test exists. New tests go in `tests/` using the in-memory database and the existing fake servers.

1. **Claude off.** Zero requests to `api.anthropic.com` for a full pipeline drop to dry-run post. *(NEW)*
2. **Valid drop.** mp4 and json accepted, logged with SHA-256, scheduled to what `nextSlots` returns. *(similar: `tests/inbox.test.ts`; add the pipeline path)*
3. **Wonder Hollow.** Three drops on a Monday land on Wednesday, Friday, next Wednesday. *(exists for Studio in `hollowSchedule.test.ts`; add the pipeline path)*
4. **`preferred_slot`** invalid or taken falls back to the next slot, reason logged. *(NEW)*
5. **Invalid sidecar** (missing approval, bad channel slug, bad checksum, unknown bot) is rejected, `.error.txt` and `.reason.json` written, notification sent. *(partly exists: rejection and `.error.txt`)*
6. **Duplicate** (same checksum or same channel and episode id) is marked duplicate and not scheduled. *(NEW)*
7. **Oct 13 regression.** Sidecar `episode_id` E007 with E006's title, or file `COE-E006.mp4`, is held. File swapped after scheduling is caught before posting and held. *(NEW; the Studio-path version exists in `ingest.test.ts`)*
8. **Partial drop** (mp4 without json, or still copying) is not processed. *(EXISTS)*
9. **Reconcile.** Seeded double booking, orphan Studio episode, file drift and blackout conflict are all reported and nothing is deleted. *(NEW)*
10. **Inbox screen** shows exactly the waiting drops, and the badge count matches. *(NEW)*
11. **Kill switch.** Pause everything: the scheduled time passes and nothing posts. Resume: posts per the missed rule, no double post. *(EXISTS in scheduler tests; add the pipeline path)*
12. **Per-channel pause, auto-schedule off, platform off** each behave as in section 5. *(mostly EXISTS)*
13. **Retry.** A platform fails twice then works: one post, three attempts logged, backoff from the new setting. *(EXISTS for 2, 10, 30; add the setting)*
14. **Blackout and daily cap.** Next slot skips the blackout day and respects the cap. *(NEW)*
15. **Local LLM.** `/status` works with no model. A question with the endpoint down gets the offline message and the fixed commands still work. *(NEW; Telegram tests exist in `tests/studio/telegram*.test.ts`)*
16. **Intake switch off.** Files stay untouched in the Inbox. *(EXISTS per channel; add the global one)*
17. **Retention.** A posted file older than N days is removed, an unposted one never is, and an audit row is written. *(EXISTS in the Archivist tests; add the audit row)*
18. **Audit log** records each setting change with before and after. *(NEW)*
19. **Format rules.** A 16:9 video is rejected for a short channel and accepted for Wonder Hollow, and a 9:16 video the other way round. *(NEW)*
20. **No real account.** A drop for a channel with no connected account for the requested platform is rejected with that reason (Backup Heroes, Complaint Department). *(NEW)*

---

## 8. Out of scope (unchanged)
Script writing, rendering and Runpod control, and the review step (all happen before the drop). Also out of scope: WhatsApp, per-channel time zones, and a hosted version.

---

## 9. Documents to update
- `docs/GROKBOT_GUIDE.md` and `docs/GROKBOT_DROP_GUIDE.md`: keep the Studio `episode_id` instructions for as long as Studio still writes Hollow episodes, and add a new section "Pipeline drops" with the sidecar in 3.2, the file name rule, what happens on rejection (`.error.txt` and `.reason.json`), and the `X-ELO-Bot` header. Correct the posting days (the drop guide says Tuesday and Friday, Hollow is Wednesday and Friday).
- `docs/sidecar.schema.json` (new, generated from the same zod schema the watcher uses, with a test that fails if it is stale, like `docs/openapi.json`).
- `docs/USER_GUIDE.md` (new Inbox screen, new switches) and `CHANGELOG.md`.
- `docs/AI_BOT_PROMPT.md` (the general bot prompt) gets a short pointer to the pipeline guide.

---

## 10. Decisions needed from Josh before building

- **Q1. WhatsApp or Telegram?** ELO has Telegram and iMessage. WhatsApp would need a WhatsApp Business account and a hosted webhook (ELO runs on a laptop with no public address). Recommended: Telegram, no WhatsApp.
- **Q2. What happens to Studio writing for Wonder Hollow?** Turning Claude off stops ELO from writing episodes. Do the bots now write **all** seven channels, and does the Studio Library stop being the source of Hollow episodes? If yes, Hollow switches from the Studio `episode_id` path to the pipeline drop, and `GROKBOT_GUIDE.md` is rewritten. If the bots only write the six other channels, Hollow keeps its Studio flow and only the other six use pipeline drops.
- **Q3. What runs on the laptop server?** Ollama (works now) or another OpenAI-compatible server (a small client is needed).
- **Q4. Tags.** Send `tags` as YouTube tags only, or also as hashtags on Instagram and TikTok?
- **Q5. Backup Heroes and The Complaint Department** have no real accounts. Connect them first (Channels, Connections), or accept drops for them as dry runs until you do?
- **Q6. TikTok.** Channels 1 and 2 post to TikTok **drafts** only (the app is not approved for Direct post). Is that acceptable for pipeline drops?
- **Q7. Defaults.** Auto-schedule on and a daily cap of 1 for all seven channels, retention 30 days, retries at 5, 15 and 60 minutes. Confirm or change.
