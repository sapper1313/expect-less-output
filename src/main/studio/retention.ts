import { existsSync, statSync, unlinkSync } from 'fs'
import type { Db } from '../db'
import type { Library as MediaLibrary } from '../services/library'
import type { StudioConfigService } from './configService'
import type { AuditLog } from './agents/framework'
import type { EpisodeLibrary } from './library'

export interface PurgeItem {
  postId: number
  brandId: number
  title: string
  postedAtUtc: string
  files: Array<{ path: string; bytes: number; kind: 'video' | 'thumbnail' }>
}

export interface PurgeReport {
  dryRun: boolean
  cutoffUtc: string
  items: PurgeItem[]
  bytes: number
}

/**
 * The Archivist. Removes the video and the full size thumbnail of anything posted more than the retention
 * period ago. Keeps the episode package, the small preview, and a tiny stats row, forever. Stats rows are never touched.
 */
export class Archivist {
  constructor(
    private d: {
      db: Db
      cfg: StudioConfigService
      media: MediaLibrary
      episodes: EpisodeLibrary
      audit: AuditLog
      now?: () => number
    },
  ) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  purge(dryRun: boolean): PurgeReport {
    const cfg = this.d.cfg.get()
    const cutoffUtc = new Date(this.now() - cfg.retentionDays * 86_400_000).toISOString()
    const posts = this.d.db
      .prepare(
        `SELECT id, brand_id, title, video_path, scheduled_at_utc FROM posts
         WHERE status = 'posted' AND media_purged_at IS NULL AND scheduled_at_utc < ?`,
      )
      .all(cutoffUtc) as Array<{ id: number; brand_id: number; title: string; video_path: string; scheduled_at_utc: string }>
    const items: PurgeItem[] = []
    for (const p of posts) {
      const item: PurgeItem = { postId: p.id, brandId: p.brand_id, title: p.title, postedAtUtc: p.scheduled_at_utc, files: [] }
      try {
        const v = this.d.media.resolve(p.video_path)
        if (existsSync(v)) item.files.push({ path: v, bytes: statSync(v).size, kind: 'video' })
      } catch {
        // path outside the media root: leave it alone
      }
      const ep = this.d.db.prepare('SELECT id, thumb_path, video_path FROM episodes WHERE post_id = ?').get(p.id) as
        | { id: string; thumb_path: string | null; video_path: string | null }
        | undefined
      if (ep?.thumb_path && existsSync(ep.thumb_path))
        item.files.push({ path: ep.thumb_path, bytes: statSync(ep.thumb_path).size, kind: 'thumbnail' })
      if (ep?.video_path && existsSync(ep.video_path) && !item.files.some((f) => f.path === ep.video_path))
        item.files.push({ path: ep.video_path, bytes: statSync(ep.video_path).size, kind: 'video' })
      items.push(item)
    }
    const report: PurgeReport = { dryRun, cutoffUtc, items, bytes: items.reduce((n, i) => n + i.files.reduce((m, f) => m + f.bytes, 0), 0) }
    if (dryRun) return report

    const archiveStats = this.d.db.prepare(
      `INSERT OR IGNORE INTO stats_archive (brand_id, platform, post_id, episode_id, posted_at_utc, views, likes, comments, shares, archived_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const it of items) {
      const targets = this.d.db
        .prepare(
          `SELECT t.id, t.platform, t.posted_at_utc,
                  (SELECT views FROM post_stats WHERE post_target_id = t.id ORDER BY id DESC LIMIT 1) AS views,
                  (SELECT likes FROM post_stats WHERE post_target_id = t.id ORDER BY id DESC LIMIT 1) AS likes,
                  (SELECT comments FROM post_stats WHERE post_target_id = t.id ORDER BY id DESC LIMIT 1) AS comments,
                  (SELECT shares FROM post_stats WHERE post_target_id = t.id ORDER BY id DESC LIMIT 1) AS shares
           FROM post_targets t WHERE t.post_id = ?`,
        )
        .all(it.postId) as any[]
      const ep = this.d.db.prepare('SELECT id FROM episodes WHERE post_id = ?').get(it.postId) as { id: string } | undefined
      const stamp = new Date(this.now()).toISOString()
      for (const t of targets)
        archiveStats.run(it.brandId, t.platform, it.postId, ep?.id ?? null, t.posted_at_utc ?? it.postedAtUtc, t.views, t.likes, t.comments, t.shares, stamp)
      for (const f of it.files) {
        try {
          unlinkSync(f.path)
        } catch {
          // already gone
        }
      }
      this.d.db.prepare('UPDATE posts SET media_purged_at = ? WHERE id = ?').run(stamp, it.postId)
      if (ep) {
        this.d.episodes.setFields(ep.id, { mediaPurgedAt: stamp, videoPath: null, thumbPath: null })
        this.d.episodes.setStatus(ep.id, 'Archived', 'Video and full size thumbnail removed by retention.')
      }
      this.d.audit.write({
        agent: 'Archivist',
        action: 'purge',
        brandId: it.brandId,
        episodeId: ep?.id ?? null,
        detail: { postId: it.postId, deleted: it.files.map((f) => `${f.kind}:${f.path}`) },
      })
    }
    return report
  }
}
