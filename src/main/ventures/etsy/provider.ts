import type {
  ConnectionStatus,
  DashboardSummary,
  ListingDetail,
  ListingQuery,
  ListingRow,
  OrderRow,
  ReviewRow,
  VentureNotification,
  VentureProvider,
  VentureRange,
} from '@shared/ventures'
import type { VentureStore } from '../store'
import { rangeToUtc, summarize } from '../metrics'

export interface CacheProviderOpts {
  id: string
  label: string
  store: VentureStore
  now: () => number
  status: () => ConnectionStatus
}

/** Reads one storefront from the local cache. The pages never call Etsy (or any storefront) directly. */
export class CacheProvider implements VentureProvider {
  readonly id: string
  readonly label: string
  constructor(private o: CacheProviderOpts) {
    this.id = o.id
    this.label = o.label
  }

  status(): ConnectionStatus {
    return this.o.status()
  }

  dashboard(r: VentureRange): DashboardSummary {
    const { fromUtc, toUtc } = rangeToUtc(r)
    const s = summarize(this.o.store.ordersBetween(this.id, fromUtc, toUtc), r)
    // Fees that belong to no order (listing fees) still come out of what the shop keeps.
    const extra = this.o.store.unattributedFees(this.id, fromUtc, toUtc)
    if (extra) {
      s.fees = { ...s.fees, cents: s.fees.cents + extra }
      s.net = { ...s.net, cents: s.net.cents - extra }
    }
    return s
  }

  listings(q: ListingQuery): ListingRow[] {
    let rows = this.o.store.listingRows(this.id)
    const s = q.search?.trim().toLowerCase()
    if (s) rows = rows.filter((l) => l.title.toLowerCase().includes(s))
    const key = q.sort ?? 'title'
    const dir = q.dir === 'desc' ? -1 : 1
    const val = (l: ListingRow): string | number =>
      key === 'title' ? l.title.toLowerCase() : key === 'price' ? l.priceCents : l[key]
    return rows.sort((a, b) => {
      const x = val(a)
      const y = val(b)
      return (x < y ? -1 : x > y ? 1 : 0) * dir
    })
  }

  listing(id: string): ListingDetail | null {
    return this.o.store.getListing(this.id, id)
  }

  orders(r: VentureRange): OrderRow[] {
    const { fromUtc, toUtc } = rangeToUtc(r)
    return this.o.store.ordersBetween(this.id, fromUtc, toUtc).map(({ receiptId, placedAt, buyerUsername, items }) => ({
      receiptId,
      placedAt,
      buyerUsername,
      items,
    }))
  }

  reviews(limit: number): ReviewRow[] {
    return this.o.store.reviewsLatest(this.id, limit)
  }

  notifications(): VentureNotification[] {
    return this.o.store.notifications(this.id)
  }

  unread(): number {
    return this.o.store.unreadCount(this.id)
  }
}
