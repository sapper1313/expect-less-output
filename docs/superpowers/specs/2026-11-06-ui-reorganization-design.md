# UI reorganization (0.18.0), design

Source: Josh's hand sketch (Downloads/20261106132952.pdf) plus his answers on 2026-11-06.
Goal: one obvious place for every setting, no duplicated info, easy for a stranger to follow.

## Left menu (in this order)

Search (box, opens the existing search, looks and works as today), Home, Manual Schedule, Inbox,
Queue, Analytics, Setup Channels, Settings, Financial, AI Settings, AI Studio, About.

Removed from the menu and the UI: Dashboard (merged into Home), Calendar, Upcoming, Studio's old
name, TikTok demo, Testing tools. Their saved data and the bot API stay (nothing deleted).
Activity Log moves under About. Nothing is removed from the database.

## Home

All analytics in the colorful Dashboard look (the Dashboard screen added in 0.17.0), on one screen:
1. Top strip of tiles: Being written, Ready for video, Video in progress, Open slots (new),
   Scheduled, Posted this week, Needs a look. Tiles click through (Queue, Inbox, etc).
2. Total last 7 days: Views, Likes, Shares, Comments, Watch hours.
3. Best videos last 7 days (top 3: title, channel, views).
4. Channel stats: one card per channel (slots filled x/y, views, vs last week).
5. Week map, channel by day (as the Dashboard has it today).
Drop: completion ring, up next, anything not in the sketch. Keep a small red "needs a look" strip so
a failed post is never hidden. The old Home screen content is removed.

## Manual Schedule (was Schedule)

New Post and Bulk Upload, as today. Default: the post goes to the next open slot for that channel.
A checkbox "Pick my own date and time" overrides the slot with a custom date and time. Bulk gets the
same checkbox. Overriding that breaks the minimum gap or the daily limit warns and lets him proceed.
Bots never choose times. The Schedule rules still apply to default placement.

## Inbox

As today, plus a read only Comments area for channel video comments (moved from Studio's Comments
tab; no duplicate). No replying for now.

## Queue, Analytics

As today, unchanged.

## Setup Channels

Channel list on the left, plus "Add new channel". Four tabs: Channel Setup, Connections,
Other settings by channel, Website.

Existing channels keep every saved setting. New channels get the simplified form only.

Channel Setup tab: Brand (name, color, Save, Pause this brand), Archive channel (with "are you sure"),
Pipeline rules (most posts per day, low queue alert, dates the channel does not post),
Posting slots: a Recommended box, then Shorts (checkbox, days, weekday and weekend times with Add) and
Long form (same). A channel can do shorts, long form, or both.
Not shown any more (data kept, not deleted): slug, defaults for new posts, hashtag sets, per channel
description defaults.

Connections tab: all non AI connections on one page for the selected channel: Facebook, YouTube,
Instagram, TikTok, Bluesky. Platform wide credentials (Google, Meta, TikTok app keys) in a
"Platform credentials" box at the bottom of the same tab.

Other settings by channel tab: scheduling mode, early handoff, pipeline, schedule rules, empty slot
warnings, and everything from Growth that is per channel. Every current value carries over to each
channel until Josh changes it. Anything that must be app wide goes to Settings.

Website tab: the existing website profile ("Fill ELO from the website").

## Settings (app wide, one long page with a jump list at the top)

Media Root folder, theme and dark mode (one control), Fresh start, Tell me when, Production and QC,
Thumbnail guidelines, Platform limits, Retention, Morning digest, Watchdog, Backups and Alerts
(each merged into one), Writing checks, public host for Instagram cover images, chapters, and
anything else that has to be app wide.

## Financial

Spend caps, Generate settings, and the spend table (from Studio's Spend tab).

## AI Settings

All AI related: AI models and local AI, Agent API, AI keys and connections (Gemini etc), mock mode.

## AI Studio

Josh will use it again when a permanent server exists. Keeps Overview, Research, Bible, Library,
Flagged, Publishing, Director's Log. Comments move to Inbox, Spend moves to Financial. Nothing
appears in two places.

## Rules

- Move, do not delete. No data is dropped. Existing settings keys stay.
- Every UI action stays reachable through src/main/api.ts and the agent API.
- Times stored UTC, shown America/New_York. No em dashes in any text.
- Teenager simple words in the UI. All UI strings live in src/shared/copy.ts where they do today.
- Update docs/USER_GUIDE.md and CHANGELOG.md. Release as 0.18.0.
