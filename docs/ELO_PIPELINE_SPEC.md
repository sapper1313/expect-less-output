# ELO Pipeline Spec v2: Bot-Written, LTX-Rendered, Josh-Approved Drops (matched to ELO 0.10.0)

Target: ELO (Expect Less Output), the Electron app in `~/Projects/expect-less-output`, version 0.10.0.
Audience: Claude Code. This replaces the first matched spec. It folds in Josh's decisions and the new **Upcoming episodes** requirement (R7). The bot that wrote the original could only see what it was told, so each requirement here says what ELO already does and what is genuinely new.

Rules for the work:
- Make changes behind settings or flags. Do not delete a working code path without a flag.
- Reuse what exists. No second scheduler, log, settings system, pause or API.
- No em dashes in any text. Every UI string lives in `src/shared/copy.ts`. Times are stored as UTC and shown as America/New_York.
- Never log or show secrets. Every UI action is also reachable through `src/main/api.ts`.

Status tags: **EXISTS** (nothing to build, maybe a test), **EXTEND** (small change), **NEW** (build it).

---

## 0. Decisions locked by Josh

**The one rule above all others: the schedule is what Josh sets in the app.** Bots and their guides never choose, promise or request a posting time. ELO's channel slots, allowed days, daily cap, blackout dates and pauses decide every date. Every guide given to a bot must say this in the first paragraph.

| Question | Josh's answer | What it means in this spec |
| --- | --- | --- |
| Q1 notifications | Stay on **Telegram** | No WhatsApp anywhere. Alerts go out through the macOS notification, iMessage, email and Telegram (all exist). |
| Q2 who writes and produces | **All episodes stop being written and produced by ELO** | ELO becomes intake, schedule and post only, for all seven channels (R8). Wonder Hollow moves off the Studio `episode_id` path onto the pipeline drop. |
| Q3 laptop server | **Keep as is, Ollama** | The existing `ollama:<model>` route is used. No new client. |
| Q4 tags | **Both** | `tags` become YouTube tags and also hashtags on Instagram and TikTok. |
| Q5 channels with no accounts | **Keep in a queue until Josh sets up the account and clicks resume** | Backup Heroes and The Complaint Department accept drops and hold them. Nothing is scheduled until the channel is resumed with a real account connected (R2). |
| Q6 TikTok | **All TikTok channels work the same** | TikTok is Drafts mode on every channel (the video goes to the TikTok inbox and Josh finishes it in the TikTok app). See assumption A1. |
| Q7 defaults | **Fine** | Auto-schedule on, daily cap 1, retention 30 days, retries at 5, 15 and 60 minutes. |

---

## 1. What the first draft got wrong or did not know (still true)

| # | Assumed | What ELO has | Result |
| --- | --- | --- | --- |
| 1 | Guide is `GROKBOT_DROP_GUIDE.md` | Two guides exist for Wonder Hollow: `docs/GROKBOT_GUIDE.md` (read an episode, make the video) and `docs/GROKBOT_DROP_GUIDE.md` (hand back by link). Both describe ELO writing the episode, and the drop guide says Tuesday where Hollow posts Wednesday. | Rewrite both for the pipeline (section 11). |
| 2 | Gate every Claude call site | One gateway for all of them (`src/main/studio/agents/llm.ts`). | One switch at the gateway (R1). |
| 3 | A local LLM client must be added | `ollama:<model>` routing exists per agent. The Telegram assistant and the Director chat are the agent `Assistant`. | EXTEND (R6). |
| 4 | Wed/Fri must be built | **Done** (migration 014, `tests/studio/hollowSchedule.test.ts`). It lives in `PostService.postDays` and `getNextOpenSlots({ weekdays })`. | EXISTS. |
| 5 | Per channel days, times, cadence, timezone | Times are per channel weekday and weekend slot lists. Allowed days exist through the Studio weekly cadence. **Timezone is global Eastern.** | Reuse. |
| 6 | Slugs map to channels | Channels are `brands` rows with ids. **No slug field.** | NEW alias (section 3). |
| 7 | Vertical 5 to 180 s for every channel | **Wonder Hollow is 16:9 long-form.** The other six are 9:16 shorts. | Probe rules per channel format (4.3). |
| 8 | Calendar and queue are separate stores | The calendar is computed from the `posts` table (plus Studio episodes). | R3 is rewritten to checks that can fail. |
| 9 | Retry 3 tries, 5/15/60 | 3 retries after 2, 10, 30 minutes today, never double-posts. | EXTEND: make it a setting. |
| 10 | Titles from the sidecar only | True for plain drops already. | Pipeline drops use sidecar text only. |
| 11 | `ELO_API_TOKEN` in Settings | The token is made in Settings, Agent API ("Make a token" or "Make a new token"). `ELO_API_TOKEN` is only the MCP server's variable name. | Nothing to build for one token. R7 needs more (6.5). |
| 12 | A Settings > Pipeline tab | Settings tabs: General, Studio, AI models and Local AI, Alerts and backup, Agent API, Testing tools. Per channel switches are on **Channels, Channel setup**. | Place each switch where it belongs (section 7). |
| 13 | `preferred_slot` is honored if valid | Contradicts Josh's rule that the schedule is the app's. | **Ignored** and logged (4.2). |
| 14 | Sidecar `episode_id` is `COE-E007` and the Upcoming id is `clock-out-early-2026-0007` | Two id formats for one thing, and R7 says they must match. | One format everywhere (U1, recommended `<slug>-<year>-<nnnn>`, the shape ELO ids already have). |
| 15 | `Inbox/shared/upcoming.json` | ELO's Inbox is **per channel** (`<Media Root>/<Channel>/Inbox`). There is no top-level Inbox. | Default path `<Media Root>/Shared/upcoming.json`, configurable (6.2). |
| 16 | Bots are told apart by who edited | The API has **one token**. Ownership rules (R7) cannot be enforced without knowing which bot called. | Per-bot tokens (6.5). |
| 17 | The missed slot alert is still right | The Director's "A posting slot will be missed ... episode is Ready for production" alert is about Studio episodes. With ELO not producing, it would fire wrongly or never. | Replace with a low queue alert (R9). |

