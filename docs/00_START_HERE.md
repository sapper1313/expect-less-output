# Expect Less Output: Start Here

App name: **Expect Less Output**. Tagline: "The algorithm has been fed." Short name in code and file paths: `elo`. Logo and icon files are in the `brand` folder.

## What these files are

| File | Who it is for | When |
|---|---|---|
| 00_START_HERE.md | You | Now |
| 01_PROJECT_SPEC.md | Claude Code (master spec, read every phase) | Every phase |
| 02_PHASE_1_CORE_APP.md | Claude Code | Phase 1 |
| 03_PHASE_2_YOUTUBE.md | Claude Code | Phase 2 |
| 04_PHASE_3_FACEBOOK_INSTAGRAM.md | Claude Code | Phase 3 |
| 05_PHASE_4_TIKTOK.md | Claude Code | Phase 4 |
| 06_PHASE_5_ALERTS_AND_POLISH.md | Claude Code | Phase 5 |
| 07_PHASE_6_AGENT_API_MCP.md | Claude Code | Phase 6 |
| 08_PHASE_7_STATS_OPTIONAL.md | Claude Code | Phase 7 (optional) |
| SETUP_A_GOOGLE_YOUTUBE.md | You | Before Phase 2 |
| SETUP_B_META_FACEBOOK_INSTAGRAM.md | You | Before Phase 3 |
| SETUP_C_TIKTOK.md | You | Before Phase 4 (start early, review takes days) |
| SETUP_D_WEBSITE_PAGES.md | Claude Code, in your Expect Less Media website project | Before SETUP_C |
| SETUP_E_CLOUDFLARE_R2_IF_NEEDED.md | You | Only if Claude Code says Instagram needs it |

## Recommended order (so nothing waits on approvals)

1. Do the one-time Mac setup below.
2. Start Phase 1 with Claude Code. It needs no accounts or keys.
3. While Phase 1 builds, do SETUP_A (Google) and SETUP_B (Meta). They take about 20 minutes each.
4. Run SETUP_D in your Expect Less Media website project so the privacy, terms, and TikTok pages are live.
5. Do SETUP_C (TikTok) and submit the TikTok app for review. Approval takes days, so start it early.
6. Run Phases 2, 3, 4, 5, 6 in order. Phase 7 is optional.

## One-time Mac setup (MacBook)

Build the app on the MacBook itself. A Mac app has to be built on a Mac.

1. Open the **Terminal** app (press Command + Space, type `Terminal`, press Return).
2. Install Apple's developer tools. Paste this and press Return, then click **Install** in the popup and wait until it finishes:
   ```
   xcode-select --install
   ```
   If it says they are already installed, that is fine.
3. Install Node.js: go to https://nodejs.org, download the **LTS** version for macOS, open the downloaded file, and click through the installer.
4. Confirm Node works. In Terminal run:
   ```
   node -v
   ```
   You should see a version number like `v22.x.x` or higher.
5. Install Claude Code. In Terminal run:
   ```
   curl -fsSL https://claude.ai/install.sh | bash
   ```
   Close Terminal and open it again when it finishes.
6. Create the project folder and a docs folder:
   ```
   mkdir -p ~/Projects/expect-less-output/docs
   ```
7. Copy ALL of these .md files AND the `brand` folder into `~/Projects/expect-less-output/docs/`. (In Finder, press Command + Shift + G, paste `~/Projects/expect-less-output/docs`, press Return, then drag the files and the `brand` folder in.) When done you should see `docs/brand/` with 6 image files inside.
8. Start Claude Code inside the project:
   ```
   cd ~/Projects/expect-less-output
   claude
   ```
   Sign in when it asks.

## How to run each phase

Paste this into Claude Code, changing the phase file name each time:

```
Read docs/01_PROJECT_SPEC.md and docs/02_PHASE_1_CORE_APP.md completely.
Build this phase exactly as written. Before writing any code, ask me every
question you have. When done, run the acceptance checklist at the bottom of
the phase file, show me the results, and commit to git.
```

Between phases, type `/clear` in Claude Code to start fresh, then paste the prompt for the next phase.

When a phase needs keys from a SETUP file, Claude Code will tell you where to paste them in the app's Settings screen. Never paste keys or secrets into the chat or into code files.

## If something looks different

The Google, Meta, and TikTok websites change their buttons and menus often. If a screen does not match the SETUP instructions, take a screenshot and paste it into Claude (here or in Claude Code) and ask "where do I click?"
