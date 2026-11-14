import { AdapterError, type AdapterContext, type AdapterResult, type PlatformAdapter } from './types'
import { PLATFORM_LIMITS } from '@shared/platformLimits'
import { UploadPostError, type UploadPostClient } from '../uploadpost/client'

export interface UploadPostInstagramDeps {
  client: Pick<UploadPostClient, 'uploadInstagram' | 'status'>
  apiKey: () => string | null
  profileFor: (brandId: number) => string
  host: { log(level: 'info' | 'warn' | 'error', message: string, ctx: AdapterContext): void }
}

const PROCESSING_TIMEOUT_MS = 45 * 60_000

/** Words in an Upload-Post or TikTok message that mean waiting will not fix it. Everything else is tried again. */
const STOP_WORDS =
  /reauth|re-auth|expired access|not configured|invalid_platforms|privacy_unavailable|not connected|unauthorized|forbidden|not allowed|policy|spam|duplicate|too short|too long|resolution|aspect/i

function friendly(reason: string): string {
  if (/reauth|expired access/i.test(reason))
    return 'Instagram needs the account signed in again on Upload-Post. Open their site, reconnect Instagram for this profile, then press Retry.'
  if (/not configured|invalid_platforms|not connected/i.test(reason))
    return 'This Upload-Post profile has no Instagram login. Connect Instagram to the profile on their site, then press Retry.'
  return reason
}

/** Posts an Instagram Reel through Upload-Post. Used for a channel with Instagram ticked on the Upload-Post page. */
export class UploadPostInstagramAdapter implements PlatformAdapter {
  readonly platform = 'instagram' as const
  constructor(private d: UploadPostInstagramDeps) {}

  wantsHandoff(): boolean {
    return false
  }
  minHandoffLeadMs(): number {
    return 0
  }
  async connect(): Promise<void> {}
  async refreshIfNeeded(): Promise<void> {}

  async validate(ctx: AdapterContext): Promise<void> {
    if (!this.d.apiKey())
      throw new AdapterError(
        'The Upload-Post key is missing. Add it in AI Settings, on the Upload-Post card.',
        'permanent',
      )
    if (!this.d.profileFor(ctx.brandId))
      throw new AdapterError(
        `${ctx.brandName} has no Upload-Post profile name. Add it in AI Settings, on the Upload-Post card.`,
        'permanent',
      )
    const lim = PLATFORM_LIMITS.instagram
    if (ctx.caption.length > lim.captionMax)
      throw new AdapterError(
        `The Instagram caption is ${ctx.caption.length} characters. The limit is ${lim.captionMax}.`,
        'permanent',
      )
    if (!/\.(mp4|mov)$/i.test(ctx.videoAbsPath))
      throw new AdapterError('Instagram Reels accept MP4 or MOV videos.', 'permanent')
  }

  async publish(ctx: AdapterContext): Promise<AdapterResult> {
    const st = ctx.getState()
    if (typeof st.upRequestId === 'string') return { status: 'processing', externalId: st.upRequestId }
    const key = this.d.apiKey() as string
    const seq = (typeof st.upSeq === 'number' ? st.upSeq : 0) + 1
    // Saved before sending, so a crash in the middle can still be followed up by asking about this id.
    const requestId = `elo-${ctx.targetId}-${seq}-${Math.floor(ctx.nowMs() / 1000)}`
    ctx.setState({ upSeq: seq, upRequestId: requestId, upStartedAtMs: ctx.nowMs() })
    try {
      await this.d.client.uploadInstagram(key, {
        user: this.d.profileFor(ctx.brandId),
        caption: ctx.caption,
        filePath: ctx.videoAbsPath,
        requestId,
        coverTimestampMs:
          typeof ctx.settings.coverTimestampMs === 'number' ? ctx.settings.coverTimestampMs : undefined,
      })
    } catch (err) {
      ctx.setState({ upRequestId: null })
      throw this.asAdapterError(err)
    }
    this.d.host.log('info', 'Upload-Post received the video for Instagram. Waiting for Instagram to publish it.', ctx)
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
    const mine = r.results.find((x) => x.platform === 'instagram')
    if (mine && !mine.success && (r.status === 'completed' || r.status === 'failed' || mine.message)) {
      ctx.setState({ upRequestId: null })
      const reason = (mine.message || 'unknown reason').replace(/\.$/, '')
      throw new AdapterError(
        `Instagram could not post this video: ${friendly(reason)}`,
        STOP_WORDS.test(reason) ? 'permanent' : 'transient',
      )
    }
    if (r.status === 'failed') {
      ctx.setState({ upRequestId: null })
      throw new AdapterError(`Upload-Post could not post this video: ${friendly(r.message || 'unknown reason')}`, 'transient')
    }
    if (r.status === 'not_found') {
      ctx.setState({ upRequestId: null })
      throw new AdapterError('Upload-Post lost track of this upload. Starting over.', 'transient')
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
      throw new AdapterError('Upload-Post has taken more than 45 minutes on this video. Starting over.', 'transient')
    }
    return { status: 'processing', externalId: requestId }
  }

  private asAdapterError(err: unknown): AdapterError {
    if (err instanceof AdapterError) return err
    if (err instanceof UploadPostError) {
      if (err.status === 401)
        return new AdapterError('Upload-Post does not accept the key. Copy it again from their site into AI Settings.', 'permanent')
      if (err.status === 403)
        return new AdapterError(
          `Upload-Post refused this post: ${err.message}.`,
          'permanent',
        )
      if (err.status === 404)
        return new AdapterError(
          'Upload-Post does not know that profile name. Check the spelling on the Upload-Post card.',
          'permanent',
        )
      if (err.status === 429) {
        const e = new AdapterError(`Upload-Post says the limit is reached: ${err.message}`, 'transient')
        e.retryAfterMs = 60 * 60_000
        return e
      }
      if (err.status === 400 && STOP_WORDS.test(`${err.code ?? ''} ${err.message}`))
        return new AdapterError(friendly(`${err.code ?? ''} ${err.message}`), 'permanent')
      return new AdapterError(`Upload-Post problem: ${friendly(err.message)}`, err.status === 400 ? 'permanent' : 'transient')
    }
    return new AdapterError(`Upload-Post problem: ${(err as Error).message}`, 'transient')
  }
}
