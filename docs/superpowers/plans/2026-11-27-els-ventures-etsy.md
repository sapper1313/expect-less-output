# ELS Ventures and Etsy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "ELS Ventures" section to ELO with Etsy as the first storefront provider (six pages, cached sync, notifications, read-only phone view, B.E.T.H. draft-listing endpoint), built on mock data first.

**Architecture:** A typed provider contract in `src/shared/ventures.ts` is implemented by a mock provider and an Etsy provider, both reading a local SQLite cache (`venture_*` tables) filled by a syncer. Six shared React screens render any provider; the Mac shell is ELO itself and a second Vite entry (`ventures.html`) is served by the existing phone server over a read-only allowlist. B.E.T.H. writes go through new agent-API routes limited to drafts and audited.

**Tech Stack:** Electron, React, Tailwind, better-sqlite3, vitest, zod, electron-vite, existing `SecretStore`, `AlertService`, `AgentServer`.

**Spec:** `docs/superpowers/specs/2026-11-27-els-ventures-etsy-design.md`

## Global Constraints

- Read `docs/01_PROJECT_SPEC.md` first. Owner is not a developer: any instruction to him is step by step and teenager simple. No em dashes in any text (code comments, copy, docs, commits).
- Migrations are versioned SQL in `src/main/db/migrations/NNN_name.sql`, never edit an applied one. Latest is 049, so new ones start at 050.
- All UI strings live in `src/shared/copy.ts`. Brand names are data, never hardcoded in logic.
- Every UI action is also callable through `src/main/api.ts` (builds the one service layer used by IPC and the agent API).
- Times stored UTC, shown America/New_York (`src/shared/time.ts`).
- Secrets (Etsy keystring and shared secret, OAuth tokens, mailbox password) never logged or shown; tokens and passwords stored through `SecretStore` (safeStorage). The renderer gets `has` and masks only.
- Buyers shown by username only. No buyer email or address is stored or displayed.
- Etsy scopes: `listings_r listings_w transactions_r shops_r profile_r`. Sync every 20 minutes. Back off on HTTP 429 and honor `Retry-After`.
- Agent API and MCP listen on 127.0.0.1 only. The phone allowlist is read only. B.E.T.H. may only create or update drafts and never activates a listing.
- Verify with `npm test`, `npm run typecheck`, `npm run lint` (25 pre-existing lint problems is the baseline). Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Empty shop or zero sales: dashboard shows zeros and an empty chart, no divide-by-zero in average order value (Task 3, Task 6).
- Custom date range that is reversed or spans a daylight saving change: reversed ranges are rejected, boundaries use Eastern midnight (Task 3).
- Etsy returns 429 or a 5xx mid-sync: partial progress is kept, next run resumes, no tight retry loop (Task 5).
- Expired or revoked OAuth token: one refresh attempt, then status becomes `needs_reauth` and an alert, not a crash loop (Task 9).
- Message email with odd encoding, no snippet, or not from Etsy: parsed safely or skipped, never stored with addresses (Task 10).
- Phone request with a wrong token, a path outside the allowlist, or a non-GET method: refused (Task 8).
- B.E.T.H. tries to set state active, edit a non-draft, or exceed Etsy limits (tags over 13, title over 140): rejected with a clear error and still audited (Task 11).

## File Structure

