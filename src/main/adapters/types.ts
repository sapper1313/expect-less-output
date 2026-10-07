import type { Account, Platform } from '@shared/types'

export type ErrorKind = 'transient' | 'permanent'

export class AdapterError extends Error {
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
  title: string
  /** Shared caption, or the per-platform override when one exists. */
  caption: string
  aiFlag: boolean
  videoAbsPath: string
  scheduledAtUtc: string
  account: Account | null
  /** Small per-target memory (for example a video id or upload session) that survives restarts. */
  getState(): Record<string, unknown>
  setState(patch: Record<string, unknown>): void
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
