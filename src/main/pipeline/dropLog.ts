import { appendFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import { DateTime } from 'luxon'
import type { Db } from '../db'
import { toCsv } from '@shared/csv'
import type { DropFilter, DropResult, DropRow } from '@shared/pipeline'

export interface DropInput {
  sourceBot?: string | null
  fileName: string
  filePath: string
  fileSize?: number | null
  sha256?: string | null
  brandId?: number | null
  channel?: string | null
  episodeId?: string | null
  title?: string | null
  sidecarValid: boolean
  result: DropResult
  reason?: string | null
  scheduledSlot?: string | null
  postId?: number | null
  approvedBy?: string | null
  approvedAt?: string | null
  render?: unknown
  postType?: 'episode' | 'clip'
  notes?: string | null
}

const map = (r: any): DropRow => ({
  id: r.id,
  dropId: r.drop_id,
  receivedAt: r.received_at,
  sourceBot: r.source_bot,
  fileName: r.file_name,
  filePath: r.file_path,
  fileSize: r.file_size,
  sha256: r.sha256,
  brandId: r.brand_id,
  channel: r.channel,
  episodeId: r.episode_id,
  title: r.title,
  sidecarValid: !!r.sidecar_valid,
  result: r.result,
  reason: r.reason,
  scheduledSlot: r.scheduled_slot,
  postId: r.post_id,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  postType: r.post_type ?? 'episode',
  render: r.render_json ? JSON.parse(r.render_json) : null,
  notes: r.notes,
})

/**
 * The record of every drop. A row is added when a drop is decided and only its slot, post and notes change later
 * (when the drop gets scheduled). It is never deleted. Each decision is also written as one line of logs/drops.jsonl.
 */
export class DropLog {
  constructor(
    private db: Db,
    private jsonlPath: string | null,
    private now: () => number = Date.now,
  ) {}

  record(i: DropInput): DropRow {
    const dropId = randomUUID()
    const at = DateTime.fromMillis(this.now(), { zone: 'America/New_York' }).toISO() as string
    this.db
      .prepare(
        `INSERT INTO drops (drop_id, received_at, source_bot, file_name, file_path, file_size, sha256, brand_id, channel,
           episode_id, title, sidecar_valid, result, reason, scheduled_slot, post_id, approved_by, approved_at, render_json, notes, post_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        dropId,
        at,
        i.sourceBot ?? null,
        i.fileName,
        i.filePath,
        i.fileSize ?? null,
        i.sha256 ?? null,
        i.brandId ?? null,
        i.channel ?? null,
        i.episodeId ?? null,
        i.title ?? null,
        i.sidecarValid ? 1 : 0,
        i.result,
        i.reason ?? null,
        i.scheduledSlot ?? null,
        i.postId ?? null,
        i.approvedBy ?? null,
        i.approvedAt ?? null,
        i.render === undefined ? null : JSON.stringify(i.render),
        i.notes ?? null,
        i.postType ?? 'episode',
      )
    const row = this.byDropId(dropId) as DropRow
    this.line(row)
    return row
  }

  byDropId(dropId: string): DropRow | null {
    const r = this.db.prepare('SELECT * FROM drops WHERE drop_id = ?').get(dropId)
    return r ? map(r) : null
  }

  get(id: number): DropRow | null {
    const r = this.db.prepare('SELECT * FROM drops WHERE id = ?').get(id)
    return r ? map(r) : null
  }

  /** The newest drop for a post. */
  forPost(postId: number): DropRow | null {
    const r = this.db
      .prepare('SELECT * FROM drops WHERE post_id = ? ORDER BY id DESC LIMIT 1')
      .get(postId)
    return r ? map(r) : null
  }

  /** What changes after a drop was accepted: its slot, its post and notes. Nothing else is ever rewritten. */
  update(
    dropId: string,
    patch: {
      scheduledSlot?: string | null
      postId?: number | null
      notes?: string | null
      result?: DropResult
      reason?: string | null
    },
  ): void {
    const sets: string[] = []
    const args: unknown[] = []
    if (patch.scheduledSlot !== undefined)
      (sets.push('scheduled_slot = ?'), args.push(patch.scheduledSlot))
    if (patch.postId !== undefined) (sets.push('post_id = ?'), args.push(patch.postId))
    if (patch.notes !== undefined) (sets.push('notes = ?'), args.push(patch.notes))
    if (patch.result !== undefined) (sets.push('result = ?'), args.push(patch.result))
    if (patch.reason !== undefined) (sets.push('reason = ?'), args.push(patch.reason))
    if (!sets.length) return
    this.db.prepare(`UPDATE drops SET ${sets.join(', ')} WHERE drop_id = ?`).run(...args, dropId)
    const row = this.byDropId(dropId)
    if (row) this.line(row, 'update')
  }

  list(f: DropFilter = {}): DropRow[] {
    const where: string[] = []
    const args: unknown[] = []
    if (f.channel) (where.push('channel = ?'), args.push(f.channel))
    if (f.bot) (where.push('source_bot = ?'), args.push(f.bot))
    if (f.result) (where.push('result = ?'), args.push(f.result))
    const sql = `SELECT * FROM drops ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
    return (this.db.prepare(sql).all(...args, f.limit ?? 500) as any[]).map(map)
  }

  csv(f: DropFilter = {}): string {
    const rows = this.list({ ...f, limit: 100000 })
    const cols = [
      'drop_id',
      'received_at',
      'source_bot',
      'file_name',
      'file_path',
      'file_size',
      'sha256',
      'channel',
      'episode_id',
      'title',
      'sidecar_valid',
      'result',
      'reason',
      'scheduled_slot',
      'post_id',
      'approved_by',
      'approved_at',
      'notes',
    ]
    return toCsv(
      cols,
      rows.map((r) => ({
        drop_id: r.dropId,
        received_at: r.receivedAt,
        source_bot: r.sourceBot,
        file_name: r.fileName,
        file_path: r.filePath,
        file_size: r.fileSize,
        sha256: r.sha256,
        channel: r.channel,
        episode_id: r.episodeId,
        title: r.title,
        sidecar_valid: r.sidecarValid ? 'yes' : 'no',
        result: r.result,
        reason: r.reason,
        scheduled_slot: r.scheduledSlot,
        post_id: r.postId,
        approved_by: r.approvedBy,
        approved_at: r.approvedAt,
        notes: r.notes,
      })),
    )
  }

  private line(row: DropRow, kind: 'drop' | 'update' = 'drop'): void {
    if (!this.jsonlPath) return
    try {
      mkdirSync(dirname(this.jsonlPath), { recursive: true })
      appendFileSync(this.jsonlPath, JSON.stringify({ kind, ...row }) + '\n')
    } catch {
      // The database row is the record. A full disk must not stop a drop.
    }
  }
}
