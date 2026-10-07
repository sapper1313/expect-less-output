# Changelog

## 0.3.0 Phase 3: Facebook Pages (Reels) and Instagram (Reels)

- Meta App ID and Secret saved in the encrypted secret store. One Meta login (Graph API v25.0, fixed localhost port) gives a long-lived token and every Page with its Instagram account. Page tokens stored encrypted.
- Match each brand to a Page and an Instagram account, pre-matched by name similarity.
- Facebook Reels: start, resumable upload, finish. Early handoff with SCHEDULED and an exact publish time (15 minute minimum lead, Meta requires 10). Less lead publishes at the scheduled time. 30 Reels per Page per day guard.
- Instagram Reels: resumable upload of the local file (no Cloudflare R2 needed), status polling every scheduler tick, publish once, permalink saved. content_publishing_limit respected. Cover frame offset and brand share to feed setting.
- AI label: Instagram uses Meta's `is_ai_generated` field. Facebook has no documented field, so the post gets an Add AI label in app checklist and a notification.
- Duration limits enforced for Facebook (3 to 90 seconds) and Instagram (3 seconds to 15 minutes), when scheduling and again before upload.
- Token health: real expiry read from Meta, 7 day warning (notification, sidebar banner, Connections warning), needs_reauth with an alert when Meta rejects the login.
- Meta error codes classified into temporary (retry) and permanent (stop and explain).

## 0.2.0 Phase 2: YouTube (Shorts)

- Google credentials (Client ID and Secret) saved in the encrypted secret store, shown masked.
- Connect a YouTube channel per brand with the installed-app loopback flow (PKCE, offline access). Brand Account channel picker. Connect, Reconnect and Disconnect.
- Per channel modes: Manual assist (notify, copy title and description, open Studio, Mark as posted), Test private, Auto (early handoff with publishAt, public upload when under 15 minutes away).
- Resumable uploads with progress, resume after dropped connections, token refresh, and duplicate protection.
- Token health: automatic refresh, needs_reauth on invalid_grant with an alert, daily channel check.
- Quota guard with two buckets (uploads, everything else), Pacific day reset, warning at 80 percent.
- Brand settings: YouTube category list from YouTube, playlist picker, Append #Shorts.
- Docs check: quota costs changed (videos.insert is 1 unit in its own 100 per day bucket). Unverified projects are still locked to private.

## 0.1.0 Phase 1: core app (dry run only)

- Electron, React, Tailwind, SQLite app shell with a menu bar icon. Closing the window keeps the scheduler running.
- Brands with editable slots, defaults and hashtag sets. The 4 launch brands are seeded as editable data.
- New Post, Bulk Upload, Calendar (month and week, drag to reschedule), Queue, Activity Log, Settings.
- Slot engine with Eastern time and daylight saving tests.
- Scheduler on a 30 second tick with locking, early handoff, retries (2, 10, 30 minutes), missed post handling, keep awake, and file move to `Posted/YYYY-MM`.
- Dry run adapters for YouTube, Facebook, Instagram and TikTok. No real API calls yet.
- Encrypted secret store (Keychain backed) with masked previews.
- Branding: icon, menu bar icon, dark theme, fonts, voice copy.
