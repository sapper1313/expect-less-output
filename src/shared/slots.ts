import { DateTime } from 'luxon'
import { ZONE } from './time'

export interface SlotDef {
  dayType: 'weekday' | 'weekend'
  timeLocal: string // HH:MM, Eastern
  enabled: boolean
}

export interface NextSlotsInput {
  slots: SlotDef[]
  /** UTC ISO strings of times already used by this brand. */
  taken: string[]
  count: number
  from: string | Date
  /** ISO weekdays (1 Monday to 7 Sunday) a post may land on. Omit or leave empty for every day. */
  weekdays?: number[]
  zone?: string
}

const MAX_DAYS_AHEAD = 730

/**
 * Returns the next `count` open slot times as UTC ISO strings.
 * Slots are wall-clock times in Eastern. DST gaps move forward, DST overlaps use the first pass.
 */
export function getNextOpenSlots(input: NextSlotsInput): string[] {
  const zone = input.zone ?? ZONE
  const { slots, count } = input
  const fromMs = (input.from instanceof Date ? input.from : new Date(input.from)).getTime()
  const takenMs = new Set(input.taken.map((t) => minuteKey(new Date(t).getTime())))
  const active = slots.filter((s) => s.enabled && /^\d{1,2}:\d{2}$/.test(s.timeLocal))
  if (active.length === 0 || count <= 0) return []

  const result: string[] = []
  const seen = new Set<number>()
  let day = DateTime.fromMillis(fromMs, { zone }).startOf('day')

  for (let i = 0; i < MAX_DAYS_AHEAD && result.length < count; i++) {
    if (input.weekdays?.length && !input.weekdays.includes(day.weekday)) {
      day = day.plus({ days: 1 }).startOf('day')
      continue
    }
    const dayType = day.weekday >= 6 ? 'weekend' : 'weekday'
    const times = active
      .filter((s) => s.dayType === dayType)
      .map((s) => {
        const [h, m] = s.timeLocal.split(':').map(Number)
        return DateTime.fromObject(
          { year: day.year, month: day.month, day: day.day, hour: h, minute: m },
          { zone },
        ).toMillis()
      })
      .sort((a, b) => a - b)
    for (const ms of times) {
      const key = minuteKey(ms)
      if (ms <= fromMs || seen.has(key) || takenMs.has(key)) continue
      seen.add(key)
      result.push(new Date(ms).toISOString())
      if (result.length >= count) break
    }
    day = day.plus({ days: 1 }).startOf('day')
  }
  return result
}

function minuteKey(ms: number): number {
  return Math.floor(ms / 60000)
}