- `src/shared/ventures.ts`: provider contract types, `VentureRange`, notification kinds. No logic beyond type guards.
- `src/shared/copy.ts`: add `COPY.ventures` strings.
- `src/main/db/migrations/050_ventures.sql`: all `venture_*` tables.
- `src/main/ventures/store.ts`: SQL read and write helpers over the cache (`VentureStore`).
- `src/main/ventures/metrics.ts`: pure functions: range resolution (Eastern), revenue, fees, net, AOV, series, top products.
- `src/main/ventures/mock.ts`: `MockProvider` plus seeded fixture data.
- `src/main/ventures/registry.ts`: `VentureRegistry` listing providers by id.
- `src/main/ventures/etsy/client.ts`: HTTP client with rate limiting.
- `src/main/ventures/etsy/oauth.ts`: PKCE flow and token refresh.
- `src/main/ventures/etsy/sync.ts`: `EtsySyncer`.
- `src/main/ventures/etsy/provider.ts`: `EtsyProvider` (reads the cache).
- `src/main/ventures/notifications.ts`: creates notifications, badge counts, Telegram via `AlertService`.
- `src/main/ventures/messages.ts`: IMAP poller and Etsy email parser.
- `src/main/ventures/drafts.ts`: B.E.T.H. draft create and update, pending push.
- `src/main/ventures/phoneRoutes.ts`: read-only allowlist for the phone shell.
- `src/renderer/src/ventures/`: `VenturesLayout.tsx`, `pages/{Dashboard,Listings,ItemsSold,ListingDetail,Reviews,Notifications}.tsx`, `useVentures.ts`.
- `src/renderer/ventures.html`, `src/renderer/src/ventures/phoneMain.tsx`: phone shell entry.
- Modify: `src/renderer/src/App.tsx` (nav), `src/shared/api.ts`, `src/main/api.ts`, `src/main/index.ts`, `src/main/agent/{phone,server,handlers,core}.ts`, `src/shared/agentSchemas.ts`, `src/main/alerts/format.ts`, `electron.vite.config.ts`.
- Tests: `tests/ventures*.test.ts`.

---

### Task 1: Provider contract, copy, registry

**Files:**
- Create: `src/shared/ventures.ts`, `src/main/ventures/registry.ts`
- Modify: `src/shared/copy.ts`
- Test: `tests/venturesRegistry.test.ts`

**Interfaces:**
- Produces (`src/shared/ventures.ts`):
  - `type VentureRange = { from: string; to: string }` (Eastern dates `YYYY-MM-DD`, inclusive) and `type RangePreset = 'today' | '7d' | '30d' | 'ytd' | 'custom'`
  - `interface Money { cents: number; currency: string }`
  - `interface DashboardSummary { range: VentureRange; revenue: Money; fees: Money; net: Money; orders: number; units: number; averageOrder: Money; series: Array<{ date: string; revenueCents: number }>; topProducts: Array<{ listingId: string; title: string; units: number; revenueCents: number }> }`
  - `type ListingState = 'active' | 'draft' | 'inactive' | 'expired'`
  - `interface ListingRow { id: string; title: string; thumbUrl: string | null; priceCents: number; currency: string; views: number; favorites: number; quantity: number; state: ListingState; url: string }`
  - `interface ListingDetail extends ListingRow { description: string; tags: string[]; images: string[]; priceHistory: Array<{ at: string; cents: number }>; sales: number }`
  - `interface OrderRow { receiptId: string; placedAt: string; buyerUsername: string; items: Array<{ listingId: string; title: string; quantity: number; priceCents: number }> }`
  - `interface ReviewRow { id: string; listingId: string | null; rating: number; text: string; at: string; buyerUsername: string; low: boolean }`
  - `type NotificationKind = 'order' | 'review' | 'low_review' | 'message'`
  - `interface VentureNotification { id: number; storefront: string; kind: NotificationKind; title: string; detail: string; at: string; read: boolean; url: string | null }`
  - `interface ConnectionStatus { mode: 'mock' | 'connected' | 'not_connected' | 'needs_reauth'; shopName: string | null; lastSyncAt: string | null; expiresAt: string | null }`
  - `interface VentureProvider { id: string; label: string; status(): ConnectionStatus; dashboard(r: VentureRange): DashboardSummary; listings(q: { search?: string; sort?: 'title' | 'price' | 'views' | 'favorites' | 'quantity'; dir?: 'asc' | 'desc' }): ListingRow[]; listing(id: string): ListingDetail | null; orders(r: VentureRange): OrderRow[]; reviews(limit: number): ReviewRow[]; notifications(): VentureNotification[]; unread(): number }`
- Produces (`registry.ts`): `class VentureRegistry { register(p: VentureProvider): void; list(): Array<{ id: string; label: string }>; get(id: string): VentureProvider | undefined }`

