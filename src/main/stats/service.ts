import type { Db } from '../db'
import type { ActivityLog } from '../services/activity'
import { PLATFORMS } from '@shared/platformLimits'
import type {
  Account,
  BrandStats,
  Platform,
  PostStats,
  StatsNumbers,
  StatsRange,
  TargetStats,
} from '@shared/types'
import { isTikTokVideoId, shouldRefresh } from './ids'
import {
  analyze,
  recommendSlots,
  type BestTimes,
  type RecommendedSlots,
  type TimedVideo,
} from './bestTimes'
import type { StatsProvider, StatsTarget } from './providers'

const DAY = 86_400_000

interface Row {
  target_id: number
  post_id: number
  platform: Platform
  account_id: number | null
  external_id: string | null
  posted_at_utc: string | null
  status: string
  brand_id: number
  brand_name: string
  a_mode: string | null
}

export interface StatsDeps {
  db: Db
  providers: Partial<Record<Platform, StatsProvider>>
  log: ActivityLog
  emit?: () => void
  now?: () => number
  /** Imported (pre-existing) videos, included in brand totals. */
  imported?: import('./imported').ImportService
}

const EMPTY: StatsNumbers = { views: null, likes: null, comments: null, shares: null }
const addNum = (a: number | null, b: number | null): number | null =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0)
const addAll = (a: StatsNumbers, b: StatsNumbers): StatsNumbers => ({
  views: addNum(a.views, b.views),
  likes: addNum(a.likes, b.likes),
  comments: addNum(a.comments, b.comments),
  shares: addNum(a.shares, b.shares),
})

