import type { Db } from '../db'
import type { ActivityLog } from '../services/activity'
import type { GraphClient } from '../meta/graph'
import type {
  Account,
  ImportResult,
  ImportedVideo,
  Platform,
  StatsNumbers,
  StatsRange,
} from '@shared/types'
import type { MetaStatsDeps, StatsProvider, StatsTarget } from './providers'

const DAY = 86_400_000
/** Existing videos are kept fresh daily for this long after they were published. Older ones are read once at import. */
export const IMPORTED_REFRESH_DAYS = 90
const MAX_VIDEOS = 500

export interface ListedVideo {
  externalId: string
  title: string
  url: string | null
  thumbnailUrl: string | null
  publishedAt: string | null
}

export interface VideoLister {
  list(account: Account): Promise<ListedVideo[]>
}

// ---------------- listers ----------------

export interface YoutubeListSource {
  listUploads(
    accountId: number,
    channelId: string,
    max?: number,
  ): Promise<
    Array<{ id: string; title: string; publishedAt: string | null; thumbnailUrl: string | null }>
  >
}

export class YoutubeLister implements VideoLister {
  constructor(private src: YoutubeListSource) {}
  async list(account: Account): Promise<ListedVideo[]> {
    if (!account.externalId) throw new Error('This YouTube account has no channel saved yet.')
    const items = await this.src.listUploads(account.id, account.externalId, MAX_VIDEOS)
    return items.map((v) => ({
      externalId: v.id,
      title: v.title,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      thumbnailUrl: v.thumbnailUrl,
      publishedAt: v.publishedAt,
    }))
  }
}

const fbUrl = (u: string | undefined | null) =>
  !u ? null : u.startsWith('/') ? `https://www.facebook.com${u}` : u

export class InstagramLister implements VideoLister {
  constructor(private d: MetaStatsDeps) {}
  async list(account: Account): Promise<ListedVideo[]> {
    if (!account.externalId)
      throw new Error('This Instagram account is not matched to a brand yet.')
    const token = this.d.tokenFor(account)
    const media = await (this.d.graph as GraphClient).getAll<{
      id: string
      caption?: string
      media_type?: string
      permalink?: string
      timestamp?: string
      thumbnail_url?: string
    }>(
      `/${account.externalId}/media`,
      { fields: 'id,caption,media_type,permalink,timestamp,thumbnail_url', limit: 50 },
      token,
      MAX_VIDEOS,
    )
    return media
      .filter((m) => m.media_type === 'VIDEO')
      .map((m) => ({
        externalId: m.id,
        title: (m.caption ?? '').split('\n')[0].slice(0, 120),
        url: m.permalink ?? null,
        thumbnailUrl: m.thumbnail_url ?? null,
        publishedAt: m.timestamp ? new Date(m.timestamp).toISOString() : null,
      }))
  }
}

export class FacebookLister implements VideoLister {
  constructor(private d: MetaStatsDeps) {}
  async list(account: Account): Promise<ListedVideo[]> {
    if (!account.externalId) throw new Error('This Facebook account is not matched to a Page yet.')
    const token = this.d.tokenFor(account)
    const reels = await this.d.graph.getAll<{
      id: string
      description?: string
      permalink_url?: string
      created_time?: string
    }>(
      `/${account.externalId}/video_reels`,
      { fields: 'id,description,permalink_url,created_time', limit: 50 },
      token,
      MAX_VIDEOS,
    )
    return reels.map((r) => ({
      externalId: r.id,
      title: (r.description ?? '').split('\n')[0].slice(0, 120),
      url: fbUrl(r.permalink_url),
      thumbnailUrl: null,
      publishedAt: r.created_time ? new Date(r.created_time).toISOString() : null,
    }))
  }
}

// ---------------- schedule ----------------

/** Daily for 90 days after publishing. Older videos are read once, at import. */
export function shouldRefreshImported(opts: {
  ageMs: number
  lastFetchMs: number | null
  nowMs: number
}): boolean {
  if (opts.lastFetchMs === null) return true
  if (opts.ageMs > IMPORTED_REFRESH_DAYS * DAY) return false
  return opts.nowMs - opts.lastFetchMs >= DAY
}

// ---------------- service ----------------

export interface ImportDeps {
  db: Db
  listers: Partial<Record<Platform, VideoLister>>
  providers: Partial<Record<Platform, StatsProvider>>
  log: ActivityLog
  emit?: () => void
  now?: () => number
}

interface Row {
  id: number
  brand_id: number
  platform: Platform
  account_id: number | null
  external_id: string
  published_at_utc: string | null
}

export class ImportService {
  private running = false
  constructor(private d: ImportDeps) {}

  private now(): number {
    return this.d.now ? this.d.now() : Date.now()
  }

