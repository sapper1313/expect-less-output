import { existsSync, statSync } from 'fs'
import { DateTime } from 'luxon'
import type { Db } from '../db'
import type { Library } from '../services/library'
import type { PostService } from '../services/posts'
import type { SettingsService } from '../services/settings'
import { ZONE } from '@shared/time'
import { channelState } from './state'
import { realPlatforms, sha256File } from './verify'

export type IssueKind =
  | 'double_booking'
  | 'over_cap'
  | 'invalid_slot'
  | 'orphan_post'
  | 'open_slot_mismatch'
  | 'file_drift'
  | 'waiting_too_long'
  | 'stuck_upload'
  | 'low_queue'
  | 'missed_slot'
  | 'channel_state'
  | 'upcoming'

export interface FoundIssue {
  key: string
  kind: IssueKind
  brandId: number | null
  postId: number | null
  detail: string
}

export interface ReconcileIssue extends FoundIssue {
  id: number
  firstSeen: string
  lastSeen: string
  resolvedAt: string | null
}

export interface ReconcileDeps {
  db: Db
  posts: PostService
  library: Library
  settings: SettingsService
  /** One message for a newly found issue. */
  notify: (kind: 'reconcile' | 'low_queue', headline: string, detail: string) => void
  /** Moves a post to a new slot (used by auto-fix only). */
  reschedule?: (postId: number, slotUtc: string) => void
  /** Checks that belong to other parts, for example the Upcoming list. */
  extra?: Array<() => FoundIssue[]>
  now?: () => number
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
  onChange?: () => void
}

const RESERVING = "('scheduled','in_progress','partial')"
const WAIT_TOO_LONG_DAYS = 7
const STALE_UPLOAD_MS = 30 * 60_000

interface PostRow {
  id: number
  brand_id: number
  title: string
  video_path: string
  scheduled_at_utc: string | null
  status: string
  checksum: string | null
  episode_ref: string | null
  origin: string
  post_type: 'episode' | 'clip'
  created_at: string
  hold_reason: string | null
}

/**
 * Looks for things that do not add up between slots, the calendar and the queue, and reports them. It never deletes
 * anything. With "auto fix" on it may move a second pipeline post that sits in the same slot as another to the next open
 * slot, which is the one case that has a single clear answer.
 */
export class Reconciler {
  private hashed = new Map<string, { size: number; mtime: number; ok: boolean }>()
  private running = false

