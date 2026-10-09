import { DateTime } from 'luxon'
import { z } from 'zod'
import type { Db } from '../db'
import type { StudioConfigService } from './configService'
import type { AuditLog } from './agents/framework'
import type { LlmGateway } from './agents/llm'
import { ctxLine, STYLE_RULES } from './agents/prompts'
import type { BlueskyClient } from './social/bluesky'
import type { ThreadsClient } from './social/threads'
import type { ThumbnailTester } from './thumbTest'

export interface Insights {
  brandId: number
  videos: number
  totalViews: number
  topEpisodes: Array<{ id: string; title: string; hook: string; views: number }>
  topics: Array<{ topic: string; videos: number; avgViews: number }>
  lengths: Array<{ bucket: string; videos: number; avgViews: number }>
  postingHours: Array<{ hourEt: number; videos: number; avgViews: number }>
  thumbnailStyles: Array<{ headline: string; ctr: number }>
}

const MIN_VIDEOS = 3

export interface AnalyticsDeps {
  db: Db
  cfg: StudioConfigService
  gateway: LlmGateway
  audit: AuditLog
  threads: ThreadsClient
  bluesky: BlueskyClient
  tester: ThumbnailTester
  /** The existing stats pass for YouTube, Facebook, Instagram and TikTok. */
  refreshStats: () => Promise<{ fetched: number; unavailable: number }>
  brandName: (id: number) => string
  now?: () => number
}

const Summary = z.object({ summary: z.string().min(10) })

/**
 * Pulls numbers for every posted video each day (views, likes, comments, shares, plus click rate and watch time where the
 * platform gives them), works out what is working per brand, and gives the Writer and Thumbnail agent a short plain summary.
 * Stats rows are never deleted.
 */
export class Analytics {
  readonly name = 'Analytics'
  readonly role = 'Collects daily stats for every posted video, finds what is working for each brand, and tells the Writer and Thumbnail agent.'

