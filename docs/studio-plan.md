# ELO Autonomous Studio: plan and decisions

This file records what was found in the codebase, what was decided, and how the work is split. It is updated as phases finish.

## 1. What the codebase is (Step 0 findings)

- The project is at `~/Projects/expect-less-output` (the Desktop `OUTPUT` folder is empty). Electron 44, electron-vite, React 19, Tailwind 4, TypeScript strict, better-sqlite3, vitest, zod 4, luxon, FullCalendar.
- Main process services are plain classes wired in `src/main/index.ts`. The UI calls them through one typed IPC bridge (`window.elo.invoke("group.fn")`) built from `src/main/api.ts` and typed by `src/shared/api.ts`. Rule from CLAUDE.md: every UI action must also be reachable through `api.ts`.
- SQLite migrations are `src/main/db/migrations/NNN_name.sql`, never edited once applied. Latest is 006. Studio work adds 007 and later.
- Settings are key/value JSON rows in `settings`, with typed defaults in `services/settings.ts`. Studio settings use their own keys so the existing `Settings` type is not disturbed.
- Secrets: `SecretStore` (`services/secrets.ts`) encrypts values with Electron `safeStorage` (macOS Keychain backed) into `secrets.bin`. The renderer only ever sees `has` and a masked preview. Decision: keep using it for the new keys (`xai.apiKey`, `anthropic.apiKey`, `threads.token`, `bluesky.appPassword`). Reason: it is already Keychain backed, already tested, and a second secret mechanism would be worse. This differs from the prompt's literal "Keychain service names"; the effect for the owner is the same.
- Alerts: `alerts/service.ts` `AlertService.alert({kind, headline, detail})` shows a notification and sends iMessage with batching and quiet hours. All studio alerts go through it.
- Existing ingest API: the **Inbox watcher** (`agent/inbox.ts`). A video plus a same-name `.json` sidecar, or a `.json` with `video_url` (downloaded to `<name>.mp4`), is turned into a post by `agentCreatePost`. Also the local HTTP agent API (`agent/server.ts`, routes in `shared/agentRoutes.ts`). The sidecar schema is `CreatePostBody` (zod). Extension plan: add optional `episode_id`, `title`, `description`, `thumbnail_url` to the sidecar. Without `episode_id` behavior is unchanged.
- Posting is done by the Scheduler (`scheduler/scheduler.ts`) using per-platform adapters. Studio Publisher creates normal posts through `PostService`, so it reuses all of that, including the Posted folder move and the Eastern time slot engine (`shared/slots.ts`).
- Baseline before any change: 17 test files, 243 tests passing, typecheck clean.
- Tools on this Mac: node 24, python3, ffmpeg at `~/bin/ffmpeg`. The app also bundles `ffmpeg-static` and `ffprobe-installer`. Ollama is not installed here (it is meant to be on a remote machine).

## 2. Docs verified (and where they differ from the prompt's notes)

| Item | Prompt's note | Official docs (docs.x.ai, read 2026-10-09) |
|---|---|---|
| Video endpoint | POST /v1/videos/generations, GET /v1/videos/{request_id} | Same. Statuses `done`, `failed`, `expired`. Result at `video.url`. |
| Video models | 1.5 and 1.5-lite | Also lists `grok-imagine-video` ($0.05/s, editing). 1.5 is $0.080/s. Lite is $0.020/s (480p). |
| Image models | $0.02 to $0.08 | `grok-imagine-image` $0.02, `grok-imagine-image-2.0` $0.04 (recommended), `grok-imagine-image-quality` $0.05. |
| Duration | 1 to 15 s | "up to 15s". |
| Reference to video | 14 images, 3 voice refs | Confirmed for 1.5: up to 14 reference images and 3 voice references, `reference_image_urls` list. Cannot be combined with image-to-video or editing in one request. |
| Extension | exists | Exists ("continues from the last frame, original plus extension combined"). Exact field names are on a sub page; the client reads them from config and the Phase 3 client is verified against the live docs before use. |

Anything not confirmed is kept in the editable price and model config (see 4.1) and never hardcoded in logic.

## 3. Decisions (made without asking, per the prompt)

