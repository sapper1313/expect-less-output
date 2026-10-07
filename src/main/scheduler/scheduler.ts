import { randomUUID } from 'crypto'
import type { Db } from '../db'
import type { ActivityLog } from '../services/activity'
import type { Library } from '../services/library'
import type { PostService } from '../services/posts'
import { AdapterError, type AdapterContext, type PlatformAdapter } from '../adapters/types'
import { backoffMs, decideMissed, handoffDueMs } from '@shared/scheduling'
import { COPY } from '@shared/copy'
import { PLATFORM_LABELS } from '@shared/platformLimits'
import type { Account, Platform, SchedulerStatus, Settings, TargetStatus } from '@shared/types'

export interface Notifier {
  failure(headline: string, detail: string): void
  success(headline: string, detail: string): void
  missed(headline: string, detail: string): void
}

export interface SchedulerDeps {
  db: Db
  posts: PostService
  library: Library
  log: ActivityLog
  getSettings: () => Settings
  /** Picks the adapter for a platform. Real YouTube accounts get the YouTube adapter, the rest dry run. */
  adapterFor: (platform: Platform, account: Account | null) => PlatformAdapter
  notifier: Notifier
  now?: () => number
  emit?: () => void
}

interface DueRow {
  id: number
  post_id: number
  platform: Platform
  account_id: number | null
  caption_override: string | null
  ai_flag: number
  status: TargetStatus
  attempts: number
  settings_json: string | null
  brand_id: number
  next_attempt_at_utc: string | null
  external_id: string | null
  scheduled_at_utc: string
  brand_name: string
  title: string
  caption: string
  video_path: string
}

const STALE_LOCK_MS = 10 * 60_000

