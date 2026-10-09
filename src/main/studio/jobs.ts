import type { Db } from '../db'

export type JobStatus = 'planned' | 'started' | 'downloaded' | 'passed' | 'failed' | 'expired' | 'flagged' | 'approved' | 'discarded'

export interface VideoJob {
  id: number
  episodeId: string
  brandId: number
  clipN: number
  take: number
  status: JobStatus
  prompt: string
  model: string
  resolution: string
  aspect: string
  generateSeconds: number
  keepSeconds: number
  requestId: string | null
  filePath: string | null
  imageRef: string | null
  purpose: string
  qc: unknown
  error: string | null
}

const map = (r: any): VideoJob => ({
  id: r.id,
  episodeId: r.episode_id,
  brandId: r.brand_id,
  clipN: r.clip_n,
  take: r.take,
  status: r.status,
  prompt: r.prompt,
  model: r.model,
  resolution: r.resolution,
  aspect: r.aspect,
  generateSeconds: r.generate_seconds,
  keepSeconds: r.keep_seconds,
  requestId: r.request_id,
  filePath: r.file_path,
  imageRef: r.image_ref,
  purpose: r.purpose,
  qc: r.qc_json ? JSON.parse(r.qc_json) : null,
  error: r.error,
})

/** Persistent record of every clip request, so a quit or a crash never means paying twice. */
export class VideoJobs {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  private iso() {
    return new Date(this.now()).toISOString()
  }

  plan(j: { episodeId: string; brandId: number; clipN: number; take: number; prompt: string; model: string; resolution: string; aspect: string; generateSeconds: number; keepSeconds: number; purpose: string }): VideoJob {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO video_jobs (episode_id, brand_id, clip_n, take, status, prompt, model, resolution, aspect, generate_seconds, keep_seconds, purpose, created_utc, updated_utc)
         VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(j.episodeId, j.brandId, j.clipN, j.take, j.prompt, j.model, j.resolution, j.aspect, j.generateSeconds, j.keepSeconds, j.purpose, this.iso(), this.iso())
    return this.get(j.episodeId, j.clipN, j.take) as VideoJob
  }

  get(episodeId: string, clipN: number, take: number): VideoJob | null {
    const r = this.db.prepare('SELECT * FROM video_jobs WHERE episode_id = ? AND clip_n = ? AND take = ?').get(episodeId, clipN, take)
    return r ? map(r) : null
  }

  /** The newest take of each clip, in clip order. */
  latest(episodeId: string): VideoJob[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM video_jobs j WHERE episode_id = ? AND take = (SELECT MAX(take) FROM video_jobs WHERE episode_id = j.episode_id AND clip_n = j.clip_n) ORDER BY clip_n`,
        )
        .all(episodeId) as any[]
    ).map(map)
  }

  all(episodeId: string): VideoJob[] {
    return (this.db.prepare('SELECT * FROM video_jobs WHERE episode_id = ? ORDER BY clip_n, take').all(episodeId) as any[]).map(map)
  }

  /** Requests in flight right now, across every episode. This is what the concurrency limit counts. */
  activeCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM video_jobs WHERE status = 'started'").get() as { n: number }).n
  }

  update(id: number, patch: Partial<{ status: JobStatus; requestId: string | null; filePath: string | null; imageRef: string | null; prompt: string; qc: unknown; error: string | null }>): void {
    const col: Record<string, string> = { status: 'status', requestId: 'request_id', filePath: 'file_path', imageRef: 'image_ref', prompt: 'prompt', qc: 'qc_json', error: 'error' }
    const sets = Object.keys(patch).map((k) => `${col[k]} = ?`)
    const vals = Object.entries(patch).map(([k, v]) => (k === 'qc' ? JSON.stringify(v) : v))
    this.db.prepare(`UPDATE video_jobs SET ${sets.join(', ')}, updated_utc = ? WHERE id = ?`).run(...vals, this.iso(), id)
  }
}
