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
  brandName: string
  title: string
  /** Shared caption, or the per-platform override when one exists. */
  caption: string
  aiFlag: boolean
  videoAbsPath: string
  scheduledAtUtc: string
  account: Account | null
}

export interface AdapterResult {
  status: 'posted' | 'handed_off' | 'processing' | 'needs_action'
  externalId?: string
  externalUrl?: string
}

export interface PlatformAdapter {
  readonly platform: Platform
  /** True when the platform can schedule on its own after an early handoff. */
  readonly supportsHandoff: boolean
  connect(account: Account): Promise<void>
  refreshIfNeeded(account: Account): Promise<void>
  validate(ctx: AdapterContext): Promise<void>
  handOff?(ctx: AdapterContext): Promise<AdapterResult>
  publish(ctx: AdapterContext): Promise<AdapterResult>
  checkStatus(ctx: AdapterContext, nowMs: number): Promise<AdapterResult>
  fetchStats?(ctx: AdapterContext): Promise<Record<string, number>>
}
