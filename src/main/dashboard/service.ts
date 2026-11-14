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
import type { BestVideo } from '../../shared/dashboard'

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

  async weekMap(offset: number) {
    const w = await this.poller.weekMap(Math.max(0, Math.floor(Number(offset) || 0)))
    return w ? { ...w, channels: this.withPosters(w.channels) } : w
  }

  /** Adds each filled slot's video title and preview picture, read from ELO's own posts. */
  private withPosters<T extends { days: { slots: { postId?: number | null; title?: string | null; posterUrl?: string | null; platforms?: { platform: string; status: string }[] }[] }[] }>(channels: T[]): T[] {
    try {
      const ids = new Set<number>()
      for (const c of channels) for (const d of c.days) for (const sl of d.slots) if (sl.postId) ids.add(sl.postId)
      if (!ids.size) return channels
      const rows = this.deps.db
        .prepare(`SELECT id, title, poster_path FROM posts WHERE id IN (${[...ids].map(() => '?').join(',')})`)
        .all(...ids) as { id: number; title: string; poster_path: string | null }[]
      const by = new Map(rows.map((r) => [r.id, r]))
      const tg = this.deps.db
        .prepare(`SELECT post_id, platform, status FROM post_targets WHERE post_id IN (${[...ids].map(() => '?').join(',')}) AND status != 'skipped'`)
        .all(...ids) as { post_id: number; platform: string; status: string }[]
      const targets = new Map<number, { platform: string; status: string }[]>()
      for (const t of tg) targets.set(t.post_id, [...(targets.get(t.post_id) ?? []), { platform: t.platform, status: t.status }])
      return channels.map((c) => ({
        ...c,
        days: c.days.map((d) => ({
          ...d,
          slots: d.slots.map((sl) => {
            const r = sl.postId ? by.get(sl.postId) : undefined
            return r ? { ...sl, title: r.title, posterUrl: r.poster_path ? `elo-media://poster/${r.poster_path}` : null, platforms: targets.get(r.id) ?? [] } : sl
          }),
        })),
      }))
    } catch {
      return channels
    }
  }

  snapshot(): Snapshot | null {
    return this.withWatch(this.poller.latest())
  }

  /** Adds YouTube watch hours for videos posted in the last 7 days (read from the saved retention numbers). */
  private withWatch(s: Snapshot | null): Snapshot | null {
    if (!s) return s
    const one = (h: number) => {
      const top = this.bestVideos(1, h * 3_600_000)?.[0]
      return top ? { title: top.title, channel: top.channel, views: top.views, postedAt: top.postedAt, platforms: top.platforms, posterUrl: top.posterUrl } : null
    }
    s = {
      ...s,
      channels: this.withPosters(s.channels),
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
      const col = (c: string, id: string, f: string) =>
        `COALESCE((SELECT ${f} FROM ${c} WHERE ${id} ORDER BY id DESC LIMIT 1), 0)`
      type Row = {
        key: string
        title: string
        channel: string
        platform: string
        views: number
        likes: number
        comments: number
        shares: number
        postedAt: string | null
        poster?: string | null
      }
      const mineRows = this.deps.db
        .prepare(
          `SELECT 'p' || p.id AS key, p.title AS title, b.name AS channel, t.platform AS platform,
                  ${col('post_stats ps', 'ps.post_target_id = t.id', 'views')} AS views,
                  ${col('post_stats ps', 'ps.post_target_id = t.id', 'likes')} AS likes,
                  ${col('post_stats ps', 'ps.post_target_id = t.id', 'comments')} AS comments,
                  ${col('post_stats ps', 'ps.post_target_id = t.id', 'shares')} AS shares,
                  t.posted_at_utc AS postedAt, p.poster_path AS poster
           FROM post_targets t
           JOIN posts p ON p.id = t.post_id
           JOIN brands b ON b.id = p.brand_id
           WHERE t.status = 'posted' AND b.archived = 0 AND t.posted_at_utc >= ?`,
        )
        .all(since) as Row[]
      const oldRows = this.deps.db
        .prepare(
          `SELECT 'i' || iv.id AS key, iv.title AS title, b.name AS channel, iv.platform AS platform,
                  ${col('imported_stats s', 's.imported_id = iv.id', 'views')} AS views,
                  ${col('imported_stats s', 's.imported_id = iv.id', 'likes')} AS likes,
                  ${col('imported_stats s', 's.imported_id = iv.id', 'comments')} AS comments,
                  ${col('imported_stats s', 's.imported_id = iv.id', 'shares')} AS shares,
                  iv.published_at_utc AS postedAt
           FROM imported_videos iv
           JOIN brands b ON b.id = iv.brand_id
           WHERE b.archived = 0 AND iv.published_at_utc >= ?`,
        )
        .all(since) as Row[]
      const groups = new Map<string, { title: string; channel: string; views: number; postedAt: string | null; poster: string | null; platforms: NonNullable<BestVideo['platforms']> }>()
      for (const r of [...mineRows, ...oldRows]) {
        const g = groups.get(r.key) ?? { title: r.title, channel: r.channel, views: 0, postedAt: r.postedAt, poster: r.poster ?? null, platforms: [] }
        g.views += r.views
        if (r.postedAt && (!g.postedAt || r.postedAt < g.postedAt)) g.postedAt = r.postedAt
        g.platforms.push({ platform: r.platform, views: r.views, likes: r.likes, comments: r.comments, shares: r.shares })
        groups.set(r.key, g)
      }
      return [...groups.values()]
        .filter((r) => r.views > 0)
        .sort((a, b) => b.views - a.views)
        .slice(0, limit)
        .map((r, i) => ({
          rank: i + 1,
          title: r.title,
          channel: r.channel,
          views: r.views,
          approximate: false,
          postedAt: r.postedAt,
          posterUrl: r.poster ? `elo-media://poster/${r.poster}` : null,
          platforms: r.platforms.sort((a, b) => b.views - a.views),
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
