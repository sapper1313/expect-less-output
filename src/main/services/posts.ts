import type { Db } from '../db'
import type { Library } from './library'
import type { ActivityLog } from './activity'
import type { MediaService } from './media'
import { getNextOpenSlots, type SlotDef } from '@shared/slots'
import { derivePostStatus } from '@shared/scheduling'
import { durationProblem } from '@shared/platformLimits'
import { tiktokSettingsProblem } from '@shared/tiktok'
import { DateTime } from 'luxon'
import { ZONE } from '@shared/time'
import type {
  Post,
  PostFilter,
  PostInput,
  PostStatus,
  PostTarget,
  PostTargetInput,
  PostUpdate,
  TargetSettings,
  Platform,
  TargetStatus,
} from '@shared/types'

interface PostRow {
  id: number
  brand_id: number
  brand_name: string
  brand_color: string
  video_path: string
  video_meta_json: string
  poster_path: string | null
  title: string
  caption: string
  scheduled_at_utc: string | null
  status: PostStatus
  created_at: string
  updated_at: string
}

const POST_SELECT = `SELECT p.*, b.name AS brand_name, b.color AS brand_color
  FROM posts p JOIN brands b ON b.id = p.brand_id`

/** Statuses that reserve a slot for a brand. */
const RESERVING = ['scheduled', 'in_progress', 'partial']

export class PostService {
  constructor(
    private db: Db,
    private library: Library,
    private media: MediaService | null,
    private log: ActivityLog,
    private emit: () => void = () => {},
  ) {}

  // ---------- reading ----------

  private mapTarget(r: any): PostTarget {
    return {
      id: r.id,
      postId: r.post_id,
      platform: r.platform,
      accountId: r.account_id,
      captionOverride: r.caption_override,
      aiFlag: !!r.ai_flag,
      status: r.status,
      externalId: r.external_id,
      externalUrl: r.external_url,
      attempts: r.attempts,
      nextAttemptAtUtc: r.next_attempt_at_utc,
      lastError: r.last_error,
      handedOffAtUtc: r.handed_off_at_utc,
      postedAtUtc: r.posted_at_utc,
      progress: progressOf(r.settings_json),
      checklist: stateOf(r.settings_json).checklist ?? null,
      settings: {
        thumbOffsetMs: stateOf(r.settings_json).thumbOffsetMs,
        tiktok: stateOf(r.settings_json).tiktok,
      },
    }
  }

  private mapPost(r: PostRow, targets: PostTarget[]): Post {
    return {
      id: r.id,
      brandId: r.brand_id,
      brandName: r.brand_name,
      brandColor: r.brand_color,
      videoPath: r.video_path,
      fileName: r.video_path.split('/').pop() ?? r.video_path,
      videoMeta: safeParse(r.video_meta_json),
      posterUrl: r.poster_path ? `elo-media://poster/${r.poster_path}` : null,
      title: r.title,
      caption: r.caption,
      scheduledAtUtc: r.scheduled_at_utc,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      targets,
    }
  }

  private attachTargets(rows: PostRow[]): Post[] {
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    const targets = this.db
      .prepare(
        `SELECT * FROM post_targets WHERE post_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
      )
      .all(...ids) as any[]
    const byPost = new Map<number, PostTarget[]>()
    for (const t of targets) {
      const list = byPost.get(t.post_id) ?? []
      list.push(this.mapTarget(t))
      byPost.set(t.post_id, list)
    }
    return rows.map((r) => this.mapPost(r, byPost.get(r.id) ?? []))
  }

  get(id: number): Post | null {
    const row = this.db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(id) as PostRow | undefined
    return row ? this.attachTargets([row])[0] : null
  }

  list(filter: PostFilter = {}): Post[] {
    const where: string[] = []
    const args: unknown[] = []
    if (filter.brandId) {
      where.push('p.brand_id = ?')
      args.push(filter.brandId)
    }
    const st = filter.status
    if (st && st !== 'all') {
      if (st === 'upcoming')
        where.push("p.status IN ('scheduled','in_progress','partial','missed','draft')")
      else if (st === 'recent') where.push("p.status IN ('posted','failed','canceled')")
      else {
        where.push('p.status = ?')
        args.push(st)
      }
    }
    if (filter.platform) {
      where.push('EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = p.id AND t.platform = ?)')
      args.push(filter.platform)
    }
    if (filter.fromUtc) {
      where.push('p.scheduled_at_utc >= ?')
      args.push(filter.fromUtc)
    }
    if (filter.toUtc) {
      where.push('p.scheduled_at_utc < ?')
      args.push(filter.toUtc)
    }
    const sql = `${POST_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE WHEN p.scheduled_at_utc IS NULL THEN 1 ELSE 0 END, p.scheduled_at_utc, p.id`
    return this.attachTargets(this.db.prepare(sql).all(...args) as PostRow[])
  }

  // ---------- slots ----------

  nextSlots(brandId: number, count: number, fromUtc?: string, extraTaken: string[] = []): string[] {
    const slots = (
      this.db.prepare('SELECT * FROM brand_slots WHERE brand_id = ?').all(brandId) as any[]
    ).map<SlotDef>((r) => ({ dayType: r.day_type, timeLocal: r.time_local, enabled: !!r.enabled }))
    const taken = (
      this.db
        .prepare(
          `SELECT scheduled_at_utc AS t FROM posts WHERE brand_id = ? AND scheduled_at_utc IS NOT NULL
           AND status IN (${RESERVING.map(() => '?').join(',')})`,
        )
        .all(brandId, ...RESERVING) as Array<{ t: string }>
    ).map((r) => r.t)
    return getNextOpenSlots({
      slots,
      taken: [...taken, ...extraTaken],
      count,
      from: fromUtc ?? new Date().toISOString(),
    })
  }

  countOnDay(brandId: number, dayIso: string): number {
    const day = DateTime.fromISO(dayIso, { zone: 'utc' }).setZone(ZONE).startOf('day')
    const from = day.toUTC().toISO()!
    const to = day.plus({ days: 1 }).toUTC().toISO()!
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM posts WHERE brand_id = ? AND scheduled_at_utc >= ? AND scheduled_at_utc < ?
           AND status NOT IN ('canceled','draft')`,
        )
        .get(brandId, from, to) as { n: number }
    ).n
  }

