# Phase 4: TikTok

Prerequisites:
- `SETUP_D_WEBSITE_PAGES.md` is done, so these pages are live on the owner's website: app info page, privacy policy, terms of service, and the OAuth bounce page at `https://expectlessmedia.com/oauth/tiktok/` (confirm the exact URL with the owner).
- `SETUP_C_TIKTOK.md` is done. The owner has a Client Key and Client Secret, and the app is approved (or in Sandbox for testing).

## Before you write code

1. Read `docs/01_PROJECT_SPEC.md`.
2. Fetch and read the current official TikTok for Developers docs for: Login Kit (desktop or web OAuth v2, PKCE, token refresh), Content Posting API (creator_info query, Upload to inbox with `video.upload`, Direct Post with `video.publish`, FILE_UPLOAD chunking rules, publish status fetch, rate limits), the Content Sharing Guidelines (required UX for the posting screen), and the audit requirements. Tell the owner if anything differs from this file.
3. Ask questions, then build.

## Build

1. **Connections screen: TikTok credentials**
   - Fields: Client Key, Client Secret (masked), Redirect URI (pre-filled with the bounce page URL, editable). Stored in the secret store.

2. **Connect a TikTok account to a brand**
   - OAuth v2 in the system browser with PKCE and `state`. Scopes: `user.info.basic`, `video.upload`, and `video.publish` (request `video.publish` only if the owner has Direct Post enabled in the developer portal; add a toggle). Add `video.list` later in Phase 7 only if approved.
   - The redirect goes to the bounce page on the owner's website, which forwards to `expectless://oauth/tiktok?code=...&state=...`. Handle it with Electron `open-url`. Fallback: the bounce page also shows the code with a Copy button, and the app has a "Paste code" box.
   - Save open_id, display name, avatar. Save access and refresh tokens. Refresh automatically (access tokens are short-lived; refresh tokens last much longer; confirm durations in docs). Alert when refresh fails.

3. **Account mode**
   - `Drafts` (default): uses Upload to inbox. At the scheduled time, upload the video; TikTok sends it to the creator's inbox. Set target status `needs_action` and send a macOS notification: "TikTok draft ready for <brand>. Open TikTok, tap the inbox notification, add the AI label if needed, and post." Provide a "Mark as posted" button.
   - `Direct post`: only selectable after the owner confirms TikTok approved the audit. Uses Direct Post with the creator's choices.

4. **Posting UI that follows TikTok's Content Sharing Guidelines (required for audit)**
   Build a TikTok section in New Post, Bulk grid, and the post editor that, before scheduling a Direct Post:
   - Calls `creator_info` and displays the creator's nickname and avatar so the user sees which account will post.
   - Shows a privacy level dropdown populated ONLY from `privacy_level_options`, with NO default selected. The user must choose. (Brand default may pre-select only if the guidelines allow it; check the current guidelines. If they do not allow it, require a choice per post and make bulk "apply to all" available.)
   - Shows Allow Comments, Allow Duet, Allow Stitch toggles, disabled if the creator has them turned off in TikTok, and off by default unless the guidelines say otherwise.
   - Shows the commercial content disclosure toggle with "Your brand" and "Branded content" options and the required notice text.
   - Shows the required consent line (for example the Music Usage Confirmation and, for branded content, the Branded Content Policy) with links, exactly as the current guidelines specify.
   - Checks video duration against `max_video_post_duration_sec`.
   - Sets `is_aigc` from the post's AI flag.
   - Re-checks `creator_info` right before publishing, and if a chosen privacy option is no longer available, fails with a clear message instead of guessing.

5. **Upload implementation**
   - FILE_UPLOAD with chunking per the docs (chunk size rules), progress in the UI, then poll publish status until a final state. Map `SEND_TO_USER_INBOX` to `needs_action`, `PUBLISH_COMPLETE` to `posted`, failures to `failed` with the reason text.
   - Respect rate limits and daily caps; treat cap errors as transient and reschedule 1 hour later with an alert.

6. **Audit helper**
   - Add a hidden "Demo mode" screen that walks through the full TikTok flow (connect, compose, privacy choice, consent, post) for recording the screen video TikTok requires for review and audit.

## Acceptance checklist

- [ ] Client Key and Secret stored encrypted.
- [ ] Connect flow works through the bounce page and the `expectless://` link, and the Paste-code fallback works.
- [ ] Drafts mode delivers a draft to the TikTok inbox of a test brand account and the target shows `needs_action`.
- [ ] Posting UI shows nickname, privacy options from creator_info with no default, interaction toggles, commercial disclosure, and consent text.
- [ ] Direct post path unit tested with mocks (run for real only after audit approval; until then real direct posts are private only).
- [ ] USER_GUIDE.md updated: connect TikTok, finish a draft in the TikTok app, how to record the demo video, how to switch to Direct post after approval.
- [ ] Committed to git.
