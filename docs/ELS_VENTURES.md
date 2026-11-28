# ELS Ventures and Etsy: how it works

For the owner see section 29 of `USER_GUIDE.md`. This file is for bots and for whoever changes the code.

## Storefronts

Each storefront is a provider in `src/main/ventures/registry.ts` with the same read methods (`VentureProvider` in `src/shared/ventures.ts`). Etsy registers a `CacheProvider` in `src/main/index.ts`. The pages in `src/renderer/src/ventures/` only know the contract, so a second storefront needs one provider, one registration line, and (for a real shop) a syncer that fills the `venture_*` tables with its own `storefront` id.

## Data

- A syncer fills `venture_*` tables every 20 minutes. The pages read only those tables.
- Money is cents. Times are UTC. Buyers are stored as `buyer_<id>` only (Etsy gives no username on a receipt). No email, address or name is stored.
- Fees come from payment ledger entries whose description contains "fee". Fees tied to a receipt count on that order. Other fees (listing fees) count on the dashboard for the day they happened.

## Phone page

`/m/<secret>/ventures/` on the existing phone server. GET only, and only the reads listed in `src/main/ventures/phoneRoutes.ts`. Everything else is 404 or 405. The page is built from the same React screens as the Mac (`ventures.html`).

## B.E.T.H.: draft listings

Both routes need the beth token (or the owner token). Drafts only: there is no `state` field and a listing that is not a draft is refused with 403 `drafts_only`.

- `POST /v1/ventures/etsy/drafts` (MCP tool `create_etsy_draft`)
  - Body: `title` (up to 140 characters), `description`, `tags` (up to 13, each up to 20 characters), `priceCents` (at least 20), `images` (up to 10 file paths on this Mac or https links), optional `digitalFile` (a file path), optional `quantity`, optional `taxonomyId` (the Etsy category).
  - Answer: `{ "id": "...", "state": "draft", "pending": false }`. `pending: true` means no shop is connected yet and the draft is waiting in ELO (id starts with `pending-`).
- `PATCH /v1/ventures/etsy/drafts/{id}` (MCP tool `update_etsy_draft`): any of the same fields.

Send `taxonomyId` on a new draft. Without one, and without a default, the draft stays pending after the shop is connected and the reason is kept with it.

Every call, allowed or refused, is written to the audit log (`ventures.draft.create`, `ventures.draft.update`, `api.denied`) with who, what and when. File paths and file contents are never logged.

## Etsy facts the code relies on (checked against Etsy's published OpenAPI)

- `x-api-key` is `keystring:shared_secret`.
- OAuth 2.0 with PKCE (S256). Scopes `listings_r listings_w transactions_r shops_r profile_r`. The redirect address must be registered on the app: `http://127.0.0.1:38487/callback`.
- Access tokens last 1 hour. ELO refreshes five minutes early. Refresh tokens last 90 days, so ELO shows "sign in again" if it is idle longer than that.
- Listing objects have no view count in the published schema. If Etsy sends `views` ELO shows it, otherwise 0.
