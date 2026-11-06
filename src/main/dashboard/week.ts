import { DateTime } from 'luxon'

export interface Week {
  startDate: string
  endDate: string
  days: string[]
  startUtc: string
  endUtcExclusive: string
  today: string
}

function utcIso(dt: DateTime): string {
  const iso = dt.toUTC().toISO()
  if (!iso) throw new Error('invalid date')
  return iso
}

/** Sunday 00:00 through Saturday 23:59:59 in tz, stepping by calendar days (never by 24h). */
export function weekWindow(now: Date, tz: string): Week {
  const local = DateTime.fromJSDate(now, { zone: tz }).startOf('day')
  const start = local.minus({ days: local.weekday % 7 })
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }).toISODate() as string)
  return {
    startDate: days[0],
    endDate: days[6],
    days,
    startUtc: utcIso(start),
    endUtcExclusive: utcIso(start.plus({ days: 7 })),
    today: local.toISODate() as string,
  }
}

/** Converts an Eastern wall-clock date and 'HH:MM' to an ISO UTC instant at minute precision. */
export function etToUtc(date: string, time: string, tz: string): string {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: tz })
  if (!dt.isValid) throw new Error(`invalid date/time: ${date} ${time}`)
  return utcIso(dt)
}

/** 1 Monday to 7 Sunday, matching ELO. */
export function isoWeekday(date: string): number {
  return DateTime.fromISO(date, { zone: 'utc' }).weekday
}

export function formatTimeET(time: string): string {
  const [hh, mm] = time.split(':').map(Number)
  const suffix = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`
}
