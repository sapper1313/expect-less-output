# Expect Less Output: Master Project Spec

Short name for code, folders, bundle id, and URL scheme: `elo` (bundle id `com.expectlessmedia.elo`, URL scheme `expectless://`).

Read this whole file at the start of every phase. It is the source of truth. If a phase file conflicts with this file, ask the user before proceeding.

## 1. What we are building

A personal, single-user macOS app (a Hootsuite-style scheduler) that lets one person upload a vertical short video once and schedule it to publish on YouTube (Shorts), Facebook Pages (Reels), Instagram (Reels), and TikTok for one of several brands. Everything runs locally on the Mac. All media files stay on the Mac. No cloud backend, no login, no telemetry.

The owner is not a professional developer. Every instruction you give him must be step by step, exact, and simple enough for a teenager to follow. Give him functional instructions, not explanations of internals.

## 2. Brands (at launch)

| Brand | Status | Color suggestion |
|---|---|---|
| Trash Panda | Live | #6B7280 |
| Clock Out Early | Live | #F59E0B |
| Teach Your Parents Tech | Launching soon | #3B82F6 |
| The Math of It | Launching soon | #10B981 |

- Each brand has its own YouTube channel (its own Google account), Facebook Page, Instagram Professional account (linked to that Page), and TikTok account.
- Brands are fully user-editable (add, rename, recolor, archive). More brands will be added later. Never hardcode brand names in logic; seed them as editable data only.
- A brand can have any subset of the 4 platforms connected. Unconnected platforms are simply unavailable for that brand.

## 3. Hard requirements

1. **Native Mac app experience.** Electron app with a menu bar (tray) icon. Closing the window keeps the scheduler running in the background. Option to launch at login. Apple Silicon (arm64) build.
2. **Local only.** SQLite database and media library on the Mac. Secrets and tokens encrypted with Electron `safeStorage` (macOS Keychain backed). Nothing secret in the repo, in logs, or in plain-text files.
3. **One video to many platforms.** One shared caption with optional per-platform overrides. YouTube also requires a title.
4. **Scheduling modes (setting):** `Slots`, `Manual`, or `Both` (default `Both`).
   - Slots: each brand has its own slot times for Weekdays (Mon to Fri) and Weekends (Sat and Sun). A new video fills the next open slot for its brand.
   - Manual: user picks date and time per post.
   - Both: next open slot is pre-filled, and the user can override it.
5. **Bulk scheduling.** Drop many videos at once, pick the brand, and the app spreads them into the next open slots. Then show an editable grid (title, caption, time, platforms, AI flag) before confirming.
6. **Calendar.** Month view with a week toggle. Brand dropdown at top including "All brands" (color-coded by brand). Drag a post to reschedule. Click to edit. Status badges on each event.
7. **Time zone.** Everything is America/New_York (Eastern). Store times as UTC in the database. Display Eastern. Handle daylight saving correctly.
8. **Volume.** Normally up to 2 posts per brand per day. Launch days can be more. No hard cap in the app; show a soft warning above 4 per brand per day.
9. **Posting time strategy.** All platforms target the same scheduled time. YouTube and Facebook are handed off early (configurable, default 3 hours before) and the platform publishes on its own schedule at the exact time (YouTube `publishAt`, Facebook Reels scheduled publish). Instagram and TikTok publish from the app at the scheduled time.
10. **Mac asleep or offline.** Keep the Mac awake while a post is due within the next 30 minutes (Electron `powerSaveBlocker`). If a post is missed because the Mac was asleep or off, setting `Missed post behavior`: `Post on wake if less than N minutes late` (default N = 120) else `Hold and alert me`. Default: post if within 120 minutes, otherwise hold as "Missed" and alert.
11. **Retries.** Each platform target retries up to 3 times with backoff (2 min, 10 min, 30 min) for transient errors. Do not retry on permanent errors (bad token, policy rejection, file invalid). Then mark Failed and alert.
12. **Alerts: failures only** (for now). Primary channel: iMessage to +18046340444 sent through the macOS Messages app via AppleScript. Also a macOS notification. Email (Gmail SMTP with app password) is optional and off by default. The phone number and channels are editable in Settings.
13. **Posted folder.** After every platform target for a post succeeds, move the video file to `<Media Root>/<Brand>/Posted/YYYY-MM/`. If any target fails, leave the file in the brand's `Queue` folder until resolved.
14. **AI content disclosure.** Per-brand default AI flag per platform, overridable per post:
    - YouTube: set `status.containsSyntheticMedia`.
    - TikTok: set `is_aigc` when Direct Post is enabled. In Drafts mode, show a reminder to toggle the AI label in the TikTok app.
    - Facebook and Instagram: if the API offers no AI label field, show a checklist reminder on the post and in the alert/notification. Verify against current Meta docs; if a field exists, use it.