export class StatsService {
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private d: StatsDeps) {}

  private now(): number {
    return this.d.now ? this.d.now() : Date.now()
  }

  // ---------- which targets can have stats ----------

  private rows(where = '', args: unknown[] = []): Row[] {
    return this.d.db
      .prepare(
        `SELECT t.id AS target_id, t.post_id, t.platform, t.account_id, t.external_id, t.posted_at_utc, t.status,
                p.brand_id, b.name AS brand_name, a.mode AS a_mode
         FROM post_targets t JOIN posts p ON p.id = t.post_id JOIN brands b ON b.id = p.brand_id
         LEFT JOIN accounts a ON a.id = t.account_id ${where} ORDER BY t.id`,
      )
      .all(...args) as Row[]
  }

  private account(id: number | null): Account | null {
    if (!id) return null
    const a = this.d.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as any
    return a
      ? {
          id: a.id,
          brandId: a.brand_id,
          platform: a.platform,
          displayName: a.display_name,
          avatarUrl: a.avatar_url,
          externalId: a.external_id,
          status: a.status,
          mode: a.mode,
          lastCheckedAt: a.last_checked_at,
        }
      : null
  }

  private lastFetchMs(targetId: number): number | null {
    const r = this.d.db
      .prepare('SELECT MAX(fetched_at_utc) AS t FROM post_stats WHERE post_target_id = ?')
      .get(targetId) as { t: string | null }
    const a = this.d.db
      .prepare('SELECT checked_at FROM stats_availability WHERE post_target_id = ?')
      .get(targetId) as { checked_at: string } | undefined
    const times = [r.t, a?.checked_at].filter(Boolean).map((x) => new Date(x as string).getTime())
    return times.length ? Math.max(...times) : null
  }

  private isUnavailable(targetId: number): boolean {
    const a = this.d.db
      .prepare('SELECT available FROM stats_availability WHERE post_target_id = ?')
      .get(targetId) as { available: number } | undefined
    return !!a && !a.available
  }

  // ---------- fetching ----------

  /** Reads stats now. `force` ignores the refresh schedule (the Refresh button). */
  async refresh(
    opts: { postId?: number; force?: boolean } = {},
  ): Promise<{ fetched: number; unavailable: number }> {
    if (this.running) return { fetched: 0, unavailable: 0 }
    this.running = true
    let fetched = 0
    let unavailable = 0
    try {
      const nowMs = this.now()
      const all = opts.postId
        ? this.rows('WHERE t.post_id = ?', [opts.postId])
        : this.rows("WHERE t.status = 'posted'")
      // TikTok targets without a real video id still get an "unavailable" explanation, so they are not filtered out for that.
      const candidates = all.filter(
        (r) =>
          r.status === 'posted' && !!r.external_id && !!r.posted_at_utc && r.a_mode !== 'dry_run',
      )
      const due = candidates.filter(
        (r) =>
          opts.force ||
          shouldRefresh({
            ageMs: nowMs - new Date(r.posted_at_utc as string).getTime(),
            lastFetchMs: this.lastFetchMs(r.target_id),
            nowMs,
            unavailable: this.isUnavailable(r.target_id),
          }),
      )
      for (const platform of PLATFORMS) {
        const provider = this.d.providers[platform]
        const list = due.filter((r) => r.platform === platform)
        if (!provider || list.length === 0) continue
        const targets: StatsTarget[] = list.map((r) => ({
          targetId: r.target_id,
          platform,
          accountId: r.account_id,
          account: this.account(r.account_id),
          externalId: r.external_id as string,
          postedAt: r.posted_at_utc as string,
        }))
        const results = await provider.fetch(targets)
        const soft = new Map<string, number>()
        const at = new Date(this.now()).toISOString()
        for (const t of targets) {
          const o = results.get(t.targetId)
          if (!o) continue
          if (o.ok) {
            this.d.db
              .prepare(
                'INSERT INTO post_stats (post_target_id, fetched_at_utc, views, likes, comments, shares, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
              )
              .run(
                t.targetId,
                at,
                o.numbers.views,
                o.numbers.likes,
                o.numbers.comments,
                o.numbers.shares,
                JSON.stringify({ approximate: o.approximate ?? [], ...(o.extra ?? {}) }),
              )
            this.setAvailability(t.targetId, true, null, at)
            fetched++
          } else if (o.unavailable) {
            this.setAvailability(t.targetId, false, o.reason, at)
            unavailable++
          } else {
            soft.set(o.reason, (soft.get(o.reason) ?? 0) + 1)
          }
        }
        for (const [reason, n] of soft)
          this.d.log.log('warn', `Could not read ${n} ${platform} video(s) just now: ${reason}`, {
            platform,
          })
      }
      if (fetched || unavailable) this.d.emit?.()
    } finally {
      this.running = false
    }
    return { fetched, unavailable }
  }

  private setAvailability(
    targetId: number,
    available: boolean,
    reason: string | null,
    at: string,
  ): void {
    this.d.db
      .prepare(
        `INSERT INTO stats_availability (post_target_id, available, reason, checked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(post_target_id) DO UPDATE SET available = excluded.available, reason = excluded.reason, checked_at = excluded.checked_at`,
      )
      .run(targetId, available ? 1 : 0, reason, at)
  }

  /** The scheduled pass. Safe to call often, it only touches what is due. */
  async refreshDue(): Promise<{ fetched: number; unavailable: number }> {
    const mine = await this.refresh({})
    // New and returning accounts get their existing videos listed first, so the numbers below include them.
    if (this.d.imported) await this.d.imported.importDue().catch(() => undefined)
    const old = this.d.imported ? await this.d.imported.refresh({}) : { fetched: 0, unavailable: 0 }
    return { fetched: mine.fetched + old.fetched, unavailable: mine.unavailable + old.unavailable }
  }

  start(): void {
    setTimeout(() => void this.refreshDue().catch(() => {}), 60_000)
    this.timer = setInterval(() => void this.refreshDue().catch(() => {}), 30 * 60_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  // ---------- reading ----------

  private latest(targetId: number): { n: StatsNumbers; at: string; approximate: string[] } | null {
    const r = this.d.db
      .prepare('SELECT * FROM post_stats WHERE post_target_id = ? ORDER BY id DESC LIMIT 1')
      .get(targetId) as any
    if (!r) return null
    let approximate: string[] = []
    try {
      approximate = JSON.parse(r.extra_json ?? '{}').approximate ?? []
    } catch {
      // no extra
    }
    return {
      n: { views: r.views, likes: r.likes, comments: r.comments, shares: r.shares },
      at: r.fetched_at_utc,
      approximate,
    }
  }

  private explain(r: Row): { state: TargetStats['state']; reason: string | null } {
    const av = this.d.db
      .prepare('SELECT available, reason FROM stats_availability WHERE post_target_id = ?')
      .get(r.target_id) as { available: number; reason: string | null } | undefined
    if (r.a_mode === 'dry_run')
      return { state: 'unavailable', reason: 'This was a dry run. Nothing real was posted.' }
    if (r.status !== 'posted')
      return { state: 'pending', reason: 'Stats start once the post is live.' }
    if (!r.external_id)
      return {
        state: 'unavailable',
        reason:
          'The app does not know this video. Paste the video link when you mark a post as posted.',
      }
    if (r.platform === 'tiktok' && !isTikTokVideoId(r.external_id)) {
      return {
        state: 'unavailable',
        reason:
          'TikTok does not tell the app the video id for drafts. Paste the video link when you mark the post as posted.',
      }
    }
    if (av && !av.available) return { state: 'unavailable', reason: av.reason ?? 'Not available.' }
    return { state: 'pending', reason: 'Not fetched yet. Press Refresh stats.' }
  }

  private targetStats(r: Row): TargetStats {
    const l = this.latest(r.target_id)
    const history = (
      this.d.db
        .prepare(
          'SELECT fetched_at_utc, views, likes, comments, shares FROM post_stats WHERE post_target_id = ? ORDER BY id LIMIT 1000',
        )
        .all(r.target_id) as any[]
    ).map((h) => ({
      t: h.fetched_at_utc as string,
      views: h.views,
      likes: h.likes,
      comments: h.comments,
      shares: h.shares,
    }))
    if (l) {
      return {
        targetId: r.target_id,
        platform: r.platform,
        state: 'ok',
        reason: null,
        latest: { ...l.n, fetchedAt: l.at, approximate: l.approximate },
        history,
      }
    }
    const e = this.explain(r)
    return {
      targetId: r.target_id,
      platform: r.platform,
      state: e.state,
      reason: e.reason,
      latest: null,
      history,
    }
  }

  postStats(postId: number): PostStats {
    const targets = this.rows('WHERE t.post_id = ?', [postId]).map((r) => this.targetStats(r))
    return {
      postId,
      targets,
      totals: targets.reduce((acc, t) => (t.latest ? addAll(acc, t.latest) : acc), EMPTY),
    }
  }

  /** Totals for the Queue columns, for many posts at once. */
  forPosts(ids: number[]): Record<number, PostStats> {
    const out: Record<number, PostStats> = {}
    for (const id of ids) out[id] = this.postStats(id)
    return out
  }

  brandSummary(brandId: number | null, range: StatsRange): BrandStats {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 36500
    const since = new Date(this.now() - days * DAY).toISOString()
    const rows = this.rows(
      `WHERE t.status = 'posted' AND t.posted_at_utc >= ? ${brandId ? 'AND p.brand_id = ?' : ''}`,
      brandId ? [since, brandId] : [since],
    )
    const posts = new Set(rows.map((r) => r.post_id))
    const old = this.d.imported ? this.d.imported.list(brandId, range) : []
    const platforms = PLATFORMS.map((platform) => {
      const mine = rows.filter((r) => r.platform === platform)
      let totals = EMPTY
      let videos = 0
      let unavailable = 0
      let reason: string | null = null
      for (const r of mine) {
        const l = this.latest(r.target_id)
        if (l) {
          totals = addAll(totals, l.n)
          videos++
        } else {
          unavailable++
          reason ??= this.explain(r).reason
        }
      }
      for (const v of old.filter((x) => x.platform === platform)) {
        if (v.state === 'ok') {
          totals = addAll(totals, v.numbers)
          videos++
        } else {
          unavailable++
          reason ??= v.reason
        }
      }
      return { platform, videos, unavailable, reason, ...totals }
    }).filter((p) => p.videos + p.unavailable > 0)
    const totals = platforms.reduce<StatsNumbers>((acc, p) => addAll(acc, p), EMPTY)
    return { brandId, range, posts: posts.size + old.length, platforms, totals }
  }

  /** Videos with numbers and a go-live time, for the best time analysis. */
  private timedVideos(brandId: number | null, platform: Platform | null): TimedVideo[] {
    const mine = this.d.db
      .prepare(
        `SELECT at, views, brand_id, platform FROM (
           SELECT COALESCE(p.scheduled_at_utc, t.posted_at_utc) AS at, p.brand_id AS brand_id, t.platform AS platform,
             (SELECT views FROM post_stats WHERE post_target_id = t.id ORDER BY id DESC LIMIT 1) AS views
           FROM post_targets t JOIN posts p ON p.id = t.post_id WHERE t.status = 'posted')
         WHERE views IS NOT NULL AND at IS NOT NULL`,
      )
      .all() as Array<{ at: string; views: number; brand_id: number; platform: Platform }>
    const old = this.d.db
      .prepare(
        `SELECT at, views, brand_id, platform FROM (
           SELECT v.published_at_utc AS at, v.brand_id AS brand_id, v.platform AS platform,
             (SELECT views FROM imported_stats WHERE imported_id = v.id ORDER BY id DESC LIMIT 1) AS views
           FROM imported_videos v)
         WHERE views IS NOT NULL AND at IS NOT NULL`,
      )
      .all() as Array<{ at: string; views: number; brand_id: number; platform: Platform }>
    return [...mine, ...old]
      .filter((r) => (!brandId || r.brand_id === brandId) && (!platform || r.platform === platform))
      .map((r) => ({ at: r.at, views: r.views, group: `${r.brand_id}:${r.platform}` }))
  }

  /** Which hours and days of the week got the most views. Raw views for one brand and platform, otherwise "times typical". */
  bestTimes(brandId: number | null, platform: Platform | null, minAgeDays = 7): BestTimes {
    return analyze(this.timedVideos(brandId, platform), {
      nowMs: this.now(),
      minAgeDays,
      relative: !(brandId && platform),
    })
  }

  recommendedSlots(brandId: number): RecommendedSlots {
    return recommendSlots(this.timedVideos(brandId, null), { nowMs: this.now(), minAgeDays: 7 })
  }
}
