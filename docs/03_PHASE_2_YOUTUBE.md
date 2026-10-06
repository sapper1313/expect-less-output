# Phase 2: YouTube (Shorts)

Prerequisite: the owner has finished `SETUP_A_GOOGLE_YOUTUBE.md` and has a Client ID and Client Secret for a Desktop OAuth client.

## Before you write code

1. Read `docs/01_PROJECT_SPEC.md`.
2. Fetch and read the current official YouTube Data API v3 docs for: OAuth 2.0 for installed apps (loopback redirect), `videos.insert` (resumable upload), `videos.update`, `playlistItems.insert`, `status.publishAt`, `status.containsSyntheticMedia`, `status.selfDeclaredMadeForKids`, quota costs, and the rule that uploads from unverified API projects are restricted to private. Tell the owner if anything differs from this file.
3. Ask questions, then build.

## Build

1. **Connections screen: Google credentials**
   - Fields: Client ID, Client Secret (masked). Save to the secret store.
   - Help text: "Get these from SETUP_A_GOOGLE_YOUTUBE.md step 5."

2. **Connect a channel to a brand**
   - On the brand's Connections card: "Connect YouTube" button.
   - OAuth installed-app flow with loopback redirect (`http://127.0.0.1:<random free port>`), PKCE, `access_type=offline`, `prompt=consent`.
   - Scopes: `https://www.googleapis.com/auth/youtube.upload`, `https://www.googleapis.com/auth/youtube` (playlists and status updates), `https://www.googleapis.com/auth/youtube.readonly` (stats in Phase 7).
   - After auth, call `channels.list?mine=true`. If more than one channel is returned (Brand Accounts), show a picker. Save channel id, title, avatar to `accounts`. Save refresh token in the secret store.
   - Show in the UI which Google channel is linked to which brand, with Disconnect and Reconnect buttons.
   - The browser page after login must say "Connected. You can close this tab and return to Expect Less Output."

3. **Account mode selector** (per YouTube account)
   - `Manual assist` (default): at the scheduled time, send a macOS notification "Time to post on YouTube: <brand> <title>", copy title and description to the clipboard, and open `https://studio.youtube.com` in the browser. Mark the target `needs_action` with a "Mark as posted" button (optional field to paste the video URL).
   - `Test private`: real upload with `privacyStatus=private`, no `publishAt`. Label clearly "Uploads stay private. Use for testing only."
   - `Auto`: real upload with early handoff (spec section 3 item 9): upload `handoffHours` before the scheduled time with `privacyStatus=private` and `publishAt=<scheduled time in RFC 3339 UTC>` so YouTube publishes on its own. If the scheduled time is less than 15 minutes away, upload as public immediately at the scheduled time instead.
   - Show a note next to the selector: "Switch to Auto only after Google approves your audit (SETUP_A step 9)."

4. **Upload implementation**
   - Resumable upload with progress shown in the UI and retry on network errors.
   - Metadata: `snippet.title`, `snippet.description` (shared caption or YouTube override, hashtags appended per template), `snippet.tags` (parsed from hashtag set without the # symbol), `snippet.categoryId` (brand default), `status.selfDeclaredMadeForKids` (brand default, default false), `status.containsSyntheticMedia` (post AI flag), `status.privacyStatus`, `status.publishAt`.
   - Add `#Shorts` to the description only if the owner turns on a brand setting "Append #Shorts" (default off).
   - After insert, store video id and URL `https://youtube.com/shorts/<id>`. If a brand default playlist is set, call `playlistItems.insert`.
   - Detect the "uploaded but locked private by unverified project" situation if the API reports it, and surface a clear error: "Google has not approved your app yet. YouTube switched this to private. Use Manual assist until SETUP_A step 9 is approved."

5. **Token health**
   - Refresh access tokens automatically. If a refresh fails with `invalid_grant`, mark the account `needs_reauth` and send an alert (Phase 5 will add iMessage; for now macOS notification and activity log).
   - Daily account health check (cheap `channels.list` call).

6. **Quota guard**
   - Track today's estimated quota use per Google Cloud project (resets midnight Pacific). Show it in Connections. Warn at 80 percent.

7. **Brand defaults additions**
   - YouTube category dropdown (fetch `videoCategories.list?regionCode=US` once and cache).
   - Default playlist dropdown (fetch the channel's playlists).

## Acceptance checklist

- [ ] Owner can paste Client ID and Secret, and they are stored encrypted.
- [ ] Owner can connect each brand's channel; Brand Account picker works.
- [ ] In `Test private` mode, a scheduled post uploads privately with the AI flag set (verify in YouTube Studio).
- [ ] In `Manual assist` mode, notification, clipboard, and browser open all work, and "Mark as posted" completes the target.
- [ ] Early handoff logic in `Auto` mode is unit tested with mocked API calls (do not run Auto for real until audit approval).
- [ ] Token refresh and `needs_reauth` path tested with a mock.
- [ ] USER_GUIDE.md updated with simple steps: connect a channel, choose a mode, test a private upload, delete the test video in YouTube Studio.
- [ ] Committed to git.
