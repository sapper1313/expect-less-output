# Bot guide: how ELO works with the writing and rendering bots

Give this whole file to every bot (Grok Bot, Kids Comedy, B.E.T.H.). It is the first thing to read. The drop details are in `docs/GROKBOT_DROP_GUIDE.md`.

**The schedule is set in the ELO app, by the owner. A bot never sets, asks for, hints at or promises a posting date or time.** Do not put a date in a sidecar. Do not tell anyone "this will post on Friday". ELO picks the next open slot for the channel from the times and days the owner set. If a sidecar contains `preferred_slot`, ELO ignores it and writes "Ignored: the schedule is set in ELO." in its log.

## What each part does

1. **Bots write** scripts and shot lists, and add the episode to the Upcoming list.
2. **B.E.T.H. checks** scripts, queues renders and checks the finished videos.
3. **The render script** (outside ELO) makes and stitches the video.
4. **Josh approves** the finished video in chat, before ELO sees it.
5. **A bot drops** the approved video and its sidecar (a small JSON file) into the channel's Inbox.
6. **ELO checks, logs, schedules and posts.** ELO does not write scripts, make videos or review them.

## The channels

| Channel | Slug (use this in files) | Who works on it | Posts |
| --- | --- | --- | --- |
| Trash Panda | `trash-panda` | Grok Bot | Short |
| Clock Out Early | `clock-out-early` | Grok Bot | Short |
| Teach Your Parents Tech | `teach-your-parents-tech` | Grok Bot | Short |
| The Math of It | `math-of-it` | Grok Bot | Short |
| Wonder Hollow Workshop | `wonder-hollow` | Grok Bot | Long, Wednesday and Friday only |
| Backup Heroes | `backup-heroes` | Kids Comedy | Short, waits until the owner connects an account |
| The Complaint Department | `complaint-department` | Kids Comedy | Short, waits until the owner connects an account |

Shorts are 9:16 and 5 to 180 seconds. Wonder Hollow is 16:9 and 60 to 720 seconds. Every video needs sound.

## The one episode id

Every episode has one id for its whole life: `<slug>-<year>-<SSEE>`, where SS is the season and EE the episode, for example `clock-out-early-2026-0101` (season 1, episode 1). Use the same id in the Upcoming list, in the sidecar, and in the video file name. If you leave the id out when you add an entry to Upcoming, ELO picks the next free one and returns it.

## Your own token

Each bot has its own token, made by the owner in ELO under Settings, Agent API, Bots. Send it as `Authorization: Bearer <token>` to `http://127.0.0.1:47821`. A bot token can read, drop videos into its own channels, and use Upcoming. It cannot change settings, schedule by hand or delete anything.

## The Upcoming list

`GET /v1/upcoming` shows every episode in flight. `POST /v1/upcoming` adds one (on your own channels). `PATCH /v1/upcoming/{channel}/{episode_id}` edits or moves one. The statuses go in this order: `idea`, `scripted`, `queued`, `rendering`, `needs-review`, `muse-passed`, `dropped`.

- Move an entry forward as the work moves: `scripted` when the script is done, `queued` when a render is queued, `rendering` while it renders, `needs-review` when the video is ready for Josh, `muse-passed` when Muse has passed it. Set `air_date` (YYYY-MM-DD, Eastern) when the day is known.
- You may edit the title, premise and notes only of entries you created. You may move any entry on your own channels forward and set `script_path` and `notes` on it.
- Moving an entry backward needs B.E.T.H. (or Josh) and a note saying why.
- Never set `dropped`. ELO does that when the video with the exact same episode id is accepted.
- Always send `entry_revision` (the number you read) with a change. If someone changed the entry after you read it, different fields are merged. If you both changed the same field, ELO keeps both versions, flags a conflict (HTTP 409), and the owner sorts it out. Never retry a conflict by overwriting.
- You can also edit `upcoming.json` directly (the file is `Shared/upcoming.json` in the Media Root), but ELO then checks what you changed. Raise `revision` and the entry's `entry_revision`, and set `updated_by` to your name. A change you are not allowed to make is flagged and the owner can put the file back.

## Dropping a finished video

Read `docs/GROKBOT_DROP_GUIDE.md`. In short: put `<episode-id>.mp4` and `<episode-id>.json` in `<Media Root>/<Channel name>/Inbox`, or call `POST /v1/drops`. ELO answers by moving the video to the channel Queue (accepted) or to `Inbox/Rejected` with a reason (not accepted).

## Reading what happened

- `GET /v1/drops` and `GET /v1/drops/{id}`: the drop log, with the decision and the reason.
- `GET /v1/posts?origin=inbox` and `?held=true`: the posts that came from drops, and the ones held back.
- `GET /v1/slots/next-open?channel=<slug>&days=14`: the open slots. You can look. You cannot choose one.
- `GET /v1/reconcile`: things that do not add up.

## Clips

A show can also post short vertical clips (`"post_type": "clip"`, 9:16, 5 to 90 seconds) on their own schedule. See the Short clips section of `docs/GROKBOT_DROP_GUIDE.md`.

## Things that can happen to a drop

| Result | Meaning |
| --- | --- |
| accepted and scheduled | It has a slot. Nothing more to do. |
| accepted and waiting | The channel is paused, has no connected account, or the owner turned off automatic scheduling. The owner schedules it later. |
| held | Something does not match (for example the file name does not contain the episode id). Nothing posts until the owner looks. |
| rejected | The sidecar or the video is wrong. The reasons are in `<name>.error.txt` and `<name>.reason.json` in `Inbox/Rejected`. Fix it and drop again. |
| duplicate | The same video or the same episode id is already in ELO. |

## Older flow

Before the pipeline, a sidecar with only `episode_id` and `video_url` handed a Studio episode back. That still works for episodes made inside ELO's Studio, but the Studio no longer writes or produces episodes, so use the pipeline sidecar.
