import type { Db } from '../../db'
import { COPY } from '@shared/copy'
import type { AlertItem } from '../../alerts/format'
import { probe } from '../ffmpeg'
import type { StudioConfigService } from '../configService'
import type { BlueskyClient } from './bluesky'
import type { PublicHost } from './publicHost'
import { SocialError } from './errors'
import type { ThreadsClient } from './threads'

export interface SocialRow {
  id: number
  episodeId: string | null
  brandId: number
  platform: 'threads' | 'bluesky'
  status: 'scheduled' | 'posting' | 'posted' | 'failed' | 'skipped'
  text: string
  videoPath: string
  title: string
  scheduledAtUtc: string
  attempts: number
  externalId: string | null
  externalUrl: string | null
  error: string | null
  mock: boolean
}

const BACKOFF_MIN = [2, 10, 30]

const map = (r: any): SocialRow => ({
  id: r.id,
  episodeId: r.episode_id,
  brandId: r.brand_id,
  platform: r.platform,
  status: r.status,
  text: r.text,
  videoPath: r.video_path,
  title: r.title,
  scheduledAtUtc: r.scheduled_at_utc,
  attempts: r.attempts,
  externalId: r.external_id,
  externalUrl: r.external_url,
  error: r.error,
  mock: !!r.mock,
})

export interface SocialDeps {
  db: Db
  cfg: StudioConfigService
  threads: ThreadsClient
  bluesky: BlueskyClient
  host: PublicHost
  userId: { get: () => string | null; set: (id: string) => void }
  alert: (item: AlertItem) => void
  log: (level: 'info' | 'warn' | 'error', message: string) => void
  brandName: (id: number) => string
  now?: () => number
}

/**
 * Threads and Bluesky posts. The scheduler only knows four platforms, so these two are sent from here, at the same time
 * as the others, with retries (2, 10, 30 minutes) and the usual failure alert. Rate limits: Threads 250 posts per 24 hours,
 * Bluesky has a daily video allowance that is read before every upload.
 */