---

## 2. ELO today (so the bot can see it)

**Menu (0.10.0):** Home; Create and schedule (Schedule, Calendar, Queue); Make (Studio); Results (Analytics); Set up (Channels, Settings); Records (Activity Log).

**The seven channels now**

| id | Channel | Slug | Format | Real platforms connected | Paused |
| --- | --- | --- | --- | --- | --- |
| 1 | Trash Panda | `trash-panda` | Short 9:16 | YouTube (auto), Facebook, Instagram, TikTok (drafts) | no |
| 2 | Clock Out Early | `clock-out-early` | Short 9:16 | YouTube (auto), Facebook, Instagram, TikTok (drafts) | no |
| 3 | Teach Your Parents Tech | `teach-your-parents-tech` | Short 9:16 | YouTube (auto), Facebook, Instagram. TikTok is a dry run | **yes** |
| 4 | The Math of It | `math-of-it` | Short 9:16 | YouTube (auto), Facebook, Instagram. TikTok is a dry run | no |
| 5 | Wonder Hollow Workshop | `wonder-hollow` | **Long 16:9** | **YouTube only** (auto). Others dry run | no |
| 6 | Backup Heroes | `backup-heroes` | Short 9:16 | **None** (all dry runs) | **yes** |
| 7 | The Complaint Department | `complaint-department` | Short 9:16 | **None** (all dry runs) | **yes** |

