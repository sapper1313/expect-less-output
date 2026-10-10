import type { Db } from '../db'
import type { RetentionView } from '@shared/studio/research'
import type { RetentionData } from './youtubeAnalytics'

export interface RetentionDeps {
  db: Db
  read: (accountId: number, videoId: string, fromDate: string, toDate: string) => Promise<RetentionData>
  mock: () => boolean
  now?: () => number
}

/** Watch time and the retention curve for posted YouTube videos, kept so they can be looked at later. */
export class RetentionService {
  constructor(private d: RetentionDeps) {}
  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  get(postId: number): RetentionView | null {
    const r = this.d.db.prepare("SELECT * FROM video_retention WHERE post_id = ? AND platform = 'youtube'").get(postId) as { post_id: number; platform: string; video_id: string; fetched_utc: string; minutes_watched: number | null; avg_view_seconds: number | null; avg_view_percent: number | null; curve_json: string } | undefined
    return r ? { postId: r.post_id, platform: r.platform, videoId: r.video_id, fetchedUtc: r.fetched_utc, minutesWatched: r.minutes_watched, avgViewSeconds: r.avg_view_seconds, avgViewPercent: r.avg_view_percent, curve: JSON.parse(r.curve_json) } : null
  }

  async refresh(postId: number): Promise<RetentionView> {
    const t = this.d.db
      .prepare("SELECT t.external_id, t.account_id, t.posted_at_utc, t.settings_json, a.mode AS mode FROM post_targets t LEFT JOIN accounts a ON a.id = t.account_id WHERE t.post_id = ? AND t.platform = 'youtube' AND t.status = 'posted'")
      .get(postId) as { external_id: string | null; account_id: number | null; posted_at_utc: string | null; settings_json: string | null; mode: string | null } | undefined
    if (!t?.external_id) throw new Error('This post is not on YouTube yet, so there is no watch time to read.')
    const fake = (() => {
      try {
        return (JSON.parse(t.settings_json ?? '{}') as { mock?: boolean }).mock === true
      } catch {
        return false
      }
    })()
    const offline = this.d.mock() || fake || t.account_id === null || t.mode === 'dry_run'
    const from = (t.posted_at_utc ?? new Date(this.now() - 30 * 86_400_000).toISOString()).slice(0, 10)
    const to = new Date(this.now()).toISOString().slice(0, 10)
    const data: RetentionData = offline
      ? { minutesWatched: 412, avgViewSeconds: 38, avgViewPercent: 61, curve: Array.from({ length: 21 }, (_, i) => ({ t: i / 20, watch: Math.max(0.08, 1 - 0.045 * i - (i > 14 ? 0.1 : 0)) })) }
      : await this.d.read(t.account_id as number, t.external_id, from, to)
    this.d.db
      .prepare(
        `INSERT INTO video_retention (post_id, platform, video_id, fetched_utc, minutes_watched, avg_view_seconds, avg_view_percent, curve_json) VALUES (?, 'youtube', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(post_id, platform) DO UPDATE SET fetched_utc = excluded.fetched_utc, minutes_watched = excluded.minutes_watched, avg_view_seconds = excluded.avg_view_seconds, avg_view_percent = excluded.avg_view_percent, curve_json = excluded.curve_json`,
      )
      .run(postId, t.external_id, new Date(this.now()).toISOString(), data.minutesWatched, data.avgViewSeconds, data.avgViewPercent, JSON.stringify(data.curve))
    return this.get(postId) as RetentionView
  }

  /** The newest posted YouTube videos, refreshed one after another. Failures do not stop the rest. */
  async refreshRecent(limit = 12): Promise<number> {
    const rows = this.d.db
      .prepare("SELECT DISTINCT t.post_id FROM post_targets t JOIN posts p ON p.id = t.post_id WHERE t.platform = 'youtube' AND t.status = 'posted' AND t.external_id IS NOT NULL ORDER BY t.post_id DESC LIMIT ?")
      .all(limit) as Array<{ post_id: number }>
    let n = 0
    for (const r of rows) {
      try {
        await this.refresh(r.post_id)
        n++
      } catch {
        // One video that cannot be read does not stop the others.
      }
    }
    return n
  }
}