export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private inFlight = new Set<number>()
  private active = new Set<Promise<void>>()

  constructor(private d: SchedulerDeps) {}

  private now(): number {
    return this.d.now ? this.d.now() : Date.now()
  }

  start(intervalMs = 30_000): void {
    this.recoverOnStart()
    void this.tick()
    this.timer = setInterval(() => void this.tick(), intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Called when the Mac wakes up. Runs the normal pass right away. */
  async onWake(): Promise<void> {
    this.d.log.log('info', 'Mac woke up. Checking for posts that came due.')
    await this.tick()
  }

  /** Targets left mid-flight by a crash or quit go back to the queue (or to status checks). */
  recoverOnStart(): void {
    const stuck = this.d.db
      .prepare("SELECT id, post_id, external_id FROM post_targets WHERE status = 'uploading'")
      .all() as Array<{ id: number; post_id: number; external_id: string | null }>
    for (const t of stuck) {
      const next: TargetStatus = t.external_id ? 'processing' : 'pending'
      this.d.db
        .prepare(
          'UPDATE post_targets SET status = ?, lock_token = NULL, locked_at_utc = NULL WHERE id = ?',
        )
        .run(next, t.id)
      this.d.log.log('warn', `Recovered an interrupted upload (now ${next}).`, {
        postId: t.post_id,
      })
    }
  }

  // ---------- main pass ----------

  tick(): Promise<void> {
    const p = this.doTick().finally(() => this.active.delete(p))
    this.active.add(p)
    return p
  }

  /** Resolves when every pass that is currently running has finished. */
  async idle(): Promise<void> {
    while (this.active.size) await Promise.all([...this.active])
  }

  private async doTick(): Promise<void> {
    const settings = this.d.getSettings()
    if (settings.schedulerPaused) return
    const nowMs = this.now()
    const nowIso = new Date(nowMs).toISOString()

    this.releaseStaleLocks(nowMs)
    const work: Array<Promise<void>> = []

    // 1. Pending targets that are due (or due for early handoff).
    const rows = this.d.db
      .prepare(
        `SELECT t.*, p.scheduled_at_utc, p.title, p.caption, p.video_path, p.brand_id, b.name AS brand_name
         FROM post_targets t
         JOIN posts p ON p.id = t.post_id
         JOIN brands b ON b.id = p.brand_id
         WHERE p.status IN ('scheduled','in_progress','partial')
           AND p.scheduled_at_utc IS NOT NULL
           AND t.status = 'pending' AND t.lock_token IS NULL
           AND (t.next_attempt_at_utc IS NULL OR t.next_attempt_at_utc <= ?)`,
      )
      .all(nowIso) as DueRow[]

    const missedPosts = new Set<number>()
    for (const row of rows) {
      if (missedPosts.has(row.post_id) || this.inFlight.has(row.id)) continue
      const scheduledMs = new Date(row.scheduled_at_utc).getTime()
      const account = this.loadAccount(row.account_id)
      const adapter = this.d.adapterFor(row.platform, account)
      const hours =
        row.platform === 'youtube'
          ? settings.handoffHoursYoutube
          : row.platform === 'facebook'
            ? settings.handoffHoursFacebook
            : 0
      const wantsHandoff = adapter.wantsHandoff(account) && !!adapter.handOff && hours > 0
      const handoffMs = handoffDueMs(scheduledMs, hours)

      let action: 'handoff' | 'publish' | null = null
      if (nowMs >= scheduledMs) action = 'publish'
      else if (
        wantsHandoff &&
        nowMs >= handoffMs &&
        scheduledMs - nowMs >= adapter.minHandoffLeadMs(account)
      )
        action = 'handoff'
      if (!action) continue

      // Missed check only applies to first attempts. Retries and manual retries set next_attempt.
      if (row.attempts === 0 && row.next_attempt_at_utc === null && action === 'publish') {
        const decision = decideMissed(
          scheduledMs,
          nowMs,
          settings.missedBehavior,
          settings.missedGraceMinutes,
        )
        if (decision === 'missed') {
          missedPosts.add(row.post_id)
          this.markMissed(row)
          continue
        }
        if (decision === 'post_late') {
          this.d.log.log('warn', 'Posting late because the Mac was asleep or off.', {
            postId: row.post_id,
            platform: row.platform,
          })
        }
      }
      work.push(this.run(row, action))
    }

    // 2. Handed off or processing targets: ask the platform whether they went live.
    const watch = this.d.db
      .prepare(
        `SELECT t.*, p.scheduled_at_utc, p.title, p.caption, p.video_path, p.brand_id, b.name AS brand_name
         FROM post_targets t
         JOIN posts p ON p.id = t.post_id
         JOIN brands b ON b.id = p.brand_id
         WHERE t.status IN ('handed_off','processing') AND t.lock_token IS NULL
           AND p.status IN ('scheduled','in_progress','partial','missed')
           AND p.scheduled_at_utc IS NOT NULL AND p.scheduled_at_utc <= ?`,
      )
      .all(nowIso) as DueRow[]
    for (const row of watch) {
      if (!this.inFlight.has(row.id)) work.push(this.check(row))
    }

    await Promise.all(work)
    this.d.emit?.()
  }

  private releaseStaleLocks(nowMs: number): void {
    const cutoff = new Date(nowMs - STALE_LOCK_MS).toISOString()
    const stale = this.d.db
      .prepare("SELECT id FROM post_targets WHERE status = 'uploading' AND locked_at_utc < ?")
      .all(cutoff) as Array<{ id: number }>
    for (const s of stale) {
      if (this.inFlight.has(s.id)) continue
      this.d.db
        .prepare(
          "UPDATE post_targets SET status = 'pending', lock_token = NULL, locked_at_utc = NULL WHERE id = ?",
        )
        .run(s.id)
    }
  }

  private markMissed(row: DueRow): void {
    this.d.posts.setPostStatus(row.post_id, 'missed')
    this.d.log.log('error', `Missed post: "${row.title}" for ${row.brand_name}.`, {
      postId: row.post_id,
    })
    this.d.notifier.missed(
      COPY.missedHeadline,
      `${row.brand_name}, "${row.title}" was due and the Mac was not awake in time. Open the app and reschedule or post now.`,
    )
    this.d.emit?.()
  }

  // ---------- one target ----------

  private lock(id: number, nowMs: number): string | null {
    const token = randomUUID()
    const res = this.d.db
      .prepare(
        `UPDATE post_targets SET status = 'uploading', lock_token = ?, locked_at_utc = ?, attempts = attempts + 1
         WHERE id = ? AND status = 'pending' AND lock_token IS NULL`,
      )
      .run(token, new Date(nowMs).toISOString(), id)
    return res.changes === 1 ? token : null
  }

  private loadAccount(accountId: number | null): Account | null {
    if (!accountId) return null
    const a = this.d.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as any
    if (!a) return null
    return {
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
  }

  private targetState(id: number): Record<string, unknown> {
    const r = this.d.db.prepare('SELECT settings_json FROM post_targets WHERE id = ?').get(id) as
      { settings_json: string | null } | undefined
    try {
      return r?.settings_json ? JSON.parse(r.settings_json) : {}
    } catch {
      return {}
    }
  }

  private buildContext(row: DueRow): AdapterContext {
    let lastProgressWrite = 0
    const setState = (patch: Record<string, unknown>) => {
      const next = { ...this.targetState(row.id), ...patch }
      this.d.db
        .prepare('UPDATE post_targets SET settings_json = ? WHERE id = ?')
        .run(JSON.stringify(next), row.id)
    }
    return {
      postId: row.post_id,
      targetId: row.id,
      brandId: row.brand_id,
      brandName: row.brand_name,
      title: row.title,
      caption: row.caption_override ?? row.caption,
      aiFlag: !!row.ai_flag,
      videoAbsPath: this.d.library.resolve(row.video_path),
      scheduledAtUtc: row.scheduled_at_utc,
      account: this.loadAccount(row.account_id),
      getState: () => this.targetState(row.id),
      setState,
      reportProgress: (fraction) => {
        const t = Date.now()
        if (fraction < 1 && t - lastProgressWrite < 1500) return
        lastProgressWrite = t
        setState({ progress: Math.round(fraction * 1000) / 1000 })
        this.d.emit?.()
      },
    }
  }

  private async run(row: DueRow, action: 'handoff' | 'publish'): Promise<void> {
    const token = this.lock(row.id, this.now())
    if (!token) return // someone else has it, never double post
    this.inFlight.add(row.id)
    const label = PLATFORM_LABELS[row.platform]
    try {
      const ctx = this.buildContext(row)
      const adapter = this.d.adapterFor(row.platform, ctx.account)
      if (ctx.account) await adapter.refreshIfNeeded(ctx.account)
      await adapter.validate(ctx)
      const result =
        action === 'handoff' && adapter.handOff
          ? await adapter.handOff(ctx)
          : await adapter.publish(ctx)
      const nowIso = new Date(this.now()).toISOString()
      this.d.db
        .prepare(
          `UPDATE post_targets SET status = ?, external_id = COALESCE(?, external_id), external_url = COALESCE(?, external_url),
           handed_off_at_utc = CASE WHEN ? = 'handed_off' THEN ? ELSE handed_off_at_utc END,
           posted_at_utc = CASE WHEN ? = 'posted' THEN ? ELSE posted_at_utc END,
           last_error = NULL, next_attempt_at_utc = NULL, lock_token = NULL, locked_at_utc = NULL WHERE id = ?`,
        )
        .run(
          result.status,
          result.externalId ?? null,
          result.externalUrl ?? null,
          result.status,
          nowIso,
          result.status,
          nowIso,
          row.id,
        )
      this.d.log.log(
        'info',
        `${label}: ${result.status === 'handed_off' ? 'handed off early' : result.status} for "${row.title}" (${row.brand_name}).`,
        { postId: row.post_id, platform: row.platform },
      )
      this.afterTargetChange(row.post_id)
    } catch (err) {
      this.handleFailure(row, err)
    } finally {
      this.inFlight.delete(row.id)
      this.d.emit?.()
    }
  }

  private async check(row: DueRow): Promise<void> {
    this.inFlight.add(row.id)
    try {
      const ctx = this.buildContext(row)
      const result = await this.d.adapterFor(row.platform, ctx.account).checkStatus(ctx, this.now())
      if (result.status === 'posted') {
        const nowIso = new Date(this.now()).toISOString()
        this.d.db
          .prepare(
            `UPDATE post_targets SET status = 'posted', posted_at_utc = ?, external_id = COALESCE(?, external_id),
             external_url = COALESCE(?, external_url), last_error = NULL WHERE id = ?`,
          )
          .run(nowIso, result.externalId ?? null, result.externalUrl ?? null, row.id)
        this.d.log.log('info', `${PLATFORM_LABELS[row.platform]}: went live for "${row.title}".`, {
          postId: row.post_id,
          platform: row.platform,
        })
        this.afterTargetChange(row.post_id)
      }
    } catch (err) {
      if (err instanceof AdapterError && err.kind === 'permanent') {
        this.failTarget(row, err.message, { kind: 'permanent', source: 'status check' })
      } else {
        this.d.log.log('warn', `Status check failed: ${(err as Error).message}`, {
          postId: row.post_id,
          platform: row.platform,
        })
      }
    } finally {
      this.inFlight.delete(row.id)
    }
  }

  private handleFailure(row: DueRow, err: unknown): void {
    const kind = err instanceof AdapterError ? err.kind : 'transient'
    const reason = err instanceof Error ? err.message : String(err)
    const label = PLATFORM_LABELS[row.platform]
    const t = this.d.db.prepare('SELECT attempts FROM post_targets WHERE id = ?').get(row.id) as {
      attempts: number
    }
    const delay =
      kind === 'transient' ? backoffMs(t.attempts, this.d.getSettings().fastBackoff) : null
    if (delay !== null) {
      const next = new Date(this.now() + delay).toISOString()
      this.d.db
        .prepare(
          "UPDATE post_targets SET status = 'pending', last_error = ?, next_attempt_at_utc = ?, lock_token = NULL, locked_at_utc = NULL WHERE id = ?",
        )
        .run(reason, next, row.id)
      this.d.log.log(
        'warn',
        `${label} attempt ${t.attempts} failed for "${row.title}": ${reason.replace(/\.$/, '')}. Retrying at ${next}.`,
        { postId: row.post_id, platform: row.platform, detail: { kind, attempt: t.attempts } },
      )
    } else {
      this.failTarget(row, reason, { kind, attempts: t.attempts })
      return
    }
    this.afterTargetChange(row.post_id)
  }

  private failTarget(row: DueRow, reason: string, detail: Record<string, unknown>): void {
    const label = PLATFORM_LABELS[row.platform]
    this.d.db
      .prepare(
        "UPDATE post_targets SET status = 'failed', last_error = ?, next_attempt_at_utc = NULL, lock_token = NULL, locked_at_utc = NULL WHERE id = ?",
      )
      .run(reason, row.id)
    this.d.log.log('error', `${label} failed for "${row.title}": ${reason}`, {
      postId: row.post_id,
      platform: row.platform,
      detail,
    })
    this.d.notifier.failure(
      COPY.failureHeadline,
      COPY.failureDetail(label, row.brand_name, row.title, reason),
    )
    this.afterTargetChange(row.post_id)
  }

  /** The owner finished a Manual assist post by hand. */
  markPosted(targetId: number, url?: string): void {
    const t = this.d.db
      .prepare('SELECT post_id, status, platform FROM post_targets WHERE id = ?')
      .get(targetId) as { post_id: number; status: TargetStatus; platform: Platform } | undefined
    if (!t) throw new Error('That platform entry no longer exists.')
    if (t.status !== 'needs_action')
      throw new Error('Only a post waiting for you can be marked as posted.')
    const link = url?.trim() || null
    if (link && !/^https?:\/\//i.test(link))
      throw new Error('The video link must start with http:// or https://')
    this.d.db
      .prepare(
        "UPDATE post_targets SET status = 'posted', posted_at_utc = ?, external_url = COALESCE(?, external_url), last_error = NULL WHERE id = ?",
      )
      .run(new Date(this.now()).toISOString(), link, targetId)
    this.d.log.log('info', `${PLATFORM_LABELS[t.platform]} marked as posted by hand.`, {
      postId: t.post_id,
      platform: t.platform,
    })
    this.afterTargetChange(t.post_id)
    this.d.emit?.()
  }

  /** Recomputes the post status and moves the file once every target succeeded. */
  private afterTargetChange(postId: number): void {
    const status = this.d.posts.recomputeStatus(postId)
    if (status !== 'posted') return
    const post = this.d.posts.get(postId)
    if (!post) return
    try {
      const rel = this.d.library.moveToPosted(post.videoPath, post.brandName, new Date(this.now()))
      if (rel !== post.videoPath) {
        this.d.posts.setVideoPath(postId, rel)
        this.d.log.log('info', `Moved video to ${rel}.`, { postId })
      }
    } catch (err) {
      this.d.log.log('warn', `Posted, but the file could not be moved: ${(err as Error).message}`, {
        postId,
      })
    }
    this.d.notifier.success(COPY.success, `${post.brandName}: "${post.title}"`)
  }

  // ---------- user actions ----------

  retryTarget(targetId: number): void {
    const t = this.d.db
      .prepare('SELECT post_id, status FROM post_targets WHERE id = ?')
      .get(targetId) as { post_id: number; status: TargetStatus } | undefined
    if (!t) throw new Error('That platform entry no longer exists.')
    if (!['failed', 'needs_action'].includes(t.status)) return
    this.d.db
      .prepare(
        `UPDATE post_targets SET status = 'pending', attempts = 0, last_error = NULL, lock_token = NULL,
         locked_at_utc = NULL, next_attempt_at_utc = ? WHERE id = ?`,
      )
      .run(new Date(this.now()).toISOString(), targetId)
    const post = this.d.posts.get(t.post_id)
    if (post && ['failed', 'partial'].includes(post.status))
      this.d.posts.setPostStatus(t.post_id, 'scheduled')
    this.d.posts.recomputeStatus(t.post_id)
    this.d.log.log('info', 'Retry requested.', { postId: t.post_id })
    this.d.emit?.()
    void this.tick()
  }

  postNow(postId: number): void {
    this.d.posts.update(postId, {
      scheduledAtUtc: new Date(this.now()).toISOString(),
      status: 'scheduled',
    })
    this.d.db
      .prepare(
        "UPDATE post_targets SET next_attempt_at_utc = ? WHERE post_id = ? AND status = 'pending'",
      )
      .run(new Date(this.now()).toISOString(), postId)
    void this.tick()
  }

  // ---------- reporting ----------

  /** True when anything is due within the next N minutes, so the Mac should stay awake. */
  hasDueWithin(minutes: number): boolean {
    const until = new Date(this.now() + minutes * 60_000).toISOString()
    const n = (
      this.d.db
        .prepare(
          `SELECT COUNT(*) AS n FROM post_targets t JOIN posts p ON p.id = t.post_id
           WHERE p.status IN ('scheduled','in_progress','partial') AND p.scheduled_at_utc <= ?
             AND t.status IN ('pending','uploading','handed_off','processing')`,
        )
        .get(until) as { n: number }
    ).n
    return n > 0
  }

  status(): SchedulerStatus {
    const paused = this.d.getSettings().schedulerPaused
    const next = this.d.db
      .prepare(
        `SELECT p.id, p.title, p.scheduled_at_utc, b.name AS brand_name FROM posts p JOIN brands b ON b.id = p.brand_id
         WHERE p.status IN ('scheduled','in_progress','partial') AND p.scheduled_at_utc IS NOT NULL
         ORDER BY p.scheduled_at_utc LIMIT 1`,
      )
      .get() as any
    const pending = (
      this.d.db
        .prepare(
          "SELECT COUNT(*) AS n FROM posts WHERE status IN ('scheduled','in_progress','partial')",
        )
        .get() as { n: number }
    ).n
    return {
      paused,
      running: this.timer !== null,
      pendingCount: pending,
      nextPost: next
        ? {
            postId: next.id,
            brandName: next.brand_name,
            title: next.title,
            whenUtc: next.scheduled_at_utc,
          }
        : null,
    }
  }
}
