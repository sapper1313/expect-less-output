import { describe, expect, it } from 'vitest'
import { buildSlots } from '../src/main/dashboard/slots'
import { weekWindow } from '../src/main/dashboard/week'

describe('week map slots follow Shorts and Long form', () => {
  it('Shorts Mon to Sat and Long form Sun give one slot a day, not two or three', () => {
    const week = weekWindow(new Date('2026-11-04T15:00:00Z'), 'America/New_York')
    const slots = buildSlots(
      [
        {
          id: 12,
          name: 'Usefully Useless Info',
          state: 'active',
          postDays: null,
          dailyCap: 0,
          episodeTimes: { weekday: ['20:00'], weekend: ['10:00', '19:00'] },
          kinds: [
            { kind: 'short', days: [1, 2, 3, 4, 5, 6], times: { weekday: ['20:00'], weekend: ['10:00'] } },
            { kind: 'long', days: [7], times: { weekday: [], weekend: ['19:00'] } },
          ],
          clipDays: [],
          clipTime: null,
          blackoutDates: [],
        },
      ],
      week,
      'America/New_York',
    )
    expect(slots).toHaveLength(7)
    const perDay = new Map<string, number>()
    for (const s of slots) perDay.set(s.date, (perDay.get(s.date) ?? 0) + 1)
    expect([...perDay.values()].every((n) => n === 1)).toBe(true)
  })
})