1. **Where the code lives.** New code is under `src/main/studio/` (services and agents), `src/shared/studio/` (types, zod schemas, pure logic that tests and the UI share), and `src/renderer/src/screens/Studio*.tsx`. Existing files are only touched where a hook is needed (api, preload types, App nav, inbox, index wiring).
2. **Config.** One `StudioConfig` JSON blob in `settings` under key `studio.config`, merged over typed defaults, holding prices, model names, retake multiplier, retention days, thresholds, robotic phrase list, run times, concurrency. Per brand data (format, cadence, platform toggles, flags) lives in a new table `studio_brands` so it follows brands being added or archived.
3. **Money.** Dollars stored as REAL with 6 decimals. Caps are checked before each paid call using the estimated cost of that call (worst case for the call, full generated seconds).
4. **Month boundary.** Eastern time, first of the month, computed with luxon.
5. **Mock mode** defaults ON. Mock clients implement the same interfaces as the real ones (`LlmClient`, `XaiVideoClient`, `XaiImageClient`, `OllamaClient`, `PlatformPublisher`). Real clients are only created when mock mode is off and a key exists.
6. **Agents** are modules with a role prompt, zod input and output schemas, an allowed tool list and a model. They call an `LlmClient` that returns JSON, validated with one retry. The Director never writes content.
7. **Tasks are persisted** in `agent_tasks`. A task claimed as `running` when the app dies is requeued on boot. Paid calls use an idempotency key stored on the task, so a resumed video job polls the existing request id instead of paying again.
8. **Library package** is `~/ELO/Library/<brand>/<year>/<episode-id>.json.gz` (path editable in config). The index row is in `episodes`. Hollow READY packages are also copied as plain `.json` to `~/ELO/Library/hollow/ready/`.
9. **Muse access.** Read-only routes `GET /v1/episodes` and `GET /v1/episodes/{id}` are added to the existing localhost agent API (same bearer token) plus the ready folder.
10. **Calendar.** The existing FullCalendar screen keeps working and gains studio items (planned slots, production windows, episodes) behind a merged event feed, with filters and a list view.
11. **Brand matching.** Studio rows are attached to brands by name prefix on first run (Trash Panda, Clock Out Early, Teach Your Parents Tech, The Math of It). Wonder Hollow Workshop is created as a brand if it is missing (YouTube only). After seeding, everything is by id and editable.
12. **Local AI** is always a remote HTTP service. Ollama host and Whisper mode are separate settings. No code assumes localhost.
13. **Threads and Bluesky are not added to the scheduler's four platform model.** The `posts`, `post_targets` and `accounts` tables have a CHECK constraint limiting `platform` to youtube, facebook, instagram and tiktok. SQLite cannot change a CHECK in place, and rebuilding three live tables is high risk. So Threads and Bluesky posts live in their own `social_posts` table (Phase 4) and are sent by the studio Publisher with its own retry and rate limit logic. Everything the scheduler already does for the four platforms is untouched.
14. **Scheduling after ingest.** The Inbox watcher creates a draft through the normal agent path, then the studio schedules it internally (not through the agent API), so the "agents may create drafts only" safety switch stays about outside agents. Hollow posts go to the next Tuesday or Friday at the brand's first weekday slot time.
15. **Brand caps.** A brand "per episode cap" that is set to "No spend cap" means "use the global default", because the brand field is an override.
16. **Alert noise.** A short is only called a missed slot once its posting time is within 30 minutes. A package brand (Hollow) alerts a day ahead.
17. **No X (Twitter).**
18. **No em dashes** anywhere, enforced in code by `shared/studio/lint.ts` plus a test that scans the studio source and docs.

## 4. Phases and files