  // ---------- writing ----------

  private brandName(brandId: number): string {
    const b = this.db.prepare('SELECT name FROM brands WHERE id = ?').get(brandId) as
      { name: string } | undefined
    if (!b) throw new Error('Brand not found.')
    return b.name
  }

  private accountFor(brandId: number, platform: Platform): number | null {
    const a = this.db
      .prepare('SELECT id FROM accounts WHERE brand_id = ? AND platform = ?')
      .get(brandId, platform) as { id: number } | undefined
    return a?.id ?? null
  }

  private insertTargets(postId: number, brandId: number, targets: PostTargetInput[]): void {
    const ins = this.db.prepare(
      `INSERT INTO post_targets (post_id, platform, account_id, caption_override, ai_flag, settings_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const seen = new Set<Platform>()
    for (const t of targets) {
      if (seen.has(t.platform)) continue
      seen.add(t.platform)
      ins.run(
        postId,
        t.platform,
        this.accountFor(brandId, t.platform),
        t.captionOverride?.trim() ? t.captionOverride : null,
        t.aiFlag ? 1 : 0,
        JSON.stringify(cleanSettings(t.settings)),
      )
    }
  }

  /** A TikTok Direct Post must carry the creator's own choices. Drafts mode does not need them. */
  private checkTikTok(
    brandId: number,
    durationSeconds: number | undefined,
    targets: PostTargetInput[],
  ): void {
    for (const t of targets) {
      if (t.platform !== 'tiktok') continue
      const acct = this.db
        .prepare('SELECT mode FROM accounts WHERE brand_id = ? AND platform = ?')
        .get(brandId, 'tiktok') as { mode: string } | undefined
      if (!acct || acct.mode !== 'direct') continue
      const problem = tiktokSettingsProblem(t.settings?.tiktok, null, durationSeconds ?? 0)
      if (problem) throw new Error(`TikTok: ${problem}`)
    }
  }

  /** Facebook and Instagram have hard length limits. Block a real account early with a clear message. */
  private checkDurations(
    brandId: number,
    durationSeconds: number | undefined,
    targets: PostTargetInput[],
  ): void {
    if (!durationSeconds) return
    for (const t of targets) {
      if (t.platform !== 'facebook' && t.platform !== 'instagram') continue
      const acct = this.db
        .prepare('SELECT mode FROM accounts WHERE brand_id = ? AND platform = ?')
        .get(brandId, t.platform) as { mode: string } | undefined
      if (!acct || acct.mode === 'dry_run') continue // dry runs only warn
      const problem = durationProblem(t.platform, durationSeconds)
      if (problem) throw new Error(problem)
    }
  }

  private validateInput(input: PostInput): void {
    if (input.targets.length === 0 && input.status === 'scheduled') {
      throw new Error('Pick at least one platform before scheduling.')
    }
    if (input.status === 'scheduled' && !input.scheduledAtUtc) {
      throw new Error('Pick a date and time before scheduling.')
    }
  }

  async createMany(inputs: PostInput[]): Promise<Post[]> {
    inputs.forEach((i) => this.validateInput(i))
    // Copy files first (cannot be part of a DB transaction), then insert everything at once.
    const prepared: Array<{ input: PostInput; rel: string; meta: string; poster: string | null }> =
      []
    try {
      for (const input of inputs) {
        const brand = this.brandName(input.brandId)
        let meta = '{}'
        let poster: string | null = null
        if (this.media) {
          const m = await this.media.probe(input.sourcePath)
          meta = JSON.stringify(m)
          this.checkDurations(input.brandId, m.durationSeconds, input.targets)
          poster = await this.media.poster(input.sourcePath, m.durationSeconds)
        }
        if (input.status === 'scheduled') {
          this.checkTikTok(
            input.brandId,
            (JSON.parse(meta) as { durationSeconds?: number }).durationSeconds,
            input.targets,
          )
        }
        const rel = this.library.importToQueue(brand, input.sourcePath)
        prepared.push({ input, rel, meta, poster })
      }
      const ids = this.db.transaction(() => {
        const out: number[] = []
        const ins = this.db.prepare(
          `INSERT INTO posts (brand_id, video_path, video_meta_json, poster_path, title, caption, scheduled_at_utc, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        for (const p of prepared) {
          const id = Number(
            ins.run(
              p.input.brandId,
              p.rel,
              p.meta,
              p.poster,
              p.input.title,
              p.input.caption,
              p.input.scheduledAtUtc,
              p.input.status,
            ).lastInsertRowid,
          )
          this.insertTargets(id, p.input.brandId, p.input.targets)
          out.push(id)
        }
        return out
      })()
      ids.forEach((id, i) =>
        this.log.log(
          'info',
          `Post created: "${prepared[i].input.title}" (${prepared[i].input.status}).`,
          {
            postId: id,
          },
        ),
      )
      this.emit()
      return ids.map((id) => this.get(id) as Post)
    } catch (err) {
      for (const p of prepared) this.library.removeIfInside(p.rel)
      throw err
    }
  }

  async create(input: PostInput): Promise<Post> {
    return (await this.createMany([input]))[0]
  }

  /** Targets already handed to a real platform (not a dry run). The platform now holds the schedule. */
  private realHandedOff(postId: number): Array<{ platform: string }> {
    return this.db
      .prepare(
        `SELECT t.platform FROM post_targets t JOIN accounts a ON a.id = t.account_id
         WHERE t.post_id = ? AND t.status IN ('handed_off','processing') AND a.mode != 'dry_run'`,
      )
      .all(postId) as Array<{ platform: string }>
  }

  update(id: number, patch: PostUpdate): Post {
    const cur = this.get(id)
    if (!cur) throw new Error('Post not found.')
    if (
      patch.scheduledAtUtc &&
      patch.scheduledAtUtc !== cur.scheduledAtUtc &&
      this.realHandedOff(id).length
    ) {
      throw new Error(
        'This post is already scheduled inside YouTube. Cancel it and delete the scheduled video in YouTube Studio first, then schedule it again.',
      )
    }
    if (['posted', 'in_progress'].includes(cur.status)) {
      throw new Error('This post is already going out. Wait for it to finish first.')
    }
    this.db.transaction(() => {
      const title = patch.title ?? cur.title
      const caption = patch.caption ?? cur.caption
      const when = patch.scheduledAtUtc !== undefined ? patch.scheduledAtUtc : cur.scheduledAtUtc
      let status: PostStatus = cur.status
      if (patch.status) status = patch.status
      else if (
        ['missed', 'failed', 'partial', 'canceled'].includes(cur.status) &&
        patch.scheduledAtUtc
      )
        status = 'scheduled'
      if (status === 'scheduled' && !when)
        throw new Error('Pick a date and time before scheduling.')
      this.db
        .prepare(
          'UPDATE posts SET title = ?, caption = ?, scheduled_at_utc = ?, status = ?, updated_at = ? WHERE id = ?',
        )
        .run(title, caption, when, status, new Date().toISOString(), id)
      if (patch.targets) {
        const keep = new Set(patch.targets.map((t) => t.platform))
        for (const t of cur.targets) {
          if (!keep.has(t.platform) && t.status !== 'posted')
            this.db.prepare('DELETE FROM post_targets WHERE id = ?').run(t.id)
        }
        const existing = new Map(cur.targets.map((t) => [t.platform, t]))
        for (const t of patch.targets) {
          const e = existing.get(t.platform)
          if (e) {
            if (e.status !== 'posted')
              this.db
                .prepare(
                  'UPDATE post_targets SET caption_override = ?, ai_flag = ?, settings_json = ? WHERE id = ?',
                )
                .run(
                  t.captionOverride?.trim() ? t.captionOverride : null,
                  t.aiFlag ? 1 : 0,
                  JSON.stringify({
                    ...stateOf(this.rawSettings(e.id)),
                    ...cleanSettings(t.settings),
                  }),
                  e.id,
                )
          } else {
            this.insertTargets(id, cur.brandId, [t])
          }
        }
      }
      // A reschedule of a missed or failed post starts it fresh.
      if (
        patch.scheduledAtUtc &&
        ['missed', 'failed', 'partial', 'canceled'].includes(cur.status)
      ) {
        this.db
          .prepare(
            `UPDATE post_targets SET status = 'pending', attempts = 0, next_attempt_at_utc = NULL, last_error = NULL,
             lock_token = NULL, locked_at_utc = NULL WHERE post_id = ? AND status IN ('failed','needs_action','pending')`,
          )
          .run(id)
      }
    })()
    this.log.log('info', 'Post edited.', { postId: id })
    this.emit()
    return this.get(id) as Post
  }

  reschedule(ids: number[], scheduledAtUtc: string): void {
    for (const id of ids) this.update(id, { scheduledAtUtc })
    this.log.log('info', `Rescheduled ${ids.length} post(s) to ${scheduledAtUtc}.`)
  }

  cancel(ids: number[]): void {
    this.db.transaction(() => {
      for (const id of ids) {
        this.db
          .prepare(
            "UPDATE posts SET status = 'canceled', updated_at = ? WHERE id = ? AND status NOT IN ('posted')",
          )
          .run(new Date().toISOString(), id)
        this.db
          .prepare(
            "UPDATE post_targets SET status = 'skipped' WHERE post_id = ? AND status IN ('pending','needs_action','failed')",
          )
          .run(id)
        this.log.log('info', 'Post canceled.', { postId: id })
        if (this.realHandedOff(id).length) {
          this.log.log(
            'warn',
            'This post was already scheduled inside YouTube. Delete the scheduled video in YouTube Studio so it does not publish.',
            { postId: id },
          )
        }
      }
    })()
    this.emit()
  }

  remove(ids: number[], alsoDeleteFile: boolean): void {
    for (const id of ids) {
      const post = this.get(id)
      if (!post) continue
      this.db.prepare('DELETE FROM posts WHERE id = ?').run(id)
      if (alsoDeleteFile) {
        try {
          this.library.deleteFile(post.videoPath)
        } catch (err) {
          this.log.log('warn', `Could not delete the video file: ${(err as Error).message}`, {
            postId: id,
          })
        }
      }
      this.log.log(
        'info',
        `Post deleted${alsoDeleteFile ? ' with its file' : ' (file kept)'}: "${post.title}".`,
      )
    }
    this.emit()
  }

  private rawSettings(targetId: number): string | null {
    return (
      (
        this.db.prepare('SELECT settings_json FROM post_targets WHERE id = ?').get(targetId) as
          { settings_json: string | null } | undefined
      )?.settings_json ?? null
    )
  }

  dismissChecklist(targetId: number): void {
    const next = { ...stateOf(this.rawSettings(targetId)) }
    delete next.checklist
    this.db
      .prepare('UPDATE post_targets SET settings_json = ? WHERE id = ?')
      .run(JSON.stringify(next), targetId)
    this.emit()
  }

  // ---------- status helpers used by the scheduler ----------

  recomputeStatus(postId: number): PostStatus {
    const row = this.db.prepare('SELECT status FROM posts WHERE id = ?').get(postId) as
      { status: PostStatus } | undefined
    if (!row) return 'draft'
    const targets = (
      this.db.prepare('SELECT status FROM post_targets WHERE post_id = ?').all(postId) as Array<{
        status: TargetStatus
      }>
    ).map((t) => t.status)
    const next = derivePostStatus(targets, row.status)
    if (next !== row.status) {
      this.db
        .prepare('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?')
        .run(next, new Date().toISOString(), postId)
    }
    return next
  }

  setPostStatus(postId: number, status: PostStatus): void {
    this.db
      .prepare('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), postId)
  }

  setVideoPath(postId: number, rel: string): void {
    this.db
      .prepare('UPDATE posts SET video_path = ?, updated_at = ? WHERE id = ?')
      .run(rel, new Date().toISOString(), postId)
  }
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

function stateOf(settingsJson: string | null): Record<string, any> {
  if (!settingsJson) return {}
  try {
    return JSON.parse(settingsJson) ?? {}
  } catch {
    return {}
  }
}

function progressOf(settingsJson: string | null): number | null {
  if (!settingsJson) return null
  try {
    const v = JSON.parse(settingsJson)?.progress
    return typeof v === 'number' ? v : null
  } catch {
    return null
  }
}

function cleanSettings(s: TargetSettings | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (s && typeof s.thumbOffsetMs === 'number' && s.thumbOffsetMs >= 0)
    out.thumbOffsetMs = Math.round(s.thumbOffsetMs)
  if (s?.tiktok) out.tiktok = s.tiktok
  return out
}
