# Bot guide: dropping a finished video into ELO

Give this whole file to every bot that hands videos to ELO. Read `docs/GROKBOT_GUIDE.md` first.

**The schedule is set in the ELO app, by the owner. A bot never sets, asks for, hints at or promises a posting date or time.** A drop has no date in it. `preferred_slot` is accepted so old files do not break, but ELO ignores it.

## The two files

For one finished video you make two files with the same name apart from the ending:

```
clock-out-early-2026-0007.mp4
clock-out-early-2026-0007.json
```

Rules for the names:

1. The video file name must contain the episode id (`clock-out-early-2026-0007`). If it does not, ELO holds the drop and does not schedule it.
2. The `.json` file has the same name as the video, with `.json` at the end.
3. Copy the video first and the `.json` last. ELO waits until both are there and the sizes stop changing for 5 seconds. To skip the wait, create an empty file called `clock-out-early-2026-0007.ready` after the other two.

Put both in the channel's Inbox folder: `<Media Root>/<Channel name>/Inbox`, for example `~/Movies/Expect Less Output/Clock Out Early/Inbox`. The owner can also let you call `POST /v1/drops` (see the end).

## The sidecar

```json
{
  "schema_version": "1.0",
  "channel": "clock-out-early",
  "episode_id": "clock-out-early-2026-0007",
  "title": "Find Any Chrome Tab Instantly",
  "description": "Stop scrolling through forty tabs. Here is the trick. #productivity",
  "tags": ["chrome", "productivity"],
  "thumbnail_path": "clock-out-early-2026-0007_thumb.jpg",
  "video_file": "clock-out-early-2026-0007.mp4",
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
| `episode_id` | yes | `<slug>-<year>-<nnnn>`. Unique for the channel. |
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

## With a link instead of a file

If the video is on the internet, drop only the `.json`, with an extra `"video_url": "https://..."`. ELO downloads it into the Inbox as `<same name>.mp4` and then checks it as above. The link must be direct, public, http or https, an MP4 or MOV, under 2 GB, and alive for at least 15 minutes. `video_file` must equal the name the download gets (`<json name>.mp4`).

## With the API

`POST /v1/drops` with your bot token and this body does the same as dropping the files:

```json
{ "sidecar": { "...the sidecar above..." }, "file_path": "/Users/me/renders/clock-out-early-2026-0007.mp4" }
```

`file_path` is copied into the Inbox; your original stays. The answer says `received: true` and, when it is already decided, the drop (`result`, `reason`, `scheduled_slot`). You can only drop into channels your token is allowed to use.