15. **Future upgrade hooks (design now, build later):**
    - Local agent API and MCP server (Phase 6). Design the data model and services so every UI action is also callable through a service layer, not only from React components.
    - Local LLM "text assist" provider (for captions, titles, hashtags). Define a `TextAssistProvider` interface with a `none` implementation now. Later an Ollama or LM Studio provider at `localhost` will plug in.
    - Easy migration to a new Mac (backup and restore in Phase 5).

## 4. Tech stack (use exactly this unless the user approves a change)

- Electron (latest stable) with `electron-vite`, TypeScript everywhere, strict mode.
- Renderer: React + Vite + Tailwind CSS. Calendar: FullCalendar (MIT packages only: `@fullcalendar/react`, `daygrid`, `timegrid`, `interaction`, `luxon3` or `moment-timezone` plugin for Eastern time).
- Main process services in TypeScript. IPC via a typed, contextIsolated preload bridge. `nodeIntegration` off, `contextIsolation` on, `sandbox` on for the renderer.
- Database: SQLite via `better-sqlite3`, schema migrations in versioned SQL files.
- Video inspection: `ffprobe-static` and `ffmpeg-static` (no Homebrew needed). Thumbnail frame extraction for the UI.
- Google: `googleapis` npm package. Meta and TikTok: direct HTTPS calls with `undici` or `fetch` (no unofficial SDKs).
- Tests: `vitest` for scheduler, slot math, time zone, retry, and file-move logic.
- Packaging: `electron-builder`, macOS arm64, unsigned local build. Document how to open an unsigned app the first time (right-click the app, choose Open, then Open).
- Custom URL scheme: `expectless://` registered with `app.setAsDefaultProtocolClient` for OAuth returns (used by TikTok).

## 5. Data model (starting point; refine if needed, keep it agent-friendly)

- `brands`: id, name, color, archived, created_at
- `brand_slots`: id, brand_id, day_type (`weekday` | `weekend`), time_local (HH:MM), enabled
- `brand_defaults`: brand_id, caption_template, default_hashtag_set_id, youtube_category_id, youtube_made_for_kids (default false), youtube_playlist_id (nullable), ai_flag_youtube, ai_flag_tiktok, ai_flag_facebook, ai_flag_instagram, tiktok_privacy_default (nullable, see TikTok rules), tiktok_allow_comments, tiktok_allow_duet, tiktok_allow_stitch
- `hashtag_sets`: id, brand_id (nullable for global), name, tags_text
- `accounts`: id, brand_id, platform (`youtube` | `facebook` | `instagram` | `tiktok`), external_id, display_name, avatar_url, token_ref (key into encrypted secret store), token_expires_at, status (`connected` | `needs_reauth` | `error`), mode (platform-specific, e.g. youtube `test_private` | `manual_assist` | `auto`, tiktok `drafts` | `direct`), last_checked_at
- `posts`: id, brand_id, video_path, video_meta_json (duration, width, height, codec, size, fps), title, caption, scheduled_at_utc, status (`draft` | `scheduled` | `in_progress` | `partial` | `posted` | `failed` | `missed` | `canceled`), created_at, updated_at
- `post_targets`: id, post_id, platform, account_id, caption_override, settings_json (platform-specific fields), ai_flag, status (`pending` | `handed_off` | `uploading` | `processing` | `posted` | `needs_action` | `failed` | `skipped`), external_id, external_url, attempts, next_attempt_at_utc, last_error, handed_off_at_utc, posted_at_utc
- `settings`: key, value_json
- `activity_log`: id, ts_utc, level, post_id (nullable), platform (nullable), message, detail_json (never contains secrets)
- `post_stats` (Phase 7): post_target_id, fetched_at_utc, views, likes, comments, shares, extra_json

