import { DateTime } from 'luxon'
import { ZONE } from './time'

/** Shorts are vertical videos of 3 minutes or less. Everything else is Long form. */
export type SlotKind = 'short' | 'long'
export function slotKindFor(meta?: { width?: number; height?: number; durationSeconds?: number } | null): SlotKind | undefined {
  if (!meta || !meta.width || !meta.height) return undefined
  const vertical = meta.height > meta.width
  const short = meta.durationSeconds === undefined || meta.durationSeconds <= 180
  return vertical && short ? 'short' : 'long'
}

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
  /** Dates (YYYY-MM-DD in the zone) nothing is placed on. */
  blackoutDates?: string[]
  /** Most posts on one day for this brand. 0 or missing means no limit. */
  maxPerDay?: number
  /** Smallest gap in minutes to any post in `gapWith` (all channels) or `taken`. 0 or missing means none. */
  minGapMinutes?: number
  /** Times used by other channels, only looked at for the minimum gap. */
  gapWith?: string[]
  /** Times that count toward the daily limit but do not reserve a slot (posts already sent). */
  alsoCounted?: string[]
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
  const blackout = new Set(input.blackoutDates ?? [])
  const cap = input.maxPerDay && input.maxPerDay > 0 ? input.maxPerDay : 0
  const gapMs = (input.minGapMinutes ?? 0) * 60_000
  const perDay = new Map<string, number>()
  const dayKeyOf = (ms: number) => DateTime.fromMillis(ms, { zone }).toFormat('yyyy-MM-dd')
  for (const t of [...input.taken, ...(input.alsoCounted ?? [])]) {
    const k = dayKeyOf(new Date(t).getTime())
    perDay.set(k, (perDay.get(k) ?? 0) + 1)
  }
  const gapTimes = gapMs
    ? [...input.taken, ...(input.gapWith ?? [])].map((t) => new Date(t).getTime())
    : []
  let day = DateTime.fromMillis(fromMs, { zone }).startOf('day')

  for (let i = 0; i < MAX_DAYS_AHEAD && result.length < count; i++) {
    if (input.weekdays?.length && !input.weekdays.includes(day.weekday)) {
      day = day.plus({ days: 1 }).startOf('day')
      continue
    }
    if (blackout.has(day.toFormat('yyyy-MM-dd'))) {
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
      const dk = day.toFormat('yyyy-MM-dd')
      if (cap && (perDay.get(dk) ?? 0) >= cap) continue
      if (gapMs && gapTimes.some((g) => Math.abs(g - ms) < gapMs)) continue
      seen.add(key)
      perDay.set(dk, (perDay.get(dk) ?? 0) + 1)
      if (gapMs) gapTimes.push(ms)
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

export interface SlotTimesInput {
  slots: SlotDef[]
  /** UTC ISO strings. The window is from (inclusive) to to (exclusive). */
  from: string | Date
  to: string | Date
  weekdays?: number[]
  blackoutDates?: string[]
  /** Only the earliest N slots of a day count, because that is all the channel may post. 0 or missing means all. */
  maxPerDay?: number
  zone?: string
}

/**
 * Every posting slot of a channel inside a window, as UTC times, whether or not a post sits in it. It follows the same
 * rules as getNextOpenSlots (the days a channel posts, the slot times, blackout dates, the daily limit) so the Calendar
 * and the scheduler can never disagree about where the slots are.
 */
export function getSlotTimes(input: SlotTimesInput): string[] {
  const zone = input.zone ?? ZONE
  const fromMs = (input.from instanceof Date ? input.from : new Date(input.from)).getTime()
  const toMs = (input.to instanceof Date ? input.to : new Date(input.to)).getTime()
  const active = input.slots.filter((s) => s.enabled && /^\d{1,2}:\d{2}$/.test(s.timeLocal))
  if (!active.length || toMs <= fromMs) return []
  const blackout = new Set(input.blackoutDates ?? [])
  const cap = input.maxPerDay && input.maxPerDay > 0 ? input.maxPerDay : 0
  const out: string[] = []
  let day = DateTime.fromMillis(fromMs, { zone }).startOf('day')
  for (let i = 0; i < 400 && day.toMillis() < toMs; i++) {
    const next = day.plus({ days: 1 }).startOf('day')
    const skip =
      (input.weekdays?.length && !input.weekdays.includes(day.weekday)) ||
      blackout.has(day.toFormat('yyyy-MM-dd'))
    if (!skip) {
      const dayType = day.weekday >= 6 ? 'weekend' : 'weekday'
      let times = active
        .filter((s) => s.dayType === dayType)
        .map((s) => {
          const [h, m] = s.timeLocal.split(':').map(Number)
          return DateTime.fromObject(
            { year: day.year, month: day.month, day: day.day, hour: h, minute: m },
            { zone },
          ).toMillis()
        })
        .sort((a, b) => a - b)
      times = [...new Set(times)]
      if (cap) times = times.slice(0, cap)
      for (const ms of times) if (ms >= fromMs && ms < toMs) out.push(new Date(ms).toISOString())
    }
    day = next
  }
  return out
}

/**
 * A channel slot counts as filled when a post sits within this many minutes of it. Since each platform has its own times,
 * a post's own time is its earliest platform time, which can be a little off the channel's slot (Bluesky 6:00 PM against
 * a 6:30 PM slot). Matching only the exact minute left those slots looking empty.
 */
export const SLOT_MATCH_TOLERANCE_MIN = 90

/**
 * Pairs slots with the nearest unused post time inside the tolerance, one post per slot.
 * Returns, for each slot index, the index of the time that fills it (or -1).
 */
export function pairNearest(slotIsos: string[], timeIsos: string[], toleranceMin = SLOT_MATCH_TOLERANCE_MIN): number[] {
  const tol = toleranceMin * 60_000
  const s = slotIsos.map((x) => new Date(x).getTime())
  const t = timeIsos.map((x) => new Date(x).getTime())
  const pairs: Array<{ si: number; ti: number; d: number }> = []
  for (let si = 0; si < s.length; si++)
    for (let ti = 0; ti < t.length; ti++) {
      const d = Math.abs(s[si] - t[ti])
      if (d <= tol) pairs.push({ si, ti, d })
    }
  pairs.sort((a, b) => a.d - b.d || a.si - b.si)
  const out = slotIsos.map(() => -1)
  const used = new Set<number>()
  for (const p of pairs) {
    if (out[p.si] !== -1 || used.has(p.ti)) continue
    out[p.si] = p.ti
    used.add(p.ti)
  }
  return out
}
