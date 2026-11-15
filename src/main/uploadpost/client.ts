import { openAsBlob } from 'fs'
import { basename } from 'path'
import type { UploadPostProfileInfo } from '@shared/uploadPost'

export const UPLOAD_POST_BASE = 'https://api.upload-post.com/api'

/** An answer from Upload-Post that was not a success. `status` is 0 when there was no answer at all. */
export class UploadPostError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
    this.name = 'UploadPostError'
  }
}

export interface UploadPostResult {
  platform: string
  success: boolean
  message?: string
  postId?: string | null
  postUrl?: string | null
  fallbackToInbox?: boolean
  warnings?: string[]
}

export interface UploadPostStatus {
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'not_found'
  results: UploadPostResult[]
  message?: string
}

export interface UploadTikTokInput {
  user: string
  /** The caption TikTok shows. */
  title: string
  filePath: string
  requestId: string
  privacy: string
  aiGenerated: boolean
  coverTimestampMs?: number
}

export interface UploadInstagramInput {
  user: string
  /** The caption Instagram shows. */
  caption: string
  filePath: string
  requestId: string
  coverTimestampMs?: number
}

/**
 * True when Upload-Post clearly refused or could not do a write (a 4xx answer). A time out, no answer at all, or a 5xx
 * is unsure: the comment or message may have gone through, so ELO's own login must not send it again.
 * A 429 (slow down) is not a failure either, it is a wait.
 */
export function isDefinitiveFailure(err: unknown): boolean {
  if (!(err instanceof UploadPostError)) return false
  return err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429
}

type Fetch = typeof fetch

/** Plain fetch calls to Upload-Post. The key is passed in for each call and never stored here. */
export class UploadPostClient {
  constructor(
    private f: Fetch = (...a) => fetch(...a),
    private base = UPLOAD_POST_BASE,
  ) {}

