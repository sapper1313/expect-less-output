import type { Db } from '../db'
import type { ActivityLog } from './activity'
import type { UploadPostService } from './uploadPost'
import { uploadPostOn } from './uploadPost'
import { UploadPostClient, UploadPostError } from '../uploadpost/client'
import { PLATFORM_LABELS } from '@shared/platformLimits'
import type { Platform } from '@shared/types'

const WAIT_MS = 60_000
const RETRY_MS = 10 * 60_000
const MAX_ATTEMPTS = 5
/** TikTok hands out the public video id after its own checks, which can take up to a day. */
const TIKTOK_ID_WAIT_MS = 26 * 3_600_000

/** Platforms Upload-Post can start a comment on. Instagram only allows replies, so it is not here. */
const CAN_START = new Set(['facebook', 'youtube', 'linkedin', 'tiktok', 'x', 'threads', 'bluesky'])

interface TargetRow {
  target_id: number
  post_id: number
  brand_id: number
  brand_name: string
  title: string
  platform: string
  external_id: string | null
  external_url: string | null
  posted_at_utc: string | null
  settings_json: string | null
  first_comment: string | null
  pinned_comment: string | null
}

interface JobRow {
  target_id: number
  post_id: number
  platform: string
  text: string
  attempts: number
}

const textOf = (r: TargetRow): string => {
  let own: string
  try {
    own = String((JSON.parse(r.settings_json ?? '{}') as { firstComment?: string }).firstComment ?? '')
  } catch {
    own = ''
  }
  return (own.trim() || r.first_comment || '').trim()
}

/**
 * Posts each video's first comment after the video is live. It goes through Upload-Post, only on platforms ticked
 * for the channel on the Upload-Post card. Problems are written on the post so they show in the Queue.
 */
export class FirstCommentService {
  private running = false
  constructor(
    private d: {
      db: Db
      uploadPost: UploadPostService
      client: Pick<UploadPostClient, 'createComment' | 'status'>
      log: ActivityLog
      alert: (headline: string, detail: string) => void
      now?: () => number
      emit?: () => void
    },
  ) {}

  private now(): number {
    return (this.d.now ?? Date.now)()
  }

