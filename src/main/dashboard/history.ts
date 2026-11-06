import type { Db } from '../db'

export interface HistoryRow {
  date: string
  weekStart: string
  filled: number
  total: number
  channelViews: Record<string, number>
}

function previousWeek(weekStart: string): string {
  return new Date(Date.parse(`${weekStart}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10)
}

export class History {
  constructor(private db: Db) {}

  saveDaily(row: HistoryRow): void {
    this.db
      .prepare(
        `INSERT INTO dashboard_daily (date, week_start, filled, total, channel_views) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET week_start=excluded.week_start, filled=excluded.filled,
         total=excluded.total,
         channel_views=CASE WHEN excluded.channel_views = '{}' THEN dashboard_daily.channel_views ELSE excluded.channel_views END`,
      )
      .run(row.date, row.weekStart, row.filled, row.total, JSON.stringify(row.channelViews))
  }

  saveSnapshot(json: string): void {
    this.db
      .prepare(
        "INSERT INTO dashboard_kv (k, v) VALUES ('snapshot', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      )
      .run(json)
  }

  loadSnapshot(): string | null {
    const row = this.db.prepare("SELECT v FROM dashboard_kv WHERE k = 'snapshot'").get() as
      { v: string } | undefined
    return row ? row.v : null
  }

  private latestOfWeek(
    weekStart: string,
  ): { filled: number; total: number; channel_views: string } | undefined {
    return this.db
      .prepare(
        'SELECT filled, total, channel_views FROM dashboard_daily WHERE week_start = ? ORDER BY date DESC LIMIT 1',
      )
      .get(weekStart) as { filled: number; total: number; channel_views: string } | undefined
  }

  /** Last row of each week, the most recent `limit` weeks, oldest first. */
  weeklyPercent(limit: number): { week: string; percent: number }[] {
    const weeks = this.db
      .prepare('SELECT DISTINCT week_start FROM dashboard_daily ORDER BY week_start DESC LIMIT ?')
      .all(limit) as { week_start: string }[]
    return weeks
      .map((w) => w.week_start)
      .reverse()
      .map((week) => {
        const r = this.latestOfWeek(week) as { filled: number; total: number }
        return { week, percent: r.total === 0 ? 0 : Math.round((r.filled / r.total) * 100) }
      })
  }

  /** Percent change of 7d views vs the last saved day of the previous week. */
  viewsDeltaPct(channelId: number, weekStart: string): number | null {
    const cur = this.latestOfWeek(weekStart)
    const prev = this.latestOfWeek(previousWeek(weekStart))
    if (!cur || !prev) return null
    const c = (JSON.parse(cur.channel_views) as Record<string, number>)[String(channelId)]
    const p = (JSON.parse(prev.channel_views) as Record<string, number>)[String(channelId)]
    if (typeof c !== 'number' || typeof p !== 'number' || p === 0) return null
    return Math.round(((c - p) / p) * 100)
  }
}
