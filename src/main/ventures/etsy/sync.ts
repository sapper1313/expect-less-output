import type { ListingDetail, ListingState, VentureNotification } from '@shared/ventures'
import type { VentureStore } from '../store'
import type { EtsyClient } from './client'

const SF = 'etsy'
const PAGE = 100
const STATES = ['active', 'inactive', 'sold_out', 'draft', 'expired'] as const

interface Money {
  amount: number
  divisor: number
  currency_code: string
}
const cents = (m?: Money) => (m && m.divisor ? Math.round((m.amount / m.divisor) * 100) : 0)
const iso = (sec: number) => new Date(sec * 1000).toISOString()
const mapState = (s: string): ListingState =>
  s === 'active' || s === 'draft' || s === 'expired' ? s : 'inactive'

export interface SyncDeps {
  client: EtsyClient
  store: VentureStore
  shopId: () => string | null
  notify: (n: Omit<VentureNotification, 'id' | 'read'>, key: string) => void
  now: () => number
}

/** Pulls listings, fees, orders and reviews into the cache. A failed page keeps earlier pages and resumes next run. */
export class EtsySyncer {
  constructor(private d: SyncDeps) {}

  /** Walks one list page by page, saving a cursor after each page so a crash resumes instead of restarting. */
  private async paged(
    phase: string,
    fetchPage: (offset: number) => Promise<unknown[]>,
    handle: (rows: any[]) => void,
  ): Promise<number> {
    let offset = Number(this.d.store.getState(SF, `cursor:${phase}`) ?? 0)
    let total = 0
    for (;;) {
      const rows = (await fetchPage(offset)) as any[]
      handle(rows)
      total += rows.length
      if (rows.length < PAGE) break
      offset += PAGE
      this.d.store.setState(SF, `cursor:${phase}`, String(offset))
    }
    this.d.store.setState(SF, `cursor:${phase}`, null)
    return total
  }

  private since(phase: string): Record<string, number> {
    const v = this.d.store.getState(SF, `since:${phase}`)
    return v ? { min_created: Number(v) } : {}
  }
  private doneSince(phase: string): void {
    this.d.store.setState(SF, `since:${phase}`, String(Math.floor(this.d.now() / 1000) - 86_400))
  }

