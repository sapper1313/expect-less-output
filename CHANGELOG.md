# Changelog

## 0.1.0 Phase 1: core app (dry run only)

- Electron, React, Tailwind, SQLite app shell with a menu bar icon. Closing the window keeps the scheduler running.
- Brands with editable slots, defaults and hashtag sets. The 4 launch brands are seeded as editable data.
- New Post, Bulk Upload, Calendar (month and week, drag to reschedule), Queue, Activity Log, Settings.
- Slot engine with Eastern time and daylight saving tests.
- Scheduler on a 30 second tick with locking, early handoff, retries (2, 10, 30 minutes), missed post handling, keep awake, and file move to `Posted/YYYY-MM`.
- Dry run adapters for YouTube, Facebook, Instagram and TikTok. No real API calls yet.
- Encrypted secret store (Keychain backed) with masked previews.
- Branding: icon, menu bar icon, dark theme, fonts, voice copy.
