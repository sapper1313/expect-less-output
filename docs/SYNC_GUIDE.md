# Scheduler sync: how the bot box stays in step with ELO

For B.E.T.H. and the Scheduler agent on the bot box. **The schedule is set in the ELO app by the owner. ELO posts. The box reads, it never sets, asks for or promises a posting time.**

## How it connects

The agent API listens on the Mac at `127.0.0.1:47821`. When the owner turns on **Settings > Agent API > Also listen on Tailscale**, it also listens on the Mac's Tailscale address (a `100.x.x.x` address). Nothing else can reach it: not the internet, not the Wi-Fi. Every request still needs a token.

- **Base URL:** `http://<the Mac's Tailscale address>:47821` (the address is shown under the checkbox). The Mac's `*.ts.net` name works too.
- **Auth:** `Authorization: Bearer <token>`. Use the bot's own token (Settings > Agent API > Bots), kept only in the `ELO_GROKBOT_TOKEN` environment variable on the box. Never write it to a file, a log or a message. A wrong or missing token returns HTTP 401. A bot token cannot change settings, schedule by hand or delete.
- **Mac asleep or off:** the box gets no answer. Treat that as **unknown, stale since the last good heartbeat**, never as "all fine".
- **To turn it off:** untick the box. Nothing on the box needs to change.

## What to call

| Need | Call |
| --- | --- |
| Am I current, and as of when? | `GET /v1/sync` (app version, server time in New York, Upcoming revision, last change id, switches) |
| What changed since last time? | `GET /v1/changes?since_id=N` (keep the `cursor` it returns) |
| Upcoming list | `GET /v1/upcoming` (add `updated_after=<time with zone>` to get only what changed) |
| Channel states and rules | `GET /v1/brands` (`state`, `post_days`, `daily_cap`, `blackout_dates`, `slots`, `aliases`) |
| Open slots (read only) | `GET /v1/slots/next-open?channel=<slug>&days=14` |
| Posts | `GET /v1/posts` (`origin=inbox`, `held=true`, `past_due=true` for missed slots) |
| Drops | `GET /v1/drops`, `GET /v1/drops/{id}`, `POST /v1/drops` |
| Things that do not add up | `GET /v1/reconcile` (includes `missed_slot`, `double_booking`, `file_drift`, `channel_state`, `upcoming`) |
| Write Upcoming | `POST /v1/upcoming`, `PATCH /v1/upcoming/{channel}/{episode_id}` (send `entry_revision`) |

Poll `/v1/sync` every few minutes and `/v1/changes` about every 15 minutes while the Mac is awake. For the midday missed-slot check, call `GET /v1/posts?past_due=true` and `GET /v1/reconcile`.

## Channel states

`state` on each brand is one of `active`, `paused`, `on-hold`, `archived`. archived beats on-hold beats paused.

- `active`: may be scheduled and posted.
- `paused`: a short break. Schedules are kept. Drops wait.
- `on-hold`: not scheduling while a decision is made. Drops wait.
- `archived`: out of service for good. Writes to it are refused (409): no drops, no Upcoming entries, no changes. The sync cannot bring it back; only the owner can, in the app.

## Canonical ids

| Channel | Slug (canonical) | Episode id looks like | Also accepted as an old name | Folder in the Media Root |
| --- | --- | --- | --- | --- |
| Trash Panda | `trash-panda` | `trash-panda-2026-0007` | | Trash Panda |
| Clock Out Early | `clock-out-early` | `clock-out-early-2026-0007` | | Clock Out Early |
| Teach Your Parents Tech | `teach-your-parents-tech` | `teach-your-parents-tech-2026-0007` | | Teach Your Parents Tech |
| The Math of It | `math-of-it` | `math-of-it-2026-0007` | `the-math-of-it` | The Math of It |
| Wonder Hollow Workshop | `wonder-hollow` | `wonder-hollow-2026-0007` | `wonder-hollow-workshop` | Wonder Hollow Workshop |
| Backup Heroes | `backup-heroes` | `backup-heroes-2026-0007` | | Backup Heroes (archived) |
| The Complaint Department | `complaint-department` | `complaint-department-2026-0007` | `the-complaint-department` | The Complaint Department |

Episode ids are matched exactly, never fuzzy. An old name in `channel` is mapped to the canonical slug. An old-prefix id such as `the-math-of-it-2026-0001` is still accepted for `math-of-it`, and posted history keeps the ids it already has.

## Days and times

- `post_days` use ISO numbers: 1 = Monday to 7 = Sunday. Wonder Hollow is `[3, 5]` (Wednesday and Friday).
- ELO's slot times (Settings, Channel setup) decide the time of day. The Studio weekly days only narrow which weekdays are allowed. The next open slot respects, in order: archived or on-hold or paused, the allowed weekdays, the slot times, blackout dates (global and per channel), and the daily limit per channel (default 1).
- All times are America/New_York with the offset, for example `2026-10-17T17:03:00-04:00`.

## Statuses

Upcoming: `idea`, `scripted`, `queued`, `rendering`, `needs-review`, `dropped`. Posts: `draft` (waiting, no slot yet), `scheduled`, `in_progress`, `partial`, `posted`, `failed`, `missed`, `canceled`; a post with a `hold_reason` is held. Drops: `accepted`, `rejected`, `duplicate`, `held`.

## The gate for scheduling

Nothing is scheduled by a bot. A finished video is dropped, and ELO schedules it only if Settings, Agent API has **Agents may create drafts only** unticked, the channel is active with a connected account, and automatic scheduling is on for it. For a stricter check, the owner can switch on **Require a passing QC result and B.E.T.H. sign-off** (Settings > Pipeline). The sidecar then needs:

```json
"qc": { "status": "pass", "by": "beth", "at": "2026-10-17T10:00:00-04:00" },
"beth_signoff": { "by": "beth", "at": "2026-10-17T10:05:00-04:00" }
```

Without them the drop is rejected with the code `no_qc`. The `approval` block (Josh) is always needed. Posting is idempotent: one post per channel and episode id, and retries (5, 15 and 60 minutes) never post twice. After a post, the Activity Log and `GET /v1/changes` show the title, file and checksum that were sent.