  private async call(key: string, path: string, init: RequestInit = {}): Promise<any> {
    let res: Response
    try {
      res = await this.f(`${this.base}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Apikey ${key}` },
      })
    } catch (err) {
      throw new UploadPostError(
        `Could not reach Upload-Post (${(err as Error).message}). Check the internet connection.`,
        0,
      )
    }
    const text = await res.text()
    let body: any
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    if (!res.ok) {
      const msg = (body && (body.message || body.error)) || text.slice(0, 200) || `HTTP ${res.status}`
      throw new UploadPostError(String(msg), res.status, body?.error_code ?? body?.code)
    }
    return body
  }

  /** The profiles on the account and which networks each one has a login for. */
  async profiles(key: string): Promise<UploadPostProfileInfo[]> {
    const body = await this.call(key, '/uploadposts/users')
    const list = Array.isArray(body?.profiles) ? body.profiles : []
    return list.map((p: any) => ({
      username: String(p.username ?? ''),
      connected: Object.entries(p.social_accounts ?? {})
        .filter(([, v]) => !!v && !(typeof v === 'object' && Object.keys(v as object).length === 0))
        .map(([k]) => k),
    }))
  }

  /** Starts a TikTok post. Returns at once; the video keeps uploading on Upload-Post's side. */
  async uploadTikTok(key: string, i: UploadTikTokInput): Promise<void> {
    const form = new FormData()
    form.set('user', i.user)
    form.append('platform[]', 'tiktok')
    form.set('title', i.title)
    form.set('tiktok_title', i.title)
    form.set('async_upload', 'true')
    form.set('request_id', i.requestId)
    form.set('post_mode', 'DIRECT_POST')
    form.set('privacy_level', i.privacy)
    form.set('is_aigc', i.aiGenerated ? 'true' : 'false')
    if (typeof i.coverTimestampMs === 'number') form.set('cover_timestamp', String(i.coverTimestampMs))
    form.set('video', await openAsBlob(i.filePath), basename(i.filePath))
    await this.call(key, '/upload', { method: 'POST', body: form })
  }

  /** Starts an Instagram Reel. Returns at once; the video keeps uploading on Upload-Post's side. */
  async uploadInstagram(key: string, i: UploadInstagramInput): Promise<void> {
    const form = new FormData()
    form.set('user', i.user)
    form.append('platform[]', 'instagram')
    form.set('title', i.caption)
    form.set('instagram_title', i.caption)
    form.set('media_type', 'REELS')
    form.set('share_to_feed', 'true')
    form.set('async_upload', 'true')
    form.set('request_id', i.requestId)
    if (typeof i.coverTimestampMs === 'number') form.set('thumb_offset', String(i.coverTimestampMs))
    form.set('video', await openAsBlob(i.filePath), basename(i.filePath))
    await this.call(key, '/upload', { method: 'POST', body: form })
  }

  /**
   * Starts a video post on any platform (YouTube, Facebook, Bluesky and the rest). `fields` are the platform's own
   * form fields; a value may be a list (sent once per item, such as tags). Returns at once; the video keeps
   * uploading on Upload-Post's side and is followed up with its request id.
   */
  async uploadVideo(
    key: string,
    i: { user: string; platform: string; requestId: string; filePath: string; fields: Record<string, string | string[]>; thumbnailPath?: string },
  ): Promise<void> {
    const form = new FormData()
    form.set('user', i.user)
    form.append('platform[]', i.platform)
    form.set('async_upload', 'true')
    form.set('request_id', i.requestId)
    for (const [k, v] of Object.entries(i.fields)) {
      if (Array.isArray(v)) for (const x of v) form.append(k, x)
      else form.set(k, v)
    }
    form.set('video', await openAsBlob(i.filePath), basename(i.filePath))
    if (i.thumbnailPath) form.set('thumbnail', await openAsBlob(i.thumbnailPath), basename(i.thumbnailPath))
    await this.call(key, '/upload', { method: 'POST', body: form })
  }

  /**
   * Views, likes, comments and shares of one post. Looked up by the upload's request id when there is one, otherwise by
   * the platform's own post id. Returns the numbers Upload-Post has, or an empty object when it has none.
   */
  async postAnalytics(
    key: string,
    i: { platform: string; user: string; requestId?: string; platformPostId?: string },
  ): Promise<{ metrics: Record<string, number>; postId: string | null; postUrl: string | null; error: string | null }> {
    let r: any
    if (i.requestId) {
      r = await this.call(key, `/uploadposts/post-analytics/${encodeURIComponent(i.requestId)}?platform=${encodeURIComponent(i.platform)}`)
    } else if (i.platformPostId) {
      const q = new URLSearchParams({ platform_post_id: i.platformPostId, platform: i.platform, user: i.user })
      r = await this.call(key, `/uploadposts/post-analytics?${q.toString()}`)
    } else {
      throw new UploadPostError('No upload id or post id to look up.', 0)
    }
    const mine = r?.platforms?.[i.platform] ?? {}
    const raw = (mine.post_metrics && typeof mine.post_metrics === 'object' ? mine.post_metrics : {}) as Record<string, unknown>
    const metrics: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) metrics[k] = v
    return {
      metrics,
      postId: mine.platform_post_id ? String(mine.platform_post_id) : null,
      postUrl: mine.post_url ? String(mine.post_url) : null,
      error: (mine.post_metrics_error ?? r?.post_metrics_error ?? mine.error_message ?? null) as string | null,
    }
  }

  /** A top-level comment on one of your posts (or a reply, when commentId is given). */
  async createComment(
    key: string,
    i: { platform: string; user: string; message: string; postId?: string; postUrl?: string; commentId?: string },
  ): Promise<{ id: string | null; warnings: string[] }> {
    const body: Record<string, string> = { platform: i.platform, user: i.user, message: i.message }
    if (i.commentId) body.comment_id = i.commentId
    else if (i.postId) body.post_id = i.postId
    else if (i.postUrl) body.post_url = i.postUrl
    const r = await this.call(key, '/uploadposts/comments/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { id: r?.id ?? null, warnings: Array.isArray(r?.warnings) ? r.warnings : [] }
  }

  /** Account numbers for one profile on several platforms. The answer is keyed by platform name. */
  async analytics(key: string, user: string, platforms: string[], extra: { pageId?: string } = {}): Promise<Record<string, any>> {
    const q = new URLSearchParams({ platforms: platforms.join(',') })
    if (extra.pageId) q.set('page_id', extra.pageId)
    const r = await this.call(key, `/analytics/${encodeURIComponent(user)}?${q.toString()}`)
    return r && typeof r === 'object' ? r : {}
  }

  /** Who follows a TikTok account and when they are online. */
  async audience(key: string, user: string, platform: string): Promise<any> {
    return this.call(key, `/uploadposts/audience?platform=${encodeURIComponent(platform)}&user=${encodeURIComponent(user)}`)
  }

  /** Top-level comments on one post, newest first. Only the first page is read. */
  async listComments(
    key: string,
    i: { platform: string; user: string; postId?: string; postUrl?: string; limit?: number },
  ): Promise<Array<{ id: string; text: string; at: string | null; userId: string; username: string }>> {
    const q = new URLSearchParams({ platform: i.platform, user: i.user, limit: String(i.limit ?? 50) })
    if (i.postId) q.set('post_id', i.postId)
    else if (i.postUrl) q.set('post_url', i.postUrl)
    const r = await this.call(key, `/uploadposts/comments?${q.toString()}`)
    return (Array.isArray(r?.comments) ? r.comments : []).map((c: any) => ({
      id: String(c.id),
      text: String(c.text ?? c.message ?? ''),
      at: c.timestamp ?? c.created_time ?? null,
      userId: String(c.user?.id ?? c.from?.id ?? ''),
      username: String(c.user?.username ?? c.from?.username ?? c.author ?? ''),
    }))
  }

  /** Instagram DM conversations with their recent messages. */
  async dmConversations(key: string, user: string): Promise<any[]> {
    const r = await this.call(key, `/uploadposts/dms/conversations?platform=instagram&user=${encodeURIComponent(user)}`)
    return Array.isArray(r?.conversations) ? r.conversations : []
  }

  async sendDm(key: string, i: { user: string; recipientId: string; message: string }): Promise<void> {
    await this.call(key, '/uploadposts/dms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'instagram', user: i.user, recipient_id: i.recipientId, message: i.message }),
    })
  }

  async status(key: string, requestId: string): Promise<UploadPostStatus> {
    try {
      const b = await this.call(key, `/uploadposts/status?request_id=${encodeURIComponent(requestId)}`)
      return {
        status: (b?.status ?? 'pending') as UploadPostStatus['status'],
        message: b?.message,
        results: (Array.isArray(b?.results) ? b.results : []).map((r: any) => ({
          platform: String(r.platform ?? ''),
          success: r.success === true,
          message: r.message ?? r.error,
          postId: r.platform_post_id ?? r.post_id ?? null,
          postUrl: r.post_url ?? r.url ?? null,
          fallbackToInbox: r.fallback_to_inbox === true,
          warnings: Array.isArray(r.warnings) ? r.warnings : [],
        })),
      }
    } catch (err) {
      if (err instanceof UploadPostError && err.status === 404)
        return { status: 'not_found', results: [], message: err.message }
      throw err
    }
  }
}
