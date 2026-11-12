# Grok Bot: your full instructions for working with ELO

**The schedule belongs to the owner, and ELO picks the time unless you ask for one.** With no date in the sidecar, ELO gives the video the next open slot of every platform (each platform has its own times). If you do want an exact time, put `scheduled_at` in the sidecar (ISO 8601 with a UTC offset, in the future, for example `2026-11-14T19:30:00-05:00`). ELO uses it as it is for every platform, on a slot or off one. Only ask for a time when someone told you to. Do not promise a time you were not given. If the time has already passed, ELO uses the next open slot and writes that in its log. `preferred_slot` is still ignored.

This one file has everything: the rules, the Upcoming list, and how to hand over a finished video.

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

Give this whole file to every bot that hands videos to ELO. Read `docs/GROKBOT_GUIDE.md` first.

**The schedule belongs to the owner. A drop normally has no date in it and ELO gives it the next open slot of every platform.** A bot may ask for an exact time with `scheduled_at` (see the table below). `preferred_slot` is accepted so old files do not break, but ELO ignores it.

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
  "source_bot": "grok-bot",
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
| `platforms` | yes | Any of `youtube`, `facebook`, `instagram`, `tiktok`. A platform with no connected account is skipped and noted. The owner's ticks for this kind of video (Shorts or Long form) on Setup Channels decide where it goes, so this list is only a hint and is used only for a channel with no ticks yet. TikTok goes to Drafts unless the owner turned on Upload-Post for the channel. |
| `approval` | yes | Who approved it and when (with a time zone). Without it the drop is rejected. |
| `checksum` | yes | SHA-256 of the mp4. Make it with `shasum -a 256 file.mp4`. ELO checks it when the drop arrives, before it is scheduled, and again right before it posts. |
| `source_bot` | yes | `grok-bot`, `kids-comedy` or `beth`. |
| `render` | no | Anything about the render. Kept in the drop log only. |
| `scheduled_at` | no | An exact date and time with a UTC offset, in the future. Used as it is for every platform. Leave it out to take the next open slots. |
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
  "source_bot": "grok-bot"
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

## Fixing a post before it posts (beth only)

The beth token (any bot token with the orchestrator role works the same) works on **every channel, the ones that exist now and any made later**, and may **create, edit, stop (cancel) and replace** a post that has not gone out yet, including its time. No other bot token may; a try by another bot is refused (403) and written to the audit log. The owner's own token works too. To create a post: `POST /v1/posts` with `brand_id` and `file_path`; `status: scheduled` with no time goes to the first open slot of every platform, `scheduled_at` gives every platform one exact time, and `platform_times` gives one platform its own time. To move one: `PATCH /v1/posts/{id}` with `scheduled_at` or `platform_times`. To stop one: `POST /v1/posts/{id}/cancel` (its slot opens again). To swap the video and keep the slot: `POST /v1/posts/{id}/media`. A time you give is used exactly, on or off a posting slot. A platform that already has the video cannot be moved. The owner's switch **Agents may create drafts only** still applies. Every change is audited, and the owner gets a Telegram message and a message on screen each time beth creates, changes, removes or fixes a post.

| What | Call |
| --- | --- |
| Take a post out of the schedule | `POST /v1/posts/{id}/cancel` |
| Edit the title, caption or platforms | `PATCH /v1/posts/{id}` (never `scheduled_at` or `status`: those return 403) |
| Replace the video, title or description, keeping the slot | `POST /v1/posts/{id}/media` |
| Replace a thumbnail or title | `POST /v1/posts/{id}/thumbnail` |

**Remove (cancel).** The post is taken out of the schedule. Nothing is deleted: the video file stays in the channel Queue folder and the drop log keeps its history with a note "Removed by agent:beth". The same episode id can then be dropped again with the fixed video, and it takes the next open slot. It is refused (409) if any platform already has the video (handed off to YouTube early, uploading or posted): only the owner can take that down.

**Replace the media.** `POST /v1/posts/{id}/media` with `file_path` (the new .mp4 or .mov), optional `checksum` (SHA-256, checked if you send it), optional `title` (1 to 100 characters) and optional `description` (replaces the caption on every platform). Send only `title` and `description` to change just the words.

```json
{ "file_path": "/Users/josh/renders/clock-out-early-2026-0101-fixed.mp4", "checksum": "<64 hex characters>", "title": "Find Any Chrome Tab Instantly", "description": "New description #productivity" }
```