### Phase 1: foundation
- Migration `007_studio.sql`: `studio_brands`, `spend_ledger`, `spend_alerts`, `agent_tasks`, `agent_runs`, `audit_log`, `episodes`, `episode_stats`, `holidays` (Phase 2), `series_bible` (Phase 2).
- `shared/studio/`: `types.ts`, `config.ts` (defaults), `lint.ts`, `cadence.ts`, `pricing.ts`.
- `main/studio/`: `configService.ts`, `spend.ts`, `agents/framework.ts` (task store, runner, Director), `agents/llm.ts` (Anthropic client, mock client), `library.ts`, `calendarFeed.ts`, `retention.ts`, `mock.ts`, `ollama.ts` and `localAi.ts`, `studioApi.ts` (the `studio` api group), `ingest.ts`.
- UI: `Studio.tsx` (tabs: Overview, Library, Spend, Director's Log, Flagged, Settings, Local AI), calendar feed merge, toolbar "Pause everything" and mock mode banner.
- Tests in `tests/studio/`.

### Phase 2: writers, series bible, checkers
`bible.ts`, `agents/writer.ts`, `agents/scriptQc.ts`, `agents/mathChecker.ts` (runs real code, never LLM arithmetic), `agents/hollowSafety.ts`, `repetition.ts` (embeddings + keyword check), `holidays.ts`, runway logic in the Director.

### Phase 3: shorts production
`xai/client.ts` (real) and mock, `agents/producer.ts`, `agents/videoQc.ts`, ffmpeg assembly, opening/outro slots, job engine with resume.

### Phase 4: compliance, thumbnails, publisher
`platformCaps.ts`, `agents/compliance.ts`, `agents/thumbnail.ts`, `agents/publisher.ts`, Threads and Bluesky clients, A/B swap test.

### Phase 5: analytics, comments, digest, watchdog, backups
`agents/analytics.ts`, `agents/comments.ts`, `digest.ts`, launchd watchdog script under `scripts/watchdog/`, nightly backup, dry run day.

## 5. Honest limits to expect

- Real xAI, Anthropic, Threads, Bluesky and platform calls cannot be exercised here without the owner's keys and accounts. Everything is built and tested against mocks and recorded fixtures. The "Cheap test" button and the "Test connection" buttons are the owner's first real check.
- The remote Ollama machine does not exist in this environment. Local AI is tested against a fake HTTP server speaking the Ollama API.

## 6. Status log

- Phase 1 built and tested: 283 tests pass (243 before), typecheck and lint clean, built app opens every Studio tab with no page errors. 300 mock Hollow episodes take 3.3 MB including the plain `.json` ready copies.
- Phase 2 built and tested: 299 tests pass. Show Writer (one module, per brand bible), Script QC, Math Checker (runs code, no model arithmetic), Hollow Safety Checker (code screen then model check), repetition guard (embeddings or keyword plus text agent), holidays seeded 18 months, ideas bank, Bible screen. Decisions: a write task that is flagged or stopped is parked until the owner acts (the Director never re-asks for that date), and the "package not ready" alert waits until the Writer has actually given up.
- Phase 3 built and tested: 309 tests pass. Producer with a resumable job table (a request id is ledgered the moment it is received, so a relaunch polls instead of paying again), Video QC (ffmpeg checks, Whisper, vision, character match, with the documented fallbacks), retries with a text agent fixed prompt, ffmpeg assembly (loudness, optional crossfade, captions sidecar or burned), shared opening and outro generated once, optional Hollow through the API with last frame chaining (default off).
- Docs differences found in Phase 3: the xAI docs name `reference_image_urls` (reference to video, up to 14 images, up to 3 voice references) but do not give the voice reference field name, the extension endpoint, or first and last frame fields. The client therefore chains scenes with documented image to video (`image.url`, here a data URI of the last frame) instead of the undocumented extension call, and sends no voice references. Both gaps are listed in the final report.
- Phase 4 built and tested: 333 tests pass. Platform capability table (editable), Compliance agent (AI disclosure by API or plain line, made for kids, limits skip one platform only, writing lint), Thumbnail agent (guidelines with history and Revert, candidates scored with code checks plus the vision model, 1280x720 under 2 MB for long form, a 1080x1920 cover with centered text for Reels, best frame for TikTok and Instagram, opening frame for YouTube Shorts), monthly guideline refresh, thumbnail A/B swap test, full Publisher, Threads and Bluesky clients with their own post list, S3 compatible public host (Cloudflare R2, AWS SigV4 verified against the AWS test vector).
- Docs differences found in Phase 4: Threads takes a video only from a PUBLIC video_url (so a public host is required, not optional); Bluesky video limits were raised in 2026 and are read live from getUploadLimits; YouTube thumbnails.set accepts 50 MB by API while YouTube Help says 2 MB; the Instagram docs page read did not list cover_url or thumb_offset, so those stay as already used by the existing adapter; the Threads reply listing endpoint and TikTok max duration were not confirmed from official pages (TikTok max comes from creator_info at post time).
- Real Threads, Bluesky, R2, YouTube Analytics and xAI calls could not be run here (no keys). They are tested against in process fakes that follow the documented request shapes.
- Phase 5 built and tested: 353 tests pass. Analytics agent (daily numbers for every platform plus Threads and Bluesky, insights per brand, a plain summary the Writer and Thumbnail agent read), Comments agent (Auto, Draft only or Off; safe categories only; daily limit and spacing; spam hidden where the API allows), morning digest, launchd watchdog (separate bash script, install and uninstall commands, tested by running the script with a fake sender), nightly backups with a restore check, per agent switches, and a Dry run day that is a real read only simulation.
- Safety decisions added while building: the studio starts paused on first run; a post made from a mock mode placeholder video always goes to the dry run adapter (`settings.mock`), even if the account is connected; the digest does not send while paused.
