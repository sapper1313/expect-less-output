import { DateTime } from 'luxon'

export interface HolidayDef {
  date: string
  name: string
  kind: 'holiday' | 'fun' | 'math' | 'tech'
}

const iso = (y: number, m: number, d: number) => DateTime.utc(y, m, d).toFormat('yyyy-MM-dd')

/** The nth (1-based) weekday of a month. weekday 1 = Monday ... 7 = Sunday. n = -1 means the last one. */
function nth(y: number, m: number, weekday: number, n: number): string {
  if (n > 0) {
    let d = DateTime.utc(y, m, 1)
    while (d.weekday !== weekday) d = d.plus({ days: 1 })
    return d.plus({ weeks: n - 1 }).toFormat('yyyy-MM-dd')
  }
  let d = DateTime.utc(y, m, 1).endOf('month').startOf('day')
  while (d.weekday !== weekday) d = d.minus({ days: 1 })
  return d.toFormat('yyyy-MM-dd')
}

/** Easter Sunday by the anonymous Gregorian computus. */
export function easter(y: number): string {
  const a = y % 19
  const b = Math.floor(y / 100)
  const c = y % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return iso(y, month, day)
}

/** US holidays plus fun, math and tech days for one year. */
export function holidaysForYear(y: number): HolidayDef[] {
  const h = (date: string, name: string, kind: HolidayDef['kind'] = 'holiday') => ({ date, name, kind })
  return [
    h(iso(y, 1, 1), "New Year's Day"),
    h(nth(y, 1, 1, 3), 'Martin Luther King Jr. Day'),
    h(iso(y, 1, 28), 'Data Privacy Day', 'tech'),
    h(iso(y, 2, 2), 'Groundhog Day', 'fun'),
    h(iso(y, 2, 9), 'National Pizza Day', 'fun'),
    h(iso(y, 2, 14), "Valentine's Day"),
    h(nth(y, 2, 1, 3), "Presidents' Day"),
    h(nth(y, 2, 2, 2), 'Safer Internet Day', 'tech'),
    h(iso(y, 3, 14), 'Pi Day', 'math'),
    h(iso(y, 3, 17), "St. Patrick's Day"),
    h(iso(y, 3, 31), 'World Backup Day', 'tech'),
    h(easter(y), 'Easter'),
    h(iso(y, 4, 1), "April Fools' Day", 'fun'),
    h(iso(y, 4, 22), 'Earth Day', 'fun'),
    h(iso(y, 5, 4), 'Star Wars Day', 'fun'),
    h(nth(y, 5, 4, 1), 'World Password Day', 'tech'),
    h(nth(y, 5, 7, 2), "Mother's Day"),
    h(nth(y, 5, 1, -1), 'Memorial Day'),
    h(nth(y, 6, 7, 3), "Father's Day"),
    h(iso(y, 6, 19), 'Juneteenth'),
    h(iso(y, 6, 28), 'Tau Day', 'math'),
    h(iso(y, 7, 4), 'Independence Day'),
    h(iso(y, 7, 22), 'Pi Approximation Day', 'math'),
    h(nth(y, 9, 1, 1), 'Labor Day'),
    h(iso(y, 9, 19), 'Talk Like a Pirate Day', 'fun'),
    h(iso(y, 10, 1), 'International Raccoon Appreciation Day', 'fun'),
    h(iso(y, 10, 4), 'National Taco Day', 'fun'),
    h(nth(y, 10, 2, 2), 'Ada Lovelace Day', 'tech'),
    h(iso(y, 10, 23), 'Mole Day', 'math'),
    h(iso(y, 10, 31), 'Halloween'),
    h(iso(y, 11, 11), 'Veterans Day'),
    h(nth(y, 11, 4, 4), 'Thanksgiving'),
    h(DateTime.fromISO(nth(y, 11, 4, 4)).plus({ days: 4 }).toFormat('yyyy-MM-dd'), 'Cyber Monday', 'tech'),
    h(iso(y, 12, 24), 'Christmas Eve'),
    h(iso(y, 12, 25), 'Christmas Day'),
    h(iso(y, 12, 31), "New Year's Eve"),
  ]
}