- The post keeps its slot (`scheduled_at` does not change).
- The new video is checked against the channel rules like a drop (a clip is 9:16 and 5 to 90 seconds; an episode follows the show's rules), must differ from the video already on the post, and must not be a video already on another post of the channel.
- The new file is saved in the channel Queue under the episode id. The old file is moved to the channel's `Replaced` folder, never deleted. The answer gives `old_sha256` and `old_file_moved_to`.
- It only works on a draft or scheduled post that no platform has yet, and not within 2 minutes of its slot. A held post stays held until the owner releases it.
- While **Agents may create drafts only** is on, only a draft can be changed.

**To fix a video that is already scheduled:** either replace the media (the slot is kept), or remove the post and drop the fixed video again (it takes the next open slot, which is the same slot if nothing else moved).

## Thumbnails and titles (beth only)

The beth bot token (every channel) can set a custom thumbnail and a title on a post through the API. No other bot token may, and a try by another bot is refused (403) and written to the audit log. The owner's own token works too.

`POST /v1/posts/{id}/thumbnail` with a JSON body. Send `image_path`, `title`, or both:

```json
{ "image_path": "/Users/josh/renders/clock-out-early-2026-0101_thumb.jpg", "title": "Find Any Chrome Tab Instantly" }
```

- `image_path`: an absolute path on the Mac to a real `.jpg` or `.png` under 2 MB (YouTube's limit). It is copied next to the post in the channel's Queue folder. Your original stays.
- `title`: 1 to 100 characters. It only works while the post has **not gone out**. A post that already posted keeps its title (the call is refused with 409).
- **Post not posted yet** (draft or scheduled): the picture is kept and used when the video uploads to YouTube, and the title is changed in ELO. The bot-drop safety check (title must match the drop) moves with it, so the post is not held.
- **Video already inside YouTube** (handed off early, scheduled there): ELO calls `thumbnails.set` right away to replace the thumbnail, and sends the new title to YouTube.
- **Posted YouTube video**: ELO calls `thumbnails.set` to replace the live thumbnail. YouTube needs the channel to be verified. If YouTube refuses, the call fails with 502 and YouTube's reason, and nothing else changes.
- Only YouTube uses the picture. Tall videos (Shorts and clips) often ignore custom thumbnails, and the answer says so in `notes`.
- While **Agents may create drafts only** is on in Settings, only a draft can be changed. For a scheduled or posted post the call is refused (403 `drafts_only`).
- The answer lists what was done in `applied`: `saved_for_upload`, `set_on_youtube`, `title_updated_on_youtube` or `skipped`.

## More platforms

Bluesky, X, LinkedIn, Pinterest and Snapchat are not something a bot chooses. A channel that has a login saved for one posts there on its own, a few minutes after the other platforms. A channel with no login is ignored. You may list them in `platforms`, but it changes nothing. Length limits: Bluesky 3 minutes, X 20, LinkedIn 30, Pinterest 15, Snapchat 5. A video that is too long skips that platform. The text for each platform is written from `description` and `tags`, so write the description so the first one or two sentences stand alone.

## Growth fields in the sidecar (all optional)

These fields only add features. None of them can set or promise a posting time, and the schedule is still whatever the owner set in ELO.

| Field | What it does |
| --- | --- |
| `topic` | A short tag such as `browser` or `finance_debt`. ELO warns the owner when two scheduled posts on one channel in a row have the same topic. Vary the topics. |
| `pinned_comment` | Up to 500 characters: a question for viewers, or a link. ELO posts it on YouTube as the channel when the video goes live and tells the owner to pin it (YouTube does not let apps pin). Paste it by hand on the other apps. |
| `first_comment` | Up to 2000 characters (TikTok allows about 150): a question or call to action ELO posts as the first comment about a minute after the video goes live, on every platform that is ticked for the channel on the owner's Upload-Post card. It goes through Upload-Post. Instagram cannot take one. Different for every video. |
| `first_comments` | Optional. A first comment for one platform, like `{"tiktok": "..."}`. It replaces `first_comment` for that platform. |
| `community_poll` | Up to 1000 characters: a companion poll. ELO reminds the owner 30 minutes after the video goes live (apps cannot post to the YouTube Community tab). |
| `thumbnail_variants` | Up to 3 JPG or PNG files in the Inbox next to the video, best first. If the owner turned on thumbnail rescue and the click rate is low after 24 hours, ELO puts on the second one. |
| `search_phrases` | Up to 10 phrases people type into search. Added to the YouTube tags. If you leave it out, ELO asks YouTube autocomplete itself. |
| `caption_overrides` | Your own text for one platform. ELO otherwise writes the Facebook, Instagram and TikTok versions from `description` and `tags` (no hashtags on Facebook, one sentence per line on Instagram, two short sentences on TikTok). |

Useful reads before you write a script:

- `GET /v1/learnings` tells you where viewers left past videos. ELO reads the YouTube audience curve 48 hours after a video goes live, finds the steepest drop and writes a lesson, for example "talking while static lost 18 points near 0:14, add a cut or a new visual there". The same text is in `Shared/learnings.md`. Use it for pacing.
- `GET /v1/seo/suggestions?q=<topic words>` gives search phrases people type. Weave the strong ones into the spoken script and on-screen text, and send them as `search_phrases`.
- Ideas in `GET /v1/upcoming` with `community_request: true` came from real viewer questions. Open the episode by answering the viewer's question (use the first name or handle in `question_author`).
- `GET /v1/brief` is the owner's Monday summary: reach, the best video, how many episodes are at each step, and empty slots.
- The audio should be about -14 LUFS with no clipping. ELO measures every drop and writes "quiet", "loud" or "may clip" in the drop log notes. ELO does not mix music under speech, so duck the music while someone talks before you hand the video on.
- Only the orchestrator (B.E.T.H.) and the owner can use `POST /v1/episodes/{episode_id}/retract`, the emergency take down.

## Your checklist for every episode

1. Add the episode to Upcoming (`POST /v1/upcoming`) as `idea`, or find Josh's idea there. Note the episode id.
2. Write the script, then move the entry to `scripted` and set `script_path`.
3. Move it to `queued` and `rendering` as the render runs.
4. When Josh has approved the finished video, move it to `needs-review`.
5. Drop `<episode-id>.mp4` and `<episode-id>.json` (or call `POST /v1/drops`). Do not move the entry to `dropped`; ELO does that.
6. Check `GET /v1/drops/{id}`. If it was rejected, read the reasons, fix them, and drop again.
7. You cannot delete Upcoming entries. Only Josh can. If an entry is wrong, put a note on it.

Never mention or choose a posting date. Josh sets the schedule in the app.
