import type { PostStatus, TargetStatus } from './types'

/** Minutes between retries after the 1st, 2nd and 3rd failure. */
export const BACKOFF_MINUTES = [2, 10, 30]
/** Seconds used instead when the "fast backoff" test setting is on. */
export const FAST_BACKOFF_SECONDS = [5, 10, 15]
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1
/** A target this late or less is just a normal tick, not a "missed" post. */
export const ON_TIME_TOLERANCE_MINUTES = 5

export function backoffMs(failedAttempts: number, fast: boolean): number | null {
  const idx = failedAttempts - 1
  if (idx < 0 || idx >= BACKOFF_MINUTES.length) return null
  return fast ? FAST_BACKOFF_SECONDS[idx] * 1000 : BACKOFF_MINUTES[idx] * 60_000
}

export type MissedDecision = 'on_time' | 'post_late' | 'missed'

export function decideMissed(
  scheduledMs: number,
  nowMs: number,
  behavior: 'post_if_recent' | 'hold',
  graceMinutes: number,
): MissedDecision {
  const lateMin = (nowMs - scheduledMs) / 60_000
  if (lateMin <= ON_TIME_TOLERANCE_MINUTES) return 'on_time'
  if (behavior === 'post_if_recent' && lateMin <= graceMinutes) return 'post_late'
  return 'missed'
}

export function handoffDueMs(scheduledMs: number, hours: number): number {
  return scheduledMs - hours * 3_600_000
}

/** Works out the post status from its targets. `current` protects canceled, missed and draft. */
export function derivePostStatus(targets: TargetStatus[], current: PostStatus): PostStatus {
  if (current === 'draft' || current === 'canceled' || current === 'missed') return current
  const live = targets.filter((t) => t !== 'skipped')
  if (live.length === 0) return current
  if (live.every((t) => t === 'posted')) return 'posted'
  const settled = (t: TargetStatus) => t === 'posted' || t === 'failed' || t === 'needs_action'
  if (live.every(settled)) {
    if (live.some((t) => t === 'failed'))
      return live.some((t) => t === 'posted') ? 'partial' : 'failed'
    return 'partial'
  }
  if (live.some((t) => t !== 'pending')) return 'in_progress'
  return 'scheduled'
}
