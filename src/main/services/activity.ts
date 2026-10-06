import type { Db } from '../db'
import type { LogEntry, LogFilter, Platform } from '@shared/types'

const SECRET_PATTERN =
  /(access_token|refresh_token|client_secret|authorization|bearer)[=:\s"']+[A-Za-z0-9._\-~+/]{8,}/gi

export function scrub(text: string): string {
  return text
    .replace(SECRET_PATTERN, '$1=[hidden]')
    .replace(/([?&](?:token|key|code)=)[^&\s]+/gi, '$1[hidden]')
}

export class ActivityLog {
  constructor(private db: Db) {}

  log(
    level: 'info' | 'warn' | 'error',
    message: string,
    opts: { postId?: number | null; platform?: Platform | null; detail?: unknown } = {},
  ): void {
    this.db
      .prepare(
        'INSERT INTO activity_log (ts_utc, level, post_id, platform, message, detail_json) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        new Date().toISOString(),
        level,
        opts.postId ?? null,
        opts.platform ?? null,
        scrub(message),
        opts.detail === undefined ? null : scrub(JSON.stringify(opts.detail)),
      )
  }

  list(filter: LogFilter = {}): LogEntry[] {
    const where: string[] = []
    const args: unknown[] = []
    if (filter.level && filter.level !== 'all') {
      where.push('level = ?')
      args.push(filter.level)
    }
    if (filter.platform) {
      where.push('platform = ?')
      args.push(filter.platform)
    }
    if (filter.postId) {
      where.push('post_id = ?')
      args.push(filter.postId)
    }
    const sql = `SELECT * FROM activity_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
    args.push(filter.limit ?? 500)
    return (this.db.prepare(sql).all(...args) as any[]).map((r) => ({
      id: r.id,
      tsUtc: r.ts_utc,
      level: r.level,
      postId: r.post_id,
      platform: r.platform,
      message: r.message,
      detail: r.detail_json ? safeParse(r.detail_json) : null,
    }))
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
