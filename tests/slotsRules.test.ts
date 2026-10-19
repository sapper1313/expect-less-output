import { describe, expect, it } from 'vitest'
import { getNextOpenSlots, type SlotDef } from '../src/shared/slots'

const slots: SlotDef[] = [
  { dayType: 'weekday', timeLocal: '09:00', enabled: true },
  { dayType: 'weekday', timeLocal: '17:00', enabled: true },
  { dayType: 'weekend', timeLocal: '10:00', enabled: true },
]
const from = '2026-10-19T12:00:00Z' // Monday 8 AM Eastern
const et = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
  })

describe('slot rules (test 14)', () => {
  it('one post a day uses only the first open slot of each day', () => {
    const r = getNextOpenSlots({ slots, taken: [], count: 3, from, maxPerDay: 1 })
    expect(r.map(et)).toEqual(['Mon, 10/19, 9 AM', 'Tue, 10/20, 9 AM', 'Wed, 10/21, 9 AM'])
  })
  it('counts posts that already went out toward the cap', () => {
    const r = getNextOpenSlots({
      slots,
      taken: [],
      alsoCounted: ['2026-10-19T13:00:00Z'],
      count: 1,
      from,
      maxPerDay: 1,
    })
    expect(et(r[0])).toBe('Tue, 10/20, 9 AM')
  })
  it('skips blackout dates', () => {
    const r = getNextOpenSlots({
      slots,
      taken: [],
      count: 2,
      from,
      maxPerDay: 1,
      blackoutDates: ['2026-10-19', '2026-10-20'],
    })
    expect(r.map(et)).toEqual(['Wed, 10/21, 9 AM', 'Thu, 10/22, 9 AM'])
  })
  it('keeps the minimum gap to posts from every channel', () => {
    const r = getNextOpenSlots({
      slots,
      taken: [],
      gapWith: ['2026-10-19T13:00:00Z'],
      minGapMinutes: 60,
      count: 1,
      from,
    })
    expect(et(r[0])).toBe('Mon, 10/19, 5 PM')
  })
  it('no cap means every slot', () => {
    const r = getNextOpenSlots({ slots, taken: [], count: 3, from })
    expect(r.map(et)).toEqual(['Mon, 10/19, 9 AM', 'Mon, 10/19, 5 PM', 'Tue, 10/20, 9 AM'])
  })
})

describe('episode ids: season and episode', () => {
  it('start at 0101, count up inside a season, then start the next season', async () => {
    const { nextEpisodeId } = await import('../src/shared/upcoming')
    expect(nextEpisodeId('clock-out-early', 2026, [])).toBe('clock-out-early-2026-0101')
    expect(nextEpisodeId('clock-out-early', 2026, ['clock-out-early-2026-0007'])).toBe(
      'clock-out-early-2026-0101',
    )
    expect(
      nextEpisodeId('clock-out-early', 2026, [
        'clock-out-early-2026-0101',
        'clock-out-early-2026-0104',
      ]),
    ).toBe('clock-out-early-2026-0105')
    expect(nextEpisodeId('clock-out-early', 2026, ['clock-out-early-2026-0199'])).toBe(
      'clock-out-early-2026-0201',
    )
    expect(nextEpisodeId('clock-out-early', 2026, ['clock-out-early-2026-0207'])).toBe(
      'clock-out-early-2026-0208',
    )
  })
})
