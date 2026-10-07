import { DateTime } from 'luxon'

const ZONE = 'America/New_York'

export interface TimedVideo {
  /** When it went live (ISO, UTC). */
  at: string
  views: number
  /** Videos are only compared with others from the same group (brand and platform). */
  group: string
}

export interface HourStat {
  hour: number
  count: number
  mean: number
  median: number
}
export interface CellStat extends HourStat {
  /** 1 = Monday ... 7 = Sunday, Eastern time. */
  weekday: number
}
export interface BestTimes {
  minAgeDays: number
  /** Videos that had numbers. */
  videos: number
  /** Videos old enough to compare fairly. */
  used: number
  /** True when values are "times your typical video" instead of raw views. */
  relative: boolean
  enough: boolean
  hours: HourStat[]
  cells: CellStat[]
  top: HourStat[]
}

export const MIN_VIDEOS = 10
const MIN_PER_SLOT = 2

export const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

interface Scored {
  weekday: number
  hour: number
  value: number
}

/** Turns videos into comparable values and places each one on the Eastern clock. */
export function score(
  videos: TimedVideo[],
  opts: { nowMs: number; minAgeDays: number; relative: boolean },
): Scored[] {
  const old = videos.filter(
    (v) => opts.nowMs - new Date(v.at).getTime() >= opts.minAgeDays * 86_400_000,
  )
  const medians = new Map<string, number>()
  if (opts.relative) {
    const groups = new Map<string, number[]>()
    for (const v of old) groups.set(v.group, [...(groups.get(v.group) ?? []), v.views])
    for (const [g, xs] of groups) medians.set(g, median(xs))
  }
  return old.map((v) => {
    const t = DateTime.fromISO(v.at, { zone: 'utc' }).setZone(ZONE)
    const base = medians.get(v.group) ?? 0
    return {
      weekday: t.weekday,
      hour: t.hour,
      value: opts.relative ? (base > 0 ? v.views / base : 1) : v.views,
    }
  })
}

const stat = (hour: number, xs: number[]): HourStat => ({
  hour,
  count: xs.length,
  mean: mean(xs),
  median: median(xs),
})

/** The best hours, spaced at least two hours apart so the list is not one busy afternoon. */
export function pickTop(hours: HourStat[], n = 3): HourStat[] {
  const ranked = hours
    .filter((h) => h.count >= MIN_PER_SLOT)
    .sort((a, b) => b.median - a.median || b.mean - a.mean || b.count - a.count)
  const out: HourStat[] = []
  for (const h of ranked) {
    if (out.every((o) => Math.abs(o.hour - h.hour) >= 2)) out.push(h)
    if (out.length === n) break
  }
  return out
}

export function analyze(
  videos: TimedVideo[],
  opts: { nowMs: number; minAgeDays: number; relative: boolean },
): BestTimes {
  const scored = score(videos, opts)
  const hours = Array.from({ length: 24 }, (_, h) =>
    stat(
      h,
      scored.filter((s) => s.hour === h).map((s) => s.value),
    ),
  )
  const cells: CellStat[] = []
  for (let d = 1; d <= 7; d++)
    for (let h = 0; h < 24; h++) {
      const xs = scored.filter((s) => s.weekday === d && s.hour === h).map((s) => s.value)
      if (xs.length) cells.push({ weekday: d, ...stat(h, xs) })
    }
  return {
    minAgeDays: opts.minAgeDays,
    videos: videos.length,
    used: scored.length,
    relative: opts.relative,
    enough: scored.length >= MIN_VIDEOS,
    hours,
    cells,
    top: pickTop(hours),
  }
}

export interface SlotSuggestion {
  timeLocal: string
  count: number
  /** Typical views at this hour compared with the brand's typical video, 1.4 = 40% more. */
  lift: number
}
export interface RecommendedSlots {
  videos: number
  enough: boolean
  weekday: SlotSuggestion[]
  weekend: SlotSuggestion[]
}

/** Suggested posting times for one brand, from all its platforms, split into weekdays and weekends. */
export function recommendSlots(
  videos: TimedVideo[],
  opts: { nowMs: number; minAgeDays: number },
): RecommendedSlots {
  const scored = score(videos, { ...opts, relative: true })
  const part = (days: number[]): SlotSuggestion[] => {
    const mine = scored.filter((s) => days.includes(s.weekday))
    if (mine.length < MIN_VIDEOS / 2) return []
    const hours = Array.from({ length: 24 }, (_, h) =>
      stat(
        h,
        mine.filter((s) => s.hour === h).map((s) => s.value),
      ),
    )
    return pickTop(hours).map((h) => ({
      timeLocal: `${String(h.hour).padStart(2, '0')}:00`,
      count: h.count,
      lift: h.median,
    }))
  }
  return {
    videos: scored.length,
    enough: scored.length >= MIN_VIDEOS,
    weekday: part([1, 2, 3, 4, 5]),
    weekend: part([6, 7]),
  }
}
