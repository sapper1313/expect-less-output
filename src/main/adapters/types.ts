import type { Account, Platform } from '@shared/types'

export type ErrorKind = 'transient' | 'permanent'

export class AdapterError extends Error {
  /** When set, try again after this many milliseconds without using up a retry (for example a daily cap). */
  retryAfterMs?: number
  /**
   * Upload-Post only: the video may already have gone out (it timed out or Upload-Post lost track of it), so ELO's own
   * backup must not post it again. The normal retry asks Upload-Post again instead.
   */
  ambiguous?: boolean
  /** Upload-Post could not be reached at all. Two of these in a row count as a real failure. */
  unreachable?: boolean
  constructor(
    message: string,
    public kind: ErrorKind,
  ) {
    super(message)
    this.name = 'AdapterError'
  }
}

export interface AdapterContext {
  postId: number
  targetId: number
  brandId: number
  brandName: string
  /** The pipeline episode id when the post came from a drop. */
  episodeId?: string | null
  title: string
  /** Shared caption, or the per-platform override when one exists. */
  caption: string
  aiFlag: boolean
  videoAbsPath: string
  /** The platform's id for this video once it exists, otherwise null. */
  externalId: string | null
  /** From ffprobe at import time. 0 when unknown. */
  videoDurationSeconds: number
  videoSizeBytes: number
  /** Picture size from ffprobe at import time. 0 when unknown. */
  videoWidth?: number
  videoHeight?: number
  scheduledAtUtc: string
  account: Account | null
  /** Small per-target memory (for example a video id or upload session) that survives restarts. */
  getState(): Record<string, unknown>
  setState(patch: Record<string, unknown>): void
  /** Optional per-target settings, for example the Instagram cover frame. */
  settings: Record<string, unknown>
  /** The scheduler's clock in milliseconds. Tests move it. */
  nowMs(): number
  /** Upload progress from 0 to 1. */
  reportProgress(fraction: number): void
}

export interface AdapterResult {
  status: 'posted' | 'handed_off' | 'processing' | 'needs_action'
  externalId?: string
  externalUrl?: string
}

export interface PlatformAdapter {
  readonly platform: Platform
  /** True when this account should be handed to the platform early so it publishes on its own. */
  wantsHandoff(account: Account | null): boolean
  /** Do not hand off when the scheduled time is closer than this. The post goes out at its time instead. */
  minHandoffLeadMs(account: Account | null): number
  connect(account: Account): Promise<void>
  refreshIfNeeded(account: Account): Promise<void>
  validate(ctx: AdapterContext): Promise<void>
  handOff?(ctx: AdapterContext): Promise<AdapterResult>
  publish(ctx: AdapterContext): Promise<AdapterResult>
  checkStatus(ctx: AdapterContext, nowMs: number): Promise<AdapterResult>
  fetchStats?(ctx: AdapterContext): Promise<Record<string, number>>
}

/** Marks an Upload-Post error as "the video may already be out", so the backup path stays out of it. */
export function ambiguous<T extends AdapterError>(e: T): T {
  e.ambiguous = true
  return e
}

/** Marks an error as "Upload-Post could not be reached" when its status says so. */
export function unreachableIf<T extends AdapterError>(e: T, status: number): T {
  if (status === 0) {
    e.ambiguous = true
    e.unreachable = true
  }
  return e
}
