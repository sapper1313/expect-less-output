# Phase 5: Alerts and Polish

## Before you write code

Read `docs/01_PROJECT_SPEC.md`. Ask questions, then build.

## Build

1. **Alerts (failures only)**
   - Alert service with channels: iMessage, macOS notification, email (optional).
   - iMessage: send through the Messages app with AppleScript via `osascript`, to the number in Settings (default `+18046340444`). Example approach: tell application "Messages" to send the text to the participant/buddy for that number on the iMessage service. Test both current AppleScript syntaxes and use whichever works on this macOS version.
   - First run must trigger the macOS Automation permission prompt. Give the owner exact steps: System Settings, Privacy and Security, Automation, allow Expect Less Output to control Messages. Messages must be signed in with his Apple ID on the Mac.
   - Email (off by default): Gmail SMTP with an app password using `nodemailer`. Settings fields: from address, app password (secret store), to address. Include owner instructions for creating a Gmail app password (Google Account, Security, 2-Step Verification must be on, App passwords, create one named Expect Less Output, copy the 16 characters).
   - Alert triggers: target Failed after retries, post Missed, account `needs_reauth`, token expiring within 7 days, daily caps hit, Media Root missing.
   - Message format (short, under 300 characters): `Could not post. Probably for the best. <platform>, <brand>, "<title>", <time ET>. Reason: <short reason>. Open Expect Less Output to retry.`
   - Batch: if more than 3 alerts happen within 5 minutes, send one combined message.
   - "Send test alert" button for each channel.
   - Quiet hours setting (default off).

2. **Reliability polish**
   - On app start and wake, reconcile: any target stuck in `uploading` or `processing` for over 30 minutes gets a status check through its adapter.
   - Health panel on the Connections screen: each account's status, last check, token expiry, quota (YouTube), mode.
   - Pause per brand and global pause.

3. **Backup and restore (for moving to a Mac Studio later)**
   - Settings, Backup: export a zip with the database, settings, and the folder structure manifest. Tokens are NOT exported; after restore, show which accounts need reconnecting.
   - Restore from zip on a new Mac, ask for the new Media Root, remap relative paths.
   - Write the migration steps in USER_GUIDE.md.

4. **UX polish**
   - Keyboard shortcuts: Command+N new post, Command+Shift+N bulk upload, Command+1 calendar, Command+2 queue.
   - Duplicate post (for reposting).
   - Post editor shows per-platform preview text after template and hashtags are applied.
   - Search in Queue by title or caption.

5. **Final packaging**
   - Confirm the app icon and menu bar icon from Phase 1 look right in Finder, the Dock, and the menu bar in both light and dark mode.
   - Launch at login verified.
   - `npm run dist` produces the final `.dmg`.

## Acceptance checklist

- [ ] Test iMessage arrives on the owner's phone.
- [ ] Forced failure sends exactly one iMessage after the final retry.
- [ ] Batching works for multiple failures.
- [ ] Backup then restore into a fresh user data folder works and lists accounts to reconnect.
- [ ] USER_GUIDE.md updated with alert setup, test, and Mac migration steps.
- [ ] Committed to git.
