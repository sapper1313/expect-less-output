import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { rangeToUtc, resolveRange, summarize } from '../src/main/ventures/metrics'

// 2026-06-10 15:00 Eastern
const NOW = DateTime.fromISO('2026-06-10T15:00:00', { zone: 'America/New_York' }).toMillis()

describe('resolveRange', () => {
  it('builds the presets in Eastern dates', () => {
    expect(resolveRange('today', NOW)).toEqual({ from: '2026-06-10', to: '2026-06-10' })
    expect(resolveRange('7d', NOW)).toEqual({ from: '2026-06-04', to: '2026-06-10' })
    expect(resolveRange('30d', NOW)).toEqual({ from: '2026-05-12', to: '2026-06-10' })
    expect(resolveRange('ytd', NOW)).toEqual({ from: '2026-01-01', to: '2026-06-10' })
  })
  it('uses a custom range as given and rejects a reversed one', () => {
    expect(resolveRange('custom', NOW, { from: '2026-05-01', to: '2026-05-31' })).toEqual({ from: '2026-05-01', to: '2026-05-31' })
    expect(() => resolveRange('custom', NOW, { from: '2026-06-02', to: '2026-06-01' })).toThrow('Start date is after end date.')
  })
})

describe('rangeToUtc', () => {
  const hours = (d: string) => {
    const r = rangeToUtc({ from: d, to: d })
    return (Date.parse(r.toUtc) - Date.parse(r.fromUtc)) / 3_600_000
  }
  it('handles daylight saving days', () => {
    expect(hours('2026-03-08')).toBe(23)
    expect(hours('2026-11-01')).toBe(25)
    expect(hours('2026-06-10')).toBe(24)
  })
})

describe('summarize', () => {
  const range = { from: '2026-06-09', to: '2026-06-10' }
  it('returns zeros and a full zero series for no orders', () => {
    const s = summarize([], range)
    expect(s.revenue.cents).toBe(0)
    expect(s.averageOrder.cents).toBe(0)
    expect(s.orders).toBe(0)
    expect(s.series.map((p) => p.date)).toEqual(['2026-06-09', '2026-06-10'])
    expect(s.series.every((p) => p.revenueCents === 0)).toBe(true)
  })
  it('adds up revenue, fees, net, units, average and top products', () => {
    const s = summarize(
      [
        { placedAt: '2026-06-09T16:00:00.000Z', feesCents: 200, currency: 'USD', items: [{ listingId: 'A', title: 'Mug', quantity: 2, priceCents: 1500 }] },
        { placedAt: '2026-06-10T16:00:00.000Z', feesCents: 100, currency: 'USD', items: [{ listingId: 'B', title: 'Print', quantity: 1, priceCents: 1000 }, { listingId: 'A', title: 'Mug', quantity: 1, priceCents: 1500 }] },
      ],
      range,
    )
    expect(s.revenue.cents).toBe(5500)
    expect(s.fees.cents).toBe(300)
    expect(s.net.cents).toBe(5200)
    expect(s.orders).toBe(2)
    expect(s.units).toBe(4)
    expect(s.averageOrder.cents).toBe(2750)
    expect(s.topProducts[0]).toEqual({ listingId: 'A', title: 'Mug', units: 3, revenueCents: 4500 })
    expect(s.series.map((p) => p.revenueCents)).toEqual([3000, 2500])
  })
})
