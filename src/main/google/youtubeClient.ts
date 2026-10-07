import { statSync } from 'fs'
import { OAuth2Client } from 'google-auth-library'
import { youtube, type youtube_v3 } from '@googleapis/youtube'
import { AdapterError } from '../adapters/types'
import { classifyGoogleError, isNetworkError } from './errors'
import type { GoogleUrls } from './config'
import type { QuotaTracker } from './quota'
import type { TokenManager } from './tokens'
import { resumableUpload, type UploadedVideo } from './uploader'
import type { VideoMetadata } from './metadata'
import type { YoutubeChannel, YoutubeOption } from '@shared/types'

export interface UploadArgs {
  filePath: string
  metadata: VideoMetadata
  sessionUrl?: string | null
  onSession?: (url: string | null) => void
  onProgress?: (fraction: number) => void
}

export interface VideoStatus {
  privacyStatus: string
  uploadStatus?: string
  publishAt?: string
}

/** Everything the adapter needs from YouTube. Tests replace this with a mock. */
export interface YoutubeClientLike {
  uploadVideo(accountId: number, args: UploadArgs): Promise<UploadedVideo>
  videoStatus(accountId: number, videoId: string): Promise<VideoStatus | null>
  addToPlaylist(accountId: number, playlistId: string, videoId: string): Promise<void>
}

export class YoutubeClient implements YoutubeClientLike {
  constructor(
    private tokens: TokenManager,
    private urls: GoogleUrls,
    private quota: QuotaTracker,
  ) {}

  private async api(accountId: number, forceRefresh = false): Promise<youtube_v3.Youtube> {
    const auth = new OAuth2Client()
    auth.setCredentials({ access_token: await this.tokens.getAccessToken(accountId, forceRefresh) })
    return youtube({ version: 'v3', auth, rootUrl: this.urls.apiRoot })
  }

  /** Runs one API call, refreshing the token once on a 401, and maps failures to adapter errors. */
  private async call<T>(accountId: number, fn: (yt: youtube_v3.Youtube) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn(await this.api(accountId, attempt > 0))
      } catch (err) {
        if (err instanceof AdapterError) throw err
        const e = err as {
          code?: number | string
          status?: number
          response?: { status?: number; data?: any }
          errors?: Array<{ reason?: string }>
          message?: string
        }
        const status = e.response?.status ?? e.status ?? (typeof e.code === 'number' ? e.code : 0)
        if (status === 401 && attempt === 0) continue
        if (!status && isNetworkError(err))
          throw new AdapterError(
            `Could not reach YouTube: ${e.message ?? 'network error'}`,
            'transient',
          )
        const reason = e.response?.data?.error?.errors?.[0]?.reason ?? e.errors?.[0]?.reason ?? ''
        throw classifyGoogleError(
          status,
          reason,
          e.response?.data?.error?.message ?? e.message ?? '',
        )
      }
    }
  }

  async uploadVideo(accountId: number, args: UploadArgs): Promise<UploadedVideo> {
    if (this.quota.uploadsLeft() <= 0) {
      throw new AdapterError(
        'The daily YouTube upload limit (100) is used up. It resets at midnight Pacific.',
        'permanent',
      )
    }
    const size = statSync(args.filePath).size
    const initUrl = `${this.urls.uploadUrl}?uploadType=resumable&part=snippet,status&notifySubscribers=false`
    const video = await resumableUpload({
      initUrl,
      accessToken: (force) => this.tokens.getAccessToken(accountId, force),
      metadata: args.metadata,
      filePath: args.filePath,
      fileSize: size,
      sessionUrl: args.sessionUrl,
      onSession: args.onSession,
      onProgress: (sent, total) => args.onProgress?.(total ? sent / total : 0),
    })
    this.quota.record('videoInsert')
    return video
  }

  async videoStatus(accountId: number, videoId: string): Promise<VideoStatus | null> {
    const res = await this.call(accountId, (yt) =>
      yt.videos.list({ part: ['status'], id: [videoId] }),
    )
    this.quota.record('videosList')
    const s = res.data.items?.[0]?.status
    if (!s) return null
    return {
      privacyStatus: s.privacyStatus ?? 'unknown',
      uploadStatus: s.uploadStatus ?? undefined,
      publishAt: s.publishAt ?? undefined,
    }
  }

  async addToPlaylist(accountId: number, playlistId: string, videoId: string): Promise<void> {
    await this.call(accountId, (yt) =>
      yt.playlistItems.insert({
        part: ['snippet'],
        requestBody: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } },
      }),
    )
    this.quota.record('playlistItemInsert')
  }

  async myChannels(accountId: number): Promise<YoutubeChannel[]> {
    const res = await this.call(accountId, (yt) =>
      yt.channels.list({ part: ['snippet'], mine: true, maxResults: 50 }),
    )
    this.quota.record('channelsList')
    return channelsOf(res.data)
  }

  /** Used during sign-in, before the account has been saved, so there is no account id to refresh yet. */
  async channelsForToken(accessToken: string): Promise<YoutubeChannel[]> {
    const auth = new OAuth2Client()
    auth.setCredentials({ access_token: accessToken })
    const yt = youtube({ version: 'v3', auth, rootUrl: this.urls.apiRoot })
    try {
      const res = await yt.channels.list({ part: ['snippet'], mine: true, maxResults: 50 })
      this.quota.record('channelsList')
      return channelsOf(res.data)
    } catch (err) {
      const e = err as { response?: { status?: number; data?: any }; message?: string }
      const status = e.response?.status ?? 0
      if (!status && isNetworkError(err))
        throw new AdapterError(
          `Could not reach YouTube: ${e.message ?? 'network error'}`,
          'transient',
        )
      throw classifyGoogleError(
        status,
        e.response?.data?.error?.errors?.[0]?.reason ?? '',
        e.response?.data?.error?.message ?? e.message ?? '',
      )
    }
  }

  async playlists(accountId: number): Promise<YoutubeOption[]> {
    const out: YoutubeOption[] = []
    let pageToken: string | undefined
    do {
      const res = await this.call(accountId, (yt) =>
        yt.playlists.list({ part: ['snippet'], mine: true, maxResults: 50, pageToken }),
      )
      this.quota.record('playlistsList')
      for (const p of res.data.items ?? [])
        if (p.id) out.push({ id: p.id, title: p.snippet?.title ?? p.id })
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken && out.length < 200)
    return out
  }

  async categories(accountId: number): Promise<YoutubeOption[]> {
    const res = await this.call(accountId, (yt) =>
      yt.videoCategories.list({ part: ['snippet'], regionCode: 'US' }),
    )
    this.quota.record('videoCategoriesList')
    return (res.data.items ?? [])
      .filter((c) => c.id && c.snippet?.assignable)
      .map((c) => ({ id: c.id as string, title: c.snippet?.title ?? (c.id as string) }))
  }
}

export function channelsOf(data: youtube_v3.Schema$ChannelListResponse): YoutubeChannel[] {
  return (data.items ?? [])
    .filter((c) => c.id)
    .map((c) => ({
      id: c.id as string,
      title: c.snippet?.title ?? 'Untitled channel',
      avatarUrl: c.snippet?.thumbnails?.default?.url ?? null,
    }))
}
