# Phase 3: Facebook Pages (Reels) and Instagram (Reels)

Prerequisite: the owner has finished `SETUP_B_META_FACEBOOK_INSTAGRAM.md` and has a Meta App ID and App Secret. The Meta app stays in Development mode (the owner is the app admin and manages all the Pages, so no App Review is needed for his own accounts).

## Before you write code

1. Read `docs/01_PROJECT_SPEC.md`.
2. Fetch and read the current official Meta docs for: Facebook Login (manual flow) with a localhost redirect in Development mode, long-lived user tokens and Page access tokens, the Reels Publishing API for Pages (`/{page-id}/video_reels` start, upload, finish, with scheduled publish), the Instagram Content Publishing API for Reels (container creation, resumable upload of a local file, status polling, `media_publish`, rate limits), and whether any API field exists for AI-generated content labels on Facebook or Instagram. Use the newest stable Graph API version. Tell the owner if anything differs from this file.
3. Ask questions, then build.

## Build

1. **Connections screen: Meta credentials**
   - Fields: App ID, App Secret (masked), stored in the secret store.

2. **Connect Facebook and Instagram (one login)**
   - "Connect Meta" button (global, not per brand). Facebook Login via the system browser with redirect `http://localhost:<fixed port, e.g. 53682>/meta/callback` and a `state` parameter.
   - Permissions to request (confirm names in current docs): `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`, `instagram_basic`, `instagram_content_publish`, and `read_insights` plus `instagram_manage_insights` (for Phase 7).
   - Exchange the code for a user token, then for a long-lived user token. Fetch `/me/accounts` to get every Page and its Page access token (Page tokens derived from a long-lived user token do not expire; confirm in docs). For each Page fetch `instagram_business_account`.
   - Show an assignment screen: for each brand, pick its Facebook Page and its Instagram account from dropdowns (pre-match by name similarity). Save to `accounts`, tokens to the secret store.
   - Show the long-lived user token expiry date. Alert 7 days before expiry with a "Reconnect Meta" button (reconnecting refreshes everything).

3. **Facebook Reels publishing**
   - Use the Pages Reels flow: start upload session, upload the local file bytes, finish with description (shared caption or Facebook override).
   - Early handoff: when `handoffHours` before the scheduled time is reached, upload and finish with scheduled publish (`video_state=SCHEDULED` and `scheduled_publish_time`, confirm field names in docs). If less than the platform minimum lead time remains, publish immediately at the scheduled time instead.
   - Validate 3 to 90 seconds duration (from platformLimits.ts) before upload; fail with a clear message if outside.
   - Store the video/reel id and permalink.

4. **Instagram Reels publishing**
   - At the scheduled time: create a Reels container (`media_type=REELS`, caption, `share_to_feed=true` by default, brand setting to change).
   - Preferred: resumable upload of the local file to Meta's upload host. Fallback only if the docs show resumable upload is unavailable: upload to Cloudflare R2 (SETUP_E), pass a presigned URL valid for 2 hours as `video_url`, delete the object after publish or failure. If you need the fallback, stop and tell the owner to do SETUP_E first.
   - Poll container `status_code` every 15 seconds until `FINISHED` (timeout 15 minutes, then transient error), then `media_publish`. Fetch permalink.
   - Respect the published content limit (check `content_publishing_limit`).
   - Optional per-post field: cover frame offset (`thumb_offset` in ms).

5. **AI label**
   - If current Meta docs offer an API field for AI-generated labels on Reels, wire the post's AI flag to it.
   - If not: when the AI flag is on, set the target to `posted` but add a yellow checklist chip "Add AI label in app" with a link to the post, and include this reminder in the success flow (macOS notification only, since alerts are failures only).

6. **Errors**
   - Classify Meta error codes into transient (rate limit, temporary, processing timeout) and permanent (permissions, invalid token, policy). Invalid token marks accounts `needs_reauth` and alerts.

## Acceptance checklist

- [ ] App ID and Secret stored encrypted.
- [ ] One Meta login lists all Pages and linked Instagram accounts; assignment to brands saves correctly.
- [ ] Test post to one brand's Facebook Page publishes as a Reel at the scheduled time (early handoff verified in Meta Business Suite as scheduled).
- [ ] Test post to one brand's Instagram publishes as a Reel and the permalink is stored.
- [ ] Duration validation blocks a 2-minute video for Facebook with a clear message.
- [ ] Token expiry warning tested with a mocked date.
- [ ] USER_GUIDE.md updated: connect Meta, assign Pages and Instagram to brands, post a test, delete the test from each app.
- [ ] Committed to git.
