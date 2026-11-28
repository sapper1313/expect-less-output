# ELS Ventures and Etsy: design

Date: 2026-11-27. Status: waiting for the owner's approval. Source: a plan written by B.E.T.H. and pasted in by the owner, plus the owner's answers below.

## Intent and why

The owner wants to run his Etsy shop from ELO: see sales, listings, orders, reviews and alerts in one place, and let B.E.T.H. put draft listings in the shop. More storefronts (Amazon KDP, Gumroad) will follow, so the area is built as "ELS Ventures", with Etsy as the first provider. The owner also wants to read the sales pages on his phone, not only on the Mac.

## Goals

- A top-level "ELS Ventures" section with one sub-section per storefront. Every storefront is a provider with the same six pages.
- Etsy pages: Sales dashboard, Active listings, Items sold, Listing detail, Reviews, Notifications.
- Everything works on mock data first. Connecting the real shop later is one "Connect Etsy" button (OAuth 2.0 with PKCE).
- Pages load from ELO's own database, never from Etsy directly. A background sync fills the database every 15 to 30 minutes within Etsy's rate limits.
- Owner decision: the same pages open on the Mac (inside ELO) and on his phone (over Tailscale, read only).
- B.E.T.H. can create and update draft listings through a secured, audited endpoint.
- Alerts for new orders, new reviews, low-star reviews and new buyer messages, with badges on ELS Ventures and Etsy, a list, and Telegram through the existing setup.

## Non-goals

- No replying to messages or reviews from ELO (Etsy has no API for it). Replies happen on Etsy.
- No activating, deleting or repricing live listings from ELO or from B.E.T.H. Drafts only.
- No buyer emails or addresses are stored for display or shown anywhere.
- No second storefront is built now, only the seam for it.
- No exposing the rest of ELO (posting, settings, connections) to the phone.

## Anti-goals (failure even if it "works")

- Any secret (keystring, shared secret, OAuth tokens, IMAP password) in logs, the UI, the repo or a plain file.
- The phone page being able to change anything, or being reachable from the public internet.
- A live listing changed by a bot without a person activating it.

## Constraints

- Follows the project spec: Electron, React, Tailwind, better-sqlite3, versioned migrations (next is 049 and up, never edit an applied one), `safeStorage` for secrets, every UI action also reachable through `src/main/api.ts`, all UI strings in `src/shared/copy.ts`, times stored UTC and shown America/New_York, brand names are data.
- Etsy app is "Pending Personal Approval": real calls are not possible yet. Scopes when approved: listings_r, listings_w, transactions_r, shops_r, profile_r.
- Etsy API v3 limits apply (queries per second and per day). The sync must back off on 429 and never loop.
- The existing phone page, token and Tailscale switch (`agent.server.phone`, `agentApiTailscale`) are reused. The agent API and MCP server stay on 127.0.0.1.

## Approaches considered

1. Separate plain-HTML phone pages next to the React pages. Smallest, but two copies of every page. Rejected.
2. **Chosen by the owner: one set of React pages, two shells.** The Mac shell is ELO itself. The phone shell is a second small Vite entry that mounts only the ELS Ventures screens, with a thin HTTP stand-in for `window.elo` that can call only an allowlist of read-only Etsy functions.
3. Serve all of ELO to the phone. Most work and far more exposure. Rejected.

## The design

### Navigation

- `NAV_GROUPS` in `App.tsx` gets a new group "ELS Ventures". It opens a sub-menu listing the registered storefronts (today: Etsy).
- Narrow windows (under about 900px) swap the fixed 228px sidebar for a top bar with a menu button and a slide-over drawer holding the same groups. Every existing section stays reachable in both layouts. Badges show in both.
- A storefront is a provider object registered in one list: `id`, `label`, `pages[]` (the six page ids and components), `syncer`, `notifications`. Adding KDP later means adding one provider file and one line in the list. The sub-menu and routing read the list, nothing is hardcoded per storefront.

### Provider contract (shared)

`src/shared/ventures.ts` holds the typed contract: dashboard summary for a date range, listings (search, sort), orders with line items, listing detail, reviews, notifications, connection status. Etsy implements it. A `mock` implementation of the same contract feeds the pages until the app is approved, and stays for tests.

### Data and sync (main process)

