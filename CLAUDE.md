# Expect Less Output

Always read docs/01_PROJECT_SPEC.md before working. Follow its tech stack and engineering rules. The owner wants step-by-step, teenager-simple instructions and no em dashes in any text.

## Folder map

- `docs/` specs, phase files, setup guides, brand assets. `docs/USER_GUIDE.md` is the owner's manual.
- `src/shared/` code used by both sides: types, `platformLimits.ts`, `copy.ts` (every UI string), `slots.ts` (slot engine), `scheduling.ts` (retry and missed rules), `time.ts` (Eastern time helpers), `api.ts` (the typed service contract).
- `src/main/` Electron main process.
  - `db/` SQLite open, versioned migrations (`db/migrations/NNN_name.sql`, never edit an applied one), seed data.
  - `services/` brands, posts, settings, activity log, secrets (safeStorage), media (ffprobe and ffmpeg), library (Media Root files).
  - `scheduler/scheduler.ts` the 30 second tick, locking, retries, missed posts.
  - `adapters/` the platform adapter interface and the `dryRun` adapter. Real adapters come in later phases.
  - `api.ts` builds the one service layer that both the UI (via IPC) and a future agent API call.
  - `index.ts` app boot, window, tray, power handling. `tray.ts`, `notifier.ts`.
- `src/preload/` typed contextIsolated bridge (`window.elo`).
- `src/renderer/src/` React UI. `screens/` one file per screen, `components/` shared pieces, `ui.tsx` small controls.
- `tests/` vitest tests (slots, DST, scheduler, retries, file moves). They use an in-memory SQLite database.
- `scripts/` `make-icons.mjs` (icons and logos), `e2e/` Playwright driven acceptance runs against the built app.
- `resources/`, `build/` generated icons.

## Commands

- `npm run dev` start the app with hot reload. `npm test` unit tests. `npm run typecheck`. `npm run lint`.
- `npm run dist` build the arm64 `.app` and `.dmg` into `release/`.

## Rules of thumb

- Brand names are data, never hardcoded in logic.
- Every UI action must also be reachable through `src/main/api.ts`.
- Times are stored as UTC and shown as America/New_York.
- Never log or show secrets. Never delete user video files unless the user ticked the box.