  private accounts(brandId: number | null): Array<Account & { brandName: string }> {
    const rows = this.d.db
      .prepare(
        `SELECT a.*, b.name AS brand_name FROM accounts a JOIN brands b ON b.id = a.brand_id
         WHERE a.mode != 'dry_run' AND b.archived = 0 ${brandId ? 'AND a.brand_id = ?' : ''} ORDER BY a.brand_id, a.id`,
      )
      .all(...(brandId ? [brandId] : [])) as any[]
    return rows.map((a) => ({
      id: a.id,
      brandId: a.brand_id,
      platform: a.platform,
      displayName: a.display_name,
      avatarUrl: a.avatar_url,
      externalId: a.external_id,
      status: a.status,
      mode: a.mode,
      lastCheckedAt: a.last_checked_at,
      brandName: a.brand_name,
    }))
  }

  private account(id: number | null): Account | null {
    return id ? (this.accounts(null).find((a) => a.id === id) ?? null) : null
  }

  /** Finds the videos already on each connected channel and reads their numbers. */
  async importExisting(brandId: number | null, onlyAccountIds?: number[]): Promise<ImportResult> {
    const result: ImportResult = { found: 0, added: 0, problems: [] }
    if (this.running) return result
    this.running = true
    try {
      const at = new Date(this.now()).toISOString()
      for (const a of this.accounts(brandId)) {
        if (onlyAccountIds && !onlyAccountIds.includes(a.id)) continue
        const lister = this.d.listers[a.platform]
        if (!lister) {
          result.problems.push({
            brand: a.brandName,
            platform: a.platform,
            message:
              'Importing existing TikTok videos is not built yet. It needs the video.list permission to be approved first.',
          })
          continue
        }
        if (a.status === 'needs_reauth') {
          result.problems.push({
            brand: a.brandName,
            platform: a.platform,
            message: 'Sign in again in Setup Channels, on the Connections tab first.',
          })
          continue
        }
        try {
          const listed = await lister.list(a)
          this.markImported(a.id, at)
          result.found += listed.length
          const known = this.d.db.prepare(
            'SELECT 1 FROM post_targets WHERE platform = ? AND external_id = ?',
          )
          const insert = this.d.db.prepare(
            `INSERT OR IGNORE INTO imported_videos
               (brand_id, platform, account_id, external_id, title, url, thumbnail_url, published_at_utc, imported_at_utc)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          for (const v of listed) {
            // Videos this app posted already have their own stats.
            if (known.get(a.platform, v.externalId)) continue
            const r = insert.run(
              a.brandId,
              a.platform,
              a.id,
              v.externalId,
              v.title,
              v.url,
              v.thumbnailUrl,
              v.publishedAt,
              at,
            )
            result.added += r.changes
          }
        } catch (e) {
          result.problems.push({
            brand: a.brandName,
            platform: a.platform,
            message: (e as Error).message,
          })
        }
      }
      this.d.log.log(
        'info',
        `Imported existing videos: ${result.found} found, ${result.added} new${result.problems.length ? `, ${result.problems.length} problem(s)` : ''}.`,
      )
    } finally {
      this.running = false
    }
    await this.refresh({ brandId, force: false })
    this.d.emit?.()
    return result
  }

  private static KEY = 'imports.lastByAccount'

  private lastImports(): Record<string, string> {
    const r = this.d.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(ImportService.KEY) as { value_json: string } | undefined
    try {
      return r ? (JSON.parse(r.value_json) as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  private markImported(accountId: number, at: string): void {
    const all = { ...this.lastImports(), [String(accountId)]: at }
    this.d.db
      .prepare(
        'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
      )
      .run(ImportService.KEY, JSON.stringify(all))
  }

  /**
   * Keeps the library of existing videos current without anyone pressing a button: a newly connected account is
   * imported soon after it connects, and every connected account is looked at again once a day so videos uploaded
   * outside the app show up too.
   */
  async importDue(): Promise<ImportResult> {
    const last = this.lastImports()
    const nowMs = this.now()
    const due = this.accounts(null).filter(
      (a) =>
        this.d.listers[a.platform] &&
        a.status === 'connected' &&
        (!last[String(a.id)] || nowMs - new Date(last[String(a.id)]).getTime() >= DAY),
    )
    if (due.length === 0) return { found: 0, added: 0, problems: [] }
    const result: ImportResult = { found: 0, added: 0, problems: [] }
    for (const brandId of new Set(due.map((a) => a.brandId))) {
      const r = await this.importExisting(
        brandId,
        due.filter((a) => a.brandId === brandId).map((a) => a.id),
      )
      result.found += r.found
      result.added += r.added
      result.problems.push(...r.problems)
    }
    return result
  }

  private lastFetchMs(id: number): number | null {
    const t = this.d.db
      .prepare(
        `SELECT MAX(t) AS t FROM (
           SELECT MAX(fetched_at_utc) AS t FROM imported_stats WHERE imported_id = ?
           UNION ALL SELECT checked_at FROM imported_availability WHERE imported_id = ?)`,
      )
      .get(id, id) as { t: string | null }
    return t.t ? new Date(t.t).getTime() : null
  }

  /** Reads numbers for imported videos that are due (or all of them with force). */
  async refresh(opts: { brandId?: number | null; force?: boolean } = {}): Promise<{
    fetched: number
    unavailable: number
  }> {
    let fetched = 0
    let unavailable = 0
    const nowMs = this.now()
    const rows = this.d.db
      .prepare(
        `SELECT id, brand_id, platform, account_id, external_id, published_at_utc FROM imported_videos
         ${opts.brandId ? 'WHERE brand_id = ?' : ''} ORDER BY id`,
      )
      .all(...(opts.brandId ? [opts.brandId] : [])) as Row[]
    const due = rows.filter((r) => {
      if (opts.force) return true
      const age = r.published_at_utc ? nowMs - new Date(r.published_at_utc).getTime() : 0
      return shouldRefreshImported({ ageMs: age, lastFetchMs: this.lastFetchMs(r.id), nowMs })
    })
    for (const platform of ['youtube', 'facebook', 'instagram', 'tiktok'] as Platform[]) {
      const provider = this.d.providers[platform]
      const list = due.filter((r) => r.platform === platform)
      if (!provider || list.length === 0) continue
      const targets: StatsTarget[] = list.map((r) => ({
        targetId: r.id,
        platform,
        accountId: r.account_id,
        account: this.account(r.account_id),
        externalId: r.external_id,
        postedAt: r.published_at_utc ?? new Date(nowMs).toISOString(),
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
              'INSERT INTO imported_stats (imported_id, fetched_at_utc, views, likes, comments, shares, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
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
        this.d.log.log(
          'warn',
          `Could not read ${n} existing ${platform} video(s) just now: ${reason}`,
          {
            platform,
          },
        )
    }
    if (fetched || unavailable) this.d.emit?.()
    return { fetched, unavailable }
  }

  private setAvailability(id: number, available: boolean, reason: string | null, at: string) {
    this.d.db
      .prepare(
        `INSERT INTO imported_availability (imported_id, available, reason, checked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(imported_id) DO UPDATE SET available = excluded.available, reason = excluded.reason, checked_at = excluded.checked_at`,
      )
      .run(id, available ? 1 : 0, reason, at)
  }

  /** Imported videos with their latest numbers, newest first. */
  list(brandId: number | null, range: StatsRange): ImportedVideo[] {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : null
    const since = days ? new Date(this.now() - days * DAY).toISOString() : null
    const where: string[] = ['b.archived = 0']
    const args: unknown[] = []
    if (brandId) {
      where.push('v.brand_id = ?')
      args.push(brandId)
    }
    if (since) {
      where.push('v.published_at_utc >= ?')
      args.push(since)
    }
    const rows = this.d.db
      .prepare(
        `SELECT v.*, b.name AS brand_name,
           (SELECT available FROM imported_availability WHERE imported_id = v.id) AS av,
           (SELECT reason FROM imported_availability WHERE imported_id = v.id) AS av_reason
         FROM imported_videos v JOIN brands b ON b.id = v.brand_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY COALESCE(v.published_at_utc, v.imported_at_utc) DESC LIMIT 1000`,
      )
      .all(...args) as any[]
    return rows.map((r) => {
      const s = this.d.db
        .prepare('SELECT * FROM imported_stats WHERE imported_id = ? ORDER BY id DESC LIMIT 1')
        .get(r.id) as any
      let approximate: string[] = []
      try {
        approximate = JSON.parse(s?.extra_json ?? '{}').approximate ?? []
      } catch {
        // none
      }
      const numbers: StatsNumbers = s
        ? { views: s.views, likes: s.likes, comments: s.comments, shares: s.shares }
        : { views: null, likes: null, comments: null, shares: null }
      return {
        id: r.id,
        brandId: r.brand_id,
        brandName: r.brand_name,
        platform: r.platform,
        title: r.title,
        url: r.url,
        thumbnailUrl: r.thumbnail_url,
        publishedAt: r.published_at_utc,
        state: s ? 'ok' : r.av === 0 ? 'unavailable' : 'pending',
        reason: s ? null : r.av === 0 ? (r.av_reason ?? 'Not available.') : 'Not read yet.',
        fetchedAt: s?.fetched_at_utc ?? null,
        numbers,
        approximate,
      } satisfies ImportedVideo
    })
  }
}
