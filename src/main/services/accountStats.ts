import type { Db } from '../db'
import type { ActivityLog } from './activity'
import type { UploadPostService } from './uploadPost'
import { explainProblem } from './engage'
import type { UploadPostClient } from '../uploadpost/client'
import { PLATFORM_LABELS } from '@shared/platformLimits'
import type { Platform } from '@shared/types'
import type {
  AccountAudience,
  AccountStatRow,
  AccountStatsView,
  AccountSyncResult,
  ChannelTotals,
  HomeAccountTotals,
} from '@shared/engage'

/** Platforms Upload-Post answers account numbers for. LinkedIn needs a company page id, which ELO does not have. */
const ANALYTICS = ['instagram', 'tiktok', 'facebook', 'youtube', 'x', 'threads', 'pinterest', 'bluesky']
const HOUR = 3_600_000
const DAY = 86_400_000

const eastern = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

/** Every plain number in an answer. Lists (like the reach per day) are handled separately. */
export function flatNumbers(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}

/** Watch time in minutes when the platform gave a number for it. */
export function watchMinutesOf(numbers: Record<string, number>): number | null {
  for (const [k, v] of Object.entries(numbers)) {
    if (/avg|average|per_?view|duration/i.test(k)) continue
    if (/watch/i.test(k)) return /hour/i.test(k) ? v * 60 : /second/i.test(k) ? v / 60 : v
  }
  return null
}

type Client = Pick<UploadPostClient, 'analytics' | 'audience'>

/** Reads account numbers (followers, views, impressions and more) for every ticked platform and keeps a daily history. */
export class AccountStatsService {
  private running = false
  constructor(
    private d: { db: Db; uploadPost: UploadPostService; client: Client; log: ActivityLog; emit?: () => void; now?: () => number },
  ) {}

  private now(): number {
    return (this.d.now ?? Date.now)()
  }

  private brandsWithTicks(): Array<{ id: number; name: string; user: string; platforms: string[] }> {
    const brands = this.d.db.prepare('SELECT id, name FROM brands WHERE archived = 0 ORDER BY id').all() as Array<{ id: number; name: string }>
    const out: Array<{ id: number; name: string; user: string; platforms: string[] }> = []
    for (const b of brands) {
      const link = this.d.uploadPost.state().links.find((l) => l.brandId === b.id)
      if (!link?.profile) continue
      const platforms = Object.entries(link.platforms).filter(([, on]) => on).map(([k]) => k)
      if (platforms.length) out.push({ id: b.id, name: b.name, user: link.profile, platforms })
    }
    return out
  }

