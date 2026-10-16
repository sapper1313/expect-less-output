# Before you sell Expect Less Output: what was checked and what is left

Written during the 0.10.0 QA pass. This is a working list for the owner, not legal advice.

## What was checked

- **Automated tests:** 441 unit and integration tests (scheduler, retries, slots, Daylight Saving, every platform adapter against fake servers, stats, imports, Studio agents, Telegram, the agent API and MCP tools).
- **Screen tour (`scripts/e2e/tour.mjs`):** opens every screen and every tab in a fresh copy of the app, 69 checks. It fails on a blank screen, a crash, a console error, a button without a name, or an image without alt text. It also checks the fixes from this round (solid calendar pop-up, time pickers, one pause, workflow order of the menu).
- **Flow checks (`scripts/e2e/interactive.mjs`):** schedules a post with the new pickers, reschedules it from the Queue, edits its time, schedules many videos, changes quiet hours and the Studio run time, and checks that forms keep what you typed while the app reloads in the background.
- **Real network test:** the Reconnect problem was reproduced on this Mac and fixed (IPv6 addresses that resolve but never connect). Before: about 12 percent of calls to Google and Meta timed out after 10 seconds. After: 0 of 36, slowest 199 ms.
- **Privacy review:** the first owner's phone number was a built-in default for iMessage alerts. It is removed. New installs start with no number. An install already in use keeps its number (migration 015, with tests).

## What you must decide or do before selling

### 1. Things that identify you or your brands (remove or make optional)

- **Seeded channels.** Every new install is created with Trash Panda, Clock Out Early, Teach Your Parents Tech, The Math of It and Wonder Hollow Workshop, with slots, caption templates, hashtag sets and Studio bibles (`src/main/db/seed.ts`, `src/shared/studio/bible.ts`). A buyer should start with an empty app and an "Add your first channel" step.
- **Website address.** The TikTok sign-in bounce page defaults to `https://expectlessmedia.com/oauth/tiktok/` (`src/main/tiktok/config.ts`). A buyer needs their own site (SETUP_D) or a hosted bounce page you provide.
- **Names and artwork.** The app id `com.expectlessmedia.elo`, the watchdog label, the logo, icons and the tagline belong to your brand.
- **Documents.** `docs/SETUP_*`, `docs/YOUR_TASKS_ROUND_TWO.md` and the User Guide mention your own accounts and sites.

### 2. Distribution

- **The app is not signed or notarized.** On another Mac, macOS will warn and may refuse to open it. You need an Apple Developer ID (about 99 dollars a year), code signing and notarization, then a download page.
- **Updates.** There is no auto-update. Plan for one (Electron's updater needs a signed build and a place to host releases).
- **Apple silicon only.** The build is arm64 only (the Intel warning is fixed, there is no Intel build). Decide if Intel Macs matter.

### 3. Licenses (ask a lawyer)

- `ffmpeg-static` ships an FFmpeg build that is licensed GPL. Distributing it inside a paid app carries obligations (offer the source, license notices). `@ffprobe-installer` ships an LGPL build. Either comply, or replace FFmpeg with a build you are allowed to ship, or have the user install it.
- Add a third-party notices file listing every dependency license. Add your own license or EULA and a privacy policy.

### 4. Platform rules and approvals (the biggest friction for a buyer)

- **Every buyer needs their own developer accounts:** a Google Cloud project (OAuth consent screen, and verification to remove the 7 day sign-in limit and the unverified warning), a Meta app (permissions need App Review for use beyond the owner), and a TikTok app (the Content Posting API needs an audit before Direct post can go public).
- This is why the setup guides are so long. A hosted service that holds one approved app for all customers would remove most of it, but it is a different product (servers, security, compliance).
- YouTube's API has a daily quota. Heavy use by one buyer is fine, many customers on one project is not.

### 5. Product gaps a buyer will notice

- **Time zone.** Everything is Eastern time and Eastern is shown in every screen. Add a time zone setting.
- **First run.** There is a Get set up checklist on Home (0.10.0), but no guided wizard, and the Studio and most settings assume the owner's workflow.
- **One user.** There are no logins, roles or approvals. That suits a single creator. Agencies will ask.
- **Language.** English only.
- **Support.** Decide where buyers get help and how they report a problem (the Activity Log is the only record).

### 6. Smaller things noticed

- Several older acceptance scripts (`scripts/e2e/phase2` to `phase6`, `part1`, `part2`, `smoke`) still use menu names from before 0.9.0 and need updating before they can be used again. The tour and flow scripts above replace them for general checking.
- A real end to end test with live accounts is still the owner's: connect, post, read stats on each platform. The unit tests use fake servers.

## How the best tools compare (public information)

Reviews of Buffer, Later, Metricool and Hootsuite consistently point to these features: a visual calendar with drag and drop, a queue or slots, best time to post, analytics with export, bulk scheduling, content recycling, link in bio, team approvals, and an onboarding checklist. ELO has the calendar, slots, best times, analytics, bulk scheduling and recycling, and gained click-to-schedule on the calendar, CSV export and a setup checklist in 0.10.0. Not built: link in bio, team approvals, competitor ad analytics. Sources: public comparison pages such as metricool.com/metricool-vs-later and metricool.com/metricool-vs-buffer, and general roundups of scheduling tools in 2026.
