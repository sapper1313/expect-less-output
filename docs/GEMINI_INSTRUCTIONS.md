# Gemini: your full instructions for working with ELO

**The schedule is set in the ELO app, by the owner. A bot never sets, asks for, hints at or promises a posting date or time.** Do not put a date in a sidecar. Do not tell anyone "this will post on Friday". ELO picks the next open slot for the channel from the times and days the owner set. If a sidecar contains `preferred_slot`, ELO ignores it and writes "Ignored: the schedule is set in ELO." in its log.

This one file has everything: the rules, the Upcoming list, and how to hand over a finished video.

## Connecting to ELO

ELO runs on the owner's Mac. You talk to it with web requests (a REST API) and a token the owner gives you.

- **Base URL:** the owner will give you the address, for example `http://100.x.y.z:47821` (the Mac's Tailscale address). The Mac must be awake. If it is asleep or off, you get no answer: treat that as "unknown, try later", never as "everything is fine".
- **Token:** the owner gives you a token that starts with `elo_bot_`. Send it as `Authorization: Bearer <token>` with every request. Keep it only in a secret setting (an environment variable). Never write it in a file, a message, a log or a sidecar. A wrong or missing token returns 401.
- **JSON:** send bodies as JSON with `Content-Type: application/json`. Times need a time zone, like `-04:00`, and ELO shows everything in America/New_York.
- **Check your connection first:**
  1. `GET /v1/sync` returns the app version, the server time and the current revision of the Upcoming list. If it answers, you are connected and current.
  2. `GET /v1/brands` lists the channels, their slugs, their state (`active`, `paused`, `on-hold`, `archived`), their post days and their clip days.
  3. `GET /v1/openapi.json` is the full machine readable description of every call.
- **Errors** look like `{"error":{"code":"...","message":"..."}}`. Show the message exactly. 403 means your token may not do that. 409 means the thing is in a state that does not allow it (for example already posted). Do not retry a 4xx in a loop.
- **What you can do with this token:** read everything (posts, drops, slots, the Upcoming list, reconcile warnings); add and move Upcoming entries on your own channels; drop finished videos and clips into your own channels. **You cannot** change settings, set a posting time, edit or delete posts, or change thumbnails. If you need one of those, tell the owner.

## What each part does

1. **A writing bot** writes scripts and shot lists, and adds the episode to the Upcoming list.
2. **B.E.T.H. checks** scripts, queues renders and checks the finished videos. She is the orchestrator.
3. **The render step** (outside ELO) makes and stitches the video. If you make part of the video, you hand your result on to the next step; only a finished, approved video is dropped into ELO.
4. **Josh approves** the finished video in chat, before ELO sees it.
5. **A bot drops** the approved video and its sidecar (a small JSON file) into the channel's Inbox.
6. **ELO checks, logs, schedules and posts.** ELO does not write scripts, make videos or review them.

## The channels

| Channel | Slug (use this in files) | Your access | Posts |
| --- | --- | --- | --- |
| Trash Panda | `trash-panda` | (set by the owner) | Short |
| Clock Out Early | `clock-out-early` | (set by the owner) | Short |
| Teach Your Parents Tech | `teach-your-parents-tech` | (set by the owner) | Short |
| The Math of It | `math-of-it` | (set by the owner) | Short |
| Wonder Hollow Workshop | `wonder-hollow` | (set by the owner) | Long, Wednesday and Friday only |
| Backup Heroes | `backup-heroes` | (set by the owner) | Short, waits until the owner connects an account |
| The Complaint Department | `complaint-department` | (set by the owner) | Short, waits until the owner connects an account |

Shorts are 9:16 and 5 to 180 seconds. Wonder Hollow is 16:9 and 60 to 720 seconds. Every video needs sound.

## The one episode id

Every episode has one id for its whole life: `<slug>-<year>-<SSEE>`, where SS is the season and EE the episode, for example `clock-out-early-2026-0101` (season 1, episode 1). Use the same id in the Upcoming list, in the sidecar, and in the video file name. If you leave the id out when you add an entry to Upcoming, ELO picks the next free one and returns it.

## Your own token

Each bot has its own token, made by the owner in ELO under Settings, Agent API, Bots. Send it as `Authorization: Bearer <token>` to the base URL above. A bot token can read, drop videos into its own channels, and use Upcoming. It cannot change settings, schedule by hand or delete anything.

## The Upcoming list

`GET /v1/upcoming` shows every episode in flight. `POST /v1/upcoming` adds one (on your own channels). `PATCH /v1/upcoming/{channel}/{episode_id}` edits or moves one. The statuses go in this order: `idea`, `scripted`, `queued`, `rendering`, `needs-review`, `dropped`.

- Move an entry forward as the work moves: `scripted` when the script is done, `queued` when a render is queued, `rendering` while it renders, `needs-review` when the video is ready for Josh.
- You may edit the title, premise and notes only of entries you created. You may move any entry on your own channels forward and set `script_path` and `notes` on it.
- Moving an entry backward needs B.E.T.H. (or Josh) and a note saying why.
- Never set `dropped`. ELO does that when the video with the exact same episode id is accepted.
- Always send `entry_revision` (the number you read) with a change. If someone changed the entry after you read it, different fields are merged. If you both changed the same field, ELO keeps both versions, flags a conflict (HTTP 409), and the owner sorts it out. Never retry a conflict by overwriting.
- You can also edit `upcoming.json` directly (the file is `Shared/upcoming.json` in the Media Root), but ELO then checks what you changed. Raise `revision` and the entry's `entry_revision`, and set `updated_by` to your name. A change you are not allowed to make is flagged and the owner can put the file back.

## Dropping a finished video

In short: put `<episode-id>.mp4` and `<episode-id>.json` in `<Media Root>/<Channel name>/Inbox`, or call `POST /v1/drops`. ELO answers by moving the video to the channel Queue (accepted) or to `Inbox/Rejected` with a reason (not accepted).

## Reading what happened

- `GET /v1/drops` and `GET /v1/drops/{id}`: the drop log, with the decision and the reason.
- `GET /v1/posts?origin=inbox` and `?held=true`: the posts that came from drops, and the ones held back.
- `GET /v1/slots/next-open?channel=<slug>&days=14`: the open slots. You can look. You cannot choose one.
- `GET /v1/reconcile`: things that do not add up.

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

---

These are the rules for handing videos to ELO.

**The schedule is set in the ELO app, by the owner. A bot never sets, asks for, hints at or promises a posting date or time.** A drop has no date in it. `preferred_slot` is accepted so old files do not break, but ELO ignores it.

## Dropping: The two files

For one finished video you make two files with the same name apart from the ending:

```
clock-out-early-2026-0101.mp4
clock-out-early-2026-0101.json
```

Rules for the names:

1. The video file name must contain the episode id (`clock-out-early-2026-0101`). If it does not, ELO holds the drop and does not schedule it.
2. The `.json` file has the same name as the video, with `.json` at the end.
3. Copy the video first and the `.json` last. ELO waits until both are there and the sizes stop changing for 5 seconds. To skip the wait, create an empty file called `clock-out-early-2026-0101.ready` after the other two.

Put both in the channel's Inbox folder: `<Media Root>/<Channel name>/Inbox`, for example `~/Movies/Expect Less Output/Clock Out Early/Inbox`. The owner can also let you call `POST /v1/drops` (see the end).

## Dropping: The sidecar

```json
{
  "schema_version": "1.0",
  "channel": "clock-out-early",
  "episode_id": "clock-out-early-2026-0101",
  "title": "Find Any Chrome Tab Instantly",
  "description": "Stop scrolling through forty tabs. Here is the trick. #productivity",
  "tags": ["chrome", "productivity"],
  "thumbnail_path": "clock-out-early-2026-0101_thumb.jpg",
  "video_file": "clock-out-early-2026-0101.mp4",
  "platforms": ["youtube", "tiktok", "instagram"],
  "approval": { "approved_by": "Josh", "approved_at": "2026-10-16T15:30:00-04:00" },
  "checksum": { "algo": "sha256", "value": "<64 hex characters of the mp4>" },
  "source_bot": "gemini",
  "render": { "model": "LTX-2.5", "resolution": "720x1280", "fps": 24, "duration_s": 29.8 }
}
```

The full format is in `docs/sidecar.schema.json`. In plain words:

| Field | Needed | What it is |
| --- | --- | --- |
| `schema_version` | yes | Always `"1.0"`. |
| `channel` | yes | The channel slug. It must match the Inbox folder you used. |
| `episode_id` | yes | `<slug>-<year>-<SSEE>` (SS = season, EE = episode). Unique for the channel. |
| `title` | yes | Up to 100 characters. |
| `description` | yes | The YouTube description and the Instagram and TikTok caption. |
| `tags` | no | Up to 30. They go to YouTube as tags, and are added as hashtags to the caption where the caption does not have them already. |
| `thumbnail_path` | no | A JPG or PNG under 2 MB, next to the sidecar. Used as the YouTube thumbnail on long videos. |
| `video_file` | yes | The exact name of the video you dropped. |
| `platforms` | yes | Any of `youtube`, `facebook`, `instagram`, `tiktok`. A platform with no connected account is skipped and noted. TikTok always goes to Drafts. |
| `approval` | yes | Who approved it and when (with a time zone). Without it the drop is rejected. |
| `checksum` | yes | SHA-256 of the mp4. Make it with `shasum -a 256 file.mp4`. ELO checks it when the drop arrives, before it is scheduled, and again right before it posts. |
| `source_bot` | yes | `gemini` (your name). The owner must have added it to the allowed bots in ELO, or every drop is rejected as `unknown_bot`. |
| `render` | no | Anything about the render. Kept in the drop log only. |
| `preferred_slot` | no | Ignored. Do not use it. |

Times need a zone, like `-04:00` or `Z`.

## Dropping: What ELO checks

1. The sidecar has every needed field and nothing unknown.
2. `channel` matches the Inbox folder. `episode_id` looks right. `source_bot` is on the allowed list.
3. `video_file` is the file you dropped, and the checksum matches it.
4. The video shape: a short must be 9:16 and 5 to 180 seconds. Wonder Hollow must be 16:9 and 60 to 720 seconds. Every video needs sound.
5. It is not a duplicate (same video, or same channel and episode id).
6. The file name contains the episode id.

An accepted video moves to the channel's Queue folder with its sidecar. ELO then schedules it with the next open slot, if the channel is running and has a connected account. Otherwise it waits in the Inbox screen.

## Dropping: When a drop is not accepted

The video and sidecar go to `Inbox/Rejected`, with two files next to them:

- `<name>.error.txt`: the reasons in plain words.
- `<name>.reason.json`: the same reasons as data, with a `code` for each one (`bad_checksum`, `no_approval`, `wrong_channel`, `bad_format`, `bad_duration`, `no_audio`, `unknown_bot`, `duplicate_checksum`, `duplicate_episode`, and so on).

Fix the cause, give the file a new name if the old one is still there, and drop it again. Never edit a file in `Rejected` in place. After a video is accepted, never change it. If you change the file, ELO notices the checksum changed and holds the post. Make a new episode id and drop again.

## Dropping: Short clips

A show can post full episodes and short vertical clips. Clips have their own schedule, set by the owner in ELO (Channels, Studio settings per channel, Short clips): their own days, their own time of day, and their own platforms. **As always, a bot never sets, asks for or promises a posting time, for clips too.** A clip never uses or moves an episode slot.

Tag a clip with two optional sidecar fields:

| Field | What it is |
| --- | --- |
| `post_type` | `"clip"` for a clip. Missing, or `"episode"`, means a full episode exactly as before. |
| `source_episode_id` | Optional, clips only. The episode the clip was cut from, for example `clock-out-early-2026-0101`. Once that episode is live on YouTube, ELO adds "Full episode on YouTube:" and the link to the clip's description right before the clip is sent. If the episode is not live yet, the clip goes out without the line. |

| `channel_link` | Optional, clips only, on by default. Adds the show's YouTube channel link to the end of the clip description on every platform the clip posts to, after the "Full episode on YouTube:" line. Send `false` to leave it off. Ignored on episodes. |

**The Related video on a YouTube Short is set by hand, not by ELO.** The YouTube Data API has no field for a Short's Related video (the tap-through link under the Short), so ELO cannot set it. Instead, a clip that has `source_episode_id` and a YouTube target shows a "Related video" reminder in the Queue with the episode link (or "not live yet" until it is), and the Activity Log says the same when the clip posts and again when the episode goes live. The owner sets it in YouTube Studio and clicks Done. A bot cannot set it either, so do not promise it.

Rules for a clip:

- The video must be 9:16 and 5 to 90 seconds long, with sound, whatever the show's video type is. A wide or too long clip is rejected with the reason.
- It belongs to the same channel as the show's episodes: drop it in the same Inbox, with the same `channel`.
- Its `episode_id` is its own id: a normal id, or an episode id with `-c1`, `-c2` and so on, for example `clock-out-early-2026-0101-c1`. The file name must contain it, like any drop. The id must be unique for the channel.
- `platforms` is optional for a clip. Leave it out and the clip goes to every platform the show has switched on for clips (Instagram Reels, Facebook Reels, TikTok and YouTube Shorts unless the owner turned one off). If you list platforms, a platform the show turned off for clips is skipped, with a note. A YouTube clip is uploaded as a Short.
- If the show has no clip days set, the clip is accepted and waits in the Inbox until the owner sets them.
- The Inbox, the Queue and Upcoming show a "Clip" badge. In Upcoming you can also set `post_type: "clip"` and `source_episode_id` on an entry. The API shows `post_type` and `source_episode_id` on posts and drops, and `clip_post_days`, `clip_time` and `clip_platforms` on each channel. Use `GET /v1/posts?post_type=clip` to list clips.

Example clip sidecar (`clock-out-early-2026-0101-c1.json`, next to `clock-out-early-2026-0101-c1.mp4`):

```json
{
  "schema_version": "1.0",
  "channel": "clock-out-early",
  "post_type": "clip",
  "episode_id": "clock-out-early-2026-0101-c1",
  "source_episode_id": "clock-out-early-2026-0101",
  "title": "The Chrome tab trick in 20 seconds",
  "description": "Stop scrolling through forty tabs. #productivity",
  "tags": ["chrome", "productivity"],
  "video_file": "clock-out-early-2026-0101-c1.mp4",
  "approval": { "approved_by": "Josh", "approved_at": "2026-10-21T15:30:00-04:00" },
  "checksum": { "algo": "sha256", "value": "<64 hex characters of the mp4>" },
  "source_bot": "gemini"
}
```

## Dropping: With a link instead of a file

If the video is on the internet, drop only the `.json`, with an extra `"video_url": "https://..."`. ELO downloads it into the Inbox as `<same name>.mp4` and then checks it as above. The link must be direct, public, http or https, an MP4 or MOV, under 2 GB, and alive for at least 15 minutes. `video_file` must equal the name the download gets (`<json name>.mp4`).

## Dropping: With the API

`POST /v1/drops` with your bot token and this body does the same as dropping the files:

```json
{ "sidecar": { "...the sidecar above..." }, "file_path": "/Users/me/renders/clock-out-early-2026-0101.mp4" }
```

`file_path` is copied into the Inbox; your original stays. The answer says `received: true` and, when it is already decided, the drop (`result`, `reason`, `scheduled_slot`). You can only drop into channels your token is allowed to use.

---

## Your checklist for every episode

1. Add the episode to Upcoming (`POST /v1/upcoming`) as `idea`, or find Josh's idea there. Note the episode id.
2. Write the script, then move the entry to `scripted` and set `script_path`.
3. Move it to `queued` and `rendering` as the render runs.
4. When Josh has approved the finished video, move it to `needs-review`.
5. Drop `<episode-id>.mp4` and `<episode-id>.json` (or call `POST /v1/drops`). Do not move the entry to `dropped`; ELO does that.
6. Check `GET /v1/drops/{id}`. If it was rejected, read the reasons, fix them, and drop again.
7. You cannot delete Upcoming entries. Only Josh can. If an entry is wrong, put a note on it.

Never mention or choose a posting date. Josh sets the schedule in the app.