- New migration adds tables prefixed `venture_`: shops, listings, listing_images, listing_price_history, orders, order_items, reviews, ledger_entries (fees), messages, notifications, sync_state. Buyers are stored as username only.
- `src/main/ventures/etsy/` holds the OAuth client (PKCE, loopback redirect like the other connectors), token store (encrypted, refreshed automatically before expiry), the API client with rate limiting and retry, and the syncer.
- The scheduler runs the syncer every 20 minutes (inside the 15 to 30 window), one shop at a time, honoring `Retry-After`. Revenue, orders, units, average order value, fees and net are computed from the cached tables. Fees come from payment ledger entries, since Etsy has no simple fee field. Net is shown separately from gross.
- Price history is recorded each time the sync sees a changed price. It starts when the shop is connected.
- Mock mode seeds realistic fake data so every page and the storefront list can be seen before approval.

### Pages (shared React components, responsive)

Sales dashboard (today, 7, 30, year to date, custom range, revenue chart, top products), Active listings (thumbnail, title, price, views, favorites, quantity, state, link to Etsy, search and sort), Items sold (date, product, quantity, price, buyer username only), Listing detail (images, description, tags, price history, views, favorites, sales), Reviews (latest, star rating, flag on 1 to 3 stars), Notifications (list, mark read). All pages are cards that stack on narrow widths and tables that become card lists.

### Notifications and messages

- Notification kinds: new order, new review, low-star review, new buyer message. The sync creates them. Badge counts show on ELS Ventures and on Etsy. Telegram sends through the existing alert service by adding new kinds to `AlertKind`.
- Buyer messages: ELO reads Etsy's "new message" notification emails from a mailbox over IMAP (read only, one dedicated folder or label, polled with the sync). It stores sender name, subject, snippet, time and the link that opens the conversation on Etsy. It does not store the full body or any address. The mailbox password is encrypted with `safeStorage`. Settings has a small card to enter the mailbox and test it. Until it is set up, the message count simply shows as "not connected".

### Phone shell

- The existing phone server adds a second page and a small JSON route set under the same secret-token link, served only on the Tailscale address when that switch is on. The route set is an allowlist of read-only Etsy calls (dashboard, listings, orders, detail, reviews, notifications). Any other path returns 404. No connect, disconnect, settings or write calls exist on it.
- The phone entry reuses the same screen components, so Mac and phone always match.

### B.E.T.H. write access

- New routes on the existing agent API (loopback, bearer token, schema checked), enabled for the `beth` bot only: create draft listing and update draft listing (title, description, tags, price, images, digital file). Routes refuse any listing that is not a draft and never set state to active.
- Every call writes an `audit_log` row (who, what, when, listing id, fields changed, never secrets). Dry-run and mock mode record the change locally without calling Etsy.
- Until the app is approved and `listings_w` is granted, writes are stored as pending drafts in ELO and pushed on first connect (call: see below).
- `docs/openapi.json` is regenerated (`npm run openapi`).

### Connect Etsy

One button on the Etsy page starts the OAuth PKCE flow in the browser and returns through a loopback redirect. API keystring and shared secret are read from env or config at start and never logged or shown. Status, expiry and a Disconnect button sit beside it.

### Tests and acceptance

- Unit tests (vitest, in-memory database): ledger math for gross, fees and net, date ranges including Eastern time, sync upsert and price history, rate-limit backoff, token refresh, notification creation, IMAP email parsing (fixture emails), phone allowlist (every non-listed path is refused), beth route refuses non-drafts and always audits.
- Acceptance: with mock data every page renders, the storefront list holds more than one entry (a second mock storefront is registered in tests), the layout works at phone width, and the phone shell opens with the token and shows read only data.

## What is left to the builder

Visual styling inside the existing glass theme, chart library choice (reuse what Analytics uses), exact table columns beyond the listed ones, and file layout inside `src/main/ventures/`.

## Calls I made (please check these)

1. **Phone shell is a second small page on the existing phone server**, not a new server, and it reuses the existing secret link and Tailscale switch.
2. **Mailbox for messages: IMAP, read only,** with the password encrypted. If you would rather forward the emails to a Gmail label, the same code works with Gmail's IMAP.
3. **Narrow layout breakpoint at about 900px** with a drawer menu.
4. **Sync every 20 minutes.**
5. **B.E.T.H. drafts made before Etsy approval are held in ELO as pending and pushed after you connect.** This keeps her endpoint testable now.
6. **Price history starts at connect time.** Etsy gives no past prices.
7. **Mock storefront data stays in the app as a demo mode** until you connect the real shop, then is replaced.
8. **Build in this order:** navigation and provider contract with mock data, then the six pages, then database and sync (mock-driven), then notifications and Telegram, then phone shell, then B.E.T.H. endpoint, then OAuth and IMAP last, since they need real approval to fully test.