- [ ] **Step 1: Write failing test** in `tests/venturesRegistry.test.ts`: registering two fake providers (`etsy`, `kdp`) gives `list()` of length 2 in registration order; `get('kdp')?.label` equals the label given; `get('nope')` is `undefined`; registering a duplicate id throws `Error` containing `already registered`.
- [ ] **Step 2: Run** `npx vitest run tests/venturesRegistry.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the types in `src/shared/ventures.ts` and `VentureRegistry` in `src/main/ventures/registry.ts` (a `Map` preserving insertion order).
- [ ] **Step 4: Add `COPY.ventures`** in `src/shared/copy.ts`: `nav: 'ELS Ventures'`, page names (`dashboard: 'Sales'`, `listings: 'Listings'`, `itemsSold: 'Items sold'`, `reviews: 'Reviews'`, `notifications: 'Notifications'`), `lowStarFlag: 'Low rating'`, `notConnected`, `connectEtsy: 'Connect Etsy'`, empty-state lines. Plain words, no em dashes.
- [ ] **Step 5: Run** the test again. Expected: PASS.
- [ ] **Step 6: Commit** `git add -A && git commit -m "Ventures: provider contract and registry"`.

### Task 2: Database tables and store

**Files:**
- Create: `src/main/db/migrations/050_ventures.sql`, `src/main/ventures/store.ts`
- Test: `tests/venturesStore.test.ts`

**Interfaces:**
- Consumes: `ListingRow`, `ListingDetail`, `OrderRow`, `ReviewRow`, `VentureNotification` from Task 1.
- Produces: `class VentureStore { constructor(db: Db); upsertListing(storefront: string, l: ListingDetail): void; listingRows(storefront: string): ListingRow[]; getListing(storefront: string, id: string): ListingDetail | null; upsertOrder(storefront: string, o: OrderRow & { feesCents: number; currency: string }): void; ordersBetween(storefront: string, fromUtc: string, toUtc: string): Array<OrderRow & { feesCents: number; currency: string }>; upsertReview(storefront: string, r: ReviewRow): boolean /* true if new */; reviewsLatest(storefront: string, limit: number): ReviewRow[]; addNotification(n: Omit<VentureNotification, 'id' | 'read'>, dedupeKey: string): boolean /* false if duplicate */; notifications(storefront: string): VentureNotification[]; markRead(ids: number[]): void; unreadCount(storefront: string): number; setState(storefront: string, key: string, value: string | null): void; getState(storefront: string, key: string): string | null }`
- Tables (all with `storefront TEXT NOT NULL` so a second storefront shares them): `venture_listings`, `venture_listing_images`, `venture_price_history` (records a row only when price changes), `venture_orders`, `venture_order_items`, `venture_reviews`, `venture_ledger`, `venture_messages` (sender, subject, snippet, at, url, dedupe key; no addresses or bodies), `venture_notifications` (unique on `storefront, dedupe_key`), `venture_state` (key and value per storefront).

- [ ] **Step 1: Write failing tests**: after `makeEnv()` the new tables exist; `upsertListing` twice with a changed price adds exactly one extra `priceHistory` entry and none when the price is unchanged; `upsertReview` returns `true` then `false` for the same id; `addNotification` with the same `dedupeKey` twice returns `true` then `false`; `unreadCount` drops after `markRead`; data for storefront `kdp` never appears in `etsy` queries.
- [ ] **Step 2: Run** `npx vitest run tests/venturesStore.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write `050_ventures.sql`** and `VentureStore`. Money as integer cents, times as UTC ISO text.
- [ ] **Step 4: Run** the tests. Expected: PASS. Also run `npx vitest run` to confirm the migration list test (if any) still passes.
- [ ] **Step 5: Commit.**

### Task 3: Metrics (pure functions)

**Files:**
- Create: `src/main/ventures/metrics.ts`
- Test: `tests/venturesMetrics.test.ts`

**Interfaces:**
- Consumes: types from Task 1, `src/shared/time.ts`.
- Produces: `resolveRange(preset: RangePreset, nowMs: number, custom?: VentureRange): VentureRange` (throws `Error('Start date is after end date.')` when reversed); `rangeToUtc(r: VentureRange): { fromUtc: string; toUtc: string }` (Eastern midnight start, next Eastern midnight end, so DST days are 23 or 25 hours); `summarize(orders: Array<{ placedAt: string; items: OrderRow['items']; feesCents: number; currency: string }>, range: VentureRange): DashboardSummary` where revenue is the sum of `quantity * priceCents`, `net = revenue - fees`, `averageOrder = orders === 0 ? 0 : Math.round(revenue / orders)`, `series` has one entry per day in the range including zero days, `topProducts` sorted by revenue descending, max 10.

