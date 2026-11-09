import { DateTime } from 'luxon'
import type { Db } from '../db'
import { PLATFORM_LABELS, type Platform } from '@shared/platformLimits'
import type { BrandStats, StatsRange } from '@shared/types'
import type { SpendSummary } from '@shared/studio/types'

const ZONE = 'America/New_York'
const when = (iso: string) =>
  DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('ccc LLL d, h:mm a')
const num = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : n.toLocaleString('en-US')
const cut = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}...` : s)

export interface ReportBrand {
  id: number
  name: string
  paused: boolean
}

export interface ReportDeps {
  db: Db
  brands: () => ReportBrand[]
  spend: () => SpendSummary
  flagged: () => Array<{
    taskId: number
    brandName: string | null
    title: string | null
    error: string | null
  }>
  brandStats: (brandId: number | null, range: StatsRange) => BrandStats
  now?: () => number
}

interface PostedRow {
  brand_id: number
  platform: Platform
  at: string
  title: string
}

/**
 * The plain text answers for the phone commands. All of it is read straight from the app's records, so the numbers can
 * never be made up by a language model.
 */
export class TelegramReports {
  constructor(private d: ReportDeps) {}

  private now(): number {
    return this.d.now ? this.d.now() : Date.now()
  }

  /** The last post on each platform for every brand, and the next one coming. */
  last(): string {
    const rows = this.d.db
      .prepare(
        `SELECT p.brand_id AS brand_id, t.platform AS platform, t.posted_at_utc AS at, p.title AS title
         FROM post_targets t JOIN posts p ON p.id = t.post_id JOIN brands b ON b.id = p.brand_id
         LEFT JOIN accounts a ON a.id = t.account_id
         WHERE b.archived = 0 AND t.status = 'posted' AND t.posted_at_utc IS NOT NULL AND (a.mode IS NULL OR a.mode != 'dry_run')
         ORDER BY t.posted_at_utc DESC`,
      )
      .all() as PostedRow[]
    const nextRows = this.d.db
      .prepare(
        `SELECT brand_id, scheduled_at_utc AS at, title FROM posts
         WHERE status IN ('scheduled', 'in_progress') AND scheduled_at_utc >= ? ORDER BY scheduled_at_utc`,
      )
      .all(new Date(this.now()).toISOString()) as Array<{
      brand_id: number
      at: string
      title: string
    }>
    const out: string[] = []
    for (const b of this.d.brands()) {
      const mine = rows.filter((r) => r.brand_id === b.id)
      const lines = [`${b.name}${b.paused ? ' (paused)' : ''}`]
      if (mine.length === 0) lines.push('  No posts yet.')
      const seen = new Set<string>()
      for (const r of mine) {
        if (seen.has(r.platform)) continue
        seen.add(r.platform)
        lines.push(`  ${PLATFORM_LABELS[r.platform]}: ${when(r.at)}, ${cut(r.title)}`)
      }
      const next = nextRows.find((n) => n.brand_id === b.id)
      lines.push(
        next ? `  Next: ${when(next.at)}, ${cut(next.title)}` : '  Next: nothing scheduled.',
      )
      out.push(lines.join('\n'))
    }
    return out.length
      ? `Last posts (Eastern time)\n\n${out.join('\n\n')}`
      : 'There are no channels yet.'
  }

  /** Views, likes and comments for videos published in the last 7 or 30 days, per brand, plus the best video. */
  stats(days: 7 | 30 = 7): string {
    const range: StatsRange = days === 30 ? '30d' : '7d'
    const out: string[] = [`Last ${days} days (videos published in that time)`]
    for (const b of this.d.brands()) {
      const s = this.d.brandStats(b.id, range)
      if (s.posts === 0) {
        out.push(`${b.name}: no videos`)
        continue
      }
      const per = s.platforms
        .filter((p) => p.views !== null)
        .map((p) => `${PLATFORM_LABELS[p.platform]} ${num(p.views)}`)
        .join(', ')
      const missing = s.platforms
        .filter((p) => p.unavailable > 0 && p.videos === 0)
        .map((p) => PLATFORM_LABELS[p.platform])
      out.push(
        `${b.name}: ${s.posts} video${s.posts === 1 ? '' : 's'}, ${num(s.totals.views)} views, ${num(s.totals.likes)} likes, ${num(s.totals.comments)} comments${per ? `\n  Views by platform: ${per}` : ''}${missing.length ? `\n  No numbers yet: ${missing.join(', ')}` : ''}`,
      )
    }
    const total = this.d.brandStats(null, range)
    out.push(
      `All brands: ${num(total.totals.views)} views, ${num(total.totals.likes)} likes, ${num(total.totals.comments)} comments.`,
    )
    const best = this.best(days)
    if (best)
      out.push(
        `Best video: "${cut(best.title)}" (${best.brand}, ${PLATFORM_LABELS[best.platform]}) with ${num(best.views)} views.`,
      )
    return out.join('\n')
  }

  private best(
    days: number,
  ): { title: string; brand: string; platform: Platform; views: number } | null {
    const since = new Date(this.now() - days * 86_400_000).toISOString()
    const mine = this.d.db
      .prepare(
        `SELECT p.title AS title, b.name AS brand, t.platform AS platform,
           (SELECT views FROM post_stats WHERE post_target_id = t.id ORDER BY id DESC LIMIT 1) AS views
         FROM post_targets t JOIN posts p ON p.id = t.post_id JOIN brands b ON b.id = p.brand_id
         WHERE t.status = 'posted' AND b.archived = 0 AND t.posted_at_utc >= ?`,
      )
      .all(since) as Array<{
      title: string
      brand: string
      platform: Platform
      views: number | null
    }>
    const old = this.d.db
      .prepare(
        `SELECT v.title AS title, b.name AS brand, v.platform AS platform,
           (SELECT views FROM imported_stats WHERE imported_id = v.id ORDER BY id DESC LIMIT 1) AS views
         FROM imported_videos v JOIN brands b ON b.id = v.brand_id WHERE b.archived = 0 AND v.published_at_utc >= ?`,
      )
      .all(since) as Array<{
      title: string
      brand: string
      platform: Platform
      views: number | null
    }>
    const all = [...mine, ...old].filter((r) => r.views !== null) as Array<{
      title: string
      brand: string
      platform: Platform
      views: number
    }>
    return all.sort((a, b) => b.views - a.views)[0] ?? null
  }

  /** What is coming in the next 3 days, what failed in the last day, and what needs a look. */
  today(): string {
    const nowIso = new Date(this.now()).toISOString()
    const to = new Date(this.now() + 3 * 86_400_000).toISOString()
    const day = new Date(this.now() - 86_400_000).toISOString()
    const names = new Map(this.d.brands().map((b) => [b.id, b.name]))
    const up = this.d.db
      .prepare(
        `SELECT brand_id, scheduled_at_utc AS at, title FROM posts
         WHERE status IN ('scheduled', 'in_progress') AND scheduled_at_utc BETWEEN ? AND ? ORDER BY scheduled_at_utc`,
      )
      .all(nowIso, to) as Array<{ brand_id: number; at: string; title: string }>
    const bad = this.d.db
      .prepare(
        `SELECT brand_id, status, title FROM posts WHERE status IN ('failed', 'partial', 'missed') AND scheduled_at_utc >= ?`,
      )
      .all(day) as Array<{ brand_id: number; status: string; title: string }>
    const flagged = this.d.flagged()
    const lines = ['Next 3 days']
    if (up.length === 0) lines.push('  Nothing is scheduled.')
    for (const r of up.slice(0, 10))
      lines.push(`  ${when(r.at)}: ${names.get(r.brand_id) ?? 'Brand'}, ${cut(r.title, 45)}`)
    if (bad.length) {
      lines.push('', 'Needs a look (last 24 hours)')
      for (const r of bad.slice(0, 8))
        lines.push(`  ${r.status}: ${names.get(r.brand_id) ?? 'Brand'}, ${cut(r.title, 45)}`)
    }
    lines.push('', this.flagText(flagged))
    return lines.join('\n')
  }

  private flagText(f: ReturnType<ReportDeps['flagged']>): string {
    if (f.length === 0) return 'Nothing is flagged in the Studio.'
    return [
      `Flagged in the Studio: ${f.length}`,
      ...f
        .slice(0, 6)
        .map(
          (x) =>
            `  ${x.brandName ?? 'Studio'}${x.title ? `, ${cut(x.title, 40)}` : ''}: ${cut(x.error ?? 'needs a look', 90)}`,
        ),
    ].join('\n')
  }

  flags(): string {
    return this.flagText(this.d.flagged())
  }

  /** Month to date spend and every cap with what is left. */
  spend(): string {
    const s = this.d.spend()
    const lines = [`Spend this month (${s.month}): $${s.total.toFixed(2)}`]
    for (const c of s.caps) {
      lines.push(
        c.cap.none
          ? `  ${c.label}: no cap, $${c.spent.toFixed(2)} spent`
          : `  ${c.label}: $${c.spent.toFixed(2)} of $${c.cap.value.toFixed(2)}, $${(c.remaining ?? 0).toFixed(2)} left`,
      )
    }
    const top = [...s.byBrand]
      .sort((a, b) => b.dollars - a.dollars)
      .slice(0, 4)
      .filter((b) => b.dollars > 0)
    if (top.length)
      lines.push(
        '',
        'By brand: ' + top.map((b) => `${b.brandName} $${b.dollars.toFixed(2)}`).join(', '),
      )
    return lines.join('\n')
  }

  /** The brands and whether each is paused. */
  brandList(): string {
    return [
      'Brands',
      ...this.d.brands().map((b) => `  ${b.name}${b.paused ? ' (paused)' : ''}`),
    ].join('\n')
  }

  /** Finds a brand from what the owner typed. Not case sensitive, and part of the name is enough. */
  findBrand(text: string): { brand?: ReportBrand; problem?: string } {
    const q = text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const brands = this.d.brands()
    if (!q) return { problem: 'Which brand?\n' + this.brandList() }
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    const exact = brands.filter((b) => norm(b.name) === q)
    const hits = exact.length ? exact : brands.filter((b) => norm(b.name).includes(q))
    if (hits.length === 1) return { brand: hits[0] }
    if (hits.length === 0)
      return { problem: `I could not find a brand called "${text}".\n${this.brandList()}` }
    return {
      problem: `That could be ${hits.map((h) => h.name).join(' or ')}. Type more of the name.`,
    }
  }
}
