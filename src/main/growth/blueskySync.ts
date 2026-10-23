import type { Db } from '../db'
import type { SettingsService } from '../services/settings'
import type { SocialPublisher } from '../studio/social/socialPublisher'
import { blueskyOffset, morphCaption } from '@shared/growth'

/** Bluesky takes videos up to 3 minutes and 100 MB. */
export const BLUESKY_MAX_SECONDS = 180
export const BLUESKY_MAX_BYTES = 100 * 1024 * 1024

export interface BlueskySyncDeps {
  db: Db
  settings: SettingsService
  social: SocialPublisher
  /** Why a channel cannot post to Bluesky (no login), or null when it can. */
  notReady: (brandId: number) => string | null
  log: (level: 'info' | 'warn' | 'error', message: string) => void
  now?: () => number
}

interface PostRow {
  id: number
  brand_id: number
  title: string
  caption: string
  episode_ref: string | null
  scheduled_at_utc: string
  video_path: string
  video_meta_json: string | null
}

/**
 * Keeps one Bluesky post for every pipeline post on a channel that has a Bluesky login. A channel with no login is
 * ignored. The Bluesky time is the post's time plus a wait after the last other platform. It follows a reschedule, is
 * skipped when the post is taken out of the schedule, and a post that already went to Bluesky is never touched.
 */
export class BlueskySync {
  private warned = new Set<number>()

  constructor(private d: BlueskySyncDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  sync(): number {
    const s = this.d.settings.get()
    if (s.globalDryRun) return 0
    const live = this.d.db
      .prepare(
        `SELECT id, brand_id, title, caption, episode_ref, scheduled_at_utc, video_path, video_meta_json FROM posts
         WHERE origin = 'inbox' AND hold_reason IS NULL AND scheduled_at_utc IS NOT NULL
           AND status IN ('scheduled','in_progress','partial','posted') AND scheduled_at_utc >= ?`,
      )
      .all(new Date(this.now() - 6 * 3_600_000).toISOString()) as PostRow[]
    const keep = new Set<number>()
    let changed = 0
    for (const p of live) {
      if (this.d.notReady(p.brand_id)) continue
      const meta = ((): { durationSeconds?: number; sizeBytes?: number } => {
        try {
          return JSON.parse(p.video_meta_json ?? '{}')
        } catch {
          return {}
        }
      })()
      if (
        (meta.durationSeconds ?? 0) > BLUESKY_MAX_SECONDS ||
        (meta.sizeBytes ?? 0) > BLUESKY_MAX_BYTES
      ) {
        if (!this.warned.has(p.id)) {
          this.warned.add(p.id)
          this.d.log(
            'info',
            `Not sent to Bluesky: ${p.episode_ref ?? p.title} is longer than 3 minutes or bigger than 100 MB.`,
          )
        }
        continue
      }
      keep.add(p.id)
      const last = (
        this.d.db
          .prepare('SELECT MAX(stagger_offset_min) AS m FROM post_targets WHERE post_id = ?')
          .get(p.id) as { m: number | null }
      ).m
      const offset = s.staggerEnabled
        ? blueskyOffset(last ?? 0, p.id, s.staggerGapMin, s.staggerGapMax)
        : 0
      const when = new Date(new Date(p.scheduled_at_utc).getTime() + offset * 60_000).toISOString()
      const text = morphCaption('bluesky', { description: p.caption })
      const row = this.d.db
        .prepare(
          "SELECT id, status, scheduled_at_utc, text FROM social_posts WHERE post_id = ? AND platform = 'bluesky'",
        )
        .get(p.id) as
        { id: number; status: string; scheduled_at_utc: string; text: string } | undefined
      if (!row) {
        this.d.social.add({
          postId: p.id,
          episodeId: p.episode_ref,
          brandId: p.brand_id,
          platform: 'bluesky',
          text,
          videoPath: p.video_path,
          title: p.title,
          scheduledAtUtc: when,
          mock: false,
        })
        changed++
      } else if (
        ['scheduled', 'skipped'].includes(row.status) &&
        (row.status === 'skipped' || row.scheduled_at_utc !== when || row.text !== text)
      ) {
        this.d.db
          .prepare(
            "UPDATE social_posts SET status = 'scheduled', scheduled_at_utc = ?, text = ?, title = ?, next_attempt_utc = NULL WHERE id = ? AND external_id IS NULL",
          )
          .run(when, text, p.title, row.id)
        changed++
      }
    }
    // Posts that left the schedule (removed, held, back to waiting) must not go out.
    const waiting = this.d.db
      .prepare(
        "SELECT id, post_id FROM social_posts WHERE post_id IS NOT NULL AND platform = 'bluesky' AND status = 'scheduled'",
      )
      .all() as Array<{ id: number; post_id: number }>
    for (const w of waiting) {
      if (keep.has(w.post_id)) continue
      this.d.db.prepare("UPDATE social_posts SET status = 'skipped' WHERE id = ?").run(w.id)
      changed++
    }
    return changed
  }

  /** Makes sure the queue matches the schedule, then sends what is due. */
  async run(): Promise<void> {
    this.sync()
    await this.d.social.tick()
  }
}