- [ ] **Step 1: Write failing tests**: today/7d/30d/ytd presets for a fixed `nowMs` (assert exact `from`/`to`); reversed custom range throws the message above; `rangeToUtc` for 2026-03-08 (spring forward) spans 23 hours and for 2026-11-01 spans 25 hours; `summarize([])` returns zeros with a full zero series and `averageOrder.cents === 0`; a two-order fixture gives exact revenue, fees, net, orders, units, AOV, and top products order.
- [ ] **Step 2: Run** to see failure.
- [ ] **Step 3: Implement** in `metrics.ts` using luxon with `ZONE`.
- [ ] **Step 4: Run** to see pass.
- [ ] **Step 5: Commit.**

### Task 4: Mock provider and Etsy provider (cache readers)

**Files:**
- Create: `src/main/ventures/mock.ts`, `src/main/ventures/etsy/provider.ts`
- Test: `tests/venturesProviders.test.ts`

**Interfaces:**
- Consumes: `VentureStore` (Task 2), `summarize`/`rangeToUtc` (Task 3), `VentureProvider` (Task 1).
- Produces: `seedMockData(store: VentureStore, storefront: string, nowMs: number): void` (about 12 listings across all four states, 40 orders over 60 days, 8 reviews including two with 1 to 3 stars, 5 notifications, price changes on three listings); `class CacheProvider implements VentureProvider` with `constructor(opts: { id: string; label: string; store: VentureStore; now: () => number; status: () => ConnectionStatus })`. The Etsy provider is `new CacheProvider({ id: 'etsy', label: 'Etsy', ... })`, so one class serves every storefront. `listings()` filters by case-insensitive title search and sorts by the given key and direction (default `title asc`). `reviews()` sets `low = rating <= 3`.

- [ ] **Step 1: Write failing tests**: seeded data renders through `dashboard(resolveRange('30d', now))` with non-zero revenue and `net < revenue`; `listings({ search: 'mug' })` returns only matching titles; `listings({ sort: 'price', dir: 'desc' })` is ordered; `reviews(10)` has `low === true` exactly for ratings 1 to 3; `listing(id)` includes price history entries; a fresh empty store returns an all-zero dashboard.
- [ ] **Step 2: Run** to see failure.
- [ ] **Step 3: Implement** both files. Mock images use inline `data:` SVG placeholders so no network is needed.
- [ ] **Step 4: Run** to see pass.
- [ ] **Step 5: Commit.**

### Task 5: Etsy API client and syncer

**Files:**
- Create: `src/main/ventures/etsy/client.ts`, `src/main/ventures/etsy/sync.ts`
- Test: `tests/venturesEtsySync.test.ts`

**Interfaces:**
- Consumes: `VentureStore`, a token source `() => Promise<string>` (Task 9 supplies it), keystring from config.
- Produces: `class EtsyClient { constructor(opts: { keystring: string; token: () => Promise<string>; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; baseUrl?: string }); get<T>(path: string, query?: Record<string, string | number>): Promise<T> }` sending headers `x-api-key` and `Authorization: Bearer`, spacing calls at most 5 per second, retrying 429 and 5xx up to 3 times honoring `Retry-After` (else 2s, 10s, 30s), and throwing `EtsyError { status: number; permanent: boolean }` otherwise (401 and 403 permanent). It never includes the keystring or token in error text.
- Produces: `class EtsySyncer { constructor(opts: { client: EtsyClient; store: VentureStore; shopId: () => string | null; notify: (n: Omit<VentureNotification, 'id' | 'read'>, key: string) => void; now: () => number }); run(): Promise<{ listings: number; orders: number; reviews: number }> }`. It pages listings (all four states), receipts with transactions, reviews, and payment ledger entries for fees, using `venture_state` cursors so a failed run resumes. New orders, new reviews and 1 to 3 star reviews call `notify` with dedupe keys `order:<receiptId>`, `review:<id>`, `low_review:<id>`. It stores buyer username only.

