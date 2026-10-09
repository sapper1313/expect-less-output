import { DateTime } from 'luxon'
import type { Db } from '../db'
import type { QuotaStatus } from '@shared/types'

export const UPLOAD_LIMIT = 100
export const OTHER_LIMIT = 10_000
export const WARN_AT = 0.8

/** Costs from the YouTube Data API quota table. */
export const COST = {
  videoInsert: { bucket: 'uploads', units: 1 },
  videoUpdate: { bucket: 'other', units: 50 },
  thumbnailsSet: { bucket: 'other', units: 50 },
  playlistItemInsert: { bucket: 'other', units: 50 },
  channelsList: { bucket: 'other', units: 1 },
  playlistsList: { bucket: 'other', units: 1 },
  playlistItemsList: { bucket: 'other', units: 1 },
  videosList: { bucket: 'other', units: 1 },
  videoCategoriesList: { bucket: 'other', units: 1 },
} as const

export type CostKey = keyof typeof COST

/** Estimated use per Pacific day (quota resets at midnight Pacific). */
export class QuotaTracker {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
    private onWarn: (bucket: 'uploads' | 'other', used: number, limit: number) => void = () => {},
  ) {}

  dayPt(): string {
    return DateTime.fromMillis(this.now(), { zone: 'America/Los_Angeles' }).toFormat('yyyy-LL-dd')
  }

  private used(bucket: 'uploads' | 'other'): number {
    const r = this.db
      .prepare('SELECT used FROM youtube_quota WHERE day_pt = ? AND bucket = ?')
      .get(this.dayPt(), bucket) as { used: number } | undefined
    return r?.used ?? 0
  }

  record(key: CostKey): void {
    const { bucket, units } = COST[key]
    const day = this.dayPt()
    this.db
      .prepare(
        `INSERT INTO youtube_quota (day_pt, bucket, used) VALUES (?, ?, ?)
         ON CONFLICT(day_pt, bucket) DO UPDATE SET used = used + excluded.used`,
      )
      .run(day, bucket, units)
    const used = this.used(bucket)
    const limit = bucket === 'uploads' ? UPLOAD_LIMIT : OTHER_LIMIT
    if (used >= limit * WARN_AT) {
      const row = this.db
        .prepare('SELECT warned FROM youtube_quota WHERE day_pt = ? AND bucket = ?')
        .get(day, bucket) as { warned: number }
      if (!row.warned) {
        this.db
          .prepare('UPDATE youtube_quota SET warned = 1 WHERE day_pt = ? AND bucket = ?')
          .run(day, bucket)
        this.onWarn(bucket, used, limit)
      }
    }
  }

  uploadsLeft(): number {
    return Math.max(0, UPLOAD_LIMIT - this.used('uploads'))
  }

  otherLeft(): number {
    return Math.max(0, OTHER_LIMIT - this.used('other'))
  }

  status(): QuotaStatus {
    const uploads = { used: this.used('uploads'), limit: UPLOAD_LIMIT }
    const other = { used: this.used('other'), limit: OTHER_LIMIT }
    return {
      dayPt: this.dayPt(),
      uploads,
      other,
      warn: uploads.used >= uploads.limit * WARN_AT || other.used >= other.limit * WARN_AT,
    }
  }
}
