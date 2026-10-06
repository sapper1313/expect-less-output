# Phase 1: Core App (no social platforms yet)

Goal: a working Mac app with brands, slots, media library, posts, calendar, bulk upload, and a scheduler that runs posts through `dry_run` adapters for all 4 platforms. No real API calls in this phase.

## Before you write code

1. Read `docs/01_PROJECT_SPEC.md` fully.
2. Create `CLAUDE.md` in the repo root. It must say: "Always read docs/01_PROJECT_SPEC.md before working. Follow its tech stack and engineering rules. The owner wants step-by-step, teenager-simple instructions and no em dashes in any text." Add a short map of the folder structure once it exists.
3. Ask the owner any questions you have, then proceed.

## Build

1. **Project scaffold**
   - `git init`, `.gitignore` (node_modules, out, dist, *.sqlite, .env*, any secrets).
   - Electron + electron-vite + React + TypeScript + Tailwind, strict TS, ESLint + Prettier.
   - Secure defaults: contextIsolation on, nodeIntegration off, sandboxed renderer, typed preload bridge.
   - Folder layout suggestion: `src/main/` (services, db, scheduler, adapters), `src/preload/`, `src/renderer/` (React), `src/shared/` (types, constants, platformLimits.ts).

2. **Database**
   - better-sqlite3 database at `~/Library/Application Support/Expect Less Output/elo.sqlite`.
   - Versioned migrations creating every table in spec section 5 (include `post_stats` now so later phases need no migration headaches).
   - Seed the 4 brands from spec section 2 as editable rows, each with default slots: weekdays 08:00 and 17:00, weekends 10:00 and 18:00 (owner will edit).

3. **Secret store**
   - `secrets` service using Electron `safeStorage` to encrypt values, stored in a separate file in Application Support. API: `set(key, value)`, `get(key)`, `delete(key)`, `has(key)`. Never expose raw secrets to the renderer; renderer only gets `has` booleans and masked previews.

4. **Settings screen**
   - Media Root folder picker (default `~/Movies/Expect Less Output`), creates `<Brand>/Queue` and `<Brand>/Posted` folders.
   - Scheduling mode: Slots / Manual / Both.
   - Early handoff hours for YouTube and Facebook (default 3).
   - Missed post behavior and grace minutes (default 120).
   - Launch at login toggle. Keep running in menu bar when window closes (always on).
   - Placeholder sections for Connections and Alerts (filled in later phases).

5. **Brands screen**
   - Add, edit, recolor, archive brands.
   - Slot editor per brand: two lists, Weekdays (Mon to Fri) and Weekends (Sat and Sun), add/remove times, toggle each.
   - Brand defaults form: caption template (supports tokens `{title}`, `{hashtags}`, `{brand}`), hashtag sets (create, edit, pick default), YouTube category, made for kids (default off), AI flag defaults per platform, TikTok defaults (comments, duet, stitch).

6. **Import and post creation**
   - New Post screen: drag and drop or file picker for one video, choose brand, platforms (checkboxes for connected platforms; in this phase all 4 show as "dry run"), title, shared caption (pre-filled from brand template), optional per-platform caption override (collapsible), hashtag set picker, AI flag per platform (pre-filled from brand defaults), schedule time (next open slot pre-filled according to mode), Save as Draft or Schedule.
   - On import: copy file into `<Media Root>/<Brand>/Queue/`, run ffprobe, extract a poster frame for the UI, show validation warnings from `platformLimits.ts` (spec section 7).
   - Character counters: YouTube title 100, YouTube description 5000, Instagram caption 2200 and max 30 hashtags, TikTok caption 2200. Verify these numbers in current docs and keep them in `platformLimits.ts`.

7. **Slot engine**
   - `getNextOpenSlots(brandId, count, fromTime)` returning Eastern times converted to UTC, skipping slots already taken by scheduled posts for that brand, correct across daylight saving changes.
   - Unit tests covering: weekday/weekend switching, DST spring forward and fall back, full days rolling to the next day, disabled slots.