- [ ] **Step 1: Write failing tests** with a fake `fetch`: pagination across two pages stores all rows; a 429 with `Retry-After: 1` is retried via the injected `sleep` and then succeeds; three consecutive 500s throw `EtsyError` without more than 4 total attempts; a second `run()` with identical data creates no duplicate notifications; a 1 star review emits `low_review`; thrown error text contains neither the keystring nor the token; a failure on page 2 keeps page 1 saved and the next run continues from the cursor.
- [ ] **Step 2: Run** to see failure.
- [ ] **Step 3: Implement** `client.ts` then `sync.ts`. Endpoints: `/v3/application/shops/{shop_id}/listings` (by state), `/receipts`, `/reviews`, `/payment-account/ledger-entries`, per Etsy Open API v3 docs. Check the docs page for each exact path and field name before coding and note any difference in the commit message.
- [ ] **Step 4: Run** to see pass.
- [ ] **Step 5: Commit.**

### Task 6: Service layer, API wiring, scheduler

**Files:**
- Create: `src/main/ventures/service.ts`
- Modify: `src/shared/api.ts`, `src/main/api.ts`, `src/main/index.ts`
- Test: `tests/venturesService.test.ts`

**Interfaces:**
- Consumes: registry, store, providers, syncer.
- Produces: `class VenturesService { constructor(deps: { registry: VentureRegistry; store: VentureStore; now: () => number; syncers: Record<string, { run(): Promise<unknown> }> }); storefronts(): Array<{ id: string; label: string; unread: number; mode: ConnectionStatus['mode'] }>; dashboard(id: string, preset: RangePreset, custom?: VentureRange): DashboardSummary; listings(id, q); listing(id, listingId); orders(id, preset, custom?); reviews(id, limit); notifications(id); markRead(id, ids: number[]); unreadTotal(): number; syncNow(id): Promise<void> }`.
- `Api` (shared) gains group `ventures` with exactly these methods. Unknown storefront ids throw `Error('Unknown storefront.')`.
- `index.ts`: construct the service, register the Etsy `CacheProvider`, seed mock data when `status().mode === 'mock'` and the store is empty, `setInterval(() => void ventures.syncAll().catch(() => {}), 20 * 60_000)` skipping storefronts that are in mock mode.

- [ ] **Step 1: Write failing tests**: `storefronts()` lists registered providers with unread counts; a second fake provider appears too; `dashboard('etsy','7d')` works through the service; unknown id throws; `markRead` lowers `unreadTotal`; `syncNow` calls the syncer once.
- [ ] **Step 2: Run** to see failure.
- [ ] **Step 3: Implement** the service and wire `api.ts` and `index.ts`. Mock mode is the default until Task 9 connects a real shop.
- [ ] **Step 4: Run** `npx vitest run tests/venturesService.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 7: Navigation, responsive menu, six shared pages

**Files:**
- Create: `src/renderer/src/ventures/VenturesLayout.tsx`, `useVentures.ts`, `pages/Dashboard.tsx`, `pages/Listings.tsx`, `pages/ItemsSold.tsx`, `pages/ListingDetail.tsx`, `pages/Reviews.tsx`, `pages/Notifications.tsx`
- Modify: `src/renderer/src/App.tsx`
- Test: `tests/venturesNav.test.ts` (pure helper) and manual browser check

**Interfaces:**
- Consumes: `api.ventures.*` (Task 6), `COPY.ventures`.
- Produces: `VenturesLayout({ data: VenturesData; initialStorefront?: string })` where `VenturesData` is the object returned by `useVentures()` (all six reads plus `markRead`), so the phone shell can pass an HTTP-backed one. Page components take `{ data, storefront }`. Pure helper `src/renderer/src/ventures/nav.ts`: `export const needsDrawer = (widthPx: number): boolean => widthPx < 900`.
- `App.tsx`: add `'ventures'` to `Screen`, a group `{ label: 'ELS Ventures', items: ['ventures'] }` placed after Financial, badge from `api.ventures.unreadTotal()`, and a top bar with a menu button and slide-over drawer below 900px that renders the same `NAV_GROUPS` (so every existing screen stays reachable). Add a Playwright-free check: render at 375px and 1200px using the Browser pane.

- [ ] **Step 1: Write failing test** `needsDrawer(899) === true`, `needsDrawer(900) === false`.
- [ ] **Step 2: Run** to see failure, implement `nav.ts`, run to pass.
- [ ] **Step 3: Build the layout and pages.** Sub-menu lists `api.ventures.storefronts()` (so a second storefront appears with no layout change), tabs for the five pages (Listing detail opens from a listing row). Tables become stacked cards under 640px. Dashboard has preset buttons (Today, 7 days, 30 days, Year to date, Custom with two date inputs), tiles for revenue, orders, units, average order and fees with net shown as its own tile, a revenue-over-time chart (reuse the chart approach in `src/renderer/src/screens/Stats.tsx`), and a top products table. Listings has search and sortable headers plus an "Open on Etsy" link using `window.open` through the existing external-link pattern. Items sold shows only date, product, quantity, price, buyer username. Reviews flags `low` rows. Notifications lists with unread dots and a "Mark all read" button.
- [ ] **Step 4: Verify in the browser pane** (`npm run dev`): at 1200px and at 375px every page renders with mock data, the drawer opens and reaches Home, Queue and Settings, and no horizontal page scroll appears. Capture one screenshot of each width.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint` (no new lint problems) and commit.

