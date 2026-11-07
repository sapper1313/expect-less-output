import { EloClient, EloError, type BrandStats } from './eloClient'
import type { History } from './history'
import { buildSnapshot } from './snapshot'
import type { StatsService, TopVideo } from './stats'
import type { Brand, Post, Snapshot } from './types'
import type { WeekMap } from '@shared/dashboard'
import { DateTime } from 'luxon'
import { weekWindow } from './week'

interface Deps {
  client: Pick<EloClient, 'brands' | 'posts' | 'nextOpen'>
  stats: StatsService
  history: History
  cfg: DashboardConfig
  now: () => Date
}

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

export interface DashboardConfig {
  tz: string
  pollSlotsMinutes: number
  pollStatsMinutes: number
  minGapMinutes: number
}

function log(msg: string): void {
  console.log(`[dashboard] ${msg}`)
}

/** Runs fn and returns its value, or the fallback (and a log line) if it throws. Nothing here may crash the process. */
function safe<T>(what: string, fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (err) {
    log(`${what} failed (${err instanceof Error ? err.message : 'unknown error'})`)
    return fallback
  }
}

export class Poller {
  private snapshot: Snapshot | null = null
  private brands: Brand[] = []
  private posts: Post[] = []
  private nextOpen: Map<number, string[]> | null = null
  private brandStats = new Map<number, BrandStats>()
  private topVideos: TopVideo[] = []
  private lastGoodAt: string | null = null
  private eloStatus: 'ok' | 'stale' | 'unauthorized' = 'ok'
  private haveData = false
  private statsOk = false
  private lastHistoryDate: string | null = null
  private historyHadViews = false
  private issue: 'unauthorized' | 'unreachable' | null = null
  private timers: NodeJS.Timeout[] = []

  constructor(private deps: Deps) {}

  latest(): Snapshot | null {
    return this.snapshot
  }

  /** Why there is no snapshot yet, if known. */
  startupIssue(): 'unauthorized' | 'unreachable' | null {
    return this.snapshot ? null : this.issue
  }

  /** Numbers for the --check line. */
  summary(): { brands: number; counted: number; statsOk: boolean } {
    return {
      brands: this.brands.length,
      counted: this.brands.filter((b) => b.state === 'active').length,
      statsOk: this.statsOk,
    }
  }

  /** Loads the last saved snapshot (after a restart) and marks it stale until ELO answers. */
  restore(): void {
    const raw = safe('load saved snapshot', () => this.deps.history.loadSnapshot(), null)
    if (!raw) return
    const parsed = safe('parse saved snapshot', () => JSON.parse(raw) as Snapshot, null)
    if (!parsed || !parsed.totals || !parsed.week || !Array.isArray(parsed.channels)) return
    this.lastGoodAt = parsed.status?.lastGoodAt ?? parsed.generatedAt
    this.eloStatus = 'stale'
    this.snapshot = parsed
    this.patchStatus()
  }

  private patchStatus(): void {
    const s = this.snapshot
    if (!s) return
    const last = this.lastGoodAt ? Date.parse(this.lastGoodAt) : null
    this.snapshot = {
      ...s,
      status: {
        elo: this.eloStatus,
        lastGoodAt: this.lastGoodAt,
        staleMinutes:
          last === null ? 0 : Math.max(0, Math.floor((this.deps.now().getTime() - last) / 60000)),
      },
    }
  }

  private rebuild(): void {
    if (!this.haveData) return
    const { history, cfg, now } = this.deps
    const t = now()
    const week = weekWindow(t, cfg.tz)
    const delta = new Map<number, number | null>()
    for (const b of this.brands) {
      delta.set(
        b.id,
        safe('views delta', () => history.viewsDeltaPct(b.id, week.startDate), null),
      )
    }
    const trend = safe('weekly trend', () => history.weeklyPercent(6), [])
    const built = safe(
      'build snapshot',
      () =>
        buildSnapshot({
          now: t,
          tz: cfg.tz,
          brands: this.brands,
          posts: this.posts,
          brandStats: this.brandStats,
          topVideos: this.topVideos,
          trend,
          viewsDelta: delta,
          nextOpenByBrand: this.nextOpen,
          elo: { status: this.eloStatus, lastGoodAt: this.lastGoodAt },
          minGapMinutes: cfg.minGapMinutes,
        }),
      null,
    )
    if (built) {
      built.open3d = safe('open slots next 3 days', () => this.countOpen3d(t, built), 0)
      this.snapshot = built
      if (this.eloStatus === 'ok') {
        safe('save snapshot', () => history.saveSnapshot(JSON.stringify(built)), undefined)
      }
    }
  }

  /** Open slots on today and the next 2 days. A window that runs into next week uses next week's slots too. */
  private countOpen3d(t: Date, built: Snapshot): number {
    const { cfg } = this.deps
    const today = built.week.today
    const last = DateTime.fromISO(today, { zone: 'utc' }).plus({ days: 2 }).toISODate() as string
    const channels = [...built.channels]
    if (last > built.week.end) {
      const next = buildSnapshot({
        now: new Date(t.getTime() + 7 * DAY_MS),
        tz: cfg.tz,
        brands: this.brands,
        posts: this.posts,
        brandStats: this.brandStats,
        topVideos: [],
        trend: [],
        viewsDelta: new Map(),
        nextOpenByBrand: null,
        elo: { status: this.eloStatus, lastGoodAt: this.lastGoodAt },
        minGapMinutes: cfg.minGapMinutes,
      })
      channels.push(...next.channels)
    }
    let n = 0
    for (const c of channels) {
      if (c.state !== 'active') continue
      for (const d of c.days) {
        if (d.date < today || d.date > last) continue
        n += d.slots.filter((s) => s.state === 'open').length
      }
    }
    return n
  }

