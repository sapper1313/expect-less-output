import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import { VentureStore } from '../src/main/ventures/store'
import type { ListingDetail, ReviewRow } from '../src/shared/ventures'

const listing = (over: Partial<ListingDetail> = {}): ListingDetail => ({
  id: 'L1',
  title: 'Blue mug',
  thumbUrl: null,
  priceCents: 1500,
  currency: 'USD',
  views: 10,
  favorites: 2,
  quantity: 5,
  state: 'active',
  url: 'https://www.etsy.com/listing/L1',
  description: 'A mug',
  tags: ['mug', 'blue'],
  images: ['a.jpg'],
  priceHistory: [],
  sales: 0,
  ...over,
})
const review = (id: string): ReviewRow => ({
  id,
  listingId: 'L1',
  rating: 2,
  text: 'meh',
  at: '2026-06-01T00:00:00.000Z',
  buyerUsername: 'sam',
  low: true,
})

describe('VentureStore', () => {
  it('creates the tables', () => {
    const { db } = makeEnv()
    const t = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'venture_%'").all() as Array<{ name: string }>
    const names = t.map((r) => r.name)
    for (const n of ['venture_listings', 'venture_orders', 'venture_reviews', 'venture_notifications', 'venture_state', 'venture_messages', 'venture_ledger', 'venture_price_history'])
      expect(names).toContain(n)
  })
  it('records price history only when the price changes', () => {
    const s = new VentureStore(makeEnv().db)
    s.upsertListing('etsy', listing())
    s.upsertListing('etsy', listing({ views: 20 }))
    expect(s.getListing('etsy', 'L1')!.priceHistory).toHaveLength(1)
    s.upsertListing('etsy', listing({ priceCents: 1800 }))
    const h = s.getListing('etsy', 'L1')!.priceHistory
    expect(h.map((x) => x.cents)).toEqual([1500, 1800])
  })
  it('says whether a review is new', () => {
    const s = new VentureStore(makeEnv().db)
    expect(s.upsertReview('etsy', review('R1'))).toBe(true)
    expect(s.upsertReview('etsy', review('R1'))).toBe(false)
  })
  it('dedupes notifications and counts unread', () => {
    const s = new VentureStore(makeEnv().db)
    const n = { storefront: 'etsy', kind: 'order' as const, title: 't', detail: 'd', at: '2026-06-01T00:00:00.000Z', url: null }
    expect(s.addNotification(n, 'order:1')).toBe(true)
    expect(s.addNotification(n, 'order:1')).toBe(false)
    expect(s.unreadCount('etsy')).toBe(1)
    s.markRead(s.notifications('etsy').map((x) => x.id))
    expect(s.unreadCount('etsy')).toBe(0)
  })
  it('keeps storefronts apart', () => {
    const s = new VentureStore(makeEnv().db)
    s.upsertListing('kdp', listing({ id: 'K1' }))
    expect(s.listingRows('etsy')).toHaveLength(0)
    expect(s.listingRows('kdp')).toHaveLength(1)
  })
  it('stores orders with buyer username only and finds them by date', () => {
    const s = new VentureStore(makeEnv().db)
    s.upsertOrder('etsy', { receiptId: 'O1', placedAt: '2026-06-01T15:00:00.000Z', buyerUsername: 'sam', items: [{ listingId: 'L1', title: 'Blue mug', quantity: 2, priceCents: 1500 }], feesCents: 300, currency: 'USD' })
    const got = s.ordersBetween('etsy', '2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z')
    expect(got).toHaveLength(1)
    expect(got[0].items[0].quantity).toBe(2)
    expect(got[0].feesCents).toBe(300)
    expect(s.ordersBetween('etsy', '2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z')).toHaveLength(0)
  })
})