### Task 8: Phone shell and read-only allowlist

**Files:**
- Create: `src/main/ventures/phoneRoutes.ts`, `src/renderer/ventures.html`, `src/renderer/src/ventures/phoneMain.tsx`
- Modify: `src/main/agent/phone.ts`, `src/main/agent/server.ts`, `electron.vite.config.ts`, `src/main/index.ts`
- Test: `tests/venturesPhone.test.ts`

**Interfaces:**
- Consumes: `VenturesService` (Task 6), existing `handlePhoneRequest`, `PhoneProvider`.
- Produces: `phoneVenturesRoute(svc: VenturesService, method: string, path: string, query: URLSearchParams): { status: number; body: unknown } | null`. Allowlist, GET only: `ventures/storefronts.json`, `ventures/dashboard.json?storefront&preset&from&to`, `ventures/listings.json`, `ventures/listing.json?id`, `ventures/orders.json`, `ventures/reviews.json`, `ventures/notifications.json`. Anything else under `ventures/` returns `{ status: 404 }`; non-GET returns 405. `PhoneProvider` gains `ventures: VenturesService | null`. The page `ventures/` serves the built entry; static assets are read from the built renderer folder and served only for files that exist inside it (no path traversal).
- Phone entry mounts `VenturesLayout` with a `data` object whose methods call `fetch(base + 'ventures/...')` with the same token path (`/m/<token>/`). It has no write calls at all, and hides the "Connect Etsy" button and "Mark all read".

- [ ] **Step 1: Write failing tests**: valid GET routes return 200 with the expected shapes from a seeded service; `POST ventures/dashboard.json` returns 405; `ventures/connect`, `ventures/../settings` and `ventures/%2e%2e/x` return 404; a request with a wrong token to `/m/WRONG/ventures/storefronts.json` gets the same refusal the Home page gets (follow the existing `handlePhoneRequest` behavior and assert equality); the response body of every route contains no key named `email` or `address`.
- [ ] **Step 2: Run** to see failure.
- [ ] **Step 3: Implement** the route function and hook it into `handlePhoneRequest` after token check. Add the second Vite input (`ventures.html`) in `electron.vite.config.ts` and serve built files from the renderer output directory resolved via `app.getAppPath()` (works inside the packaged app).
- [ ] **Step 4: Run** tests and `npm run build`; confirm `out/renderer/ventures.html` exists.
- [ ] **Step 5: Manual check:** with Tailscale off, open `http://127.0.0.1:<agentApiPort>/m/<token>/ventures/` in the browser pane at 375px and confirm all pages render with mock data and no write buttons show. Commit.

### Task 9: Etsy OAuth (Connect Etsy) and token refresh

**Files:**
- Create: `src/main/ventures/etsy/oauth.ts`
- Modify: `src/main/ventures/service.ts`, `src/shared/api.ts`, `src/main/api.ts`, `src/renderer/src/ventures/pages/Dashboard.tsx` (connect card)
- Test: `tests/venturesEtsyOauth.test.ts`

