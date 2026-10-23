import { createReadStream, statSync } from 'fs'
import { Readable } from 'stream'
import { OAuth2Client } from 'google-auth-library'
import { youtube, type youtube_v3 } from '@googleapis/youtube'
import { AdapterError } from '../adapters/types'
import { classifyGoogleError, isNetworkError } from './errors'
import { describeNetworkError } from '../network'
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
  /** Set when YouTube refused or removed the video, for example copyright. */
  rejectionReason?: string
  publishAt?: string
}

/** Everything the adapter needs from YouTube. Tests replace this with a mock. */
export interface YoutubeClientLike {
  uploadVideo(accountId: number, args: UploadArgs): Promise<UploadedVideo>
  videoStatus(accountId: number, videoId: string): Promise<VideoStatus | null>
  addToPlaylist(accountId: number, playlistId: string, videoId: string): Promise<void>
  /** Sets a custom thumbnail (long form only). Optional so older test doubles keep working. */
  setThumbnail?(accountId: number, videoId: string, filePath: string): Promise<void>
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
            `Could not reach YouTube: ${describeNetworkError(err)}`,
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

  /** Top level comments on a video, newest first. commentThreads.list costs 1 quota unit. */
  async listComments(
    accountId: number,
    videoId: string,
  ): Promise<Array<{ id: string; text: string; author: string; publishedAt: string }>> {
    const res = await this.call(accountId, (yt) =>
      yt.commentThreads.list({
        part: ['snippet'],
        videoId,
        maxResults: 50,
        order: 'time',
        textFormat: 'plainText',
      }),
    )
    this.quota.record('commentThreadsList')
    return (res.data.items ?? []).map((t) => ({
      id: t.snippet?.topLevelComment?.id ?? t.id ?? '',
      text: t.snippet?.topLevelComment?.snippet?.textDisplay ?? '',
      author: t.snippet?.topLevelComment?.snippet?.authorDisplayName ?? '',
      publishedAt: t.snippet?.topLevelComment?.snippet?.publishedAt ?? '',
    }))
  }

  /** Replies to a comment. comments.insert costs 50 quota units. */
  async replyToComment(accountId: number, parentId: string, text: string): Promise<string> {
    const res = await this.call(accountId, (yt) =>
      yt.comments.insert({
        part: ['snippet'],
        requestBody: { snippet: { parentId, textOriginal: text } },
      }),
    )
    this.quota.record('commentInsert')
    return res.data.id ?? ''
  }

