import { existsSync } from 'fs'
import type { Db } from '../db'
import type { Platform, Post, PostInput } from '@shared/types'
import type { RepostCandidate } from '@shared/studio/research'

export interface RepostDeps {
  db: Db
  resolve: (relative: string) => string
  createPost: (input: PostInput) => Promise<Post>
  nextSlot: (brandId: number) => string | null
  views: (postId: number) => number | null
  brandName: (id: number) => string
  minAgeDays: () => number
  now?: () => number
}

/** The best older videos that can go out again, on the platforms where a repeat does not hurt. */
export class RepostQueue {
  constructor(private d: RepostDeps) {}
  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  candidates(brandId?: number | null): RepostCandidate[] {
    const before = new Date(this.now() - this.d.minAgeDays() * 86_400_000).toISOString()
    const rows = this.d.db
      .prepare(
        `SELECT p.id, p.brand_id, p.title, p.video_path, p.scheduled_at_utc FROM posts p
         WHERE p.status = 'posted' AND p.media_purged_at IS NULL AND p.scheduled_at_utc < ? ${brandId ? 'AND p.brand_id = ?' : ''}
           AND p.id NOT IN (SELECT source_post_id FROM repost_items)
           AND NOT EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = p.id AND t.settings_json LIKE '%"mock":true%')
         ORDER BY p.id DESC LIMIT 200`,
      )
      .all(...(brandId ? [before, brandId] : [before])) as Array<{ id: number; brand_id: number; title: string; video_path: string; scheduled_at_utc: string | null }>
    const out: RepostCandidate[] = []
    for (const r of rows) {
      if (!existsSync(this.d.resolve(r.video_path))) continue
      const platforms = (this.d.db.prepare("SELECT platform FROM post_targets WHERE post_id = ? AND status = 'posted'").all(r.id) as Array<{ platform: string }>).map((x) => x.platform)
      if (!platforms.length) continue
      out.push({ postId: r.id, brandId: r.brand_id, brandName: this.d.brandName(r.brand_id), title: r.title, postedUtc: r.scheduled_at_utc, views: this.d.views(r.id), platforms, note: platforms.includes('youtube') ? 'A repeat on YouTube can look like spam, so it is off by default there.' : null })
    }
    return out.sort((a, b) => (b.views ?? -1) - (a.views ?? -1)).slice(0, 10)
  }

  async queue(postId: number, platforms: string[]): Promise<{ newPostId: number; whenUtc: string | null }> {
    const src = this.d.db.prepare("SELECT brand_id, title, caption, video_path, status FROM posts WHERE id = ?").get(postId) as { brand_id: number; title: string; caption: string; video_path: string; status: string } | undefined
    if (!src || src.status !== 'posted') throw new Error('Only a video that has already been posted can go out again.')
    const file = this.d.resolve(src.video_path)
    if (!existsSync(file)) throw new Error('The video file is gone, so it cannot be posted again.')
    const old = this.d.db.prepare("SELECT platform, ai_flag, caption_override FROM post_targets WHERE post_id = ? AND status = 'posted'").all(postId) as Array<{ platform: Platform; ai_flag: number; caption_override: string | null }>
    const chosen = old.filter((t) => platforms.includes(t.platform))
    if (!chosen.length) throw new Error('Pick at least one platform that it was posted to the first time.')
    const when = this.d.nextSlot(src.brand_id)
    const post = await this.d.createPost({
      brandId: src.brand_id,
      sourcePath: file,
      title: src.title,
      caption: src.caption,
      scheduledAtUtc: when,
      status: when ? 'scheduled' : 'draft',
      targets: chosen.map((t) => ({ platform: t.platform, aiFlag: !!t.ai_flag, captionOverride: t.caption_override })),
    })
    this.d.db.prepare("INSERT INTO repost_items (source_post_id, brand_id, platforms, status, new_post_id, created_utc) VALUES (?, ?, ?, 'scheduled', ?, ?)").run(postId, src.brand_id, chosen.map((t) => t.platform).join(','), post.id, new Date(this.now()).toISOString())
    return { newPostId: post.id, whenUtc: when }
  }

  skip(postId: number): void {
    const src = this.d.db.prepare('SELECT brand_id FROM posts WHERE id = ?').get(postId) as { brand_id: number } | undefined
    if (!src) return
    this.d.db.prepare("INSERT INTO repost_items (source_post_id, brand_id, platforms, status, created_utc) VALUES (?, ?, '', 'skipped', ?)").run(postId, src.brand_id, new Date(this.now()).toISOString())
  }
}
