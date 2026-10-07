import { fetchOneStats, type StatsProvider } from '../stats/providers'
import { statSync } from 'fs'
import {
  AdapterError,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
} from './types'
import { PLATFORM_LIMITS } from '@shared/platformLimits'
import { tiktokSettingsProblem } from '@shared/tiktok'
import type { Account, TikTokCreatorInfo, TikTokPostSettings } from '@shared/types'
import { TikTokApiError, mimeFor, type TikTokClient } from '../tiktok/client'

export interface TikTokAdapterDeps {
  /** Reads views, likes and so on for one posted video. */
  stats?: StatsProvider
  client: TikTokClient
  accessToken: (accountId: number, force?: boolean) => Promise<string>
  /** Asks TikTok for the creator's current options. Never cached. */
  freshCreator: (accountId: number) => Promise<TikTokCreatorInfo>
  host: {
    notify(title: string, body: string): void
    log(level: 'info' | 'warn' | 'error', message: string, ctx: AdapterContext): void
  }
}

const PROCESSING_TIMEOUT_MS = 30 * 60_000

/** Failure reasons TikTok gives that are worth another try. Anything else stops and explains. */
const TRANSIENT_REASONS = new Set(['internal_error', 'video_pull_failed', 'service_unavailable'])

/**
 * TikTok. Drafts mode uploads to the creator's inbox and waits for the owner to finish in the app.
 * Direct mode posts with the creator's own choices. Both upload the file in chunks, then the scheduler
 * polls the publish status each tick.
 */
export class TikTokAdapter implements PlatformAdapter {
  readonly platform = 'tiktok' as const
  constructor(private d: TikTokAdapterDeps) {}

  wantsHandoff(): boolean {
    return false
  }
  minHandoffLeadMs(): number {
    return 0
  }
  async connect(): Promise<void> {}
  async refreshIfNeeded(): Promise<void> {}

  async validate(ctx: AdapterContext): Promise<void> {
    const a = ctx.account
    if (!a || !a.externalId)
      throw new AdapterError(
        `${ctx.brandName} has no TikTok account connected. Connect one on the Connections screen.`,
        'permanent',
      )
    if (a.status === 'needs_reauth') {
      throw new AdapterError(
        `TikTok needs you to sign in again for ${ctx.brandName}. Reconnect it on the Connections screen.`,
        'permanent',
      )
    }
    if (ctx.caption.length > PLATFORM_LIMITS.tiktok.captionMax) {
      throw new AdapterError(
        `The TikTok caption is ${ctx.caption.length} characters. The limit is ${PLATFORM_LIMITS.tiktok.captionMax}.`,
        'permanent',
      )
    }
    if (!/\.(mp4|mov|webm)$/i.test(ctx.videoAbsPath))
      throw new AdapterError('TikTok accepts MP4, MOV or WebM videos.', 'permanent')
    if (a.mode === 'direct') {
      const problem = tiktokSettingsProblem(this.settingsOf(ctx), null, 0)
      if (problem) throw new AdapterError(problem, 'permanent')
    }
  }

  private settingsOf(ctx: AdapterContext): TikTokPostSettings | undefined {
    return ctx.settings.tiktok as TikTokPostSettings | undefined
  }

