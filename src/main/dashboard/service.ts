import type { Db } from '../db'
import type { SettingsService } from '../services/settings'
import { HANDLERS } from '../agent/handlers'
import { OWNER } from '../agent/bots'
import type { AgentServices } from '../agent/core'
import { EloClient, EloError, type EloTransport } from './eloClient'
import { History } from './history'
import { Poller } from './poller'
import { StatsService } from './stats'
import type { Snapshot } from './types'

const TZ = 'America/New_York'

/** Asks ELO's own agent handlers the same questions the agent API answers, without any network. */
function transport(s: AgentServices, clipsOn: () => boolean): EloTransport {
  const run = async (id: string, params: unknown, query: unknown) => {
    try {
      const out = await HANDLERS[id]({ s, params, query, body: {}, caller: OWNER })
      return JSON.parse(JSON.stringify(out))
    } catch (e) {
      throw new EloError('badResponse', e instanceof Error ? e.message : 'ELO could not answer')
    }
  }
  return async (path, p = {}) => {
    if (path === '/v1/health') return { ok: true }
    if (path === '/v1/brands') {
      const out = await run('listBrands', {}, {})
      // Clip days belong to the AI Studio. While it is off, the Home map expects no clip slots.
      if (!clipsOn() && out && Array.isArray(out.brands))
        for (const b of out.brands) b.clip_post_days = []
      return out
    }
    if (path === '/v1/posts')
      return run(
        'listPosts',
        {},
        { brand_id: Number(p.brand_id), from: p.from, to: p.to, limit: 1000 },
      )
    if (path === '/v1/slots/next-open')
      return run(
        'nextOpenSlots',
        {},
        { brand_id: Number(p.brand_id), count: Number(p.count), days: Number(p.days) },
      )
    let m = /^\/v1\/brands\/(\d+)\/stats$/.exec(path)
    if (m) return run('brandStats', { id: Number(m[1]) }, { range: p.range })
    m = /^\/v1\/posts\/(\d+)\/stats$/.exec(path)
    if (m) return run('postStats', { id: Number(m[1]) }, {})
    throw new EloError('badResponse', `Unknown path ${path}`)
  }
}

/** The Dashboard screen's numbers: how full the week is, open slots, stats per channel and top videos. Read only. */
export class DashboardService {
  private poller: Poller

  constructor(private deps: {
    db: Db
    services: AgentServices
    settings: SettingsService
    /** Reads YouTube watch time for recent videos. Optional, so tests need no Studio. */
    refreshWatchTime?: () => Promise<unknown>
    /** False while the AI Studio is off. Clip slots are then left off the week map. */
    studioOn?: () => boolean
    /** Each channel's platform numbers added together, read through Upload-Post. */
    accountTotals?: () => import('@shared/engage').HomeAccountTotals | null
    now?: () => Date
  }) {
    const now = deps.now ?? (() => new Date())
    const client = new EloClient(transport(deps.services, () => deps.studioOn?.() ?? true))
    const cfg = {
      tz: TZ,
      pollSlotsMinutes: 5,
      pollStatsMinutes: 30,
      get minGapMinutes() {
        return deps.settings.get().minGapMinutes
      },
    }
    this.poller = new Poller({
      client,
      stats: new StatsService(client, now),
      history: new History(deps.db),
      cfg,
      now,
    })
  }

  private watchTimer: ReturnType<typeof setInterval> | null = null

  start(): void {
    this.poller.start()
    const read = () => void this.deps.refreshWatchTime?.().catch(() => {})
    setTimeout(read, 60_000).unref?.()
    this.watchTimer = setInterval(read, 30 * 60_000)
    this.watchTimer.unref?.()
  }

  stop(): void {
    if (this.watchTimer) clearInterval(this.watchTimer)
    this.poller.stop()
  }

  weekMap(offset: number) {
    return this.poller.weekMap(Math.max(0, Math.floor(Number(offset) || 0)))
  }

  snapshot(): Snapshot | null {
    return this.withWatch(this.poller.latest())
  }

  /** Adds YouTube watch hours for videos posted in the last 7 days (read from the saved retention numbers). */
  private withWatch(s: Snapshot | null): Snapshot | null {
    if (!s) return s
    const one = (h: number) => {
      const top = this.bestVideos(1, h * 3_600_000)?.[0]
      return top ? { title: top.title, channel: top.channel, views: top.views } : null
    }
    s = {
      ...s,
      topVideos: this.bestVideos() ?? s.topVideos,
      best24h: one(24),
      best48h: one(48),
      accounts: this.deps.accountTotals?.() ?? null,
    }
    if (!s.stats) return s
    let hours: number | null = null
    try {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const r = this.deps.db
        .prepare(
          `SELECT SUM(r.minutes_watched) AS m, COUNT(*) AS n
           FROM video_retention r
           JOIN post_targets t ON t.post_id = r.post_id AND t.platform = r.platform
           WHERE r.platform = 'youtube' AND t.status = 'posted' AND t.posted_at_utc >= ?`,
        )
        .get(since) as { m: number | null; n: number }
      hours = r.n > 0 && r.m !== null ? Math.round((r.m / 60) * 10) / 10 : null
    } catch {
      hours = null
    }
    return { ...s, stats: { ...s.stats, watchHours: hours } }
  }

  /**
   * The best videos of the last 7 days, read straight from ELO's saved numbers. A post counts as soon as one platform
   * has it live (a post where Instagram failed is still a hit on YouTube), views add up across its platforms, and
   * videos found on the channels by the import count too.
   */
  private bestVideos(limit = 5, windowMs = 7 * 86_400_000): Snapshot['topVideos'] | null {
    try {
      const since = new Date(Date.now() - windowMs).toISOString()
      const latest = (col: string, id: string) =>
        `COALESCE((SELECT views FROM ${col} WHERE ${id} ORDER BY id DESC LIMIT 1), 0)`
      const mine = this.deps.db
        .prepare(
          `SELECT p.title AS title, b.name AS channel,
                  SUM(${latest('post_stats ps', 'ps.post_target_id = t.id')}) AS views
           FROM post_targets t
           JOIN posts p ON p.id = t.post_id
           JOIN brands b ON b.id = p.brand_id
           WHERE t.status = 'posted' AND b.archived = 0 AND t.posted_at_utc >= ?
           GROUP BY p.id`,
        )
        .all(since) as { title: string; channel: string; views: number }[]
      const old = this.deps.db
        .prepare(
          `SELECT iv.title AS title, b.name AS channel,
                  ${latest('imported_stats s', 's.imported_id = iv.id')} AS views
           FROM imported_videos iv
           JOIN brands b ON b.id = iv.brand_id
           WHERE b.archived = 0 AND iv.published_at_utc >= ?`,
        )
        .all(since) as { title: string; channel: string; views: number }[]
      return [...mine, ...old]
        .filter((r) => r.views > 0)
        .sort((a, b) => b.views - a.views)
        .slice(0, limit)
        .map((r, i) => ({
          rank: i + 1,
          title: r.title,
          channel: r.channel,
          views: r.views,
          approximate: false,
        }))
    } catch {
      return null
    }
  }

  /** The Refresh button: reads everything again now. */
  async refresh(): Promise<Snapshot | null> {
    await this.poller.refreshSlots()
    await this.poller.refreshStats()
    await this.deps.refreshWatchTime?.().catch(() => {})
    return this.withWatch(this.poller.latest())
  }
}