**Interfaces:**
- Consumes: `SecretStore`, a loopback redirect helper (reuse the pattern used by the TikTok or Google connector in `src/main/tiktok/service.ts` and `src/main/google/`), keystring from `process.env.ETSY_API_KEYSTRING` or the config file the other connectors read, shared secret likewise.
- Produces: `class EtsyAuth { constructor(opts: { secrets: SecretStore; fetch?: typeof fetch; now: () => number; openUrl: (u: string) => void; credentials: () => { keystring: string; sharedSecret: string } | null }); connect(): Promise<{ shopId: string; shopName: string }>; accessToken(): Promise<string>; status(): ConnectionStatus; disconnect(): void }`. PKCE with S256 code challenge and a random state checked on return. Scopes string exactly `listings_r listings_w transactions_r shops_r profile_r`. Tokens stored under `ventures.etsy.tokens` as one JSON secret. `accessToken()` refreshes when under 5 minutes from expiry, once; a refresh failure sets status `needs_reauth` and raises one alert. `api.ventures.connectEtsy()` and `disconnectEtsy()` are owner-only, not on the phone allowlist.
- When no credentials are configured, `connect()` throws `Error('Etsy keys are not set up yet.')` and the UI shows the plain-words setup note.

- [ ] **Step 1: Write failing tests**: the authorize URL contains `code_challenge_method=S256`, the exact scope string, and a `state`; a callback with the wrong state is rejected; the verifier hashes to the challenge; a token near expiry triggers exactly one refresh call; a failed refresh sets `needs_reauth`; `JSON.stringify` of `status()` and any thrown error contains neither token nor secret; missing credentials gives the message above.
- [ ] **Step 2: Run** to see failure, implement, run to pass.
- [ ] **Step 3: Wire** the "Connect Etsy" button (shown only when `mode !== 'connected'`) and switch the Etsy provider status from `mock` to `connected` after success; on connect clear mock data for `etsy` before the first real sync. Disconnecting returns to `not_connected` (not mock).
- [ ] **Step 4: Commit.** Real end-to-end testing waits for Etsy approval. Add a short owner note in `docs/USER_GUIDE.md` with the exact click steps for Connect Etsy and where to put the keys.

### Task 10: Notifications, Telegram, and buyer messages from email

**Files:**
- Create: `src/main/ventures/notifications.ts`, `src/main/ventures/messages.ts`
- Modify: `src/main/alerts/format.ts` (add kinds `venture_order`, `venture_review`, `venture_low_review`, `venture_message`), `src/main/index.ts`, `src/shared/api.ts`, `src/main/api.ts`, a small Settings card in `src/renderer/src/screens/` for the mailbox
- Test: `tests/venturesNotifications.test.ts`, `tests/venturesMessages.test.ts`

**Interfaces:**
- Consumes: `VentureStore.addNotification`, `AlertService`, `SecretStore`.
- Produces: `class VentureNotifier { constructor(deps: { store: VentureStore; alerts: Pick<AlertService, 'send'>; telegram: (text: string) => void }); notify(n: Omit<VentureNotification, 'id' | 'read'>, key: string): void }` (stores, and only when new, sends one Telegram line through the existing Telegram setup, plain words, no buyer details beyond username).
- Produces: `parseEtsyMessageEmail(raw: string): { sender: string; subject: string; snippet: string; at: string; url: string } | null` (sender is the buyer display name, snippet at most 140 characters, url must start with `https://www.etsy.com/`; returns `null` for non-Etsy senders; never returns addresses). `class MessagePoller { constructor(opts: { secrets: SecretStore; imap: ImapSource; store: VentureStore; notify: VentureNotifier['notify']; now: () => number }); poll(): Promise<number> }` where `ImapSource = { fetchUnseen(folder: string): Promise<string[]> }`; the real source uses the `imapflow` package (add with `npm install imapflow`, read only, one folder, `readOnly: true`). Mailbox host, user, folder in settings; password under secret key `ventures.mail.password`. Poll runs with the sync. `api.ventures.saveMailbox`, `testMailbox` (owner only).

- [ ] **Step 1: Write failing tests**: duplicate key notifies once; Telegram text for a 2 star review says low rating and never includes the review text; the parser handles a fixture Etsy email (plain and base64 and quoted-printable), returns `null` for a non-Etsy sender and for malformed input, truncates the snippet, rejects a non-Etsy url, and output has no `@` characters; the poller dedupes the same email twice and creates a `message` notification; without mailbox settings `poll()` resolves `0`.
- [ ] **Step 2: Run** to see failure, implement, run to pass.
- [ ] **Step 3: Badge wiring:** `VenturesService.unreadTotal()` feeds the ELS Ventures badge and `storefronts()[i].unread` feeds the Etsy badge (already built in Tasks 6 and 7; verify both show after mock notifications exist).
- [ ] **Step 4: Commit.**

