# Grok Bot guide: Wonder Hollow Workshop with Expect Less Output

Give this whole file to Grok Bot. It says what Expect Less Output (ELO) does now, and what Grok Bot has to do.

## The short version

ELO writes each Wonder Hollow Workshop episode as a complete package: script, scene by scene video prompts, title, description and thumbnail brief. It checks the package, stores it, and waits.

Grok Bot takes the package, makes the clips on the owner's Grok account, binds them into one finished video, and hands the video back to ELO. ELO checks it, makes the thumbnail, writes the YouTube text, and schedules it for the next Wednesday or Friday.

ELO does NOT make Wonder Hollow video through the API unless the owner switches that on later. Grok Bot makes it.

## What ELO does for you (you do not need to do any of this)

1. **Writes the episode** in the Wonder Hollow voice: about 3 minutes, 3D animated, made for kids, one life lesson and one math lesson.
2. **Checks it.** Every counted number is verified by running code, not by guessing. A safety check blocks anything frightening, unsafe, mature, or with real people or brands. A repetition check blocks a copy of an earlier episode.
3. **Stores it** in the Library as `Ready for production`, and keeps a plain `.json` copy in `~/ELO/Library/hollow/ready/` (one file per episode, named by the episode id). The copy disappears from that folder once the episode moves on.
4. **Plans the schedule.** Wonder Hollow posts on Wednesday and Friday. The production windows are Sunday and Monday (for Wednesday) and Wednesday and Thursday (for Friday). ELO makes sure a package is ready before a window opens, and the owner gets a message if a posting slot is going to be missed.
5. **After your video arrives:** checks it, writes the YouTube title and description, makes a 1280 by 720 thumbnail under 2 MB, sets the made for kids and AI labels, and schedules it. YouTube only. Comments are off.

## What Grok Bot has to do

### Step 1: find an episode to make

Ask the local ELO service. It runs on the owner's Mac while the app is open.

- Base address: `http://127.0.0.1:47821` (the port can be changed in ELO Settings, so ask the owner if it fails).
- Header on every request: `Authorization: Bearer YOUR_TOKEN_HERE`. The owner makes the token in ELO, Settings, Agents (local API and MCP), after ticking **Turn on the local API**.
- List the ones ready for you: `GET /v1/episodes?status=Ready%20for%20production`
- Read one in full: `GET /v1/episodes/{id}`

These two calls are read only. You cannot change an episode through the API.

If the API is not reachable, read the `.json` files in `~/ELO/Library/hollow/ready/` instead. They hold the same package.

### Step 2: read the package

Important fields:

| Field | What it is |
| --- | --- |
| `id` | The episode id. You need it when you hand the video back. |
| `title`, `logline`, `life_lesson`, `math_lesson` | What the episode is about. |
| `runtime_target_seconds` | About 180. Your finished video must land within 40 percent of this. |
| `counted_objects` | A list of `{ name, quantity, scenes }`. Never change a quantity. |
| `scenes[]` | The story, one object per scene (see below). |
| `youtube` | Title, description and tags. ELO uses and polishes these, you do not need to. |
| `thumbnail_brief` | For ELO's thumbnail step. You can ignore it. |

Each scene has:

- `n`: the scene number. Make them in order.
- `grok_prompt`: the complete prompt for the video model. Use it as written.
- `content_seconds`: 10. This is how much of the scene is used in the final video.
- `generate_seconds`: 10, or 15 when a transition handle helps the next scene start smoothly. If it is 15, generate 15 seconds, then use the first 10 seconds in the final video. Use the extra frames for a smooth cut or crossfade into the next scene. It is a handle, not 5 extra seconds of story.
- `setting`, `characters`, `action`, `dialogue`, `camera`, `transition_in`, `transition_out`, `extension_note`: the details behind the prompt. Keep characters, rooms and props the same from scene to scene.
- `objects_in_frame`: what must be visible.

### Step 3: rules for the video

1. **Counted objects are always on screen.** While the crew counts, the objects must be visible, they must look like they belong in the story world, and the exact quantity in `counted_objects` must be what is on screen. The crew counts out loud, one number at a time, in order. Do not skip or repeat a number.
2. **Keep it kid safe.** Nothing scary, shocking, violent or mature. No real people, no real brands, no product placement. Positive tone.
3. **Ending.** The closing is the crew singing a goodbye ("see you next time") that ends on the Hollow logo. No credits.
4. **The shared opening** is already part of what you bind. ELO does not add it again unless the owner turned that setting on.
5. **Shape.** 16:9, about 3 minutes, MP4 or MOV, with sound all the way through, no long black or frozen stretches.
6. **No em dashes** in anything you write, including file names, notes and messages. Use commas, periods or the word "and".

### Step 4: hand the video back

Put these in the Wonder Hollow Workshop `Inbox` folder (inside the owner's ELO Media Root, usually `~/Movies/Expect Less Output/Wonder Hollow Workshop/Inbox`). Use one of two ways.

**Way A, a video file plus a JSON file.** Save the finished video as `something.mp4`. Next to it save `something.json` (same name):

```json
{ "episode_id": "wonder-hollow-workshop-2026-0003" }
```

**Way B, a link.** Save just a JSON file, for example `something.json`:

```json
{ "episode_id": "wonder-hollow-workshop-2026-0003", "video_url": "https://example.com/the-video.mp4" }
```

ELO downloads it into the Inbox as `something.mp4`. The link must be http or https, point to a real MP4 or MOV, and be under 2 GB.

Leave everything else out. ELO writes the YouTube title and description itself from the package, and picks the next Wednesday or Friday slot itself. Sending a title, a caption or a time in the JSON changes nothing, and a `scheduled_at` in the past makes the file get rejected.

The folder must be one the owner has switched on as an Inbox for Wonder Hollow Workshop (ELO, Brands, tick **Watch this brand's Inbox folder**). If a video is not picked up after a minute, ask the owner to check that.

Do not delete or rename files in the Inbox. ELO moves them itself.

### Step 5: what to expect back

- The episode moves to `Video received`, `Checking video`, then `Scheduled`. Read it again with `GET /v1/episodes/{id}` to see the status.
- If the video fails a check, the episode becomes `Flagged` with a plain reason and the file moves to the Inbox `Rejected` folder with an explanation next to it. The usual reasons are:
  - the video is not 16:9
  - there is no sound
  - the length is far from `runtime_target_seconds`
  - a long black or frozen stretch
  - the `episode_id` does not exist
  Fix the problem, make the video again, and hand it back with the same `episode_id`.
- Do not hand the same episode back twice.

## Quick checklist for Grok Bot

1. `GET /v1/episodes?status=Ready%20for%20production`, pick one.
2. `GET /v1/episodes/{id}`, read every scene.
3. Make each scene from its `grok_prompt`, in order, 10 seconds each (15 where `generate_seconds` says so, trimmed to 10).
4. Keep counted objects on screen, exact quantity, counted aloud in order.
5. End on the goodbye song and the Hollow logo. No credits.
6. Export one 16:9 MP4 of about 3 minutes with sound.
7. Put the video and a JSON file with the `episode_id` in the Wonder Hollow Workshop Inbox.
8. Read the episode again to confirm it says `Scheduled`.
9. Never invent facts, never change counts, never use em dashes, never ask for or repeat the API token anywhere except the request header.
