# Bot guide: dropping a finished video into ELO

Give this whole file to every bot that hands videos to ELO. Read `docs/GROKBOT_GUIDE.md` first.

**The schedule is set in the ELO app, by the owner. A bot never sets, asks for, hints at or promises a posting date or time.** A drop has no date in it. `preferred_slot` is accepted so old files do not break, but ELO ignores it.

## The two files

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

## The sidecar

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
| `platforms` | yes | Any of `youtube`, `facebook`, `instagram`, `tiktok`. A platform with no connected account is skipped and noted. TikTok always goes to Drafts. |
| `approval` | yes | Who approved it and when (with a time zone). Without it the drop is rejected. |
| `checksum` | yes | SHA-256 of the mp4. Make it with `shasum -a 256 file.mp4`. ELO checks it when the drop arrives, before it is scheduled, and again right before it posts. |
| `source_bot` | yes | `grok-bot`, `kids-comedy` or `beth`. |
| `render` | no | Anything about the render. Kept in the drop log only. |
| `preferred_slot` | no | Ignored. Do not use it. |

Times need a zone, like `-04:00` or `Z`.

## What ELO checks

1. The sidecar has every needed field and nothing unknown.
2. `channel` matches the Inbox folder. `episode_id` looks right. `source_bot` is on the allowed list.
3. `video_file` is the file you dropped, and the checksum matches it.
4. The video shape: a short must be 9:16 and 5 to 180 seconds. Wonder Hollow must be 16:9 and 60 to 720 seconds. Every video needs sound.
5. It is not a duplicate (same video, or same channel and episode id).
6. The file name contains the episode id.

An accepted video moves to the channel's Queue folder with its sidecar. ELO then schedules it with the next open slot, if the channel is running and has a connected account. Otherwise it waits in the Inbox screen.

## When a drop is not accepted

The video and sidecar go to `Inbox/Rejected`, with two files next to them:

- `<name>.error.txt`: the reasons in plain words.
- `<name>.reason.json`: the same reasons as data, with a `code` for each one (`bad_checksum`, `no_approval`, `wrong_channel`, `bad_format`, `bad_duration`, `no_audio`, `unknown_bot`, `duplicate_checksum`, `duplicate_episode`, and so on).

Fix the cause, give the file a new name if the old one is still there, and drop it again. Never edit a file in `Rejected` in place. After a video is accepted, never change it. If you change the file, ELO notices the checksum changed and holds the post. Make a new episode id and drop again.

## Short clips

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

## With a link instead of a file

If the video is on the internet, drop only the `.json`, with an extra `"video_url": "https://..."`. ELO downloads it into the Inbox as `<same name>.mp4` and then checks it as above. The link must be direct, public, http or https, an MP4 or MOV, under 2 GB, and alive for at least 15 minutes. `video_file` must equal the name the download gets (`<json name>.mp4`).

## Fixing a post before it posts (beth only)

The beth token (any bot token with the orchestrator role works the same) works on **every channel, the ones that exist now and any made later**, and may edit, remove or fix a post that has not posted yet. No other bot token may; a try by another bot is refused (403) and written to the audit log. The owner's own token works too. **A bot still never sets or changes a posting time.** Every change is audited, and the owner gets a Telegram message and a message on screen each time beth changes, removes or fixes a post.

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

## With the API

`POST /v1/drops` with your bot token and this body does the same as dropping the files:

```json
{ "sidecar": { "...the sidecar above..." }, "file_path": "/Users/me/renders/clock-out-early-2026-0101.mp4" }
```

`file_path` is copied into the Inbox; your original stays. The answer says `received: true` and, when it is already decided, the drop (`result`, `reason`, `scheduled_slot`). You can only drop into channels your token is allowed to use.