  constructor(private d: ReconcileDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  /** Runs every check, records what is new, marks what went away, and returns the open issues. */
  async run(): Promise<ReconcileIssue[]> {
    if (this.running) return this.open()
    this.running = true
    try {
      const found: FoundIssue[] = []
      found.push(...this.bookings())
      found.push(...this.slots())
      found.push(...this.orphans())
      found.push(...this.openSlotGuard())
      found.push(...(await this.files()))
      found.push(...this.waiting())
      found.push(...this.uploads())
      found.push(...this.lowQueue())
      found.push(...this.missed())
      found.push(...this.stateConflicts())
      for (const x of this.d.extra ?? []) found.push(...x())
      const fixed = this.d.settings.get().reconcileAutoFix ? this.autoFix(found) : new Set<string>()
      this.record(found.filter((f) => !fixed.has(f.key)))
      return this.open()
    } finally {
      this.running = false
    }
  }

  open(): ReconcileIssue[] {
    return (
      this.d.db
        .prepare('SELECT * FROM reconcile_issues WHERE resolved_at IS NULL ORDER BY id DESC')
        .all() as any[]
    ).map((r) => ({
      id: r.id,
      key: r.issue_key,
      kind: r.kind,
      brandId: r.brand_id,
      postId: r.post_id,
      detail: r.detail,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      resolvedAt: r.resolved_at,
    }))
  }

  private record(found: FoundIssue[]): void {
    const nowIso = new Date(this.now()).toISOString()
    const keys = new Set(found.map((f) => f.key))
    const db = this.d.db
    for (const f of found) {
      const ex = db
        .prepare('SELECT id, resolved_at, notified FROM reconcile_issues WHERE issue_key = ?')
        .get(f.key) as { id: number; resolved_at: string | null; notified: number } | undefined
      if (!ex) {
        db.prepare(
          'INSERT INTO reconcile_issues (issue_key, kind, brand_id, post_id, detail, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(f.key, f.kind, f.brandId, f.postId, f.detail, nowIso, nowIso)
      } else {
        // A problem that came back is a new problem and is told again.
        db.prepare(
          'UPDATE reconcile_issues SET detail = ?, last_seen = ?, resolved_at = NULL, notified = ? WHERE id = ?',
        ).run(f.detail, nowIso, ex.resolved_at ? 0 : ex.notified, ex.id)
      }
    }
    for (const r of db
      .prepare('SELECT id, issue_key FROM reconcile_issues WHERE resolved_at IS NULL')
      .all() as Array<{
      id: number
      issue_key: string
    }>)
      if (!keys.has(r.issue_key))
        db.prepare('UPDATE reconcile_issues SET resolved_at = ? WHERE id = ?').run(nowIso, r.id)
    const fresh = db
      .prepare('SELECT * FROM reconcile_issues WHERE resolved_at IS NULL AND notified = 0')
      .all() as any[]
    for (const r of fresh) {
      this.d.notify(
        r.kind === 'low_queue' ? 'low_queue' : 'reconcile',
        r.kind === 'low_queue'
          ? 'A channel is running low.'
          : 'ELO found something that does not add up.',
        r.detail,
      )
      db.prepare('UPDATE reconcile_issues SET notified = 1 WHERE id = ?').run(r.id)
    }
    if (fresh.length) this.d.onChange?.()
  }

  private brandName(id: number): string {
    return (
      (
        this.d.db.prepare('SELECT name FROM brands WHERE id = ?').get(id) as
          { name: string } | undefined
      )?.name ?? `Channel ${id}`
    )
  }

  /** Posts still waiting for their time. A post whose time has passed (posted, partly posted or failed) is history, not a booking. */
  private scheduled(): PostRow[] {
    return this.d.db
      .prepare(
        `SELECT id, brand_id, title, video_path, scheduled_at_utc, status, checksum, episode_ref, origin, post_type, created_at, hold_reason
         FROM posts WHERE status = 'scheduled' AND scheduled_at_utc IS NOT NULL AND scheduled_at_utc >= ? ORDER BY scheduled_at_utc, id`,
      )
      .all(new Date(this.now() - 60 * 60_000).toISOString()) as PostRow[]
  }

  private et(iso: string): string {
    return DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('ccc LLL d, h:mm a')
  }

  /** Two posts in one slot, or more posts on a day than the daily cap. */
  private bookings(): FoundIssue[] {
    const out: FoundIssue[] = []
    const byMinute = new Map<string, PostRow[]>()
    const byDay = new Map<string, PostRow[]>()
    for (const p of this.scheduled()) {
      const min = `${p.brand_id}|${p.post_type}|${p.scheduled_at_utc!.slice(0, 16)}`
      byMinute.set(min, [...(byMinute.get(min) ?? []), p])
      const day = `${p.brand_id}|${p.post_type}|${DateTime.fromISO(p.scheduled_at_utc!, { zone: 'utc' }).setZone(ZONE).toFormat('yyyy-MM-dd')}`
      byDay.set(day, [...(byDay.get(day) ?? []), p])
    }
    for (const [k, list] of byMinute)
      if (list.length > 1)
        out.push({
          key: `double_booking:${k}`,
          kind: 'double_booking',
          brandId: list[0].brand_id,
          postId: list[list.length - 1].id,
          detail: `${this.brandName(list[0].brand_id)} has ${list.length} posts at ${this.et(list[0].scheduled_at_utc!)}: ${list.map((p) => `"${p.title}"`).join(', ')}.`,
        })
    for (const [k, list] of byDay) {
      const brandId = Number(k.split('|')[0])
      const cap = k.split('|')[1] === 'clip' ? 1 : this.d.posts.channelRules(brandId).maxPerDay
      const distinct = new Set(list.map((p) => p.scheduled_at_utc!.slice(0, 16))).size
      if (cap > 0 && distinct > cap)
        out.push({
          key: `over_cap:${k}`,
          kind: 'over_cap',
          brandId,
          postId: null,
          detail: `${this.brandName(brandId)} has ${distinct} posts on ${k.split('|')[2]} and the daily ${k.split('|')[1] === 'clip' ? 'clip ' : ''}limit is ${cap}.`,
        })
    }
    return out
  }

  /** A scheduled post on a day the channel does not post, or on a blackout date. */
  private slots(): FoundIssue[] {
    const out: FoundIssue[] = []
    const global = this.d.settings.get().blackoutDates
    for (const p of this.scheduled()) {
      const day = DateTime.fromISO(p.scheduled_at_utc!, { zone: 'utc' }).setZone(ZONE)
      const rules = this.d.posts.channelRules(p.brand_id)
      const days =
        p.post_type === 'clip'
          ? this.d.posts.clipSchedule(p.brand_id).days
          : this.d.posts.postDays(p.brand_id)
      const ymd = day.toFormat('yyyy-MM-dd')
      if (days && days.length && !days.includes(day.weekday))
        out.push({
          key: `invalid_slot:day:${p.id}`,
          kind: 'invalid_slot',
          brandId: p.brand_id,
          postId: p.id,
          detail: `"${p.title}" (${this.brandName(p.brand_id)}) is scheduled for ${this.et(p.scheduled_at_utc!)}, a day this channel does not post.`,
        })
      if ([...global, ...rules.blackoutDates].includes(ymd))
        out.push({
          key: `invalid_slot:blackout:${p.id}`,
          kind: 'invalid_slot',
          brandId: p.brand_id,
          postId: p.id,
          detail: `"${p.title}" (${this.brandName(p.brand_id)}) is scheduled for ${this.et(p.scheduled_at_utc!)}, a blackout date.`,
        })
    }
    return out
  }

  /** A scheduled post with nothing to send to, or for an archived channel. */
  private orphans(): FoundIssue[] {
    const out: FoundIssue[] = []
    for (const p of this.scheduled()) {
      const targets = (
        this.d.db.prepare('SELECT COUNT(*) AS n FROM post_targets WHERE post_id = ?').get(p.id) as {
          n: number
        }
      ).n
      const archived = (
        this.d.db.prepare('SELECT archived FROM brands WHERE id = ?').get(p.brand_id) as
          { archived: number } | undefined
      )?.archived
      if (!targets || archived)
        out.push({
          key: `orphan_post:${p.id}`,
          kind: 'orphan_post',
          brandId: p.brand_id,
          postId: p.id,
          detail: `"${p.title}" is scheduled but ${archived ? 'its channel is archived' : 'it has no platform to post to'}.`,
        })
    }
    return out
  }

  /** The open slots the app offers must never be a taken time, a blackout date, or a day the channel does not post. */
  private openSlotGuard(): FoundIssue[] {
    const out: FoundIssue[] = []
    const brands = this.d.db.prepare('SELECT id FROM brands WHERE archived = 0').all() as Array<{
      id: number
    }>
    const global = this.d.settings.get().blackoutDates
    for (const b of brands) {
      const open = this.d.posts.nextSlots(b.id, 14)
      const taken = new Set(
        (
          this.d.db
            .prepare(
              `SELECT scheduled_at_utc AS t FROM posts WHERE brand_id = ? AND post_type = 'episode' AND status IN ${RESERVING} AND scheduled_at_utc IS NOT NULL`,
            )
            .all(b.id) as Array<{ t: string }>
        ).map((r) => r.t.slice(0, 16)),
      )
      const rules = this.d.posts.channelRules(b.id)
      const days = this.d.posts.postDays(b.id)
      for (const s of open) {
        const day = DateTime.fromISO(s, { zone: 'utc' }).setZone(ZONE)
        const bad =
          taken.has(s.slice(0, 16)) ||
          [...global, ...rules.blackoutDates].includes(day.toFormat('yyyy-MM-dd')) ||
          (days && !days.includes(day.weekday))
        if (bad)
          out.push({
            key: `open_slot_mismatch:${b.id}:${s}`,
            kind: 'open_slot_mismatch',
            brandId: b.id,
            postId: null,
            detail: `${this.brandName(b.id)} offers ${this.et(s)} as open but the rules say it is not.`,
          })
      }
    }
    return out
  }

  /** The queue video is missing, or its checksum differs from the drop. */
  private async files(): Promise<FoundIssue[]> {
    const out: FoundIssue[] = []
    const rows = this.d.db
      .prepare(
        `SELECT id, brand_id, title, video_path, checksum, episode_ref FROM posts
         WHERE status IN ('draft','scheduled') AND episode_ref IS NOT NULL AND media_purged_at IS NULL`,
      )
      .all() as PostRow[]
    for (const p of rows) {
      const abs = this.d.library.resolve(p.video_path)
      if (!existsSync(abs)) {
        out.push({
          key: `file_drift:missing:${p.id}`,
          kind: 'file_drift',
          brandId: p.brand_id,
          postId: p.id,
          detail: `The video for "${p.title}" (${this.brandName(p.brand_id)}) is missing from the queue.`,
        })
        continue
      }
      if (!p.checksum) continue
      const st = statSync(abs)
      const seen = this.hashed.get(abs)
      let ok: boolean
      if (seen && seen.size === st.size && seen.mtime === st.mtimeMs) ok = seen.ok
      else {
        ok = (await sha256File(abs)).toLowerCase() === p.checksum.toLowerCase()
        this.hashed.set(abs, { size: st.size, mtime: st.mtimeMs, ok })
      }
      if (!ok)
        out.push({
          key: `file_drift:changed:${p.id}`,
          kind: 'file_drift',
          brandId: p.brand_id,
          postId: p.id,
          detail: `The video for "${p.title}" (${this.brandName(p.brand_id)}) is not the file that was dropped (the checksum changed).`,
        })
    }
    return out
  }

  /** A drop waiting more than 7 days. */
  private waiting(): FoundIssue[] {
    const cutoff = new Date(this.now() - WAIT_TOO_LONG_DAYS * 86_400_000).toISOString()
    return (
      this.d.db
        .prepare(
          `SELECT id, brand_id, title FROM posts WHERE origin = 'inbox' AND episode_ref IS NOT NULL AND status = 'draft'
           AND hold_reason IS NULL AND media_purged_at IS NULL AND created_at < ?`,
        )
        .all(cutoff) as Array<{ id: number; brand_id: number; title: string }>
    ).map((p) => ({
      key: `waiting_too_long:${p.id}`,
      kind: 'waiting_too_long' as const,
      brandId: p.brand_id,
      postId: p.id,
      detail: `"${p.title}" (${this.brandName(p.brand_id)}) has waited more than ${WAIT_TOO_LONG_DAYS} days for a slot. The channel may be paused or have no connected account.`,
    }))
  }

  private uploads(): FoundIssue[] {
    const cutoff = new Date(this.now() - STALE_UPLOAD_MS).toISOString()
    return (
      this.d.db
        .prepare(
          `SELECT t.id AS tid, t.post_id, p.brand_id, p.title, t.platform FROM post_targets t JOIN posts p ON p.id = t.post_id
           WHERE t.status = 'uploading' AND t.locked_at_utc IS NOT NULL AND t.locked_at_utc < ?`,
        )
        .all(cutoff) as Array<{
        tid: number
        post_id: number
        brand_id: number
        title: string
        platform: string
      }>
    ).map((t) => ({
      key: `stuck_upload:${t.tid}`,
      kind: 'stuck_upload' as const,
      brandId: t.brand_id,
      postId: t.post_id,
      detail: `The ${t.platform} upload of "${t.title}" has been running for more than 30 minutes.`,
    }))
  }

  /** Fewer than N days of posts scheduled ahead. One issue per channel, which clears when the queue is full again. */
  private lowQueue(): FoundIssue[] {
    const out: FoundIssue[] = []
    const s = this.d.settings.get()
    const paused = new Set(s.pausedBrandIds ?? [])
    const nowMs = this.now()
    const today = DateTime.fromMillis(nowMs, { zone: ZONE }).startOf('day')
    for (const b of this.d.db
      .prepare('SELECT id, name FROM brands WHERE archived = 0')
      .all() as Array<{ id: number; name: string }>) {
      if (paused.has(b.id)) continue
      // Only channels that post for real are watched; a channel with no connected account has nothing to run out of.
      if (!s.globalDryRun && realPlatforms(this.d.db, b.id).length === 0) continue
      const days = this.d.posts.channelRules(b.id).lowQueueDays ?? s.lowQueueDays
      if (days <= 0) continue
      const last = this.d.db
        .prepare(
          `SELECT MAX(scheduled_at_utc) AS t FROM posts WHERE brand_id = ? AND post_type = 'episode' AND status IN ${RESERVING} AND scheduled_at_utc > ?`,
        )
        .get(b.id, new Date(nowMs).toISOString()) as { t: string | null }
      const ahead = last.t
        ? Math.floor(
            DateTime.fromISO(last.t, { zone: 'utc' })
              .setZone(ZONE)
              .startOf('day')
              .diff(today, 'days').days,
          ) + 1
        : 0
      if (ahead < days)
        out.push({
          key: `low_queue:${b.id}`,
          kind: 'low_queue',
          brandId: b.id,
          postId: null,
          detail: `${b.name} has ${ahead} day(s) of posts scheduled ahead. The alert level is ${days}.`,
        })
    }
    return out
  }

  /** A slot passed and nothing went out: scheduled and late, or marked missed in the last 7 days. */
  private missed(): FoundIssue[] {
    const now = this.now()
    const late = new Date(now - 30 * 60_000).toISOString()
    const week = new Date(now - 7 * 86_400_000).toISOString()
    return (
      this.d.db
        .prepare(
          `SELECT id, brand_id, title, scheduled_at_utc, status FROM posts
           WHERE (status = 'scheduled' AND scheduled_at_utc < ?) OR (status = 'missed' AND scheduled_at_utc > ?)`,
        )
        .all(late, week) as Array<{
        id: number
        brand_id: number
        title: string
        scheduled_at_utc: string
        status: string
      }>
    ).map((p) => ({
      key: `missed_slot:${p.id}`,
      kind: 'missed_slot' as const,
      brandId: p.brand_id,
      postId: p.id,
      detail: `"${p.title}" (${this.brandName(p.brand_id)}) was due ${this.et(p.scheduled_at_utc)} and has not gone out${p.status === 'missed' ? ' (marked missed)' : ''}.`,
    }))
  }

  /** A scheduled post on a channel that is on hold or archived. */
  private stateConflicts(): FoundIssue[] {
    const out: FoundIssue[] = []
    for (const p of this.scheduled()) {
      const st = channelState(this.d.db, p.brand_id)
      if (st === 'on-hold' || st === 'archived')
        out.push({
          key: `channel_state:${p.id}`,
          kind: 'channel_state',
          brandId: p.brand_id,
          postId: p.id,
          detail: `"${p.title}" is scheduled but ${this.brandName(p.brand_id)} is ${st}.`,
        })
    }
    return out
  }

  /** The one clear fix: two bot posts in one slot, the later arrival moves to the next open slot. */
  private autoFix(found: FoundIssue[]): Set<string> {
    const fixed = new Set<string>()
    if (!this.d.reschedule) return fixed
    for (const f of found) {
      if (f.kind !== 'double_booking' || !f.postId) continue
      const p = this.d.db
        .prepare('SELECT id, brand_id, origin, episode_ref, post_type FROM posts WHERE id = ?')
        .get(f.postId) as
        | {
            id: number
            brand_id: number
            origin: string
            episode_ref: string | null
            post_type: string
          }
        | undefined
      if (!p || p.origin !== 'inbox' || !p.episode_ref) continue
      const slot = (
        p.post_type === 'clip'
          ? this.d.posts.nextClipSlots(p.brand_id, 1)
          : this.d.posts.nextSlots(p.brand_id, 1)
      )[0]
      if (!slot) continue
      this.d.reschedule(p.id, slot)
      this.d.log?.(
        'info',
        `Auto fix: moved post ${p.id} to ${this.et(slot)} because its slot was taken.`,
      )
      fixed.add(f.key)
    }
    return fixed
  }
}
