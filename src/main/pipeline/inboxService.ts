import { dirname } from 'path'
import type { Api } from '@shared/api'
import type { Db } from '../db'
import type { Library } from '../services/library'
import type { PostService } from '../services/posts'
import type { SettingsService } from '../services/settings'
import type { AuditEvents } from './auditEvents'
import type { DropLog } from './dropLog'
import { OUTSIDE_WINDOW, type PipelineIntake } from './intake'
import type { Reconciler } from './reconcile'
import type { FreshStart } from './freshStart'
import type { BrandService } from '../services/brands'
import { channelState } from './state'
import type { FillResult } from '@shared/pipeline'
import { slotKindFor } from '@shared/slots'
import { verifyPipelinePost, sha256File } from './verify'
import type { ChannelRules, InboxItem } from '@shared/pipeline'

export interface InboxServiceDeps {
  db: Db
  posts: PostService
  library: Library
  settings: SettingsService
  intake: PipelineIntake
  drops: DropLog
  audit: AuditEvents
  reconciler: Reconciler
  freshStart: FreshStart
  brands: BrandService
  openPath: (path: string) => Promise<void>
  emit: () => void
}

/** The actions behind the Inbox screen. Every one of them is also reachable through the agent API where it makes sense. */
export class InboxService {
  constructor(private d: InboxServiceDeps) {}

  private item(p: ReturnType<PostService['get']> & object, reason: string | null): InboxItem {
    const drop = this.d.drops.forPost(p.id)
    const slug =
      (
        this.d.db.prepare('SELECT slug FROM brands WHERE id = ?').get(p.brandId) as
          { slug: string | null } | undefined
      )?.slug ?? null
    return {
      postId: p.id,
      brandId: p.brandId,
      brandName: p.brandName,
      brandColor: p.brandColor,
      channel: slug,
      episodeId: p.episodeRef,
      postType: p.postType,
      title: p.title,
      sourceBot: p.sourceBot ?? drop?.sourceBot ?? null,
      droppedAt: drop?.receivedAt ?? p.createdAt,
      durationSeconds: p.videoMeta.durationSeconds ?? null,
      posterUrl: p.posterUrl,
      status: p.holdReason ? 'held' : p.status,
      reason,
      fileName: p.fileName,
      paused: (this.d.settings.get().pausedBrandIds ?? []).includes(p.brandId),
    }
  }

  private inboxPosts(held: boolean) {
    return this.d.posts
      .list({ status: held ? 'all' : 'draft' })
      .filter((p) => p.origin === 'inbox' && p.status !== 'canceled' && p.status !== 'posted')
      .filter((p) => (held ? !!p.holdReason : !p.holdReason && p.status === 'draft'))
  }

  waiting(): InboxItem[] {
    return this.inboxPosts(false)
      .map((p) =>
        this.item(
          p,
          this.d.intake.waitingReason(
            p.brandId,
            p.targets.map((t) => t.platform),
            p.postType,
          ),
        ),
      )
      .sort((a, b) => a.droppedAt.localeCompare(b.droppedAt))
  }

  held(): InboxItem[] {
    return this.inboxPosts(true).map((p) => this.item(p, p.holdReason))
  }

  counts() {
    const waiting = this.waiting().length
    const held = this.held().length
    const issues = this.d.reconciler.open().length
    return { waiting, held, issues, badge: waiting + held + issues }
  }

  private need(postId: number) {
    const p = this.d.posts.get(postId)
    if (!p) throw new Error('That post was not found.')
    return p
  }

  async schedule(postId: number) {
    const r = await this.d.intake.scheduleDrop(postId)
    void this.d.reconciler.run()
    return r
  }

  openSlots(postId: number, count: number): string[] {
    const p = this.need(postId)
    const n = Math.min(Math.max(count, 1), 60)
    return p.postType === 'clip'
      ? this.d.posts.nextClipSlots(p.brandId, n)
      : this.d.posts.nextSlots(p.brandId, n, undefined, [], slotKindFor(p.videoMeta))
  }

  async pickSlot(postId: number, slotUtc: string) {
    const r = await this.d.intake.scheduleDrop(postId, { slot: slotUtc })
    void this.d.reconciler.run()
    return r
  }

