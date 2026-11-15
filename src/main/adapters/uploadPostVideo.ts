import { AdapterError, ambiguous, unreachableIf, type AdapterContext, type AdapterResult, type PlatformAdapter } from './types'
import { UploadPostError, type UploadPostClient } from '../uploadpost/client'
import type { Platform } from '@shared/types'
import { PLATFORM_LABELS } from '@shared/platformLimits'

/** The platform's own form fields for one video, built from the post. */
export interface UploadFields {
  fields: Record<string, string | string[]>
  thumbnailPath?: string
}

export interface UploadPostVideoDeps {
  client: Pick<UploadPostClient, 'uploadVideo' | 'status'>
  apiKey: () => string | null
  profileFor: (brandId: number) => string
  /** Builds the platform's fields. Throws an AdapterError when the post cannot be made for this platform. */
  fieldsFor: (platform: Platform, ctx: AdapterContext) => UploadFields
  host: { log(level: 'info' | 'warn' | 'error', message: string, ctx: AdapterContext): void }
}

const PROCESSING_TIMEOUT_MS = 45 * 60_000

const STOP_WORDS =
  /reauth|re-auth|expired access|not configured|invalid_platforms|privacy_unavailable|not connected|unauthorized|forbidden|not allowed|policy|spam|duplicate|too short|too long|resolution|aspect/i

/**
 * Posts a video to YouTube, Facebook or Bluesky through Upload-Post. It sends at the post's time (Upload-Post and the
 * platform then publish it) and follows up with the request id until the platform says it is live.
 */
export class UploadPostVideoAdapter implements PlatformAdapter {
  constructor(
    readonly platform: Platform,
    private d: UploadPostVideoDeps,
  ) {}

  wantsHandoff(): boolean {
    return false
  }
  minHandoffLeadMs(): number {
    return 0
  }
  async connect(): Promise<void> {}
  async refreshIfNeeded(): Promise<void> {}

  private get label(): string {
    return PLATFORM_LABELS[this.platform]
  }

  private friendly(reason: string): string {
    if (/reauth|expired access/i.test(reason))
      return `${this.label} needs the account signed in again on Upload-Post.`
    if (/not configured|invalid_platforms|not connected/i.test(reason))
      return `This Upload-Post profile has no ${this.label} login.`
    return reason
  }

  async validate(ctx: AdapterContext): Promise<void> {
    if (!this.d.apiKey()) throw new AdapterError('The Upload-Post key is missing.', 'permanent')
    if (!this.d.profileFor(ctx.brandId))
      throw new AdapterError(`${ctx.brandName} has no Upload-Post profile name.`, 'permanent')
    if (!/\.(mp4|mov|webm|mpeg)$/i.test(ctx.videoAbsPath))
      throw new AdapterError(`${this.label} through Upload-Post takes MP4, MOV, WEBM or MPEG videos.`, 'permanent')
    this.d.fieldsFor(this.platform, ctx) // fails early on a bad title or description
  }

  async publish(ctx: AdapterContext): Promise<AdapterResult> {
    const st = ctx.getState()
    if (typeof st.upRequestId === 'string') return { status: 'processing', externalId: st.upRequestId }
    const key = this.d.apiKey() as string
    const seq = (typeof st.upSeq === 'number' ? st.upSeq : 0) + 1
    const requestId = `elo-${ctx.targetId}-${seq}-${Math.floor(ctx.nowMs() / 1000)}`
    ctx.setState({ upSeq: seq, upRequestId: requestId, upStartedAtMs: ctx.nowMs() })
    const built = this.d.fieldsFor(this.platform, ctx)
    try {
      await this.d.client.uploadVideo(key, {
        user: this.d.profileFor(ctx.brandId),
        platform: this.platform,
        requestId,
        filePath: ctx.videoAbsPath,
        fields: built.fields,
        thumbnailPath: built.thumbnailPath,
      })
    } catch (err) {
      ctx.setState({ upRequestId: null })
      throw this.asAdapterError(err)
    }
    this.d.host.log('info', `Upload-Post received the video for ${this.label}. Waiting for ${this.label} to publish it.`, ctx)
    return { status: 'processing', externalId: requestId }
  }

  async checkStatus(ctx: AdapterContext): Promise<AdapterResult> {
    const st = ctx.getState()
    const requestId = st.upRequestId
    const key = this.d.apiKey()
    if (typeof requestId !== 'string' || !key) return { status: 'processing' }
    let r
    try {
      r = await this.d.client.status(key, requestId)
    } catch (err) {
      throw this.asAdapterError(err)
    }
    const mine = r.results.find((x) => x.platform === this.platform)
    if (mine && !mine.success && (r.status === 'completed' || r.status === 'failed' || mine.message)) {
      ctx.setState({ upRequestId: null })
      const reason = (mine.message || 'unknown reason').replace(/\.$/, '')
      throw new AdapterError(
        `${this.label} could not post this video: ${this.friendly(reason)}`,
        STOP_WORDS.test(reason) ? 'permanent' : 'transient',
      )
    }
    if (r.status === 'failed') {
      ctx.setState({ upRequestId: null })
      throw new AdapterError(`Upload-Post could not post this video: ${this.friendly(r.message || 'unknown reason')}`, 'transient')
    }
    if (r.status === 'not_found') {
      ctx.setState({ upRequestId: null })
      throw ambiguous(new AdapterError('Upload-Post lost track of this upload. Starting over.', 'transient'))
    }
    if (mine?.success) {
      return {
        status: 'posted',
        externalId: mine.postId || requestId,
        externalUrl: mine.postUrl && /^https?:/.test(mine.postUrl) ? mine.postUrl : undefined,
      }
    }
    const started = typeof st.upStartedAtMs === 'number' ? st.upStartedAtMs : ctx.nowMs()
    if (ctx.nowMs() - started > PROCESSING_TIMEOUT_MS) {
      ctx.setState({ upRequestId: null })
      throw ambiguous(new AdapterError('Upload-Post has taken more than 45 minutes on this video. Starting over.', 'transient'))
    }
    return { status: 'processing', externalId: requestId }
  }

  private asAdapterError(err: unknown): AdapterError {
    if (err instanceof AdapterError) return err
    if (err instanceof UploadPostError) {
      if (err.status === 401) return new AdapterError('Upload-Post does not accept the key.', 'permanent')
      if (err.status === 403) return new AdapterError(`Upload-Post refused this post: ${err.message}.`, 'permanent')
      if (err.status === 404) return new AdapterError('Upload-Post does not know that profile name.', 'permanent')
      if (err.status === 429) {
        const e = new AdapterError(`Upload-Post says the limit is reached: ${err.message}`, 'transient')
        e.retryAfterMs = 60 * 60_000
        return e
      }
      if (err.status === 400 && STOP_WORDS.test(`${err.code ?? ''} ${err.message}`))
        return new AdapterError(this.friendly(`${err.code ?? ''} ${err.message}`), 'permanent')
      return unreachableIf(
        new AdapterError(`Upload-Post problem: ${this.friendly(err.message)}`, err.status === 400 ? 'permanent' : 'transient'),
        err.status,
      )
    }
    return new AdapterError(`Upload-Post problem: ${(err as Error).message}`, 'transient')
  }
}