**What exists that this spec touches**
- **Schedule** (One video, Many videos), **Queue** (reschedule, edit, cancel, Export CSV), **Calendar** (click a day to start a post). The next open slot comes from `PostService.nextSlots` and skips slots taken by other posts.
- **Inbox folder per channel**, switched on per channel. Waits for a stable file (5 s), gives a bare video 10 s for its sidecar, creates a post (a draft, or scheduled in the next slot if the channel's "Schedule Inbox videos automatically" is on). Refused files go to `Inbox/Rejected` with an `.error.txt`. A `video_url` sidecar makes ELO download the video itself.
- **Studio ingest** (the `episode_id` path used for Hollow today). Stays in the code, unused once Hollow moves to pipeline drops (R8).
- **Agent API** on `127.0.0.1:47821`, one bearer token, off by default, with "Agents may create drafts only" (default on) and "Agents may change Studio settings" (default off). MCP tools are generated from the same route table.
- **Alerts** (macOS, iMessage, email, Telegram), quiet hours, a morning digest. **Telegram bot**: `/last /stats /today /spend /flags /brands /status /latest /pause /resume` (all or one channel, after YES), plus plain questions to the `Assistant` model.
- **One pause** per channel (Channels, Channel setup) and **Pause everything** (left menu, menu bar). Both pause posting and the Studio together.
- **Retention (Archivist)**, **per account dry run**, `activity_log` and `audit_log`, backups, search, Analytics, CSV export, setup checklist (not part of this spec).
- **Studio** agents (Show Writer, Producer, Publisher, Comments, ...) and the **Director**, whose planners (`runwayPlanner`, `productionPlanner`, `missedSlotWatcher`, `upkeepPlanner`) create writing and production tasks from each channel's cadence. Agents can be switched off by name (`disabledAgents`).

---

## 3. Channel slugs (NEW, small)
- `brands.slug` (unique, lowercase `a-z0-9-`) filled with the slugs above. An alias: no renames, no id changes. A new channel gets a generated slug (editable on Channel setup).
- The Inbox folder decides the channel. A sidecar `channel` must equal that folder's slug, else rejected.
- Slug appears in `GET /v1/brands`.

---

## 4. Sidecar and intake (EXTEND the Inbox watcher)

### 4.1 Modes
| Sidecar | Detected by | Behavior |
| --- | --- | --- |
| Plain (today) | no `schema_version`, no `episode_id` | Unchanged. |
| Studio episode (today) | `episode_id`, no `schema_version` | Unchanged, but unused once R8 is on. |
| **Pipeline (new)** | `schema_version` present | Sections 4.2 to 4.5. |

The watcher today **rejects unknown fields**. A pipeline sidecar is parsed by its own schema (`docs/sidecar.schema.json`) so `approval`, `checksum`, `source_bot` and `render` are accepted and recorded.

### 4.2 Fields and how each maps to ELO
| Field | Maps to | Status |
| --- | --- | --- |
| `schema_version` | `"1.0"` only | NEW |
| `channel` | Slug (section 3), must match the folder | NEW |
| `episode_id` | New `posts.episode_ref`, unique per channel. **Same id format as Upcoming** (U1). | NEW |
| `title` | `posts.title`, max 100 | EXISTS |
| `description` | `posts.caption` (YouTube description, Instagram and TikTok caption). Per platform text through optional `caption_overrides`. | EXISTS |
| `tags` | **Both** (Q4): stored on the post, sent as **YouTube tags**, and appended as **hashtags** to the Instagram and TikTok caption only when the caption does not already contain them. Maximum 30. | EXTEND |
| `thumbnail_path` | Relative JPG or PNG under 2 MB, set as the YouTube custom thumbnail after upload. Instagram keeps optional `thumb_offset_ms`. | EXTEND |
| `video_file` | Must equal the video basename in the Inbox | NEW check |
| `platforms` | `post_targets`. TikTok is always Drafts mode (A1). A platform with no real connected account follows R2. | EXTEND |
| `preferred_slot` | **Accepted for compatibility and ignored.** Logged as "Ignored: the schedule is set in ELO." (Josh's rule, section 0.) | NEW |
| `approval.approved_by`, `approved_at` | Stored in the drop log. Missing means reject. | NEW |
| `checksum` | SHA-256 of the mp4, verified at intake, before scheduling and right before posting | NEW |
| `source_bot` | Allowlist setting (`grok-bot`, `kids-comedy`, `beth`) | NEW |
| `render.*` | Stored as JSON in the drop log only | NEW |

Required: `schema_version, channel, episode_id, title, description, platforms, approval.approved_by, approval.approved_at, checksum, source_bot, video_file`. Optional: `tags, thumbnail_path, preferred_slot, render`. Extra ELO fields stay allowed: `caption_overrides, ai_flags, tiktok, thumb_offset_ms`.

### 4.3 Probe rules per channel format
Use the channel `format` and `probe()` (`src/main/studio/ffmpeg.ts`).
- **Short:** 9:16 within 3 percent, 5 to 180 seconds, has audio.
- **Long (Wonder Hollow):** 16:9 within 3 percent, 60 to 720 seconds (settable per channel), has audio.
- A failure rejects the drop with the reason.

### 4.4 Intake order
1. Wait until mp4 and json are both present and stable 5 s (EXISTS). Optional `<name>.ready` marker skips the wait (NEW).
2. Validate schema, verify checksum, probe (NEW for pipeline).
3. Duplicate check: same SHA-256, or same channel and `episode_id` in the queue or posted (NEW). Result `duplicate`.
4. Oct 13 safeguards (4.5).
5. Create the post (existing). The accepted video moves to the channel's **Queue** folder (ELO already does this, so there is no `Inbox/accepted`). A refused drop moves to `Inbox/Rejected` with the existing `.error.txt` plus a machine readable `<name>.reason.json`.
6. Write the drop log row, notify, and schedule per R2.

### 4.5 Oct 13 safeguards
Existing for Studio episodes: one video per episode, the post is bound to the text it arrived with (commit 777c13b). Add for pipeline posts:
- Scheduling and posting are keyed by `posts.episode_ref` only. No fuzzy match, no "latest file".
- The Inbox file name must contain the `episode_id`, else hold.
- Store checksum, `video_file` and title on the post at scheduling. Before the scheduled time **and** right before posting, re-read the file: checksum and basename must match and the stored title must equal the sidecar title kept with the post. A mismatch **holds** the post and notifies.
- Build the payload from the stored record. Log the title, file and checksum actually sent, one line per platform.

---

## 5. Requirements (matched)

### R1 Disable the Claude API (EXTEND)
- Setting `ai.claudeApi.enabled`. Pipeline default **off** (Josh turns it off in Settings, Studio; it stays on for his install until he does).
- One check in `LlmGateway.call`: when off and the model is not `ollama:`, throw "Writing comes from bots." before any network call. Callers already treat a gateway error as a flagged task.
- The key **Test** button (`AnthropicClient.test`, Settings, Studio) says "Claude API is off" and makes no call.
- UI: writing buttons (Studio "Write an episode now", Bible Suggest buttons) disabled with the tooltip "Writing comes from bots."
- Startup log line "Claude API is off." or "Claude API is on."
- Test: `api.anthropic.com` appears only in the Anthropic client, and a drop to dry-run post run makes zero requests to it (fetch mock).

### R2 Schedule with the existing next-slot algorithm (EXISTS, plus rules)
- Accepted drops go through `PostService.nextSlots(brandId)`. It already skips taken slots and honors Hollow's Wednesday and Friday rule. **No new scheduler.** `preferred_slot` is ignored (4.2).
- Automatic scheduling happens only when **all** of these are true: the channel's auto-schedule is on (default on for the seven), the channel is **not paused**, the channel has a real connected account for at least one requested platform, and intake is on. Otherwise the drop is accepted and **waits** (visible in the Inbox view). This is Josh's Q5 rule.
- **Backup Heroes and The Complaint Department** are paused and have no accounts, so their drops wait. When Josh connects an account and clicks **resume** (the one pause control), the resume does two things: it refuses with "Connect an account first" if no real account exists, and otherwise it **schedules the waiting drops in the order they arrived** using the normal next slot rules (cap, blackout, days).
- A platform without a real account is skipped for that drop and noted in the drop log and the Inbox view (A1: TikTok on channels 3 to 7 is a dry run today, so it is skipped with a note, not an error). The drop still posts to the platforms that are connected.
- Daily cap and blackout dates are new inputs to `getNextOpenSlots` (section 8).
- Test: three Hollow drops on a Monday land on Wednesday, Friday, next Wednesday.

### R3 Reconciliation (NEW, read only)
Run at startup, after every schedule change, hourly, and on **Reconcile now**. `Scheduler.reconcile()` keeps repairing stuck uploads. A new `Reconciler` only reports.

| Check | Meaning in ELO |
| --- | --- |
| Double-booking | Two posts for one channel at one slot, or more posts on a day than the daily cap |
| Invalid slot | A scheduled post on a day the channel no longer allows, on a blackout date, or not at a channel slot (unless set by hand) |
| Orphan post | A scheduled post with no targets, or for an archived channel |
| Open-slot mismatch | The Calendar's open slots differ from `nextSlots` for the same window (regression guard) |
| File drift | The queue video is missing, or its SHA-256 differs from the drop |
| Waiting too long | A drop waiting more than 7 days (channel paused or no accounts) |
| Stuck upload | Existing result of `Scheduler.reconcile()` |
| Upcoming checks | Section 6.8 |

Output goes to the Inbox view (Issues tab) and `GET /v1/reconcile`, and one `other` alert per new issue. Auto-fix only with `reconcile.autoFix` (default off) and only the unambiguous case. Never delete.

### R4 Drop log (NEW)
- Table `drops` (append only) and `logs/drops.jsonl` in the ELO data folder: `drop_id, received_at (ISO with offset), source_bot, file_name, file_path, file_size, sha256, channel, episode_id, title, sidecar_valid, result (accepted|rejected|duplicate|held), reason, scheduled_slot, post_id, approved_by, approved_at, render_json, notes`.
- A human line also goes to the Activity Log. Filter and Export CSV (`toCsv` and the Save dialog exist).

### R5 Inbox view (NEW screen over existing data)
- New menu item **Inbox** under Create and schedule, tabs **Waiting**, **Held**, **Rejected**, **Log**, **Issues**. Badge = Waiting plus Held plus open Issues.
- Waiting means accepted, no slot yet: posts with status `draft` that came from the Inbox (add `posts.origin = 'inbox'`).
- Columns: thumbnail (existing poster frame), channel, episode id, title, source bot, dropped at, duration, status, reason. Filters: channel, bot, status.
- Row actions: **Schedule (next slot)**, **Pick slot** (existing picker, still limited to the channel's open slots), **Hold**, **Reject with a note**, **Open file**.

### R6 Local model for chat and the Director (EXTEND)
- Exists: per agent model choice with `ollama:<model>`, health test on the AI models screen.
- Add: one button "Use the local model for chat and the Director" that sets the `Assistant` model, plus a status light from the existing Ollama test (Home and the Telegram card).
- Add: when the model is down, **Telegram currently sends nothing** (the error is only logged). Reply with a fixed message that lists the commands that still work (`/status /last /today /stats /spend /flags /queue /pause /resume`). Add a `/queue` alias for `/today`.
- Josh keeps the Ollama server as is (Q3). No OpenAI-compatible client is built.

### R8 Stop writing and producing in ELO (NEW, Q2)
- New setting `pipeline.studioProduction.enabled`, default **off** for the pipeline build. When off:
  - The Director's `runwayPlanner` and `productionPlanner` create no tasks, and `missedSlotWatcher` is replaced by R9.
  - The agents `Show Writer`, `Producer` and the idea refill refuse to start ("Production is done by bots") and are listed as off in the Studio agents screen.
  - "Write an episode now", "Rebuild" and the Bible's Suggest buttons are disabled with the tooltip "Writing comes from bots."
- What keeps working: Comments, Analytics and Insights, Research, Spend, Telegram, the Library (existing episodes stay viewable), Flagged (existing items can be archived), backups, and the Publisher for episodes already in flight.
- Studio banner when off: "Episodes are written and made by bots. ELO schedules and posts what they drop."
- The Studio ingest path (episode id with no schema version) stays in the code but is unused.
- One-time button **Move my Studio ideas into Upcoming** (R7) for the existing ideas bank.

### R9 Low queue alert (NEW, replaces the Director's missed slot alert)
Per channel: when fewer than N days of posts are scheduled ahead (default 3, per channel setting), send one alert (Telegram and the others), and show it on Home. Not sent for paused channels.

---

## 6. R7 Upcoming episodes (matched)

### 6.1 What it is
A shared planning list, visible before any script or render exists, so Josh sees every episode in flight and adds his own ideas. The **file** is the source of truth that bots and ELO share. ELO keeps a cached copy in its database for display, history and reconcile.

### 6.2 File
- Setting `upcoming.filePath`, default `<Media Root>/Shared/upcoming.json` (a new top-level folder, ignored by the Inbox watcher, never a source of posts). Bots that cannot reach the API may point at the same file (or at the mirror they use before ELO is live, by setting this path).
- Schema as in the new spec: `schema_version, revision, updated_at, episodes[]` with entries `channel, episode_id, working_title, premise, status, source_bot, created_by, created_at, updated_by, updated_at, entry_revision, notes, script_path, drop_id` and optional `conflict, conflict_detail`. Unknown fields are preserved on write. JSON Schema at `docs/upcoming.schema.json` (generated from the same zod schema ELO validates with, with a test that fails if it is stale).
- `channel` is a slug. `episode_id` is unique per channel and uses the one id format (U1). `status`: `idea, scripted, queued, rendering, needs-review, dropped`.

### 6.3 Reading, writing, conflicts
- **Writes by ELO** use `<file>.tmp` then atomic rename. Every write bumps top-level `revision` and the entry's `entry_revision`, sets `updated_by` and `updated_at`, and writes an `audit_log` row with before and after.
- **Reads:** a file watcher with a 500 ms debounce, plus a poll every `upcoming.pollSeconds` (default 15) on modified time and hash, as a fallback for shared or network folders. Reload only when `revision` increased and the hash changed.
- **Invalid JSON mid-write:** keep the last good copy, show "upcoming.json is invalid, keeping the last good copy", send one alert, and add a reconcile issue.
- **No silent overwrite:** a write based on an older `revision` or `entry_revision` is aborted and re-read. Non-overlapping field changes are merged. Overlapping edits keep both versions, set `conflict: true` and `conflict_detail`, raise a reconcile issue, and alert. Never last-writer-wins on one field.
- **Josh editing while the file changes:** do not overwrite his open editor. Show "Updated by <actor>: Reload or Keep mine as a conflict note."
- **Duplicate `episode_id`** in a channel on load: the file is shown read only, the entries are flagged, nothing is deduplicated.

### 6.4 Ownership and transitions
- Channel owners: Grok Bot owns `wonder-hollow, math-of-it, clock-out-early, trash-panda, teach-your-parents-tech`. Kids Comedy owns `backup-heroes, complaint-department`. A bot may create, edit and advance only entries on its own channels that it created. Josh may add or edit any entry (`created_by: "josh"`). `beth` (B.E.T.H.) may advance any entry `scripted to queued to rendering to needs-review`.
- **ELO (`system`) makes exactly one transition:** `needs-review` to `dropped`, setting `drop_id`, when an accepted drop has the **same exact `episode_id`**. A mismatch makes no transition and raises a reconcile issue. An accepted drop whose entry is at an earlier status is not advanced: it raises a warning ("the drop arrived before the status caught up").
- Nobody but the owner rewrites another actor's `working_title` or `premise`. A bot can advance Josh's idea to `scripted` and set `script_path`, but cannot delete it or edit its premise. Rejecting an idea is a status note by Josh or B.E.T.H.
- Backward moves need Josh or B.E.T.H. and a note.

### 6.5 Who is calling (NEW, needed for ownership)
The API has one token today, so it cannot tell Grok Bot from Kids Comedy. Add **bots**:
- Settings, Agent API gets a **Bots** card: name (`grok-bot`, `kids-comedy`, `beth`), a token shown once, allowed channels, role (`writer` or `orchestrator`), Revoke, Make a new token.
- The existing single token keeps working as the owner's token (acts as `josh`, full access).
- Table `agent_bots(id, name, token_hash, channels_json, role, created_at, revoked_at)`. Tokens are stored hashed. The API resolves the bot from the token and writes it to `audit_log` and `updated_by`. `X-ELO-Bot` is not trusted.
- **Enforcement:** through the API, a request outside the bot's channels or role gets 403, is audit logged, and leaves the file unchanged. For bots that edit the **file** directly, ELO cannot block the write. It detects it afterwards (the entry changed and `updated_by` is not allowed for that entry), raises a reconcile issue, alerts, and offers **Restore previous** from the cached copy. It never deletes.

### 6.6 Agent API
All under `/v1`, same localhost rule, same bearer token(s):
- `GET /v1/upcoming?channel=&status=&source_bot=` (read: any bot, filtered view).
- `POST /v1/upcoming` (add an entry) and `PATCH /v1/upcoming/{channel}/{episode_id}` (edit or advance), each with the caller's `revision` and `entry_revision`. Ownership per 6.4. MCP tools are generated from the route table.
- The Director chat and Telegram can add an idea (`add idea for <channel>: ...`) through the same write path.

### 6.7 UI: Upcoming screen (NEW)
New menu group **Plan** with **Upcoming**, above Create and schedule. Badge = entries in `needs-review`.
- **Board** (default): one column per status (Idea, Scripted, Queued, Rendering, Needs review, Dropped). A card shows the channel colour and name, working title, premise (two lines), source (bot or Josh), updated, and a linked-drop chip. This is the visual view.
- **Table**: the columns in the new spec (channel, episode id, working title, premise, status, source and owner, created, updated, stale age, linked drop). Filter by channel, status, bot or `josh`, text search. Group by channel or status. Sort by updated or episode id.
- **Add idea** (Josh): channel, working title, premise, saved as `status: idea, source_bot: josh, created_by: josh`. Edit and advance his own entries. Advancing other actors' entries is allowed only where 6.4 allows it.
- Open `script_path` and the linked drop, **Copy episode id** (for a sidecar).
- Conflict and invalid entries are pinned at the top with the reason and are read only until resolved.
- **Move my Studio ideas into Upcoming** (R8) turns each existing Studio idea into an `idea` entry for its channel with `source_bot: josh`.
- Cards and rows on a paused channel show a "paused" tag. A `dropped` entry links to its post in the Queue.

### 6.8 Reconcile additions (report, never delete)
Duplicate `episode_id`; `dropped` entry with no drop log row; accepted drop with no Upcoming entry (warning); `needs-review` older than 7 days; status moved backward without a note; `conflict: true` entries; entry changed by an actor not allowed to change it; file invalid or not successfully loaded for 1 hour while `upcoming.enabled`.

### 6.9 Settings
`upcoming.enabled` (default on), `upcoming.liveWatch` (default on, off means polling only), `upcoming.pollSeconds` (15), `upcoming.filePath`.

---

## 7. Controls (where each lives)

| Control | Status | Where / default |
| --- | --- | --- |
| Pause everything (kill switch) | EXISTS | Left menu, menu bar, Telegram `/pause`. Pauses posting and the Studio. |
| Per-channel pause | EXISTS | Channels, Channel setup. The one pause. Resume runs the waiting-drop scheduling (R2). |
| Per-channel auto-schedule | EXISTS | Channel setup. **On** for all seven when the pipeline ships. |
| Per-channel platform toggle | EXISTS / EXTEND | The Inbox watcher also skips a platform the channel switched off. |
| Claude API enabled | NEW | Settings, Studio. Pipeline default off. |
| Studio production enabled | NEW | Settings, Studio. Pipeline default off (R8). |
| Local model | EXISTS / EXTEND | Settings, AI models and Local AI (R6). |
| Drop intake | EXISTS per channel | Add a global `pipeline.intake.enabled` (default on). |
| Agent API on, tokens, bots | EXISTS / EXTEND | Settings, Agent API (6.5). |
| Duplicate detection | NEW | On. |
| Sidecar validation strict | NEW | On (`pipeline.sidecar.strict`). |
| Require approval block | NEW | On (`pipeline.requireApproval`). |
| Notifications per event | EXTEND | New kinds `drop_accepted, drop_rejected, scheduled, posted, reconcile, low_queue` plus the daily summary (the morning digest exists). Switches on Alerts and backup. Delivery: macOS, iMessage, email, Telegram. |
| Retry policy | EXISTS / EXTEND | Minutes become a setting, default 5, 15, 60 (Q7). Idempotency key `channel+episode_ref+platform` as a unique index for pipeline posts. |
| Reschedule, unschedule, swap | EXISTS | Queue, editor, Calendar. Add **swap** in the Queue. Reconcile runs after each. |
| Blackout dates | NEW | Global and per channel (Channel setup). `getNextOpenSlots` skips them. |
| Daily cap per channel | NEW (hard) | Default 1. Today only a soft warning at 4. |
| Minimum gap between posts | NEW | Global minutes, default 0. |
| Reconcile auto-fix | NEW | Off. |
| Retention | EXISTS | Archivist. Default changes from 60 to 30 days (Q7). Keeps the sidecar copy and drop log. Never touches unposted media. |
| Dry run | EXTEND | A global switch makes every adapter behave like the dry run adapter. |

### Audit log (EXTEND)
`audit_log` exists but records Studio and agent actions only. Add rows (actor `josh`, `agent:<bot>` or `system`, action, target, before, after) for every settings change, schedule edit, rejection, post, deletion by retention, and every Upcoming write. A **Records, Audit log** tab with a filter and Export CSV.

---

## 8. Agent API summary
| Need | In ELO |
| --- | --- |
| Register a drop | NEW `POST /v1/drops` (a file path on the Mac, or a sidecar with `video_url`). Scheduling still follows R2 and the "Agents may create drafts only" gate. |
| List drops | NEW `GET /v1/drops`, `GET /v1/drops/{id}` |
| Queue by status | EXISTS `GET /v1/posts?status=`. Add `origin=inbox`, `held`. |
| Open slots | EXISTS `GET /v1/slots/next-open`. Add the channel slug and a `days` range. Reads only, a bot sees slots but never sets one. |
| Reconcile | NEW `GET /v1/reconcile` |
| Upcoming | NEW `GET`, `POST`, `PATCH /v1/upcoming` (6.6) |
| Can schedule | EXISTS "Agents may create drafts only" |

`getNextOpenSlots` gains `blackoutDates`, `maxPerDay` and `minGapMinutes` inputs. Regenerate `docs/openapi.json`.

---

## 9. Acceptance tests
Each notes whether something similar exists.
1. Claude off: zero Anthropic requests for a full drop to dry-run post. *(NEW)*
2. Valid drop: accepted, logged with SHA-256, scheduled at what `nextSlots` returns. *(similar in `tests/inbox.test.ts`)*
3. Wonder Hollow: three drops on a Monday land on Wednesday, Friday, next Wednesday. *(exists for Studio, add pipeline)*
4. `preferred_slot` is ignored and logged. *(NEW)*
5. Invalid sidecar (no approval, bad slug, bad checksum, unknown bot): rejected, `.error.txt` and `.reason.json` written, notification sent. *(partly exists)*
6. Duplicate (same checksum or channel and episode id): marked duplicate, not scheduled. *(NEW)*
7. Oct 13 regression: wrong title or filename holds the post. A swapped file is caught before posting. *(NEW)*
8. Partial drop is not processed. *(EXISTS)*
9. Reconcile: seeded double booking, invalid slot, file drift, blackout conflict all reported, nothing deleted. *(NEW)*
10. Inbox view shows exactly the waiting drops, badge matches. *(NEW)*
11. Pause everything: nothing posts. Resume: posts per policy, no double posts. *(exists, add pipeline)*
12. Per-channel pause, auto-schedule off, platform off. *(mostly exists)*
13. Retry: fails twice then works, one post, three attempts, backoff from the setting. *(exists, add setting)*
14. Blackout and daily cap are respected by the next slot. *(NEW)*
15. Local model: `/status` works with no model. A question with the model down gets the offline reply, fixed commands still work. *(NEW)*
16. Intake off leaves files untouched. *(exists per channel, add global)*
17. Retention removes old posted files, never unposted, writes an audit row. *(exists, add audit)*
18. Audit log records each setting change with before and after. *(NEW)*
19. Format rules: 16:9 accepted for Hollow and rejected for a short, 9:16 the other way. *(NEW)*
20. No account (Q5): a drop for Backup Heroes is accepted and **waits**. Resume with no account is refused. Resume with an account schedules the waiting drops in arrival order. *(NEW)*
21. TikTok is Drafts mode on every channel that has it connected, and is skipped with a note where it is a dry run. *(NEW)*
22. Studio production off (R8): the Director creates no writing or production tasks, the writing buttons are disabled, Comments and Analytics keep running. *(NEW)*
23. Low queue alert fires once when a channel drops under N days, and not for a paused channel. *(NEW)*
24. The one pause: pausing a channel pauses posting and the Studio for it. *(EXISTS: `tests/studio/pauseSync.test.ts`)*

**Upcoming**
25. A valid file renders on the Board and Table, filterable by channel, status and bot or `josh`. *(NEW)*
26. Josh adds an idea: `status: idea, source_bot: josh`. The owning bot can advance it to `scripted` and cannot delete it or edit its premise. *(NEW)*
27. Ownership: a request with Grok Bot's token against a `backup-heroes` entry (and Kids Comedy's against `math-of-it`) gets 403, is audit logged, and the file is unchanged. *(NEW)*
28. A direct file edit by an actor not allowed to change that entry is detected, flagged, and **Restore previous** works. *(NEW)*
29. No silent overwrite: two writers on the same `entry_revision` give an abort or a flagged conflict with both titles kept. *(NEW)*
30. Live update: an atomic replace with a higher revision reloads without a restart. Truncated JSON keeps the last good copy and alerts. *(NEW)*
31. Status flow and drop link: `idea` to `needs-review`, then an accepted drop with the exact `episode_id` sets `dropped` and `drop_id`. A mismatched id makes no transition and raises an issue. *(NEW)*
32. Reconcile-upcoming: duplicate id, `dropped` without a drop, orphan drop, stale `needs-review` all reported, nothing deleted. *(NEW)*
33. `upcoming.enabled` off hides the screen and leaves the file alone. `upcoming.liveWatch` off still reloads through polling. *(NEW)*
34. **Move my Studio ideas into Upcoming** creates one `idea` entry per existing idea, once. *(NEW)*

---

## 10. Out of scope
Script writing, rendering and Runpod control, the review step, WhatsApp, per-channel time zones, a hosted version.

## 11. Documents to update
- `docs/GROKBOT_GUIDE.md` and `docs/GROKBOT_DROP_GUIDE.md`: rewrite for the pipeline. **First paragraph: the schedule is set in ELO; the bot never sets, requests or promises a date.** Pipeline sidecar, file name rule, rejection files (`.error.txt`, `.reason.json`), Upcoming rules and the bot's own token. Correct Tuesday to Wednesday for Hollow. Keep the old `episode_id` path only in an "older flow" note.
- `docs/sidecar.schema.json` and `docs/upcoming.schema.json` (generated, with stale-checks).
- `docs/AI_BOT_PROMPT.md` (pointer to the pipeline guide), `docs/USER_GUIDE.md` (Upcoming, Inbox, the switches), `CHANGELOG.md`, `docs/openapi.json`.

---

## 12. Assumptions to confirm (small)
- **A1 TikTok.** "All TikTok channels work the same" is read as Drafts mode everywhere, and a channel whose TikTok account is still a dry run (3 to 7) skips TikTok with a note and posts to its other platforms. If Josh means TikTok must also block the post, say so.
- **U1 Episode id format.** Use `<slug>-<year>-<nnnn>` (for example `clock-out-early-2026-0007`) in the sidecar and in Upcoming. The sidecar example `COE-E007` changes to match. Per channel regex stays configurable.
- **U2 Bot tokens.** One token per bot, as in 6.5, instead of trusting a header.
- **U3 File location.** `<Media Root>/Shared/upcoming.json` by default, configurable.
- **U4 Studio menu.** While Studio production is off, keep the Studio screen for Library, Comments, Spend and the Director's Log, and show the banner in R8. The Upcoming screen becomes the place for planning and ideas.
- **U5 Build order:** R1, R8, slugs, drop log and intake (R4, 4.x), R2 rules, Inbox view (R5), reconcile (R3, R9), controls and audit, API, then Upcoming (R7) last because it is the largest.
