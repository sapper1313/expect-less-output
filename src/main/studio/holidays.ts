import { DateTime } from 'luxon'
import type { Db } from '../db'
import { holidaysForYear } from '@shared/studio/holidays'
import { addDays, todayEastern } from '@shared/studio/cadence'

export interface HolidayRow {
  id: number
  date: string
  name: string
  kind: string
  enabled: boolean
  custom: boolean
}

/** US holidays plus fun, math and tech days. Seeded 18 months ahead and topped up. Fully editable. */
export class Holidays {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  /** Makes sure the next 18 months exist. Never touches rows the owner added, changed or switched off. */
  ensureSeeded(): void {
    const today = DateTime.fromISO(todayEastern(this.now()))
    const end = today.plus({ months: 18 })
    const ins = this.db.prepare(
      'INSERT OR IGNORE INTO holidays (date, name, kind) VALUES (?, ?, ?)',
    )
    for (let y = today.year; y <= end.year; y++)
      for (const h of holidaysForYear(y))
        if (h.date >= today.toFormat('yyyy-MM-dd') && h.date <= end.toFormat('yyyy-MM-dd'))
          ins.run(h.date, h.name, h.kind)
  }

  list(fromIso?: string, toIso?: string): HolidayRow[] {
    this.ensureSeeded()
    return (
      this.db
        .prepare('SELECT * FROM holidays WHERE date >= ? AND date <= ? ORDER BY date, name')
        .all(fromIso ?? '0000-00-00', toIso ?? '9999-99-99') as any[]
    ).map((r) => ({
      id: r.id,
      date: r.date,
      name: r.name,
      kind: r.kind,
      enabled: !!r.enabled,
      custom: !!r.custom,
    }))
  }

  /** Enabled events in the next N days, for the Writers. */
  upcoming(days = 21): HolidayRow[] {
    const t = todayEastern(this.now())
    return this.list(t, addDays(t, days)).filter((h) => h.enabled)
  }

  add(date: string, name: string, kind = 'fun'): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use the date form 2026-12-31.')
    if (!name.trim()) throw new Error('Give the day a name.')
    this.db
      .prepare('INSERT OR IGNORE INTO holidays (date, name, kind, custom) VALUES (?, ?, ?, 1)')
      .run(date, name.trim(), kind)
  }

  setEnabled(id: number, enabled: boolean): void {
    this.db.prepare('UPDATE holidays SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM holidays WHERE id = ?').run(id)
  }
}
