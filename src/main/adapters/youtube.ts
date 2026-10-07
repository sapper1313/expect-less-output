import type { Account, BrandDefaults } from '@shared/types'
import {
  AdapterError,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
} from './types'
import { LOCKED_MESSAGE, STUDIO_URL } from '../google/config'
import { buildVideoMetadata } from '../google/metadata'
import type { YoutubeClientLike } from '../google/youtubeClient'

/** The bits of the Mac this adapter uses. Replaced with fakes in tests. */
export interface YoutubeHost {
  notify(title: string, body: string): void
  copyText(text: string): void
  openExternal(url: string): void
}

export interface YoutubeAdapterDeps {
  client: YoutubeClientLike
  host: YoutubeHost
  brandDefaults: (brandId: number) => BrandDefaults
  log: (level: 'info' | 'warn' | 'error', message: string, ctx: AdapterContext) => void
  /** Words YouTube may take to flip a scheduled video to public. */
  publishGraceMs?: number
}

const FIFTEEN_MIN = 15 * 60_000
const shortsUrl = (id: string) => `https://youtube.com/shorts/${id}`

export class YoutubeAdapter implements PlatformAdapter {
  readonly platform = 'youtube' as const
  constructor(private d: YoutubeAdapterDeps) {}

  wantsHandoff(account: Account | null): boolean {
    return account?.mode === 'auto'
  }
  minHandoffLeadMs(account: Account | null): number {
    return account?.mode === 'auto' ? FIFTEEN_MIN : 0
  }

  async connect(): Promise<void> {}
  async refreshIfNeeded(): Promise<void> {}

  async validate(ctx: AdapterContext): Promise<void> {
    const a = ctx.account
    if (!a)
      throw new AdapterError(
        `${ctx.brandName} has no YouTube connection. Connect one on the Connections screen.`,
        'permanent',
      )
    if (a.status === 'needs_reauth') {
      throw new AdapterError(
        `YouTube needs you to sign in again for ${ctx.brandName}. Reconnect it on the Connections screen.`,
        'permanent',
      )
    }
    if (a.status !== 'connected')
      throw new AdapterError(
        `The YouTube connection for ${ctx.brandName} has a problem. Check Connections.`,
        'permanent',
      )
    if (!['manual_assist', 'test_private', 'auto'].includes(a.mode)) {
      throw new AdapterError(`Unknown YouTube mode "${a.mode}".`, 'permanent')
    }
    // Build the metadata now so bad titles and descriptions fail early, before any upload.
    this.metadata(ctx, 'private')
  }

  private metadata(ctx: AdapterContext, privacy: 'private' | 'public', publishAt?: string) {
    const d = this.d.brandDefaults(ctx.brandId)
    return buildVideoMetadata({
      title: ctx.title,
      caption: ctx.caption,
      categoryId: d.youtubeCategoryId,
      madeForKids: d.youtubeMadeForKids,
      aiFlag: ctx.aiFlag,
      appendShorts: d.youtubeAppendShorts,
      privacy,
      publishAt,
    })
  }

  /** Uploads once. If a previous try already got a video id, that id is reused so nothing is posted twice. */
  private async upload(
    ctx: AdapterContext,
    privacy: 'private' | 'public',
    publishAt?: string,
  ): Promise<{ id: string; privacyStatus?: string }> {
    const state = ctx.getState()
    let id = typeof state.videoId === 'string' ? state.videoId : null
    let privacyStatus: string | undefined =
      typeof state.privacyStatus === 'string' ? state.privacyStatus : undefined
    if (!id) {
      const accountId = ctx.account!.id
      const video = await this.d.client.uploadVideo(accountId, {
        filePath: ctx.videoAbsPath,
        metadata: this.metadata(ctx, privacy, publishAt),
        sessionUrl: typeof state.uploadSession === 'string' ? state.uploadSession : null,
        onSession: (url) => ctx.setState({ uploadSession: url }),
        onProgress: (f) => ctx.reportProgress(f),
      })
      id = video.id
      privacyStatus = video.privacyStatus
      ctx.setState({ videoId: id, privacyStatus: privacyStatus ?? null, uploadSession: null })
      this.d.log('info', `Uploaded to YouTube as ${privacyStatus ?? privacy}.`, ctx)
    }
    if (!state.playlistDone) {
      const playlist = this.d.brandDefaults(ctx.brandId).youtubePlaylistId
      if (playlist) {
        try {
          await this.d.client.addToPlaylist(ctx.account!.id, playlist, id)
          ctx.setState({ playlistDone: true })
        } catch (err) {
          // The video is already up. A playlist hiccup must not cause a second upload.
          this.d.log(
            'warn',
            `Uploaded, but could not add it to the playlist: ${(err as Error).message}`,
            ctx,
          )
          ctx.setState({ playlistDone: true })
        }
      }
    }
    return { id, privacyStatus }
  }

  async handOff(ctx: AdapterContext): Promise<AdapterResult> {
    // Auto mode: upload now as private with publishAt so YouTube publishes at the exact time.
    const v = await this.upload(ctx, 'private', ctx.scheduledAtUtc)
    return { status: 'handed_off', externalId: v.id, externalUrl: shortsUrl(v.id) }
  }

  async publish(ctx: AdapterContext): Promise<AdapterResult> {
    const mode = ctx.account?.mode
    if (mode === 'manual_assist') return this.manualAssist(ctx)
    if (mode === 'test_private') {
      const v = await this.upload(ctx, 'private')
      return { status: 'posted', externalId: v.id, externalUrl: shortsUrl(v.id) }
    }
    // Auto mode with no time for an early handoff: upload as public right now.
    const v = await this.upload(ctx, 'public')
    if (v.privacyStatus && v.privacyStatus !== 'public')
      throw new AdapterError(LOCKED_MESSAGE, 'permanent')
    return { status: 'posted', externalId: v.id, externalUrl: shortsUrl(v.id) }
  }

  private manualAssist(ctx: AdapterContext): AdapterResult {
    const description = this.metadata(ctx, 'private').snippet.description
    this.d.host.notify('Time to post on YouTube', `${ctx.brandName}: ${ctx.title}`)
    this.d.host.copyText(`${ctx.title}\n\n${description}`)
    this.d.host.openExternal(STUDIO_URL)
    this.d.log('info', 'Manual assist: title and description copied, YouTube Studio opened.', ctx)
    return { status: 'needs_action' }
  }

  async checkStatus(ctx: AdapterContext, nowMs: number): Promise<AdapterResult> {
    const id = ctx.getState().videoId
    if (typeof id !== 'string' || !ctx.account) return { status: 'handed_off' }
    const st = await this.d.client.videoStatus(ctx.account.id, id)
    if (!st)
      throw new AdapterError(
        'The scheduled video is gone from YouTube. It may have been deleted. Reschedule the post.',
        'permanent',
      )
    if (st.privacyStatus === 'public' || st.privacyStatus === 'unlisted') {
      return { status: 'posted', externalId: id, externalUrl: shortsUrl(id) }
    }
    const lateBy = nowMs - new Date(ctx.scheduledAtUtc).getTime()
    if (lateBy > (this.d.publishGraceMs ?? 10 * 60_000))
      throw new AdapterError(LOCKED_MESSAGE, 'permanent')
    return { status: 'handed_off' }
  }
}