  /** The week map for a later week. Reads that week's posts when asked. */
  async weekMap(offset: number): Promise<WeekMap | null> {
    if (!this.haveData || offset < 0 || offset > 26) return null
    const { client, cfg, now } = this.deps
    const real = now()
    const t = new Date(real.getTime() + offset * 7 * DAY_MS)
    const week = weekWindow(t, cfg.tz)
    let posts = this.posts
    if (offset > 0) {
      posts = []
      for (const b of this.brands.filter((x) => x.state !== 'archived'))
        posts.push(...(await client.posts(b.id, week.startUtc, week.endUtcExclusive)))
    }
    const built = buildSnapshot({
      now: t,
      tz: cfg.tz,
      brands: this.brands,
      posts,
      brandStats: this.brandStats,
      topVideos: [],
      trend: [],
      viewsDelta: new Map(),
      nextOpenByBrand: null,
      elo: { status: this.eloStatus, lastGoodAt: this.lastGoodAt },
      minGapMinutes: cfg.minGapMinutes,
    })
    return {
      week: { ...built.week, today: weekWindow(real, cfg.tz).today },
      channels: built.channels,
    }
  }

  private markDown(err: unknown): void {
    const kind = err instanceof EloError ? err.kind : 'unreachable'
    this.eloStatus = kind === 'unauthorized' ? 'unauthorized' : 'stale'
    this.issue = kind === 'unauthorized' ? 'unauthorized' : 'unreachable'
    // Keep what we showed last, only changing its status. Recomputing from old posts could show a false empty new week.
    this.patchStatus()
    const why = err instanceof EloError ? `${err.kind}: ${err.message}` : 'unexpected error'
    log(`refresh failed (${why})`)
  }

  async refreshSlots(): Promise<void> {
    const { client, cfg, now } = this.deps
    let brands: Brand[]
    let posts: Post[]
    let nextOpen: Map<number, string[]> | null
    const t = now()
    try {
      brands = await client.brands()
      const week = weekWindow(t, cfg.tz)
      const from = new Date(
        Math.min(Date.parse(week.startUtc), t.getTime() - 7 * DAY_MS),
      ).toISOString()
      const to = new Date(
        Math.max(Date.parse(week.endUtcExclusive) + 7 * DAY_MS, t.getTime() + 48 * HOUR_MS),
      ).toISOString()
      posts = []
      for (const b of brands.filter((x) => x.state !== 'archived')) {
        posts.push(...(await client.posts(b.id, from, to)))
      }
      nextOpen = new Map()
      try {
        for (const b of brands.filter((x) => x.state === 'active')) {
          nextOpen.set(b.id, await client.nextOpen(b.id, 8))
        }
      } catch {
        nextOpen = null
      }
    } catch (err) {
      this.markDown(err)
      return
    }
    const firstSuccess = !this.haveData
    this.brands = brands
    this.posts = posts
    this.nextOpen = nextOpen
    this.haveData = true
    this.eloStatus = 'ok'
    this.issue = null
    this.lastGoodAt = t.toISOString()
    this.rebuild()
    if (firstSuccess) await this.refreshStats()
    this.saveDailyHistory()
  }

  async refreshStats(): Promise<void> {
    if (!this.haveData || this.eloStatus !== 'ok') return
    const { stats } = this.deps
    const names = new Map(this.brands.map((b) => [b.id, b.name]))
    try {
      let ok = true
      for (const b of this.brands.filter((x) => x.state !== 'archived')) {
        try {
          this.brandStats.set(b.id, await stats.channelViews(b.id))
        } catch {
          ok = false
        }
      }
      this.topVideos = await stats.topVideos(this.posts, names)
      this.statsOk = ok
    } catch {
      this.statsOk = false
    }
    this.rebuild()
  }

  /** Writes one history row per Eastern date, rewriting it once if the first write had no view counts. */
  saveDailyHistory(): void {
    const s = this.snapshot
    if (!s || s.status.elo !== 'ok') return
    if (this.lastHistoryDate === s.week.today && this.historyHadViews) return
    const channelViews: Record<string, number> = {}
    for (const c of s.channels) if (c.views7d !== null) channelViews[String(c.id)] = c.views7d
    safe(
      'save history',
      () => {
        this.deps.history.saveDaily({
          date: s.week.today,
          weekStart: s.week.start,
          filled: s.totals.filled,
          total: s.totals.slots,
          channelViews,
        })
        this.lastHistoryDate = s.week.today
        this.historyHadViews = Object.keys(channelViews).length > 0
      },
      undefined,
    )
  }

  start(): void {
    const { cfg } = this.deps
    this.restore()
    void this.refreshSlots().catch((e) =>
      log(`refresh error (${e instanceof Error ? e.message : 'unknown'})`),
    )
    this.timers.push(
      setInterval(() => {
        void this.refreshSlots().catch((e) =>
          log(`refresh error (${e instanceof Error ? e.message : 'unknown'})`),
        )
      }, cfg.pollSlotsMinutes * 60_000),
    )
    this.timers.push(
      setInterval(() => {
        void this.refreshStats()
          .then(() => this.saveDailyHistory())
          .catch((e) => log(`stats error (${e instanceof Error ? e.message : 'unknown'})`))
      }, cfg.pollStatsMinutes * 60_000),
    )
    for (const t of this.timers) t.unref()
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }
}