  /** Puts the oldest waiting videos into the open slots between two times, one per slot, for channels that are running. */
  async fillAll(fromUtc: string, toUtc: string): Promise<FillResult> {
    const out: FillResult = { filled: [], skipped: [], leftWaiting: 0 }
    for (const b of this.d.brands.list(false)) {
      const state = channelState(this.d.db, b.id)
      if (state !== 'active') {
        if (state !== 'archived' && this.d.posts.openSlotsInRange(b.id, fromUtc, toUtc).length)
          out.skipped.push({
            brandName: b.name,
            reason: `The channel is ${state === 'paused' ? 'paused' : 'on hold'}.`,
          })
        continue
      }
      for (const kind of ['episode', 'clip'] as const) {
        const waiting = this.d.db
          .prepare(
            `SELECT id FROM posts WHERE brand_id = ? AND origin = 'inbox' AND status = 'draft' AND hold_reason IS NULL
             AND post_type = ? AND media_purged_at IS NULL ORDER BY id`,
          )
          .all(b.id, kind) as Array<{ id: number }>
        const slots = this.d.posts
          .openSlotsInRange(b.id, fromUtc, toUtc)
          .filter((s) => s.kind === kind && !s.blockedBy)
        let i = 0
        for (; i < waiting.length && (kind === 'episode' || i < slots.length); i++) {
          // Episodes take each platform's own next open time, as long as the first of them is inside the window.
          const r = await this.d.intake.scheduleDrop(
            waiting[i].id,
            kind === 'episode' ? { within: { fromUtc, toUtc } } : { slot: slots[i].whenUtc },
          )
          if (!r.ok) {
            if (r.message !== OUTSIDE_WINDOW) out.skipped.push({ brandName: b.name, reason: r.message })
            break
          }
          const p = this.d.posts.get(waiting[i].id)
          out.filled.push({
            postId: waiting[i].id,
            title: p?.title ?? '',
            brandName: b.name,
            whenUtc: r.scheduledAtUtc ?? slots[i]?.whenUtc ?? '',
            kind,
          })
        }
        out.leftWaiting += Math.max(0, waiting.length - i)
      }
    }
    this.d.audit.write({
      actor: 'josh',
      action: 'slots.fill_all',
      target: `${fromUtc} to ${toUtc}`,
      after: { filled: out.filled.length },
    })
    void this.d.reconciler.run()
    this.d.emit()
    return out
  }

  /** The undo of a fill: scheduled drops go back to waiting and their slots are free again. */
  unschedule(postIds: number[]): number {
    let n = 0
    for (const id of postIds) {
      const p = this.d.posts.get(id)
      if (!p || p.status !== 'scheduled' || p.origin !== 'inbox') continue
      if (
        p.targets.some((t) =>
          ['handed_off', 'processing', 'uploading', 'posted'].includes(t.status),
        )
      )
        continue
      this.d.posts.update(id, { status: 'draft', scheduledAtUtc: null })
      const drop = this.d.drops.forPost(id)
      if (drop) this.d.drops.update(drop.dropId, { scheduledSlot: null })
      n++
    }
    if (n) this.d.audit.write({ actor: 'josh', action: 'slots.unfill', target: `${n} post(s)` })
    this.d.emit()
    return n
  }

  hold(postId: number, reason: string): void {
    const p = this.need(postId)
    const why = reason.trim() || 'Held by the owner.'
    this.d.posts.setHold(postId, why)
    this.d.audit.write({
      actor: 'josh',
      action: 'post.hold',
      target: `${p.brandName}/${p.episodeRef ?? p.id}`,
      after: { reason: why },
    })
    this.d.emit()
  }

  /** Clears a hold. With accept, the file and title as they are now become the new baseline (the owner looked and said yes). */
  async release(postId: number, accept: boolean) {
    const p = this.need(postId)
    this.d.posts.setHold(postId, null)
    if (accept && p.episodeRef) {
      const abs = this.d.library.resolve(p.videoPath)
      const sum = await sha256File(abs)
      this.d.db
        .prepare(
          'UPDATE posts SET checksum = ?, sidecar_title = title, video_basename = ? WHERE id = ?',
        )
        .run(sum, abs.split('/').pop(), postId)
    }
    const why = await verifyPipelinePost(this.d.db, this.d.library, postId)
    if (why) {
      this.d.posts.setHold(postId, why)
      this.d.emit()
      return { ok: false, message: `Still held: ${why}`, held: true }
    }
    this.d.audit.write({
      actor: 'josh',
      action: 'post.release',
      target: `${p.brandName}/${p.episodeRef ?? p.id}`,
      after: { accepted: accept },
    })
    this.d.emit()
    return { ok: true, message: 'Released. It is a waiting drop now.' }
  }

  /** Rejects a drop the owner does not want. The post is canceled, the file is kept, and the reason is recorded. */
  reject(postId: number, note: string): void {
    const p = this.need(postId)
    if (['posted', 'in_progress'].includes(p.status))
      throw new Error('This post is already going out.')
    this.d.posts.cancel([postId])
    this.d.db.prepare('UPDATE posts SET hold_reason = NULL WHERE id = ?').run(postId)
    const drop = this.d.drops.forPost(postId)
    if (drop)
      this.d.drops.update(drop.dropId, {
        result: 'rejected',
        reason: note.trim() || 'Rejected by the owner.',
      })
    this.d.audit.write({
      actor: 'josh',
      action: 'drop.rejected',
      target: `${p.brandName}/${p.episodeRef ?? p.id}`,
      after: { note },
    })
    this.d.emit()
    void this.d.reconciler.run()
  }

