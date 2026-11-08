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
  /** Posted as the first comment after the video is live. Added in a later version. */
  firstComment?: string
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
    if (i.firstComment?.trim()) form.set('tiktok_first_comment', i.firstComment.trim())
    form.set('video', await openAsBlob(i.filePath), basename(i.filePath))
    await this.call(key, '/upload', { method: 'POST', body: form })
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
