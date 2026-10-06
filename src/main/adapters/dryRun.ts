import type { Platform, Settings } from '@shared/types'
import {
  AdapterError,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
} from './types'

export interface DryRunOptions {
  getSettings: () => Settings
  /** Replaced in tests so nothing actually waits. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Simulates a platform. Waits 2 to 5 seconds, succeeds, or fails on purpose if Settings says so. */
export class DryRunAdapter implements PlatformAdapter {
  readonly supportsHandoff: boolean
  private sleep: (ms: number) => Promise<void>

  constructor(
    readonly platform: Platform,
    private opts: DryRunOptions,
  ) {
    this.supportsHandoff = platform === 'youtube' || platform === 'facebook'
    this.sleep = opts.sleep ?? defaultSleep
  }

  async connect(): Promise<void> {}
  async refreshIfNeeded(): Promise<void> {}
  async validate(): Promise<void> {}

  private async simulate(): Promise<void> {
    await this.sleep(2000 + Math.random() * 3000)
    const s = this.opts.getSettings()
    if (s.dryRunFailPlatform === this.platform) {
      throw new AdapterError(
        s.dryRunFailKind === 'permanent'
          ? 'Simulated permanent failure (dry run). Fix the problem, then retry.'
          : 'Simulated temporary failure (dry run).',
        s.dryRunFailKind,
      )
    }
  }

  async handOff(ctx: AdapterContext): Promise<AdapterResult> {
    await this.simulate()
    return { status: 'handed_off', externalId: `dry-${this.platform}-${ctx.postId}` }
  }

  async publish(ctx: AdapterContext): Promise<AdapterResult> {
    await this.simulate()
    return {
      status: 'posted',
      externalId: `dry-${this.platform}-${ctx.postId}`,
      externalUrl: `dry-run://${this.platform}/${ctx.postId}`,
    }
  }

  async checkStatus(ctx: AdapterContext, nowMs: number): Promise<AdapterResult> {
    if (nowMs >= new Date(ctx.scheduledAtUtc).getTime()) {
      return {
        status: 'posted',
        externalId: `dry-${this.platform}-${ctx.postId}`,
        externalUrl: `dry-run://${this.platform}/${ctx.postId}`,
      }
    }
    return { status: 'handed_off' }
  }
}