  /** Looks for newly posted targets that have a first comment, then sends the ones that are due. */
  async sweep(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      this.plan()
      await this.sendDue()
    } finally {
      this.running = false
    }
  }

  private setStatus(targetId: number, status: string, error: string | null, attempts?: number, nextAt?: number | null): void {
    this.d.db
      .prepare(
        `UPDATE first_comment_jobs SET status = ?, last_error = ?, attempts = COALESCE(?, attempts),
         next_at_utc = ?, done_at_utc = CASE WHEN ? = 'done' THEN ? ELSE done_at_utc END WHERE target_id = ?`,
      )
      .run(
        status,
        error,
        attempts ?? null,
        nextAt ? new Date(nextAt).toISOString() : null,
        status,
        new Date(this.now()).toISOString(),
        targetId,
      )
    this.d.emit?.()
  }

  private plan(): void {
    const rows = this.d.db
      .prepare(
        `SELECT t.id AS target_id, t.post_id, p.brand_id, b.name AS brand_name, p.title, t.platform, t.external_id,
                t.external_url, t.posted_at_utc, t.settings_json, p.first_comment, p.pinned_comment
         FROM post_targets t JOIN posts p ON p.id = t.post_id JOIN brands b ON b.id = p.brand_id
         WHERE t.status = 'posted'
           AND (p.first_comment IS NOT NULL OR t.settings_json LIKE '%firstComment%')
           AND NOT EXISTS (SELECT 1 FROM first_comment_jobs j WHERE j.target_id = t.id)`,
      )
      .all() as TargetRow[]
    const ins = this.d.db.prepare(
      `INSERT INTO first_comment_jobs (target_id, post_id, platform, text, status, next_at_utc, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const r of rows) {
      const text = textOf(r)
      if (!text) continue
      const label = PLATFORM_LABELS[r.platform as Platform] ?? r.platform
      let status = 'waiting'
      let why: string | null = null
      if (r.platform === 'youtube' && r.pinned_comment?.trim()) {
        status = 'skipped'
        why = 'YouTube posts the pinned comment from the drop instead.'
      } else if (r.platform === 'instagram') {
        status = 'skipped'
        why = 'Instagram does not let Upload-Post start a comment, only reply. Add it by hand.'
      } else if (!CAN_START.has(r.platform)) {
        status = 'skipped'
        why = `${label} cannot take a first comment through Upload-Post.`
      } else if (!uploadPostOn(this.d.db, r.brand_id, r.platform)) {
        status = 'skipped'
        why = `${label} is not ticked for ${r.brand_name} on the Upload-Post card in AI Settings.`
      }
      const at = new Date(r.posted_at_utc ?? new Date(this.now()).toISOString()).getTime() + WAIT_MS
      ins.run(r.target_id, r.post_id, r.platform, text, status, status === 'waiting' ? new Date(at).toISOString() : null, why)
      if (status === 'skipped')
        this.d.log.log('info', `First comment not sent on ${label}: ${why}`, { postId: r.post_id, platform: r.platform as Platform })
    }
    if (rows.length) this.d.emit?.()
  }

  private async sendDue(): Promise<void> {
    const key = this.d.uploadPost.apiKey()
    const jobs = this.d.db
      .prepare(
        "SELECT target_id, post_id, platform, text, attempts FROM first_comment_jobs WHERE status = 'waiting' AND (next_at_utc IS NULL OR next_at_utc <= ?)",
      )
      .all(new Date(this.now()).toISOString()) as JobRow[]
    for (const j of jobs) {
      if (!key) {
        this.setStatus(j.target_id, 'failed', 'The Upload-Post key is missing. Add it in AI Settings.', j.attempts)
        continue
      }
      await this.send(key, j)
    }
  }

  private async send(key: string, j: JobRow): Promise<void> {
    const t = this.d.db
      .prepare(
        `SELECT t.external_id, t.external_url, t.posted_at_utc, p.brand_id, b.name AS brand_name, p.title
         FROM post_targets t JOIN posts p ON p.id = t.post_id JOIN brands b ON b.id = p.brand_id WHERE t.id = ?`,
      )
      .get(j.target_id) as
      | { external_id: string | null; external_url: string | null; posted_at_utc: string | null; brand_id: number; brand_name: string; title: string }
      | undefined
    if (!t) return
    const label = PLATFORM_LABELS[j.platform as Platform] ?? j.platform
    const user = this.d.uploadPost.profileFor(t.brand_id)
    const attempts = j.attempts + 1
    const ctx = { postId: j.post_id, platform: j.platform as Platform }
    try {
      let postId = t.external_id
      // TikTok: ELO only knows Upload-Post's request id until TikTok releases the public video id.
      if (j.platform === 'tiktok' && (!postId || postId.startsWith('elo-'))) {
        const st = postId ? await this.d.client.status(key, postId) : null
        const mine = st?.results.find((x) => x.platform === 'tiktok')
        if (mine?.postId) {
          postId = mine.postId
          this.d.db
            .prepare('UPDATE post_targets SET external_id = ?, external_url = COALESCE(?, external_url) WHERE id = ?')
            .run(mine.postId, mine.postUrl && /^https?:/.test(mine.postUrl) ? mine.postUrl : null, j.target_id)
        } else {
          const since = new Date(t.posted_at_utc ?? 0).getTime()
          if (this.now() - since > TIKTOK_ID_WAIT_MS) {
            this.fail(j, t, label, 'TikTok never gave Upload-Post the video id, so the comment could not be placed.', attempts)
          } else {
            this.setStatus(j.target_id, 'waiting', 'Waiting for TikTok to release the video id.', j.attempts, this.now() + RETRY_MS)
          }
          return
        }
      }
      const byUrl = j.platform !== 'youtube' && j.platform !== 'tiktok' && j.platform !== 'linkedin' && !!t.external_url
      const r = await this.d.client.createComment(key, {
        platform: j.platform,
        user,
        message: j.text,
        postId: byUrl ? undefined : (postId ?? undefined),
        postUrl: byUrl ? (t.external_url as string) : undefined,
      })
      this.setStatus(j.target_id, 'done', r.warnings.join(' ') || null, attempts)
      this.d.log.log('info', `First comment posted on ${label} for "${t.title}".`, ctx)
    } catch (err) {
      const e = err as UploadPostError
      const code = e.code ?? ''
      if (e.status === 429) {
        this.setStatus(j.target_id, 'waiting', `${label} says to slow down: ${e.message}`, j.attempts, this.now() + 60 * 60_000)
        return
      }
      let plain: string | null = null
      if (code === 'tiktok_reconnect_required')
        plain =
          'TikTok only gives comment permission when the account is connected. Disconnect TikTok on Upload-Post, connect it again, then press Try again.'
      else if (e.status === 403)
        plain = `Upload-Post says the ${label} login does not have permission to comment. Reconnect ${label} on their site, then press Try again.`
      else if (e.status === 401) plain = 'Upload-Post does not accept the key. Copy it again in AI Settings.'
      else if (e.status === 400) plain = `Upload-Post refused the comment: ${e.message}`
      if (plain || attempts >= MAX_ATTEMPTS) {
        this.fail(j, t, label, plain ?? `Tried ${attempts} times: ${e.message}`, attempts)
        return
      }
      this.d.log.log('warn', `First comment on ${label} did not go through (${e.message}). Trying again soon.`, ctx)
      this.setStatus(j.target_id, 'waiting', e.message, attempts, this.now() + RETRY_MS)
    }
  }

  private fail(j: JobRow, t: { brand_name: string; title: string }, label: string, reason: string, attempts: number): void {
    this.setStatus(j.target_id, 'failed', reason, attempts)
    this.d.log.log('warn', `First comment failed on ${label} for "${t.title}": ${reason}`, { postId: j.post_id, platform: j.platform as Platform })
    this.d.alert(
      `First comment failed on ${label}.`,
      `${t.brand_name}, "${t.title}": ${reason} The comment was: ${j.text}`,
    )
  }

  /** The Try again button: put a failed or skipped comment back in line. */
  retry(targetId: number): void {
    this.d.db
      .prepare(
        "UPDATE first_comment_jobs SET status = 'waiting', attempts = 0, last_error = NULL, next_at_utc = ? WHERE target_id = ? AND status IN ('failed','skipped')",
      )
      .run(new Date(this.now()).toISOString(), targetId)
    this.d.emit?.()
  }
}
