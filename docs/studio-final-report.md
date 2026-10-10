# Autonomous Studio: final report

Version 0.8.0. Six commits (one per phase, plus the final additions), on branch `main` in `~/Projects/expect-less-output`.

## Where the code is

The Desktop `OUTPUT` folder you started Claude Code in was empty. The real project is `~/Projects/expect-less-output` (Electron, TypeScript, SQLite). All work was done there.

## Test results

- Before: 17 test files, 243 tests.
- After: 29 test files, 357 tests, all passing. Typecheck and lint are clean.
- The built app opens every Studio tab with no page errors (`scripts/e2e/studio1.mjs`), and the packaged `.app` was run with a throwaway data folder: first run is paused, Cheap test works, a Director pass wrote 15 mock episodes, no errors.
- 300 mock Hollow episodes take 3.3 MB on disk (packages plus the plain `.json` copies for Muse).

## What was built, per phase

**Phase 1, foundation.** Studio screen. Keys in the macOS Keychain store with masked fields, Save, Replace, Remove and Test connection. Spend caps (global, per brand, per episode, AI text), each 0 to 9999 or "No spend cap", checked before every paid call, alerts at 50, 80 and 100 percent. Spend ledger with Export CSV. Cadence Mode A and Mode B, pause per brand, runway days, what-if cost. Agent framework with persisted resumable tasks, retries with backoff, flagging, Director's Log. Episode Library (gzip packages, never purged). Calendar with every status, month, week and list views, backfill and the retention purge with a dry run. Mock mode (on by default). Ingest with `episode_id`. Local AI screen for a remote Ollama (checklist, model download with progress, self test, fallbacks, setup steps for Windows and Linux).

**Phase 2, writers.** Series bible per brand with skill import and Markdown export (Clock Out Early voice strings and the Wonder Hollow rules preloaded). Show Writer, Script QC, Math Checker (arithmetic and counted objects are checked by running code), Hollow Safety Checker, repetition guard (embeddings, or keyword plus a text agent when the local machine is off), holidays seeded 18 months, ideas bank, runway filled by the Director with no alert.

**Phase 3, production.** Producer with a persisted job table so a quit or crash never pays twice, Video QC (ffmpeg checks, Whisper, vision, character match, with the fallbacks), retries with a prompt the text agent fixes, ffmpeg assembly with loudness and optional crossfade, captions (sidecar or burned), shared opening and outro generated once, optional Hollow through the API with last frame chaining.

**Phase 4, publishing.** Editable platform capability table, Compliance agent, Thumbnail agent with versioned guidelines, Revert and a monthly refresh, covers for every platform, Publisher, a Bluesky client, a public host (Cloudflare R2, SigV4 verified against the AWS test vector), a thumbnail A/B swap test, adapter support for YouTube `thumbnails.set`, Instagram `cover_url` and TikTok `video_cover_timestamp_ms`.

**Phase 5, operations.** Analytics and insights, Comments agent (Auto, Draft only, Off), morning digest, launchd watchdog with install and uninstall scripts, nightly backups with a restore check, per agent switches, a real read only Dry run day.

## Safety decisions I added that you did not ask for

1. The studio **starts paused** on first run. Nothing begins until you press Resume.
2. A post made from a mock mode placeholder video is marked `mock` and always uses the dry run adapter, even when the account is connected. Mock videos are never published.
3. The very first day of a brand is never reported as a missed slot, so resuming does not send false alarms.
4. A write or production task that was flagged or stopped is parked until you act. The Director does not keep asking again.

## Where the real docs differed from your notes

| Topic | Your notes | What the docs say |
| --- | --- | --- |
| xAI image models | $0.02 to $0.08 | `grok-imagine-image` $0.02, `-2.0` $0.04 (recommended), `-quality` $0.05 |
| xAI video models | 1.5 and 1.5-lite | also `grok-imagine-video` at $0.05 per second (editing). 1.5 is $0.080, Lite $0.020 |
| xAI reference to video | 14 images, 3 voice references | confirmed for 1.5, but the voice reference field name, the extension endpoint, first and last frame fields, and the allowed values for `aspect_ratio` and `resolution` are not in the pages I could read |
| Bluesky video limits | not known | raised in 2026 (reported 10 minutes, 300 MB). The app reads `getUploadLimits` live and the table is editable |
| YouTube thumbnails.set | 2 MB, verified channel | the API reference says 50 MB and does not mention verification (YouTube Help says 2 MB). 2 MB is used |
| Instagram | `cover_url`, `thumb_offset` | the page I read did not list them. They stay as the existing adapter already uses them |
| TikTok | cover by timestamp | confirmed, Direct Post only. The docs give no maximum duration; the real one comes from `creator_info` at post time. No comment endpoints exist |
| Ollama vision names | not known | the search page was unreliable for vision names, so the model name boxes are editable and a bad name gives a plain error when you press Download |

## Things I could not do or finish, and why

- **No real service was called.** I have none of your keys or accounts. xAI, Anthropic, Threads, Bluesky, R2, YouTube Analytics, and the YouTube, Facebook and Instagram comment calls are built to the documented shapes and tested against in process fakes. Your first real check is **Test connection** and **Cheap test**.
- **Video extension and voice references are not used.** xAI's pages do not give their fields. Hollow through the API chains scenes with documented image to video from the last frame instead. Voice references are not sent.
- **Threads was built and then removed** at your request. Bluesky is the only extra platform.
- **Instagram custom cover** is only used when the public host is set up (and the bucket keeps files about 10 days). Otherwise a frame is chosen with `thumb_offset`.
- **Analytics** stores views, likes, comments and shares for all platforms and click rate plus average view duration for thumbnail tests. Retention curves and watch time for every video are not collected.
- **No video player** in the Library episode view yet. The finished video is in the Queue and Posted folders.
- **Library restore** brings back the episode files. To also restore the database use the existing Restore on the Settings screen with the matching `elo-backup` zip.
- **TikTok comments** are skipped because its API has none.
- **Whisper** needs a command on this Mac (for example `brew install whisper-cpp` and a model file) or a remote service. Until then speech checks are skipped with a notice.
- The Ollama machine does not exist here. Local AI is tested against a fake server speaking the Ollama API.

## Commands

Run the app in development:

```bash
cd ~/Projects/expect-less-output && npm run dev
```

Run the tests, typecheck and lint:

```bash
cd ~/Projects/expect-less-output && npm test && npm run typecheck && npm run lint
```

Build the Mac app (the `.app` and `.dmg` appear in `release/`):

```bash
cd ~/Projects/expect-less-output && npm run dist
```

Run the Studio smoke test against the built app:

```bash
cd ~/Projects/expect-less-output && npm run build && node scripts/e2e/studio1.mjs
```

Install the watchdog (the exact command, with your data folder, is also shown in Studio, Settings, Watchdog):

```bash
bash ~/Projects/expect-less-output/scripts/watchdog/install.sh
```

Plain steps for using everything: `docs/studio-howto.md`. Plan and decisions: `docs/studio-plan.md`.
