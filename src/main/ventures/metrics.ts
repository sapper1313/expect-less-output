import { DateTime } from 'luxon'
import { ZONE } from '@shared/time'
import type { DashboardSummary, OrderItem, RangePreset, VentureRange } from '@shared/ventures'

const D = 'yyyy-LL-dd'

/** Turns a preset (or a custom pick) into Eastern calendar dates. */
export function resolveRange(preset: RangePreset, nowMs: number, custom?: VentureRange): VentureRange {
  const today = DateTime.fromMillis(nowMs, { zone: ZONE }).startOf('day')
  switch (preset) {
    case 'today':
      return { from: today.toFormat(D), to: today.toFormat(D) }
    case '7d':
      return { from: today.minus({ days: 6 }).toFormat(D), to: today.toFormat(D) }
    case '30d':
      return { from: today.minus({ days: 29 }).toFormat(D), to: today.toFormat(D) }
    case 'ytd':
      return { from: today.startOf('year').toFormat(D), to: today.toFormat(D) }
    case 'custom': {
      if (!custom) throw new Error('Pick a start and end date.')
      const a = DateTime.fromFormat(custom.from, D, { zone: ZONE })
      const b = DateTime.fromFormat(custom.to, D, { zone: ZONE })
      if (!a.isValid || !b.isValid) throw new Error('That date is not valid.')
      if (a > b) throw new Error('Start date is after end date.')
      return { from: custom.from, to: custom.to }
    }
  }
}

/** Eastern midnight at the start, the next Eastern midnight at the end. */
export function rangeToUtc(r: VentureRange): { fromUtc: string; toUtc: string } {
  const a = DateTime.fromFormat(r.from, D, { zone: ZONE }).startOf('day')
  const b = DateTime.fromFormat(r.to, D, { zone: ZONE }).startOf('day').plus({ days: 1 })
  return { fromUtc: a.toUTC().toISO()!, toUtc: b.toUTC().toISO()! }
}

export interface MetricOrder {
  placedAt: string
  items: OrderItem[]
  feesCents: number
  currency: string
}

export function summarize(orders: MetricOrder[], range: VentureRange): DashboardSummary {
  const currency = orders[0]?.currency ?? 'USD'
  const byDay = new Map<string, number>()
  for (
    let d = DateTime.fromFormat(range.from, D, { zone: ZONE });
    d <= DateTime.fromFormat(range.to, D, { zone: ZONE });
    d = d.plus({ days: 1 })
  )
    byDay.set(d.toFormat(D), 0)

  let revenue = 0
  let fees = 0
  let units = 0
  const products = new Map<string, { listingId: string; title: string; units: number; revenueCents: number }>()
  for (const o of orders) {
    fees += o.feesCents
    const day = DateTime.fromISO(o.placedAt, { zone: 'utc' }).setZone(ZONE).toFormat(D)
    for (const it of o.items) {
      const line = it.quantity * it.priceCents
      revenue += line
      units += it.quantity
      if (byDay.has(day)) byDay.set(day, byDay.get(day)! + line)
      const p = products.get(it.listingId) ?? { listingId: it.listingId, title: it.title, units: 0, revenueCents: 0 }
      p.units += it.quantity
      p.revenueCents += line
      products.set(it.listingId, p)
    }
  }
  const money = (cents: number) => ({ cents, currency })
  return {
    range,
    revenue: money(revenue),
    fees: money(fees),
    net: money(revenue - fees),
    orders: orders.length,
    units,
    averageOrder: money(orders.length === 0 ? 0 : Math.round(revenue / orders.length)),
    series: [...byDay.entries()].map(([date, revenueCents]) => ({ date, revenueCents })),
    topProducts: [...products.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 10),
  }
}
