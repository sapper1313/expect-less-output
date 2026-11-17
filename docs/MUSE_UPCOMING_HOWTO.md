# Muse: how to update the production tracker (Upcoming)

ELO's Upcoming list is the tracker. One call per change, no chatter. Never edit `upcoming.json` by hand.

**Call:** `PATCH /v1/upcoming/{channel}/{episode_id}` with `Authorization: Bearer <your bot token>`. Base URL and token are in `docs/SYNC_GUIDE.md`.

**Body:** `{"status": "<value>", "air_date": "YYYY-MM-DD", "entry_revision": <number you read>}`. Send only what changed.

**Status, in order:** `idea`, `scripted`, `queued`, `rendering`, `needs-review`, `muse-passed`, `dropped`.
- `scripted` when the script is done. `rendering` while it builds (use `queued` if waiting). `needs-review` when the build is finished and waiting for Muse.
- `muse-passed` when Muse approves it. That is your last step.
- Never set `dropped`. ELO sets it when the video is dropped in the Inbox with the exact same `episode_id`.

**Episode id:** `<channel-slug>-<year>-<SSEE>`, for example `math-of-it-2026-0121` (season 01, episode 21). Same id in Upcoming, the sidecar and the file name. Slugs: `trash-panda`, `clock-out-early`, `teach-your-parents-tech`, `math-of-it`, `wonder-hollow`, `mam-no-toques-eso`, `usefully-useless-info`.

**New episode:** `POST /v1/upcoming` with `{"channel": "math-of-it", "working_title": "...", "episode_id": "math-of-it-2026-0121", "status": "scripted", "air_date": "2026-11-21"}`.

**air_date** is the day the episode should go out (Eastern). The tracker uses it to flag late or missing episodes. It never moves a post.

**Token:** Josh makes Muse its own token in Settings, Agent API, Bots (name it `muse`, tick the channels it works on). Keep it only in an environment variable, never in a file or a message.

Moving a status backward needs a `notes` change saying why. A bot token may only touch the channels it was given.