  async openFile(postId: number): Promise<void> {
    const p = this.need(postId)
    await this.d.openPath(dirname(this.d.library.resolve(p.videoPath)))
  }

  channelRules(brandId: number): ChannelRules {
    const r = this.d.posts.channelRules(brandId)
    const row = this.d.db
      .prepare('SELECT min_seconds, max_seconds, on_hold, always_on FROM channel_rules WHERE brand_id = ?')
      .get(brandId) as
      { min_seconds: number | null; max_seconds: number | null; on_hold: number; always_on: number } | undefined
    return {
      ...r,
      onHold: !!row?.on_hold,
      alwaysOn: !!row?.always_on,
      minSeconds: row?.min_seconds ?? null,
      maxSeconds: row?.max_seconds ?? null,
    }
  }

  setChannelRules(brandId: number, patch: Partial<ChannelRules>): ChannelRules {
    const prev = this.channelRules(brandId)
    if (
      patch.maxPerDay !== undefined &&
      (!Number.isInteger(patch.maxPerDay) || patch.maxPerDay < 0 || patch.maxPerDay > 20)
    )
      throw new Error('Posts per day must be a whole number from 0 to 20. 0 means no limit.')
    for (const d of patch.blackoutDates ?? [])
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`"${d}" is not a date. Use YYYY-MM-DD.`)
    const next = { ...prev, ...patch }
    this.d.db
      .prepare(
        `INSERT INTO channel_rules (brand_id, max_per_day, blackout_json, low_queue_days, min_seconds, max_seconds, on_hold, always_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(brand_id) DO UPDATE SET max_per_day = excluded.max_per_day, blackout_json = excluded.blackout_json,
           low_queue_days = excluded.low_queue_days, min_seconds = excluded.min_seconds, max_seconds = excluded.max_seconds,
           on_hold = excluded.on_hold, always_on = excluded.always_on`,
      )
      .run(
        brandId,
        next.maxPerDay,
        JSON.stringify([...new Set(next.blackoutDates)].sort()),
        next.lowQueueDays,
        next.minSeconds,
        next.maxSeconds,
        next.onHold ? 1 : 0,
        next.alwaysOn ? 1 : 0,
      )
    this.d.audit.write({
      actor: 'josh',
      action: 'channel.rules',
      target: String(brandId),
      before: prev,
      after: next,
    })
    this.d.emit()
    void this.d.reconciler.run()
    return next
  }

  api(): Api['pipeline'] {
    return {
      counts: async () => this.counts(),
      waiting: async () => this.waiting(),
      held: async () => this.held(),
      rejected: async () =>
        [
          ...this.d.drops.list({ result: 'rejected' }),
          ...this.d.drops.list({ result: 'duplicate' }),
        ].sort((a, b) => b.id - a.id),
      log: async (f) => this.d.drops.list(f),
      logCsv: async (f) => this.d.drops.csv(f),
      schedule: (id) => this.schedule(id),
      openSlots: async (id, n) => this.openSlots(id, n),
      pickSlot: (id, s) => this.pickSlot(id, s),
      hold: async (id, r) => this.hold(id, r),
      release: (id, a) => this.release(id, a),
      reject: async (id, n) => this.reject(id, n),
      openFile: (id) => this.openFile(id),
      issues: async () => this.d.reconciler.open(),
      reconcileNow: async () => this.d.reconciler.run(),
      fillAll: (from, to) => this.fillAll(from, to),
      unschedule: async (ids) => this.unschedule(ids),
      dismissIssue: async (id) => {
        this.d.reconciler.dismiss(id)
        this.d.emit()
      },
      dismissAllIssues: async () => {
        const n = this.d.reconciler.dismissAll()
        this.d.audit.write({
          actor: 'josh',
          action: 'issues.cleared',
          target: 'inbox issues',
          after: { count: n },
        })
        this.d.emit()
        return n
      },
      audit: async (f) => this.d.audit.list(f),
      auditCsv: async (f) => this.d.audit.csv(f),
      freshStartPreview: async () => this.d.freshStart.preview(),
      freshStartRun: async () => {
        const r = await this.d.freshStart.run()
        this.d.emit()
        return r
      },
      channelRules: async (id) => this.channelRules(id),
      setChannelRules: async (id, p) => this.setChannelRules(id, p),
    }
  }
}