  /** Reads the numbers. Without force, a channel read in the last 55 minutes is left alone. */
  async sync(opts: { force?: boolean } = {}): Promise<AccountSyncResult> {
    const result: AccountSyncResult = { channels: 0, platforms: 0, problems: [] }
    const key = this.d.uploadPost.apiKey()
    if (!key || this.running) return result
    this.running = true
    try {
      const now = this.now()
      const day = eastern(now)
      for (const b of this.brandsWithTicks()) {
        const asked = b.platforms.filter((p) => ANALYTICS.includes(p))
        if (!asked.length) continue
        const last = this.d.db
          .prepare('SELECT MAX(fetched_at_utc) AS t FROM up_account_stats WHERE brand_id = ?')
          .get(b.id) as { t: string | null }
        if (!opts.force && last.t && now - Date.parse(last.t) < 55 * 60_000) continue
        const pageId = (
          this.d.db.prepare("SELECT external_id FROM accounts WHERE brand_id = ? AND platform = 'facebook'").get(b.id) as
            | { external_id: string | null }
            | undefined
        )?.external_id
        const fbMissing = asked.includes('facebook') && !pageId
        const list = asked.filter((p) => !(p === 'facebook' && fbMissing))
        const put = this.d.db.prepare(
          `INSERT INTO up_account_stats (brand_id, platform, day, fetched_at_utc, metrics_json, error) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(brand_id, platform, day) DO UPDATE SET fetched_at_utc = excluded.fetched_at_utc,
             metrics_json = excluded.metrics_json, error = excluded.error`,
        )
        result.channels++
        if (fbMissing) result.problems.push(`${b.name}: Facebook has no page id in ELO.`)
        try {
          const res = await this.d.client.analytics(key, b.user, list, { pageId: pageId ?? undefined })
          for (const p of list) {
            const v = res[p]
            const label = PLATFORM_LABELS[p as Platform] ?? p
            if (!v || typeof v !== 'object' || typeof (v as { error?: unknown }).error === 'string') {
              const why = typeof v?.error === 'string' ? v.error : 'Upload-Post sent nothing for this platform.'
              put.run(b.id, p, day, new Date(now).toISOString(), '{}', why)
              result.problems.push(`${b.name}, ${label}: ${why}`)
              continue
            }
            const series = Array.isArray((v as any).reach_timeseries) ? (v as any).reach_timeseries : []
            put.run(b.id, p, day, new Date(now).toISOString(), JSON.stringify({ numbers: flatNumbers(v as Record<string, unknown>), series }), null)
            result.platforms++
          }
        } catch (err) {
          const why = explainProblem(err, 'Upload-Post')
          for (const p of list) put.run(b.id, p, day, new Date(now).toISOString(), '{}', why)
          result.problems.push(`${b.name}: ${why}`)
        }
        if (b.platforms.includes('tiktok')) await this.readAudience(key, b, now)
      }
      if (result.platforms) this.d.emit?.()
      return result
    } finally {
      this.running = false
    }
  }

  private async readAudience(key: string, b: { id: number; user: string }, now: number): Promise<void> {
    const have = this.d.db.prepare("SELECT fetched_at_utc AS t FROM up_audience WHERE brand_id = ? AND platform = 'tiktok'").get(b.id) as { t: string } | undefined
    if (have && now - Date.parse(have.t) < 6 * HOUR) return
    try {
      const a = await this.d.client.audience(key, b.user, 'tiktok')
      this.d.db
        .prepare(
          `INSERT INTO up_audience (brand_id, platform, fetched_at_utc, json) VALUES (?, 'tiktok', ?, ?)
           ON CONFLICT(brand_id, platform) DO UPDATE SET fetched_at_utc = excluded.fetched_at_utc, json = excluded.json`,
        )
        .run(b.id, new Date(now).toISOString(), JSON.stringify(a))
    } catch {
      // The audience is a bonus. A TikTok that cannot give it (not reconnected) just has none.
    }
  }

  rows(): AccountStatRow[] {
    const brands = new Map(
      (this.d.db.prepare('SELECT id, name, color FROM brands').all() as Array<{ id: number; name: string; color: string }>).map((b) => [b.id, b]),
    )
    const all = this.d.db
      .prepare('SELECT * FROM up_account_stats ORDER BY brand_id, platform, day DESC')
      .all() as Array<{ brand_id: number; platform: string; day: string; fetched_at_utc: string; metrics_json: string; error: string | null }>
    const byKey = new Map<string, typeof all>()
    for (const r of all) {
      const k = `${r.brand_id}|${r.platform}`
      byKey.set(k, [...(byKey.get(k) ?? []), r])
    }
    const cutoff = eastern(this.now() - 6 * DAY)
    const out: AccountStatRow[] = []
    for (const list of byKey.values()) {
      const latest = list[0]!
      const b = brands.get(latest.brand_id)
      if (!b) continue
      const parse = (t: string) => {
        try {
          return JSON.parse(t) as { numbers?: Record<string, number>; series?: Array<{ date: string; value: number }> }
        } catch {
          return {}
        }
      }
      const cur = parse(latest.metrics_json)
      const olderRow = list.find((r) => r.day <= cutoff && !r.error)
      const numbers = cur.numbers ?? {}
      out.push({
        brandId: latest.brand_id,
        brandName: b.name,
        brandColor: b.color,
        platform: latest.platform,
        fetchedAtUtc: latest.fetched_at_utc,
        numbers,
        before: olderRow ? (parse(olderRow.metrics_json).numbers ?? null) : null,
        watchMinutes: watchMinutesOf(numbers),
        series: cur.series ?? [],
        error: latest.error,
      })
    }
    return out.sort((a, b) => a.brandName.localeCompare(b.brandName) || a.platform.localeCompare(b.platform))
  }