  /** Posts a new top level comment on a video as the channel. commentThreads.insert costs 50 quota units. */
  async postComment(accountId: number, videoId: string, text: string): Promise<string> {
    const res = await this.call(accountId, (yt) =>
      yt.commentThreads.insert({
        part: ['snippet'],
        requestBody: {
          snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } },
        },
      }),
    )
    this.quota.record('commentThreadInsert')
    return res.data.snippet?.topLevelComment?.id ?? res.data.id ?? ''
  }

  /**
   * Sets who can see a video that is already on YouTube. videos.update replaces the whole status, so the current one is
   * read first and only privacyStatus changes. Costs 1 + 50 quota units.
   */
  async setPrivacy(
    accountId: number,
    videoId: string,
    privacy: 'private' | 'unlisted' | 'public',
  ): Promise<void> {
    const cur = await this.call(accountId, (yt) =>
      yt.videos.list({ part: ['status'], id: [videoId] }),
    )
    this.quota.record('videosList')
    const status = cur.data.items?.[0]?.status
    if (!status) throw new AdapterError('YouTube does not have that video any more.', 'permanent')
    await this.call(accountId, (yt) =>
      yt.videos.update({
        part: ['status'],
        requestBody: {
          id: videoId,
          status: {
            privacyStatus: privacy,
            selfDeclaredMadeForKids: status.selfDeclaredMadeForKids ?? false,
            embeddable: status.embeddable ?? true,
            license: status.license ?? 'youtube',
            publicStatsViewable: status.publicStatsViewable ?? true,
            containsSyntheticMedia: status.containsSyntheticMedia ?? undefined,
          },
        },
      }),
    )
    this.quota.record('videoUpdate')
  }

  /** Rejects an obvious spam comment (it is hidden, not deleted). */
  async rejectComment(accountId: number, commentId: string): Promise<void> {
    await this.call(accountId, (yt) =>
      yt.comments.setModerationStatus({ id: [commentId], moderationStatus: 'rejected' }),
    )
    this.quota.record('commentModerate')
  }

  /**
   * Changes the title, description or tags of a video that is already on YouTube. videos.update replaces the whole
   * snippet, so the current one is read first and only the given fields change. Costs 1 + 50 quota units.
   */
  async updateVideo(
    accountId: number,
    videoId: string,
    patch: { title?: string; description?: string; tags?: string[] },
  ): Promise<void> {
    const cur = await this.call(accountId, (yt) =>
      yt.videos.list({ part: ['snippet'], id: [videoId] }),
    )
    this.quota.record('videosList')
    const snippet = cur.data.items?.[0]?.snippet
    if (!snippet) throw new AdapterError('YouTube does not have that video any more.', 'permanent')
    await this.call(accountId, (yt) =>
      yt.videos.update({
        part: ['snippet'],
        requestBody: {
          id: videoId,
          snippet: {
            title: patch.title ?? snippet.title,
            description: patch.description ?? snippet.description,
            tags: patch.tags ?? snippet.tags ?? [],
            categoryId: snippet.categoryId,
            defaultLanguage: snippet.defaultLanguage ?? undefined,
          },
        },
      }),
    )
    this.quota.record('videoUpdate')
  }

  /** Top videos for a search. Costs 100 quota units, so it is used sparingly. */
  async searchVideos(
    accountId: number,
    q: string,
    max = 10,
  ): Promise<
    Array<{
      id: string
      title: string
      channel: string
      publishedAt: string | null
      views: number | null
    }>
  > {
    const res = await this.call(accountId, (yt) =>
      yt.search.list({
        part: ['snippet'],
        q,
        type: ['video'],
        order: 'viewCount',
        maxResults: max,
      }),
    )
    this.quota.record('searchList')
    const items = (res.data.items ?? []).filter((i) => i.id?.videoId)
    const ids = items.map((i) => i.id!.videoId!)
    const stats = ids.length ? await this.videoStatistics(accountId, ids) : new Map()
    return items.map((i) => ({
      id: i.id!.videoId!,
      title: i.snippet?.title ?? '',
      channel: i.snippet?.channelTitle ?? '',
      publishedAt: i.snippet?.publishedAt ?? null,
      views: stats.get(i.id!.videoId!)?.views ?? null,
    }))
  }

  /** A channel by its @handle or channel id: name, subscribers and its newest videos with views. */
  async channelWithRecent(
    accountId: number,
    handleOrId: string,
    recent = 8,
  ): Promise<{
    id: string
    title: string
    subscribers: number | null
    videos: Array<{ id: string; title: string; publishedAt: string | null; views: number | null }>
  } | null> {
    const isId = /^UC[\w-]{20,}$/.test(handleOrId)
    const res = await this.call(accountId, (yt) =>
      yt.channels.list(
        isId
          ? { part: ['snippet', 'statistics', 'contentDetails'], id: [handleOrId] }
          : {
              part: ['snippet', 'statistics', 'contentDetails'],
              forHandle: handleOrId.replace(/^@?/, '@'),
            },
      ),
    )
    this.quota.record('channelsList')
    const ch = res.data.items?.[0]
    if (!ch?.id) return null
    const uploads = ch.contentDetails?.relatedPlaylists?.uploads
    let videos: Array<{
      id: string
      title: string
      publishedAt: string | null
      views: number | null
    }> = []
    if (uploads) {
      const list = await this.call(accountId, (yt) =>
        yt.playlistItems.list({
          part: ['snippet', 'contentDetails'],
          playlistId: uploads,
          maxResults: recent,
        }),
      )
      this.quota.record('playlistItemsList')
      const ids = (list.data.items ?? [])
        .map((i) => i.contentDetails?.videoId)
        .filter((x): x is string => !!x)
      const stats = ids.length ? await this.videoStatistics(accountId, ids) : new Map()
      videos = (list.data.items ?? []).flatMap((i) =>
        i.contentDetails?.videoId
          ? [
              {
                id: i.contentDetails.videoId,
                title: i.snippet?.title ?? '',
                publishedAt: i.contentDetails.videoPublishedAt ?? null,
                views: stats.get(i.contentDetails.videoId)?.views ?? null,
              },
            ]
          : [],
      )
    }
    const subs = ch.statistics?.hiddenSubscriberCount
      ? null
      : ch.statistics?.subscriberCount
        ? Number(ch.statistics.subscriberCount)
        : null
    return { id: ch.id, title: ch.snippet?.title ?? '', subscribers: subs, videos }
  }

  /** Adds a caption track to a video. Costs 400 quota units per language. */
  async uploadCaption(
    accountId: number,
    videoId: string,
    lang: string,
    name: string,
    srt: string,
  ): Promise<void> {
    await this.call(accountId, (yt) =>
      yt.captions.insert({
        part: ['snippet'],
        requestBody: { snippet: { videoId, language: lang, name, isDraft: false } },
        media: { mimeType: 'application/octet-stream', body: Readable.from([srt]) },
      }),
    )
    this.quota.record('captionInsert')
  }

  /** The most popular videos right now in a category. Costs 1 quota unit. */
  async trending(
    accountId: number,
    categoryId: string,
    max = 12,
  ): Promise<Array<{ id: string; title: string; channel: string; views: number | null }>> {
    const res = await this.call(accountId, (yt) =>
      yt.videos.list({
        part: ['snippet', 'statistics'],
        chart: 'mostPopular',
        videoCategoryId: categoryId || undefined,
        regionCode: 'US',
        maxResults: max,
      }),
    )
    this.quota.record('videosList')
    return (res.data.items ?? []).map((v) => ({
      id: v.id ?? '',
      title: v.snippet?.title ?? '',
      channel: v.snippet?.channelTitle ?? '',
      views: v.statistics?.viewCount ? Number(v.statistics.viewCount) : null,
    }))
  }

  /** thumbnails.set costs 50 quota units. The channel must be verified; otherwise YouTube answers 403. */
  async setThumbnail(accountId: number, videoId: string, filePath: string): Promise<void> {
    const mime = filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
    await this.call(accountId, (yt) =>
      yt.thumbnails.set({ videoId, media: { mimeType: mime, body: createReadStream(filePath) } }),
    )
    this.quota.record('thumbnailsSet')
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
      rejectionReason: s.rejectionReason ?? undefined,
      publishAt: s.publishAt ?? undefined,
    }
  }

  /** Views, likes and comments for up to 50 videos in one call. Ids YouTube does not return are left out. */
  async videoStatistics(
    accountId: number,
    ids: string[],
  ): Promise<Map<string, { views: number | null; likes: number | null; comments: number | null }>> {
    const res = await this.call(accountId, (yt) =>
      yt.videos.list({ part: ['statistics'], id: ids, maxResults: 50 }),
    )
    this.quota.record('videosList')
    const out = new Map<
      string,
      { views: number | null; likes: number | null; comments: number | null }
    >()
    const n = (v: string | null | undefined) =>
      v === undefined || v === null || v === '' ? null : Number(v)
    for (const v of res.data.items ?? []) {
      if (v.id)
        out.set(v.id, {
          views: n(v.statistics?.viewCount),
          likes: n(v.statistics?.likeCount),
          comments: n(v.statistics?.commentCount),
        })
    }
    return out
  }

  /** Videos in a channel's uploads list, newest first. One quota unit per 50 videos, capped at `max`. */
  async listUploads(
    accountId: number,
    channelId: string,
    max = 500,
  ): Promise<
    Array<{
      id: string
      title: string
      publishedAt: string | null
      thumbnailUrl: string | null
    }>
  > {
    const ch = await this.call(accountId, (yt) =>
      yt.channels.list({ part: ['contentDetails'], id: [channelId], maxResults: 1 }),
    )
    this.quota.record('channelsList')
    // Every channel's uploads list is "UU" plus the rest of the channel id.
    const playlistId =
      ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ??
      (channelId.startsWith('UC') ? 'UU' + channelId.slice(2) : null)
    if (!playlistId) return []
    const out: Array<{
      id: string
      title: string
      publishedAt: string | null
      thumbnailUrl: string | null
    }> = []
    let pageToken: string | undefined
    do {
      const token = pageToken
      const res = await this.call(accountId, (yt) =>
        yt.playlistItems.list({
          part: ['snippet', 'contentDetails'],
          playlistId,
          maxResults: 50,
          pageToken: token,
        }),
      )
      this.quota.record('playlistItemsList')
      for (const it of res.data.items ?? []) {
        const id = it.contentDetails?.videoId
        if (!id) continue
        out.push({
          id,
          title: it.snippet?.title ?? '',
          publishedAt: it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt ?? null,
          thumbnailUrl:
            it.snippet?.thumbnails?.medium?.url ?? it.snippet?.thumbnails?.default?.url ?? null,
        })
      }
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken && out.length < max)
    return out.slice(0, max)
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
        throw new AdapterError(`Could not reach YouTube: ${describeNetworkError(err)}`, 'transient')
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
