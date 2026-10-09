import { SocialError, httpError } from './errors'

export interface Reply {
  id: string
  text: string
  username: string
  at: string
}

/**
 * Threads publishing, from the official docs (read 2026-10-09). A video post is three calls: create a container with a
 * public video_url, wait until it has finished processing (about 30 seconds), then publish it. Replies use reply_to_id.
 * The reply listing endpoint is the documented /{media-id}/replies and is marked unverified until a live account runs it.
 */
export class ThreadsClient {
  constructor(
    private token: () => string | null,
    private fetchImpl: typeof fetch = fetch,
    private base = 'https://graph.threads.net/v1.0',
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private tok(): string {
    const t = this.token()
    if (!t) throw new SocialError('The Threads token is not set. Add it in Studio Settings.', 'permanent')
    return t
  }

  private async req<T>(method: 'GET' | 'POST', path: string, params: Record<string, string | undefined> = {}): Promise<T> {
    const q = new URLSearchParams({ access_token: this.tok() })
    const body = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined) (method === 'GET' ? q : body).set(k, v)
    let res: Response
    try {
      res = await this.fetchImpl(`${this.base}${path}?${q}`, { method, body: method === 'POST' ? body : undefined, signal: AbortSignal.timeout(60_000) })
    } catch (e) {
      throw new SocialError(`Could not reach Threads: ${(e as Error).message}`, 'transient')
    }
    if (!res.ok) throw await httpError('Threads', res)
    return (await res.json()) as T
  }

  async me(): Promise<{ id: string; username: string }> {
    return this.req('GET', '/me', { fields: 'id,username' })
  }

  /** A video post. `state` remembers the container so a retry never posts twice. */
  async publishVideo(a: { userId: string; text: string; videoUrl: string; replyToId?: string; state: Record<string, unknown>; setState: (p: Record<string, unknown>) => void }): Promise<{ id: string; url: string }> {
    let container = typeof a.state.threadsContainer === 'string' ? a.state.threadsContainer : null
    if (!container) {
      const c = await this.req<{ id: string }>('POST', `/${a.userId}/threads`, { media_type: 'VIDEO', video_url: a.videoUrl, text: a.text, reply_to_id: a.replyToId })
      container = c.id
      a.setState({ threadsContainer: container })
    }
    for (let i = 0; i < 40; i++) {
      const st = await this.req<{ status?: string; error_message?: string }>('GET', `/${container}`, { fields: 'status,error_message' })
      if (st.status === 'FINISHED' || st.status === 'PUBLISHED') break
      if (st.status === 'ERROR' || st.status === 'EXPIRED') throw new SocialError(`Threads could not process the video: ${st.error_message ?? st.status}`, 'permanent')
      await this.sleep(i < 3 ? 5000 : 15_000)
      if (i === 39) throw new SocialError('Threads is taking too long to process the video.', 'transient')
    }
    const pub = await this.req<{ id: string }>('POST', `/${a.userId}/threads_publish`, { creation_id: container })
    a.setState({ threadsPostId: pub.id })
    let url = ''
    try {
      url = (await this.req<{ permalink?: string }>('GET', `/${pub.id}`, { fields: 'permalink' })).permalink ?? ''
    } catch {
      // The post is up. A missing link is not worth a retry.
    }
    return { id: pub.id, url }
  }

  async reply(userId: string, toId: string, text: string): Promise<string> {
    const c = await this.req<{ id: string }>('POST', `/${userId}/threads`, { media_type: 'TEXT', text, reply_to_id: toId })
    const p = await this.req<{ id: string }>('POST', `/${userId}/threads_publish`, { creation_id: c.id })
    return p.id
  }

  async listReplies(mediaId: string): Promise<Reply[]> {
    const r = await this.req<{ data?: Array<{ id: string; text?: string; username?: string; timestamp?: string }> }>('GET', `/${mediaId}/replies`, { fields: 'id,text,username,timestamp' })
    return (r.data ?? []).map((x) => ({ id: x.id, text: x.text ?? '', username: x.username ?? '', at: x.timestamp ?? '' }))
  }

  async hideReply(replyId: string, hide = true): Promise<void> {
    await this.req('POST', `/${replyId}/manage_reply`, { hide: String(hide) })
  }

  /** Views, likes, replies, reposts and quotes for one post. */
  async insights(mediaId: string): Promise<{ views: number; likes: number; replies: number; reposts: number; quotes: number }> {
    const r = await this.req<{ data?: Array<{ name: string; values?: Array<{ value: number }>; total_value?: { value: number } }> }>('GET', `/${mediaId}/insights`, { metric: 'views,likes,replies,reposts,quotes' })
    const get = (n: string) => r.data?.find((m) => m.name === n)?.values?.[0]?.value ?? r.data?.find((m) => m.name === n)?.total_value?.value ?? 0
    return { views: get('views'), likes: get('likes'), replies: get('replies'), reposts: get('reposts'), quotes: get('quotes') }
  }

  /** Refreshes a long lived token (valid 60 days, refreshable after 24 hours). Returns the new token. */
  async refresh(): Promise<{ token: string; expiresInSeconds: number }> {
    const q = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: this.tok() })
    const res = await this.fetchImpl(`${this.base.replace(/\/v[\d.]+$/, '')}/refresh_access_token?${q}`, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw await httpError('Threads', res)
    const d = (await res.json()) as { access_token: string; expires_in: number }
    return { token: d.access_token, expiresInSeconds: d.expires_in }
  }
}
