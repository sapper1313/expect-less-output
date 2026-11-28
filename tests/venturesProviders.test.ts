import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import { VentureStore } from '../src/main/ventures/store'
import { seedMockData } from '../src/main/ventures/mock'
import { CacheProvider } from '../src/main/ventures/etsy/provider'
import { resolveRange } from '../src/main/ventures/metrics'

const NOW = Date.UTC(2026, 5, 10, 16, 0, 0)
const make = (seed: boolean) => {
  const store = new VentureStore(makeEnv().db)
  if (seed) seedMockData(store, 'etsy', NOW)
  const p = new CacheProvider({
    id: 'etsy',
    label: 'Etsy',
    store,
    now: () => NOW,
    status: () => ({ mode: 'mock', shopName: null, lastSyncAt: null, expiresAt: null }),
  })
  return { store, p }
}

describe('CacheProvider with mock data', () => {
  it('builds a dashboard with fees and a smaller net', () => {
    const { p } = make(true)
    const d = p.dashboard(resolveRange('30d', NOW))
    expect(d.revenue.cents).toBeGreaterThan(0)
    expect(d.net.cents).toBeLessThan(d.revenue.cents)
    expect(d.topProducts.length).toBeGreaterThan(0)
  })
  it('covers all four listing states', () => {
    const { p } = make(true)
    const states = new Set(p.listings({}).map((l) => l.state))
    expect([...states].sort()).toEqual(['active', 'draft', 'expired', 'inactive'])
  })
  it('searches and sorts listings', () => {
    const { p } = make(true)
    const hits = p.listings({ search: 'MUG' })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((l) => l.title.toLowerCase().includes('mug'))).toBe(true)
    const prices = p.listings({ sort: 'price', dir: 'desc' }).map((l) => l.priceCents)
    expect(prices).toEqual([...prices].sort((a, b) => b - a))
  })
  it('flags only 1 to 3 star reviews', () => {
    const { p } = make(true)
    const r = p.reviews(20)
    expect(r.some((x) => x.low)).toBe(true)
    expect(r.every((x) => x.low === x.rating <= 3)).toBe(true)
  })
  it('shows price history on a listing', () => {
    const { p } = make(true)
    const withHistory = p.listings({}).map((l) => p.listing(l.id)!).filter((d) => d.priceHistory.length > 1)
    expect(withHistory.length).toBeGreaterThanOrEqual(3)
  })
  it('has notifications and an unread count', () => {
    const { p } = make(true)
    expect(p.notifications().length).toBe(5)
    expect(p.unread()).toBe(5)
  })
})

describe('CacheProvider with no data', () => {
  it('returns an all zero dashboard', () => {
    const { p } = make(false)
    const d = p.dashboard(resolveRange('7d', NOW))
    expect(d.revenue.cents).toBe(0)
    expect(d.averageOrder.cents).toBe(0)
    expect(d.series).toHaveLength(7)
    expect(p.listing('nope')).toBeNull()
  })
})