  constructor(private d: AnalyticsDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  /** Stats for Threads and Bluesky posts. Mock posts get simulated numbers so insights work in mock mode. */
  async socialStats(): Promise<number> {
    const rows = this.d.db.prepare("SELECT * FROM social_posts WHERE status = 'posted' AND external_id IS NOT NULL").all() as any[]
    const ins = this.d.db.prepare('INSERT INTO social_stats (social_post_id, fetched_utc, views, likes, comments, shares) VALUES (?, ?, ?, ?, ?, ?)')
    const stamp = new Date(this.now()).toISOString()
    let n = 0
    for (const r of rows) {
      try {
        if (r.mock) {
          const base = ((r.id * 7919) % 400) + 50
          ins.run(r.id, stamp, base * 10, base, Math.round(base / 12), Math.round(base / 20))
        } else if (r.platform === 'threads') {
          const i = await this.d.threads.insights(r.external_id)
          ins.run(r.id, stamp, i.views, i.likes, i.replies, i.reposts + i.quotes)
        } else {
          const c = await this.d.bluesky.counts(r.external_id)
          ins.run(r.id, stamp, null, c.likes, c.replies, c.reposts)
        }
        n++
      } catch (e) {
        this.d.audit.write({ agent: this.name, action: 'social_stats_failed', brandId: r.brand_id, detail: { platform: r.platform, error: (e as Error).message } })
      }
    }
    return n
  }

  /** Per episode totals from the newest numbers of every platform. */
  private episodeViews(brandId: number) {
    const rows = this.d.db
      .prepare(
        `SELECT e.id, e.title, e.tags, e.slot_date, e.scheduled_at_utc, e.package_path, p.scheduled_at_utc AS post_at,
          COALESCE((SELECT SUM(v) FROM (
             SELECT (SELECT views FROM post_stats s WHERE s.post_target_id = t.id ORDER BY s.id DESC LIMIT 1) AS v FROM post_targets t WHERE t.post_id = p.id)), 0)
          + COALESCE((SELECT SUM(v) FROM (
             SELECT (SELECT views FROM social_stats s WHERE s.social_post_id = sp.id ORDER BY s.id DESC LIMIT 1) AS v FROM social_posts sp WHERE sp.episode_id = e.id)), 0) AS views
         FROM episodes e JOIN posts p ON p.id = e.post_id WHERE e.brand_id = ? AND p.status = 'posted'`,
      )
      .all(brandId) as Array<{ id: string; title: string; tags: string; post_at: string | null; views: number }>
    return rows
  }

  insights(brandId: number, details: (id: string) => { hook: string; seconds: number } = () => ({ hook: '', seconds: 0 })): Insights {
    const eps = this.episodeViews(brandId)
    const out: Insights = { brandId, videos: eps.length, totalViews: eps.reduce((n, e) => n + e.views, 0), topEpisodes: [], topics: [], lengths: [], postingHours: [], thumbnailStyles: [] }
    if (!eps.length) return out
    out.topEpisodes = [...eps].sort((a, b) => b.views - a.views).slice(0, 3).map((e) => ({ id: e.id, title: e.title, hook: details(e.id).hook, views: e.views }))
    const avg = <T>(items: T[], key: (t: T) => string, val: (t: T) => number) => {
      const m = new Map<string, number[]>()
      for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), val(i)])
      return [...m.entries()].map(([k, v]) => ({ k, n: v.length, avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }))
    }
    const tagRows = eps.flatMap((e) => e.tags.split(/\s+/).filter((t) => t && !t.startsWith('backfill:')).map((t) => ({ t, v: e.views })))
    out.topics = avg(tagRows, (r) => r.t, (r) => r.v).filter((x) => x.n >= 2).sort((a, b) => b.avg - a.avg).slice(0, 5).map((x) => ({ topic: x.k, videos: x.n, avgViews: x.avg }))
    const bucket = (s: number) => (s <= 20 ? 'up to 20 seconds' : s <= 35 ? '21 to 35 seconds' : s <= 60 ? '36 to 60 seconds' : 'over a minute')
    out.lengths = avg(eps, (e) => bucket(details(e.id).seconds), (e) => e.views).map((x) => ({ bucket: x.k, videos: x.n, avgViews: x.avg })).sort((a, b) => b.avgViews - a.avgViews)
    out.postingHours = avg(
      eps.filter((e) => e.post_at),
      (e) => String(DateTime.fromISO(e.post_at as string, { zone: 'utc' }).setZone('America/New_York').hour),
      (e) => e.views,
    )
      .filter((x) => x.n >= 1)
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 3)
      .map((x) => ({ hourEt: Number(x.k), videos: x.n, avgViews: x.avg }))
    out.thumbnailStyles = this.d.tester.winnersFor(brandId).map((w) => ({ headline: w.headline, ctr: w.ctr }))
    return out
  }

  /** Writes the plain "what is working" note for one brand. Needs at least a few videos. */
  async summarize(brandId: number, details?: (id: string) => { hook: string; seconds: number }): Promise<string> {
    const ins = this.insights(brandId, details)
    let summary = ''
    if (ins.videos >= MIN_VIDEOS) {
      const r = await this.d.gateway.json(
        {
          agent: this.name,
          brandId,
          system: `You tell a script writer what is working for "${this.d.brandName(brandId)}", from numbers. Two or three short plain sentences. Name the hooks, topics, lengths, posting hours and thumbnail styles that did best. Do not invent numbers. ${STYLE_RULES}\nAnswer only with JSON: {"summary":"..."}`,
          user: `${ctxLine({ task: 'insights', brand: this.d.brandName(brandId), videos: ins.videos })}\n${JSON.stringify(ins)}`,
          maxTokens: 500,
        },
        Summary,
      )
      summary = r.summary
    }
    this.d.db
      .prepare('INSERT INTO brand_insights (brand_id, insights_json, summary, updated_utc) VALUES (?, ?, ?, ?) ON CONFLICT(brand_id) DO UPDATE SET insights_json = excluded.insights_json, summary = excluded.summary, updated_utc = excluded.updated_utc')
      .run(brandId, JSON.stringify(ins), summary, new Date(this.now()).toISOString())
    return summary
  }

  /** The note the Writer and Thumbnail agent read. Empty until there is enough data. */
  hint(brandId: number): string[] {
    const r = this.d.db.prepare('SELECT summary FROM brand_insights WHERE brand_id = ?').get(brandId) as { summary: string } | undefined
    return r?.summary ? [r.summary] : []
  }

  stored(brandId: number): { insights: Insights | null; summary: string; updatedUtc: string | null } {
    const r = this.d.db.prepare('SELECT * FROM brand_insights WHERE brand_id = ?').get(brandId) as { insights_json: string; summary: string; updated_utc: string } | undefined
    return { insights: r ? (JSON.parse(r.insights_json) as Insights) : null, summary: r?.summary ?? '', updatedUtc: r?.updated_utc ?? null }
  }

  /** The daily pass: platform numbers, social numbers, then insights for every brand. */
  async daily(details?: (id: string) => { hook: string; seconds: number }): Promise<{ fetched: number; social: number; brands: number }> {
    const s = await this.d.refreshStats().catch(() => ({ fetched: 0, unavailable: 0 }))
    const social = await this.socialStats()
    let brands = 0
    for (const b of this.d.cfg.listBrandConfigs()) {
      await this.summarize(b.brandId, details)
      brands++
    }
    this.d.audit.write({ agent: this.name, action: 'daily', detail: { fetched: s.fetched, unavailable: s.unavailable, social, brands } })
    return { fetched: s.fetched, social, brands }
  }
}
