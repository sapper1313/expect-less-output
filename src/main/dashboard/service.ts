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
function transport(s: AgentServices): EloTransport {
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
    if (path === '/v1/brands') return run('listBrands', {}, {})
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
    now?: () => Date
  }) {
    const now = deps.now ?? (() => new Date())
    const client = new EloClient(transport(deps.services))
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

  start(): void {
    this.poller.start()
  }

  stop(): void {
    this.poller.stop()
  }

  snapshot(): Snapshot | null {
    return this.withWatch(this.poller.latest())
  }

  /** Adds YouTube watch hours for videos posted in the last 7 days (read from the saved retention numbers). */
  private withWatch(s: Snapshot | null): Snapshot | null {
    if (!s || !s.stats) return s
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

  /** The Refresh button: reads everything again now. */
  async refresh(): Promise<Snapshot | null> {
    await this.poller.refreshSlots()
    await this.poller.refreshStats()
    return this.withWatch(this.poller.latest())
  }
}
