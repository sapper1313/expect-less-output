# Changelog

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