8. **Bulk Upload**
   - Drop many videos, choose brand, choose platforms, choose a hashtag set.
   - Auto-assign the next open slots in order of filename (natural sort).
   - Editable grid: thumbnail, filename, title (default: filename cleaned up, underscores and dashes to spaces, title case), caption, scheduled time, platforms, AI flags. Allow inline editing and "apply to all" for caption, hashtags, platforms, AI flags.
   - Confirm creates all posts in one transaction.

9. **Calendar**
   - FullCalendar month view with a Week toggle, time zone America/New_York.
   - Brand dropdown: each brand plus "All brands" (events colored by brand).
   - Event shows time, title, and small platform status icons.
   - Drag to reschedule (confirm dialog; updates all targets). Click to open the post editor.

10. **Queue screen**
    - Table of upcoming and recent posts, filter by brand, status, platform. Bulk select to reschedule, cancel, or delete (delete never removes the video file unless the user ticks "also delete file").

11. **Scheduler and dry-run adapters**
    - Main-process scheduler on a 30-second tick, implemented exactly per spec section 11 (idempotent, locked, transactional).
    - Implement the shared adapter interface and a `dry_run` adapter for each platform that waits 2 to 5 seconds and returns success, with a Settings toggle to force a simulated failure on a chosen platform (for testing retries and alerts).
    - Early handoff logic for YouTube and Facebook targets (dry run just marks `handed_off`, then `posted` at the scheduled time).
    - Retry with backoff and transient/permanent classification.
    - Missed-post logic on app start and on system wake (`powerMonitor` resume event).
    - `powerSaveBlocker` active whenever any target is due within 30 minutes.
    - When all targets succeed: move file to `Posted/YYYY-MM/`, update `video_path`.

12. **Menu bar (tray)**
    - Icon with menu: Open Expect Less Output, Next post: (brand, time), Pause scheduler / Resume scheduler, Quit.
    - Quitting while posts are pending shows a warning.

13. **Activity Log screen**
    - Filterable list of `activity_log` with level coloring.

14. **Text assist stub**
    - `TextAssistProvider` interface (`suggestTitle`, `suggestCaption`, `suggestHashtags`) with a `none` provider. No UI buttons yet beyond a disabled "AI assist (coming soon)" placeholder.

15. **Branding (spec section 9)**
    - App icon from `docs/brand/elo_icon_1024_dark.png` converted to `.icns`.
    - Menu bar template icon (monochrome machine silhouette).
    - Dark theme default with the palette and bundled fonts from spec section 9.
    - Sidebar header with the wide logo, tagline under it.
    - About screen with the stacked logo.
    - All UI strings in `copy.ts` using the voice table: `Fine.` button, `Task adequate.` success, failure headline plus real details, empty calendar line.

16. **Packaging**
    - `npm run dist` builds an arm64 `.app` and `.dmg` with electron-builder.
    - Write `docs/USER_GUIDE.md` with: how to start in dev mode, how to build the app, how to install it into Applications, and how to open an unsigned app the first time (right-click, Open, Open).

## Acceptance checklist (run and show results)

- [ ] `npm test` passes, including DST and slot tests.
- [ ] App launches, shows the 4 seeded brands.
- [ ] Bulk upload of 5 videos assigns 5 correct next slots in Eastern time.
- [ ] Calendar month and week views work, "All brands" shows colors, drag-to-reschedule works.
- [ ] A dry-run post scheduled 2 minutes out completes on all 4 platforms and the file moves to `Posted/YYYY-MM/`.
- [ ] Forced dry-run failure retries 3 times on the backoff schedule (use a test setting that shortens backoff to seconds) and ends as Failed.
- [ ] Closing the window keeps the scheduler running from the menu bar.
- [ ] App icon, menu bar icon, dark theme, `Fine.` button, `Task adequate.` toast, and failure headline with real reason all show correctly.
- [ ] `npm run dist` produces an app that opens on this Mac.
- [ ] Committed to git.

## Instructions to give the owner at the end of this phase

Write simple numbered steps for: starting the app, building and installing it, and testing a dry-run post. Put them in `docs/USER_GUIDE.md` and also print them in the chat.