  async run(): Promise<{ listings: number; orders: number; reviews: number }> {
    const shop = this.d.shopId()
    if (!shop) return { listings: 0, orders: 0, reviews: 0 }
    const { client, store } = this.d
    const base = `/v3/application/shops/${shop}`
    const quiet = store.getState(SF, 'first_sync_done') === null
    const note = (n: Omit<VentureNotification, 'id' | 'read'>, key: string) => {
      if (!quiet) this.d.notify(n, key)
    }

    let listings = 0
    for (const state of STATES) {
      listings += await this.paged(
        `listings:${state}`,
        async (offset) =>
          (
            await client.get<{ results: unknown[] }>(`${base}/listings`, {
              state,
              limit: PAGE,
              offset,
              includes: 'Images',
            })
          ).results,
        (rows) => {
          for (const r of rows) {
            const imgs = (r.images ?? []) as Array<{ url_170x135?: string; url_fullxfull?: string }>
            const l: ListingDetail = {
              id: String(r.listing_id),
              title: r.title ?? '',
              thumbUrl: imgs[0]?.url_170x135 ?? null,
              priceCents: cents(r.price),
              currency: r.price?.currency_code ?? 'USD',
              views: Number(r.views ?? 0),
              favorites: Number(r.num_favorers ?? 0),
              quantity: Number(r.quantity ?? 0),
              state: mapState(r.state),
              url: r.url ?? `https://www.etsy.com/listing/${r.listing_id}`,
              description: r.description ?? '',
              tags: r.tags ?? [],
              images: imgs.map((i) => i.url_fullxfull ?? '').filter(Boolean),
              priceHistory: [],
              sales: 0,
            }
            store.upsertListing(SF, l)
          }
        },
      )
    }

    // Fees first, so orders can pick theirs up. Etsy requires both ends of the date range here. A fee lookup that fails
    // never blocks orders and reviews: the orders just show no fees until the next run.
    const nowSec = Math.floor(this.d.now() / 1000)
    try {
      await this.paged(
        'ledger',
        async (offset) =>
          (
            await client.get<{ results: unknown[] }>(`${base}/payment-account/ledger-entries`, {
              min_created: Number(store.getState(SF, 'since:ledger') ?? nowSec - 365 * 86_400),
              max_created: nowSec,
              limit: PAGE,
              offset,
            })
          ).results,
        (rows) => {
          for (const e of rows) {
            const isFee = /fee/i.test(String(e.description ?? ''))
            const forReceipt = /receipt/i.test(String(e.reference_type ?? ''))
            store.addLedger(SF, {
              id: String(e.entry_id),
              receiptId: forReceipt && e.reference_id != null ? String(e.reference_id) : null,
              at: iso(Number(e.create_date)),
              cents: Number(e.amount),
              kind: isFee ? 'fee' : 'other',
            })
          }
        },
      )
      this.doneSince('ledger')
      store.setState(SF, 'ledger_error', null)
    } catch (e) {
      store.setState(SF, 'ledger_error', e instanceof Error ? e.message : 'unknown error')
    }

    const orders = await this.paged(
      'receipts',
      async (offset) =>
        (
          await client.get<{ results: unknown[] }>(`${base}/receipts`, {
            ...this.since('receipts'),
            limit: PAGE,
            offset,
          })
        ).results,
      (rows) => {
        for (const r of rows) {
          const id = String(r.receipt_id)
          const placedAt = iso(Number(r.create_timestamp ?? r.created_timestamp))
          const items = ((r.transactions ?? []) as any[]).map((t) => ({
            listingId: String(t.listing_id),
            title: t.title ?? '',
            quantity: Number(t.quantity ?? 1),
            priceCents: cents(t.price),
          }))
          const buyerUsername = `buyer_${r.buyer_user_id ?? 'unknown'}`
          const isNew = !store.hasOrder(SF, id)
          store.upsertOrder(SF, {
            receiptId: id,
            placedAt,
            buyerUsername,
            items,
            feesCents: store.feesForReceipt(SF, id),
            currency:
              r.grandtotal?.currency_code ?? r.transactions?.[0]?.price?.currency_code ?? 'USD',
          })
          if (isNew)
            note(
              {
                storefront: SF,
                kind: 'order',
                title: `New order from ${buyerUsername}`,
                detail: items.map((i) => `${i.title} x${i.quantity}`).join(', '),
                at: placedAt,
                url: `https://www.etsy.com/your/orders/sold/${id}`,
              },
              `order:${id}`,
            )
        }
      },
    )
    this.doneSince('receipts')

    const reviews = await this.paged(
      'reviews',
      async (offset) =>
        (await client.get<{ results: unknown[] }>(`${base}/reviews`, { limit: PAGE, offset }))
          .results,
      (rows) => {
        for (const r of rows) {
          const at = iso(Number(r.create_timestamp ?? r.created_timestamp))
          const rating = Number(r.rating)
          const id = `${r.listing_id}:${r.create_timestamp ?? r.created_timestamp}`
          const isNew = store.upsertReview(SF, {
            id,
            listingId: r.listing_id != null ? String(r.listing_id) : null,
            rating,
            text: r.review ?? '',
            at,
            buyerUsername: 'Etsy buyer',
            low: rating <= 3,
          })
          if (isNew)
            note(
              {
                storefront: SF,
                kind: rating <= 3 ? 'low_review' : 'review',
                title: `New ${rating} star review`,
                detail: r.review ?? '',
                at,
                url: 'https://www.etsy.com/your/shops/me/reviews',
              },
              `${rating <= 3 ? 'low_review' : 'review'}:${id}`,
            )
        }
      },
    )

    store.setState(SF, 'first_sync_done', '1')
    store.setState(SF, 'last_sync_at', new Date(this.d.now()).toISOString())
    return { listings, orders, reviews }
  }
}
