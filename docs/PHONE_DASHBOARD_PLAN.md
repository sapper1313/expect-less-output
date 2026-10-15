# Phone access: ideas saved for when the new server is ready

Status: not built. The owner chose to do the better Telegram commands first (done in version 0.9.8) and to wait on the rest until the dedicated server is set up. The owner already uses Tailscale to reach a local server.

## What is already built (version 0.9.8, Telegram)

Text the bot: /last, /stats (or /stats 30), /today, /spend, /flags, /brands, /pause and /resume (everything, or one brand by name, always after a YES). Plain questions such as "when was the last post" and "analytics" are answered from the app's records, not by a model.

## 1. Phone dashboard page (read only)

- One page served by ELO. A card for each brand: last post per platform, next post, views and likes for the last 7 days with a small chart, flagged items, and the month's spend.
- Reach it from the phone over Tailscale only. Bind the page to the Tailscale address (or use `tailscale serve`), never to the public internet.
- A secret token in the link, read only, no buttons that change anything. Pause and resume stay in Telegram with a YES.
- The data already exists in the app: `home.summary`, the stats service, the spend summary and the same report builders Telegram uses (`src/main/studio/telegramReports.ts`). The page needs a small read only HTTP route and a mobile layout, no new data work.

## 2. Report file in iCloud Drive (no server needed)

- ELO writes one simple HTML page every 30 minutes into a folder in iCloud Drive. The phone opens it from the Files app.
- Nothing is exposed to any network. It is only as fresh as the last write, and the Mac must be on and syncing.
- Good fallback if the dashboard is not wanted.

## 3. Weekly summary message

- Every Monday morning by Telegram or iMessage: views per brand, best video, spend, and what is flagged. Reuses the same report builders.

## When the server moves, check

1. Move the app data with Backup and restore (Settings, Alerts and backup). It remaps the Media Root and flags accounts to reconnect.
2. Turn on Launch at login and leave the Mac or server awake.
3. Reconnect the platforms that ask (Meta, TikTok, YouTube) and the Telegram pairing.
4. Tailscale on the server and the phone. Decide the machine name the dashboard will use.
5. The agent API and the MCP server only listen on 127.0.0.1. Keep it that way. The dashboard is a separate, read only route.

## Questions to settle before building

- Which analytics matter most on the phone (views, likes, comments, best video, followers, spend).
- Should the dashboard show every brand or let the owner pick.
- Does the owner want the weekly summary by Telegram, iMessage or both.