### Task 11: B.E.T.H. draft listing endpoint

**Files:**
- Create: `src/main/ventures/drafts.ts`
- Modify: `src/shared/agentSchemas.ts`, `src/main/agent/handlers.ts`, `src/main/agent/core.ts`, `docs/openapi.json` (via `npm run openapi`)
- Test: `tests/venturesDrafts.test.ts`

**Interfaces:**
- Consumes: `Caller` and audit writer from `src/main/agent/bots.ts` / `bethActions.ts`, `isOperator`, `EtsyClient`, `VentureStore`.
- Produces: routes `POST /v1/ventures/etsy/drafts` and `PATCH /v1/ventures/etsy/drafts/{id}`, bot-allowed only for the operator bot (`beth`) and the owner. Body schema `DraftListingInput`: `title` (1 to 140 chars), `description` (1 to 10000), `tags` (0 to 13, each 1 to 20 chars), `priceCents` (integer, at least 20), `images` (0 to 10 local file paths or https URLs), `digitalFile` (optional local file path), and no `state` field at all. `class DraftService { constructor(deps: { store: VentureStore; client: () => EtsyClient | null; audit: { write(e: { actor: string; action: string; target: string; detail?: string }): void }; now: () => number }); create(caller, input): Promise<{ id: string; state: 'draft'; pending: boolean }>; update(caller, id, patch): Promise<{ id: string; state: 'draft'; pending: boolean }> }`. `update` throws `AgentError` when the cached listing exists and `state !== 'draft'` ("Only drafts can be changed here."). When the client is null (mock mode or not connected) the draft is stored locally with `pending = true` and a local id `pending-<n>`; `pushPending()` sends them after connect.
- Every call, allowed or refused, writes an audit row `action: 'ventures.draft.create' | 'ventures.draft.update' | 'api.denied'` with actor, listing id and the list of changed field names (never values of secrets, never file contents).

- [ ] **Step 1: Write failing tests**: beth creates a draft and an audit row exists with actor `beth`; a different bot is denied and audited; a body containing `state: 'active'` fails schema validation; 14 tags fails; title of 141 chars fails; updating an active cached listing throws and is audited; with a null client the result has `pending: true`; `pushPending` creates the Etsy draft via a fake client, clears `pending`, and never sends a state other than `draft`; the audit detail never contains the digital file's contents.
- [ ] **Step 2: Run** to see failure, implement, run to pass.
- [ ] **Step 3: Register the routes** following the existing `createPost` route pattern in `agentSchemas.ts` and `handlers.ts`; run `npm run openapi` and commit the regenerated file. Add a section to `docs/GROKBOT_GUIDE.md` or the B.E.T.H. instructions file in `docs/` explaining the new endpoint in plain words.
- [ ] **Step 4: Run** `npx vitest run tests/venturesDrafts.test.ts tests/openapi*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 12: Full verification, docs, build

**Files:**
- Modify: `docs/USER_GUIDE.md`, `CHANGELOG.md`, `package.json` version bump to `0.21.0`
- Test: whole suite

- [ ] **Step 1: Add a registry integration test** in `tests/venturesService.test.ts`: register a second mock storefront (`kdp`) through `VentureRegistry`; `storefronts()` has two entries and every page read works for both. This is the acceptance check that the layout holds more than one storefront.
- [ ] **Step 2: Run** `npm test && npm run typecheck && npm run lint`. Expected: all tests pass, typecheck clean, lint at the 25 pre-existing problems.
- [ ] **Step 3: Write the owner guide section** (step by step, teenager simple, no em dashes): where ELS Ventures is, what mock mode means, how to open the phone page (the link from Settings, Agent API), how to connect Etsy once approved, how to set the mailbox for messages.
- [ ] **Step 4: Update `CHANGELOG.md`** and bump the version.
- [ ] **Step 5: Build and relaunch:** check there are no uploads in progress and note the next post time first, then `npm run dist`, quit the app with `kill` (it ignores Cmd-Q), and `open "release/mac-arm64/Expect Less Output.app"`. Confirm the new migration applied (`sqlite3 -readonly` on `elo.sqlite`, `select max(version) from schema_migrations`).
- [ ] **Step 6: Commit and push** (standing permission).