## 6. Media library layout

Media Root is chosen in Settings (default `~/Movies/Expect Less Output`).

```
<Media Root>/
  <Brand Name>/
    Queue/              imported videos waiting to post
    Posted/YYYY-MM/     moved here after all targets succeed
```

On import, copy the file into `Queue` (keep the original filename, de-duplicate with a suffix). Never delete user files. Store paths relative to Media Root so the library can move to a new Mac.

## 7. Video validation (warn, do not silently block)

On import run ffprobe and show warnings per platform. Verify every limit below against current official docs at build time and update the constants file if they changed:
- Vertical 9:16 expected (warn if not).
- Facebook Reels: 3 to 90 seconds.
- YouTube Shorts: up to 3 minutes for Shorts treatment.
- Instagram Reels via API: 3 seconds to 15 minutes.
- TikTok via API: check current max duration from the creator_info response at post time.
- Container MP4 or MOV, H.264 video, AAC audio recommended.
Keep all limits in one `platformLimits.ts` file.

## 8. Platform rules summary (details in each phase file)

- **YouTube:** OAuth Desktop client with loopback redirect. Until the Google audit passes, API uploads are locked private, so YouTube accounts have a `mode`: `test_private` (upload private, for testing), `manual_assist` (at post time, notify the user, copy title/description to clipboard, open YouTube Studio upload page), `auto` (full auto with early handoff and `publishAt`). Default `manual_assist` until the user switches to `auto` after audit approval.
- **Facebook Pages:** post as Reels via the Reels publishing flow with scheduled publish time. One Facebook login returns all Pages the user manages.
- **Instagram:** Reels via Content Publishing API using the Page's linked Instagram Professional account. Prefer resumable upload of the local file. Only if resumable upload is not available, fall back to a temporary public URL from Cloudflare R2 (see SETUP_E) and delete the object after publish.
- **TikTok:** Content Posting API. Account `mode`: `drafts` (video.upload, sends to the creator's TikTok inbox; status becomes `needs_action` and the user finishes in the TikTok app) or `direct` (video.publish, only after TikTok audit approval). Default `drafts`. The posting UI must follow TikTok's Content Sharing Guidelines so the app can pass audit (see Phase 4).

## 9. Brand and voice

The app is named **Expect Less Output**. Tagline: "The algorithm has been fed." The personality is deadpan and unimpressed, but the app must still be completely clear about what happened.

**Brand assets** are in `docs/brand/`:
- `ExpectLessOutput--color.jpg`: stacked logo on the dark background (splash and About screen).
- `ExpectLessOutput--noBG_png.png`: stacked logo with transparent background (for light mode headers).
- `ExpectLessOutput-wide-color.jpg`: wide logo on dark (onboarding banner).
- `ExpectLessOutput-wide-noBG.png`: wide logo transparent (sidebar header, trimmed to fit).
- `elo_icon_1024_dark.png`: square app icon, machine only, dark background. Use for the macOS app icon (`.icns` via electron-builder) and the TikTok developer app icon.
- `elo_icon_1024_transparent.png`: square machine only, transparent.
- Menu bar icon: create a simple monochrome macOS "template image" (16 and 32 px, @1x and @2x) of the machine silhouette (hopper on top of a box). Detailed artwork does not read at menu bar size.

**Palette** (sampled from the logos; fine-tune by eye):
- Charcoal background `#2D2B28`
- Cream text and surfaces `#F2E8D5`
- Burnt orange accent (muted, dark logo) `#D9734E`
- Bright orange accent (sticker logo) `#FF6A13`
- Ink black outlines `#111111`
- Muted gray for the publish button `#8A8580`
Default to the dark theme. Light theme uses cream backgrounds with charcoal text and the same oranges.

**Fonts** (bundle the files locally, never load from the internet; all are free OFL fonts):
- Headings: a condensed heavy display face like the "EXPECT LESS" lettering, for example Bebas Neue or Anton.
- Labels and body: a geometric sans like the "OUTPUT" and tagline text, for example Montserrat.

**UI copy rules (voice):**
| Place | Text |
|---|---|
| Main publish or schedule button | `Fine.` Muted gray button, no bright colors, no exclamation points. |
| Success notification and toast | `Task adequate.` |
| Post failure headline | `Could not post. Probably for the best.` |
| Empty calendar | `Nothing scheduled. The algorithm is hungry.` |
| App tagline in sidebar or About | `The algorithm has been fed.` |

Rules that keep the joke from hurting usability:
1. The deadpan line is the headline only. Directly under every failure headline, show the real platform, brand, title, and plain-English reason plus a Retry button. Example: `Could not post. Probably for the best.` then `Instagram, Trash Panda, "Fridge Math": token expired. Reconnect Meta, then tap Retry.`
2. iMessage and email alerts start with the deadpan line, then include the real details, in under 300 characters.
3. The `Fine.` button must have an accessible label and tooltip that says exactly what it does, for example "Schedule to YouTube, Facebook, Instagram, TikTok at 5:00 PM ET".
4. On the TikTok posting section, show a clear secondary line under `Fine.` such as `Post to TikTok as <nickname>` so the screen meets TikTok's Content Sharing Guidelines during audit. In Demo mode (Phase 4) show this line prominently.
5. Destructive confirmations stay plain and clear (no jokes) so nothing gets deleted by accident.
6. Keep all UI strings in one `copy.ts` file so tone can be tweaked in one place.

## 10. UX principles

- Clean, fast, dark and light mode following macOS.
- Main navigation: Calendar, Queue (list), New Post, Bulk Upload, Brands, Connections, Activity Log, Settings.
- Every post shows per-platform status chips with a clear error message and a "Retry" button.
- Every destructive action asks for confirmation.
- Empty states tell the user exactly what to do next.

## 11. Engineering rules

- Each platform is an adapter implementing one interface: `connect()`, `refreshIfNeeded()`, `validate(post)`, `handOff(post)` (optional, for early platform-side scheduling), `publish(post)`, `checkStatus(target)`, `fetchStats(target)` (Phase 7). Add a `dry_run` adapter mode that simulates success or failure without calling any API.
- The scheduler runs in the main process on a 30-second tick, is idempotent, and never double-posts (use a DB transaction and a target-level lock before calling any API; store external ids immediately).
- All API errors are classified as `transient` or `permanent`.
- Log every API call outcome to `activity_log` without tokens, secrets, or full URLs containing tokens.
- Do not log or display secrets. Settings screens show secrets masked with a "Replace" button.
- Use official endpoints only. No scraping, no browser automation, no unofficial APIs.
- Before implementing each platform, fetch and read the current official docs for that platform, because these APIs change. If the docs differ from these files, follow the docs and tell the user what changed.
- Commit to git at the end of each phase with a clear message. Keep a `CHANGELOG.md`.
- Keep a `docs/USER_GUIDE.md` updated each phase with plain step-by-step usage instructions for the owner.
