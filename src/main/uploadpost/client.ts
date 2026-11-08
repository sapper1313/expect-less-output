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
