import type { Brand, Slot } from './types'
import { etToUtc, formatTimeET, isoWeekday, type Week } from './week'

/** Expected slots for the week. Only active brands produce slots. */
export function buildSlots(brands: Brand[], week: Week, tz: string): Slot[] {
  const slots: Slot[] = []
  for (const b of brands) {
    if (b.state !== 'active') continue
    const blackout = new Set(b.blackoutDates)
    for (const date of week.days) {
      if (blackout.has(date)) continue
      const weekday = isoWeekday(date)
      const weekend = weekday >= 6
      if (b.postDays === null || b.postDays.includes(weekday)) {
        // ELO expects only the earliest `dailyCap` slot times each day (0 means every enabled time).
        const all = [...new Set(weekend ? b.episodeTimes.weekend : b.episodeTimes.weekday)].sort()
        const times = b.dailyCap > 0 ? all.slice(0, b.dailyCap) : all
        for (const time of times) {
          slots.push(make(b.id, 'episode', date, weekday, time, tz))
        }
      }
      if (b.clipTime && b.clipDays.includes(weekday)) {
        slots.push(make(b.id, 'clip', date, weekday, b.clipTime, tz))
      }
    }
  }
  return slots.sort(
    (a, b) =>
      a.instant.localeCompare(b.instant) || a.brandId - b.brandId || a.type.localeCompare(b.type),
  )
}

function make(
  brandId: number,
  type: Slot['type'],
  date: string,
  weekday: number,
  time: string,
  tz: string,
): Slot {
  return {
    brandId,
    type,
    instant: etToUtc(date, time, tz),
    date,
    weekday,
    timeET: formatTimeET(time),
  }
}