export class SocialPublisher {
  constructor(private d: SocialDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  add(p: { episodeId: string | null; brandId: number; platform: 'threads' | 'bluesky'; text: string; videoPath: string; title: string; scheduledAtUtc: string; mock: boolean }): SocialRow {
    const id = Number(
      this.d.db
        .prepare('INSERT INTO social_posts (episode_id, brand_id, platform, text, video_path, title, scheduled_at_utc, mock, created_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(p.episodeId, p.brandId, p.platform, p.text, p.videoPath, p.title, p.scheduledAtUtc, p.mock ? 1 : 0, new Date(this.now()).toISOString()).lastInsertRowid,
    )
    return this.get(id) as SocialRow
  }

  get(id: number): SocialRow | null {
    const r = this.d.db.prepare('SELECT * FROM social_posts WHERE id = ?').get(id)
    return r ? map(r) : null
  }

  list(filter: { episodeId?: string; status?: string } = {}): SocialRow[] {
    const where: string[] = []
    const args: unknown[] = []
    if (filter.episodeId) {
      where.push('episode_id = ?')
      args.push(filter.episodeId)
    }
    if (filter.status) {
      where.push('status = ?')
      args.push(filter.status)
    }
    return (this.d.db.prepare(`SELECT * FROM social_posts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`).all(...args) as unknown[]).map(map)
  }

  /** Posts every Threads and Bluesky item that is due. Returns how many were handled. */
  async tick(): Promise<number> {
    const nowIso = new Date(this.now()).toISOString()
    const due = this.d.db
      .prepare("SELECT * FROM social_posts WHERE status = 'scheduled' AND scheduled_at_utc <= ? AND (next_attempt_utc IS NULL OR next_attempt_utc <= ?) ORDER BY scheduled_at_utc")
      .all(nowIso, nowIso)
      .map(map)
    let n = 0
    for (const row of due) {
      n++
      this.d.db.prepare("UPDATE social_posts SET status = 'posting' WHERE id = ?").run(row.id)
      try {
        const r = row.mock ? { id: `mock-${row.platform}-${row.id}`, url: `https://example.invalid/mock/${row.platform}/${row.id}` } : await this.send(row)
        this.d.db.prepare("UPDATE social_posts SET status = 'posted', external_id = ?, external_url = ?, posted_utc = ?, error = NULL WHERE id = ?").run(r.id, r.url, nowIso, row.id)
        this.d.log('info', `Posted to ${row.platform}${row.mock ? ' (mock)' : ''}: ${row.title}`)
      } catch (e) {
        this.failed(row, e)
      }
    }
    return n
  }

  private failed(row: SocialRow, e: unknown) {
    const err = e instanceof SocialError ? e : new SocialError((e as Error).message, 'transient')
    const attempts = row.attempts + 1
    const give = err.kind === 'permanent' || attempts > BACKOFF_MIN.length
    if (!give) {
      const wait = err.retryAfterMs ?? BACKOFF_MIN[attempts - 1] * 60_000
      this.d.db.prepare("UPDATE social_posts SET status = 'scheduled', attempts = ?, next_attempt_utc = ?, error = ? WHERE id = ?").run(attempts, new Date(this.now() + wait).toISOString(), err.message, row.id)
      this.d.log('warn', `${row.platform} post will be retried: ${err.message}`)
      return
    }
    this.d.db.prepare("UPDATE social_posts SET status = 'failed', attempts = ?, error = ? WHERE id = ?").run(attempts, err.message, row.id)
    this.d.log('error', `${row.platform} post failed: ${err.message}`)
    this.d.alert({
      kind: 'failure',
      headline: COPY.failureHeadline,
      detail: `${row.platform}, ${this.d.brandName(row.brandId)}, "${row.title}": ${err.message}`,
      platform: row.platform === 'threads' ? 'Threads' : 'Bluesky',
      brand: this.d.brandName(row.brandId),
      title: row.title,
      whenUtc: row.scheduledAtUtc,
      reason: err.message,
    })
  }

  /** The owner pressed Retry on a failed post. */
  retry(id: number): void {
    this.d.db.prepare("UPDATE social_posts SET status = 'scheduled', attempts = 0, next_attempt_utc = NULL, error = NULL WHERE id = ? AND status = 'failed'").run(id)
  }

  private async send(row: SocialRow): Promise<{ id: string; url: string }> {
    const raw = this.d.db.prepare('SELECT state_json FROM social_posts WHERE id = ?').get(row.id) as { state_json: string }
    const state = JSON.parse(raw.state_json) as Record<string, unknown>
    const setState = (p: Record<string, unknown>) => {
      Object.assign(state, p)
      this.d.db.prepare('UPDATE social_posts SET state_json = ? WHERE id = ?').run(JSON.stringify(state), row.id)
    }
    if (row.platform === 'bluesky') {
      const limits = await this.d.bluesky.uploadLimits().catch(() => null)
      if (limits && limits.canUpload === false) throw new SocialError(`Bluesky will not take a video right now. ${limits.message ?? ''}`.trim(), 'transient', 60 * 60_000)
      const info = await probe(row.videoPath)
      const r = await this.d.bluesky.postVideo({ text: row.text, file: row.videoPath, width: info.width, height: info.height, alt: row.title, state, setState })
      return { id: r.uri, url: r.url }
    }
    // Threads: the video has to be at a public address while Threads fetches it.
    let userId = this.d.userId.get()
    if (!userId) {
      userId = (await this.d.threads.me()).id
      this.d.userId.set(userId)
    }
    if (!this.d.host.configured()) throw new SocialError('Threads needs the video at a public address. Set up the public host (Cloudflare R2) in Studio Settings.', 'permanent')
    let url = typeof state.publicUrl === 'string' ? state.publicUrl : null
    let key = typeof state.publicKey === 'string' ? state.publicKey : null
    if (!url) {
      const up = await this.d.host.upload(row.videoPath)
      url = up.url
      key = up.key
      setState({ publicUrl: url, publicKey: key })
    }
    try {
      const r = await this.d.threads.publishVideo({ userId, text: row.text, videoUrl: url, state, setState })
      return { id: r.id, url: r.url }
    } finally {
      if (state.threadsPostId && key) await this.d.host.remove(key)
    }
  }
}