  /** Runs a call with the account's token, refreshing it once if TikTok says it is no longer accepted. */
  private async withToken<T>(account: Account, fn: (token: string) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.d.accessToken(account.id))
    } catch (err) {
      if (err instanceof TikTokApiError && err.needsRefresh)
        return fn(await this.d.accessToken(account.id, true))
      throw err
    }
  }

  async publish(ctx: AdapterContext): Promise<AdapterResult> {
    const a = ctx.account as Account
    const direct = a.mode === 'direct'
    const size = statSync(ctx.videoAbsPath).size
    let st = ctx.getState()
    let publishId = typeof st.ttPublishId === 'string' ? st.ttPublishId : null

    if (!publishId) {
      let postInfo: Record<string, unknown> | undefined
      if (direct) {
        // Ask TikTok again right now. If the choice is gone, stop with a clear message instead of guessing.
        const info = await this.d.freshCreator(a.id)
        const s = this.settingsOf(ctx)
        const problem = tiktokSettingsProblem(s, info, ctx.videoDurationSeconds)
        if (problem) throw new AdapterError(problem, 'permanent')
        const t = s as TikTokPostSettings
        postInfo = {
          title: ctx.caption,
          privacy_level: t.privacy,
          disable_comment: !t.allowComment,
          disable_duet: !t.allowDuet,
          disable_stitch: !t.allowStitch,
          brand_content_toggle: t.commercialOn && t.brandedContent,
          brand_organic_toggle: t.commercialOn && t.yourBrand,
          is_aigc: ctx.aiFlag,
        }
      }
      const init = await this.withToken(a, (token) =>
        this.d.client.init(token, direct ? 'direct' : 'inbox', size, postInfo),
      )
      publishId = init.publishId
      ctx.setState({
        ttPublishId: publishId,
        ttUploadUrl: init.uploadUrl,
        ttChunkSize: init.chunkSize,
        ttChunkCount: init.count,
        ttUploadedChunks: 0,
        ttUploaded: false,
        ttStartedAtMs: ctx.nowMs(),
      })
      st = ctx.getState()
    }

    if (!st.ttUploaded) {
      try {
        await this.d.client.uploadChunks({
          uploadUrl: st.ttUploadUrl as string,
          filePath: ctx.videoAbsPath,
          fileSize: size,
          chunkSize: st.ttChunkSize as number,
          count: st.ttChunkCount as number,
          mime: mimeFor(ctx.videoAbsPath),
          startAtChunk: typeof st.ttUploadedChunks === 'number' ? st.ttUploadedChunks : 0,
          onProgress: (fraction, done) => {
            ctx.reportProgress(fraction)
            ctx.setState({ ttUploadedChunks: done })
          },
        })
      } catch (err) {
        // The upload address lives one hour. When it is gone, begin again with a fresh one.
        if (err instanceof TikTokApiError && err.code === 'upload_url_expired') this.forget(ctx)
        throw err
      }
      ctx.setState({ ttUploaded: true })
      this.d.host.log(
        'info',
        `TikTok received the video (${direct ? 'Direct post' : 'Drafts'}). Waiting for TikTok to process it.`,
        ctx,
      )
    }
    return { status: 'processing', externalId: publishId }
  }

  private forget(ctx: AdapterContext): void {
    ctx.setState({ ttPublishId: null, ttUploadUrl: null, ttUploaded: false, ttUploadedChunks: 0 })
  }

  async checkStatus(ctx: AdapterContext): Promise<AdapterResult> {
    const a = ctx.account
    const st = ctx.getState()
    const publishId = st.ttPublishId
    if (!a || typeof publishId !== 'string') return { status: 'processing' }
    const r = await this.withToken(a, (token) => this.d.client.status(token, publishId))
    switch (r.status) {
      case 'SEND_TO_USER_INBOX':
        this.d.host.notify(
          'TikTok draft ready',
          `TikTok draft ready for ${ctx.brandName}. Open TikTok, tap the inbox notification, add the AI label if needed, and post.`,
        )
        return { status: 'needs_action', externalId: publishId }
      case 'PUBLISH_COMPLETE': {
        const id = r.postIds[0]
        return {
          status: 'posted',
          externalId: id ?? publishId,
          externalUrl: id ? `https://www.tiktok.com/@/video/${id}` : undefined,
        }
      }
      case 'FAILED': {
        const reason = r.failReason || 'unknown reason'
        this.forget(ctx)
        throw new AdapterError(
          `TikTok could not post this video: ${reason}.`,
          TRANSIENT_REASONS.has(reason) ? 'transient' : 'permanent',
        )
      }
      default: {
        const started = typeof st.ttStartedAtMs === 'number' ? st.ttStartedAtMs : ctx.nowMs()
        if (ctx.nowMs() - started > PROCESSING_TIMEOUT_MS) {
          this.forget(ctx)
          throw new AdapterError(
            'TikTok is taking more than 30 minutes to process the video. Starting over.',
            'transient',
          )
        }
        return { status: 'processing', externalId: publishId }
      }
    }
  }

  async fetchStats(ctx: AdapterContext): Promise<Record<string, number>> {
    return fetchOneStats(this.d.stats, 'tiktok', ctx)
  }
}
