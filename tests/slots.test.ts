import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { getNextOpenSlots, type SlotDef } from '@shared/slots'

const slots: SlotDef[] = [
  { dayType: 'weekday', timeLocal: '08:00', enabled: true },
  { dayType: 'weekday', timeLocal: '17:00', enabled: true },
  { dayType: 'weekend', timeLocal: '10:00', enabled: true },
  { dayType: 'weekend', timeLocal: '18:00', enabled: true },
]
const et = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).setZone('America/New_York')
const etLocal = (s: string) =>
  DateTime.fromISO(s, { zone: 'America/New_York' }).toUTC().toISO()!.replace('.000Z', '.000Z')

describe('getNextOpenSlots', () => {
  it('uses weekday slots on weekdays and weekend slots on weekends', () => {
    // Friday 2026-03-06 12:00 ET
    const from = etLocal('2026-03-06T12:00')
    const out = getNextOpenSlots({ slots, taken: [], count: 4, from })
    const labels = out.map((i) => et(i).toFormat('ccc HH:mm'))
    expect(labels).toEqual(['Fri 17:00', 'Sat 10:00', 'Sat 18:00', 'Sun 10:00'])
  })

  it('rolls from Sunday evening to Monday morning', () => {
    const from = etLocal('2026-03-08T19:00') // Sunday after DST change handled below
    const out = getNextOpenSlots({ slots, taken: [], count: 2, from })
    expect(out.map((i) => et(i).toFormat('ccc HH:mm'))).toEqual(['Mon 08:00', 'Mon 17:00'])
  })

  it('skips taken slots and rolls to the next day when a day is full', () => {
    const from = etLocal('2026-03-09T00:30') // Monday
    const taken = [etLocal('2026-03-09T08:00'), etLocal('2026-03-09T17:00')]
    const out = getNextOpenSlots({ slots, taken, count: 1, from })
    expect(et(out[0]).toFormat('ccc HH:mm')).toBe('Tue 08:00')
  })

  it('ignores disabled slots', () => {
    const only = slots.map((s) => (s.timeLocal === '08:00' ? { ...s, enabled: false } : s))
    const out = getNextOpenSlots({
      slots: only,
      taken: [],
      count: 2,
      from: etLocal('2026-03-09T00:30'),
    })
    expect(out.map((i) => et(i).toFormat('ccc HH:mm'))).toEqual(['Mon 17:00', 'Tue 17:00'])
  })

  it('returns nothing when every slot is disabled', () => {
    const none = slots.map((s) => ({ ...s, enabled: false }))
    expect(getNextOpenSlots({ slots: none, taken: [], count: 3, from: new Date() })).toEqual([])
  })

  it('never returns a time at or before the start time', () => {
    const from = etLocal('2026-03-09T08:00')
    const out = getNextOpenSlots({ slots, taken: [], count: 1, from })
    expect(et(out[0]).toFormat('HH:mm')).toBe('17:00')
  })

  it('keeps 08:00 Eastern across spring forward (EST to EDT)', () => {
    // DST starts Sunday 2026-03-08. Saturday 7th is EST, Monday 9th is EDT.
    const from = etLocal('2026-03-07T11:00')
    const out = getNextOpenSlots({ slots, taken: [], count: 4, from })
    const utc = out.map((i) => i.slice(11, 16))
    // Sat 18:00 EST = 23:00Z, Sun 10:00 EDT = 14:00Z, Sun 18:00 EDT = 22:00Z, Mon 08:00 EDT = 12:00Z
    expect(utc).toEqual(['23:00', '14:00', '22:00', '12:00'])
    out.forEach((i, idx) => {
      expect(et(i).toFormat('HH:mm')).toBe(['18:00', '10:00', '18:00', '08:00'][idx])
    })
  })

  it('keeps wall-clock times across fall back (EDT to EST)', () => {
    // DST ends Sunday 2026-11-01. Saturday 31st EDT, Monday 2nd EST.
    const from = etLocal('2026-10-31T11:00')
    const out = getNextOpenSlots({ slots, taken: [], count: 4, from })
    expect(out.map((i) => et(i).toFormat('ccc HH:mm'))).toEqual([
      'Sat 18:00',
      'Sun 10:00',
      'Sun 18:00',
      'Mon 08:00',
    ])
    // Sun 10:00 is EST (UTC-5) = 15:00Z, Sat 18:00 is EDT (UTC-4) = 22:00Z
    expect(out[0].slice(11, 16)).toBe('22:00')
    expect(out[1].slice(11, 16)).toBe('15:00')
  })

  it('moves a slot inside the spring-forward gap to a valid time and does not duplicate', () => {
    const gap: SlotDef[] = [
      { dayType: 'weekend', timeLocal: '02:30', enabled: true },
      { dayType: 'weekend', timeLocal: '03:30', enabled: true },
    ]
    const out = getNextOpenSlots({
      slots: gap,
      taken: [],
      count: 2,
      from: etLocal('2026-03-07T12:00'),
    })
    // Sat 02:30 (next day Sunday the 8th is the gap day). Expect no duplicate instants.
    expect(new Set(out).size).toBe(out.length)
    const sunday = out.map(et).filter((d) => d.day === 8)
    sunday.forEach((d) => expect(d.hour).toBeGreaterThanOrEqual(3))
  })
})
