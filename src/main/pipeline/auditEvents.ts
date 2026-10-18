import { DateTime } from 'luxon'
import type { Db } from '../db'
import { toCsv } from '@shared/csv'

export interface AuditEvent {
  id: number
  at: string
  actor: string
  action: string
  target: string
  before: unknown
  after: unknown
}

export interface AuditEventFilter {
  actor?: string
  action?: string
  limit?: number
}

const SECRET = /(token|secret|password|api[-_]?key|authorization)/i

/** Replaces the value of anything that looks like a secret, so the audit log never holds one. */
export function redact(v: unknown, key = ''): unknown {
  if (v === null || v === undefined) return v
  if (SECRET.test(key)) return '[hidden]'
  if (Array.isArray(v)) return v.map((x) => redact(x, key))
  if (typeof v === 'object')
    return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, redact(x, k)]))
  return v
}

/**
 * One append-only record of what changed and who changed it: settings, schedule edits, rejections, posts,
 * deletions by retention and Upcoming writes. Actor is josh, agent:<bot> or system.
 */
export class AuditEvents {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  write(e: {
    actor: string
    action: string
    target?: string
    before?: unknown
    after?: unknown
  }): void {
    this.db
      .prepare(
        'INSERT INTO audit_events (at, actor, action, target, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        new Date(this.now()).toISOString(),
        e.actor,
        e.action,
        e.target ?? '',
        e.before === undefined ? null : JSON.stringify(redact(e.before)),
        e.after === undefined ? null : JSON.stringify(redact(e.after)),
      )
  }

  /** The id of the newest row, for a change cursor. */
  lastId(): number {
    return (
      this.db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM audit_events').get() as { n: number }
    ).n
  }

  /** Rows after an id, oldest first. */
  since(id: number, limit: number): AuditEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_events WHERE id > ? ORDER BY id LIMIT ?')
      .all(id, limit) as any[]
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor: r.actor,
      action: r.action,
      target: r.target,
      before: null,
      after: r.after_json ? JSON.parse(r.after_json) : null,
    }))
  }

  list(f: AuditEventFilter = {}): AuditEvent[] {
    const where: string[] = []
    const args: unknown[] = []
    if (f.actor) (where.push('actor = ?'), args.push(f.actor))
    if (f.action) (where.push('action LIKE ?'), args.push(`${f.action}%`))
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`,
      )
      .all(...args, f.limit ?? 500) as any[]
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor: r.actor,
      action: r.action,
      target: r.target,
      before: r.before_json ? JSON.parse(r.before_json) : null,
      after: r.after_json ? JSON.parse(r.after_json) : null,
    }))
  }

  csv(f: AuditEventFilter = {}): string {
    const rows = this.list({ ...f, limit: 100000 })
    return toCsv(
      ['at', 'actor', 'action', 'target', 'before', 'after'],
      rows.map((r) => ({
        at: DateTime.fromISO(r.at, { zone: 'utc' })
          .setZone('America/New_York')
          .toFormat('yyyy-MM-dd HH:mm:ss'),
        actor: r.actor,
        action: r.action,
        target: r.target,
        before: r.before === null ? '' : JSON.stringify(r.before),
        after: r.after === null ? '' : JSON.stringify(r.after),
      })),
    )
  }
}