  audience(): AccountAudience[] {
    const rows = this.d.db
      .prepare('SELECT a.*, b.name FROM up_audience a JOIN brands b ON b.id = a.brand_id ORDER BY b.id')
      .all() as Array<{ brand_id: number; platform: string; fetched_at_utc: string; json: string; name: string }>
    return rows.flatMap((r) => {
      try {
        return [{ brandId: r.brand_id, brandName: r.name, platform: r.platform, fetchedAtUtc: r.fetched_at_utc, data: JSON.parse(r.json) }]
      } catch {
        return []
      }
    })
  }

  view(): AccountStatsView {
    return { rows: this.rows(), audience: this.audience(), nothingTicked: this.brandsWithTicks().length === 0 }
  }

  /** The Home widget: every platform of a channel added together. */
  homeTotals(): HomeAccountTotals | null {
    const rows = this.rows().filter((r) => !r.error)
    if (!rows.length) return null
    const add = (list: Array<number | null | undefined>): number | null => {
      const v = list.filter((x): x is number => typeof x === 'number')
      return v.length ? v.reduce((a, b) => a + b, 0) : null
    }
    const youtubeWatch = (brandId: number): number | null => {
      try {
        const r = this.d.db
          .prepare("SELECT SUM(r.minutes_watched) AS m FROM video_retention r JOIN posts p ON p.id = r.post_id WHERE p.brand_id = ? AND r.platform = 'youtube'")
          .get(brandId) as { m: number | null }
        return r.m !== null ? Math.round((r.m / 60) * 10) / 10 : null
      } catch {
        return null
      }
    }
    const make = (rs: AccountStatRow[]): Omit<ChannelTotals, 'id' | 'name' | 'color' | 'platforms'> => {
      const watch = add(rs.map((r) => r.watchMinutes))
      return {
        followers: add(rs.map((r) => r.numbers.followers)),
        views: add(rs.map((r) => r.numbers.views ?? r.numbers.impressions)),
        likes: add(rs.map((r) => r.numbers.likes)),
        shares: add(rs.map((r) => r.numbers.shares)),
        comments: add(rs.map((r) => r.numbers.comments)),
        impressions: add(rs.map((r) => r.numbers.impressions ?? r.numbers.views)),
        watchHours: watch !== null ? Math.round((watch / 60) * 10) / 10 : null,
      }
    }
    const ids = [...new Set(rows.map((r) => r.brandId))]
    const channels: ChannelTotals[] = ids.map((id) => {
      const rs = rows.filter((r) => r.brandId === id)
      const t = make(rs)
      return {
        id,
        name: rs[0]!.brandName,
        color: rs[0]!.brandColor,
        platforms: rs.map((r) => r.platform),
        ...t,
        watchHours: t.watchHours ?? youtubeWatch(id),
      }
    })
    const total = {
      followers: add(channels.map((c) => c.followers)),
      views: add(channels.map((c) => c.views)),
      likes: add(channels.map((c) => c.likes)),
      shares: add(channels.map((c) => c.shares)),
      comments: add(channels.map((c) => c.comments)),
      impressions: add(channels.map((c) => c.impressions)),
      watchHours: add(channels.map((c) => c.watchHours)),
    }
    const latest = rows.map((r) => r.fetchedAtUtc).sort().pop() ?? null
    return { updatedAt: latest, channels, total }
  }
}
