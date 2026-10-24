import { statSync } from 'fs'
import {
  AdapterError,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
} from '../adapters/types'
import { durationProblem } from '@shared/platformLimits'
import type { BlueskyClient } from '../studio/social/bluesky'
import { SocialError } from '../studio/social/errors'

export const BLUESKY_MAX_BYTES = 100 * 1024 * 1024

type Client = Pick<BlueskyClient, 'uploadLimits' | 'postVideo'>

/** Posts a video to Bluesky with the handle and app password saved for the channel. */
export class BlueskyAdapter implements PlatformAdapter {
  readonly platform = 'bluesky' as const
  constructor(
    private d: {
      client: (brandId: number) => Client
      log: (level: 'info' | 'warn' | 'error', message: string, ctx: AdapterContext) => void
    },
  ) {}
  wantsHandoff(): boolean {
    return false
  }
  minHandoffLeadMs(): number {
    return 0
  }
  async connect(): Promise<void> {}
  async refreshIfNeeded(): Promise<void> {}

  async validate(ctx: AdapterContext): Promise<void> {
    if (!ctx.account || ctx.account.status !== 'connected')
      throw new AdapterError(
        `${ctx.brandName} has no Bluesky login saved. Add it on the Connections screen.`,
        'permanent',
      )
    const problem = durationProblem('bluesky', ctx.videoDurationSeconds)
    if (ctx.videoDurationSeconds > 0 && problem) throw new AdapterError(problem, 'permanent')
    if (ctx.videoSizeBytes > BLUESKY_MAX_BYTES)
      throw new AdapterError('Bluesky takes videos up to 100 MB. This one is bigger.', 'permanent')
  }

  async publish(ctx: AdapterContext): Promise<AdapterResult> {
    const client = this.d.client(ctx.brandId)
    try {
      const limits = await client.uploadLimits().catch(() => null)
      if (limits && limits.canUpload === false) {
        const e = new AdapterError(
          `Bluesky will not take a video right now. ${limits.message ?? ''}`.trim(),
          'transient',
        )
        e.retryAfterMs = 60 * 60_000
        throw e
      }
      const size = statSync(ctx.videoAbsPath).size
      if (size > BLUESKY_MAX_BYTES)
        throw new AdapterError(
          'Bluesky takes videos up to 100 MB. This one is bigger.',
          'permanent',
        )
      const r = await client.postVideo({
        text: ctx.caption || ctx.title,
        file: ctx.videoAbsPath,
        width: ctx.videoWidth || 1080,
        height: ctx.videoHeight || 1920,
        alt: ctx.title,
        state: ctx.getState(),
        setState: (p) => ctx.setState(p),
      })
      this.d.log('info', 'Posted to Bluesky.', ctx)
      return { status: 'posted', externalId: r.uri, externalUrl: r.url }
    } catch (e) {
      if (e instanceof AdapterError) throw e
      if (e instanceof SocialError) {
        const a = new AdapterError(e.message, e.kind)
        a.retryAfterMs = e.retryAfterMs
        throw a
      }
      throw new AdapterError(`Bluesky: ${(e as Error).message}`, 'transient')
    }
  }

  async checkStatus(): Promise<AdapterResult> {
    return { status: 'processing' }
  }
}
