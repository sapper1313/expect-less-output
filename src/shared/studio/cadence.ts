import { DateTime } from 'luxon'
import type { StudioBrandConfig } from './types'

const ZONE = 'America/New_York'

const d = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).startOf('day')
const fmt = (t: DateTime) => t.toFormat('yyyy-MM-dd')

export function todayEastern(nowMs: number = Date.now()): string {
  return DateTime.fromMillis(nowMs, { zone: ZONE }).toFormat('yyyy-MM-dd')
}

export function monthEastern(nowMs: number = Date.now()): string {
  return DateTime.fromMillis(nowMs, { zone: ZONE }).toFormat('yyyy-MM')
}

/** Mode A. First due date on or after `today`, counting in steps of N days from `startDate`. */
export function nextDueEveryN(startDate: string, n: number, today: string): string {
  const step = Math.max(1, Math.floor(n))
  const start = d(startDate)
  const now = d(today)
  if (start >= now) return fmt(start)
  const days = Math.round(now.diff(start, 'days').days)
  const k = Math.ceil(days / step)
  return fmt(start.plus({ days: k * step }))
}

/**
 * Changing N applies from the next due date forward only. The next due date becomes the new anchor,
 * so dates already in the past or already planned never move.
 */
export function changeEveryN(
  cfg: StudioBrandConfig,
  newN: number,
  today: string,
): StudioBrandConfig {
  if (!Number.isInteger(newN) || newN < 1)
    throw new Error('Every N days needs a whole number of 1 or more.')
  const anchor = nextDueEveryN(cfg.startDate, cfg.everyN, today)
  return { ...cfg, everyN: newN, startDate: anchor }
}

/** Every posting date from `from` to `to`, inclusive, as yyyy-MM-dd Eastern. */
export function dueDates(cfg: StudioBrandConfig, from: string, to: string): string[] {
  const out: string[] = []
  const end = d(to)
  if (cfg.cadenceMode === 'every_n') {
    let cur = d(nextDueEveryN(cfg.startDate, cfg.everyN, from))
    while (cur <= end) {
      out.push(fmt(cur))
      cur = cur.plus({ days: Math.max(1, cfg.everyN) })
    }
    return out
  }
  for (let cur = d(from); cur <= end; cur = cur.plus({ days: 1 })) {
    if (cfg.postDays.includes(cur.weekday)) out.push(fmt(cur))
  }
  return out
}

export function nextDue(cfg: StudioBrandConfig, today: string): string | null {
  if (cfg.cadenceMode === 'every_n') return nextDueEveryN(cfg.startDate, cfg.everyN, today)
  const list = dueDates(cfg, today, fmt(d(today).plus({ days: 14 })))
  return list[0] ?? null
}

/** Mode B. The dates, before the post date, on which production may run for that post. */
export function productionDays(cfg: StudioBrandConfig, postDate: string): string[] {
  if (cfg.cadenceMode !== 'weekly') return []
  const post = d(postDate)
  const win = cfg.windows.find((w) => w.forPostDay === post.weekday)
  if (!win) return []
  const dates = win.days.map((wd) => {
    let cur = post.minus({ days: 1 })
    while (cur.weekday !== wd) cur = cur.minus({ days: 1 })
    return fmt(cur)
  })
  return dates.sort()
}

/** The first day the Director may produce for a post date. Before this day the package must already be READY. */
export function windowOpensOn(cfg: StudioBrandConfig, postDate: string): string | null {
  return productionDays(cfg, postDate)[0] ?? null
}

export function postsPerMonth(cfg: StudioBrandConfig): number {
  if (cfg.cadenceMode === 'every_n') return 30.4375 / Math.max(1, cfg.everyN)
  return (cfg.postDays.length * 52) / 12
}

export function projectMonthlyCost(cfg: StudioBrandConfig, dollarsPerEpisode: number): number {
  return Math.round(postsPerMonth(cfg) * dollarsPerEpisode * 100) / 100
}

/** The Eastern time of a posting slot as a UTC ISO string. */
export function slotToUtc(dateIso: string, timeLocal: string): string {
  const [h, m] = timeLocal.split(':').map(Number)
  return DateTime.fromISO(dateIso, { zone: ZONE })
    .set({ hour: h, minute: m || 0, second: 0, millisecond: 0 })
    .toUTC()
    .toISO() as string
}

/** The Eastern date of a UTC instant. */
export function easternDate(utcIso: string): string {
  return DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(ZONE).toFormat('yyyy-MM-dd')
}

export function addDays(dateIso: string, n: number): string {
  return fmt(d(dateIso).plus({ days: n }))
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}
