import { createReadStream, statSync } from 'fs'
import { basename } from 'path'
import { Readable } from 'stream'
import { SocialError, httpError } from './errors'
export interface Reply {
  id: string
  text: string
  username: string
  at: string
}

interface Session {
  accessJwt: string
  refreshJwt: string
  did: string
  pds: string
}

export interface BlueskyCreds {
  handle: () => string | null
  password: () => string | null
}

export interface BskyPostRef {
  uri: string
  cid: string
}

/**
 * Bluesky (AT Protocol). Login with an app password, then the documented video flow: a service auth token for the PDS,
 * upload straight to video.bsky.app, wait for the processing job, and attach the finished blob to the post.
 */
export class BlueskyClient {
  private session: Session | null = null

  constructor(
    private creds: BlueskyCreds,
    private fetchImpl: typeof fetch = fetch,
    private urls = { pds: 'https://bsky.social', video: 'https://video.bsky.app' },
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private now: () => number = Date.now,
  ) {}

  private async raw(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { signal: AbortSignal.timeout(10 * 60_000), ...init })
    } catch (e) {
      throw new SocialError(`Could not reach Bluesky: ${(e as Error).message}`, 'transient')
    }
  }

  async login(force = false): Promise<Session> {
    if (this.session && !force) return this.session
    const handle = this.creds.handle()
    const password = this.creds.password()
    if (!handle || !password)
      throw new SocialError(
        'The Bluesky handle or app password is not set. Add them in Settings, under the Studio tab.',
        'permanent',
      )
    const res = await this.raw(`${this.urls.pds}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: handle, password }),
    })
    if (res.status === 401)
      throw new SocialError('Bluesky refused that handle and app password.', 'permanent')
    if (!res.ok) throw await httpError('Bluesky', res)
    const d = (await res.json()) as {
      accessJwt: string
      refreshJwt: string
      did: string
      didDoc?: { service?: Array<{ serviceEndpoint?: string }> }
    }
    this.session = {
      accessJwt: d.accessJwt,
      refreshJwt: d.refreshJwt,
      did: d.did,
      pds: d.didDoc?.service?.[0]?.serviceEndpoint ?? this.urls.pds,
    }
    return this.session
  }

  /** Calls the PDS with the session, signing in again once if the token has expired. */
  private async pds(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const s = await this.login(attempt > 0)
      const headers: Record<string, string> = {
        authorization: `Bearer ${s.accessJwt}`,
        ...((init.headers as Record<string, string>) ?? {}),
      }
      if (init.json !== undefined) headers['content-type'] = 'application/json'
      const res = await this.raw(`${this.urls.pds}${path}`, {
        ...init,
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      })
      if ((res.status === 401 || res.status === 400) && attempt === 0) {
        const t = await res.clone().text()
        if (res.status === 401 || /ExpiredToken|InvalidToken/.test(t)) continue
      }
      return res
    }
  }

  async test(): Promise<string> {
    const s = await this.login(true)
    return `Signed in as ${this.creds.handle()} (${s.did}).`
  }

  private async serviceAuth(aud: string, lxm: string, seconds = 1800): Promise<string> {
    const exp = Math.floor(this.now() / 1000) + seconds
    const res = await this.pds(
      `/xrpc/com.atproto.server.getServiceAuth?${new URLSearchParams({ aud, lxm, exp: String(exp) })}`,
    )
    if (!res.ok) throw await httpError('Bluesky', res)
    return ((await res.json()) as { token: string }).token
  }

  /** Today's video allowance. A real account that cannot upload says why. */
  async uploadLimits(): Promise<{
    canUpload: boolean
    remainingDailyVideos?: number
    remainingDailyBytes?: number
    message?: string
  }> {
    const token = await this.serviceAuth('did:web:video.bsky.app', 'app.bsky.video.getUploadLimits')
    const res = await this.raw(`${this.urls.video}/xrpc/app.bsky.video.getUploadLimits`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw await httpError('Bluesky', res)
    return (await res.json()) as {
      canUpload: boolean
      remainingDailyVideos?: number
      remainingDailyBytes?: number
      message?: string
    }
  }

  async uploadVideo(file: string): Promise<unknown> {
    const s = await this.login()
    const host = new URL(s.pds).host
    const token = await this.serviceAuth(`did:web:${host}`, 'com.atproto.repo.uploadBlob')
    const size = statSync(file).size
    const res = await this.raw(
      `${this.urls.video}/xrpc/app.bsky.video.uploadVideo?${new URLSearchParams({ did: s.did, name: basename(file) })}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'video/mp4',
          'content-length': String(size),
        },
        body: Readable.toWeb(createReadStream(file)) as never,
        // @ts-expect-error duplex is required by Node for streamed request bodies
        duplex: 'half',
      },
    )
    if (res.status === 409) {
      // Already uploaded (same file): Bluesky returns the existing job.
      const d = (await res.json()) as { jobId?: string; blob?: unknown; state?: string }
      return d
    }
    if (!res.ok) throw await httpError('Bluesky', res)
    const d = (await res.json()) as {
      jobStatus?: { jobId: string; blob?: unknown; state?: string }
      jobId?: string
      blob?: unknown
      state?: string
    }
    return d.jobStatus ?? d
  }

  /** Waits for the processing job. Returns the blob to attach. */
  async waitForBlob(job: { jobId?: string; blob?: unknown; state?: string }): Promise<unknown> {
    if (job.blob) return job.blob
    for (let i = 0; i < 90; i++) {
      const res = await this.raw(
        `${this.urls.video}/xrpc/app.bsky.video.getJobStatus?${new URLSearchParams({ jobId: job.jobId ?? '' })}`,
        {},
      )
      if (!res.ok) throw await httpError('Bluesky', res)
      const d = (await res.json()) as {
        jobStatus?: { state?: string; blob?: unknown; error?: string; message?: string }
      }
      const st = d.jobStatus
      if (st?.state === 'JOB_STATE_COMPLETED' && st.blob) return st.blob
      if (st?.state === 'JOB_STATE_FAILED')
        throw new SocialError(
          `Bluesky could not process the video: ${st.error ?? st.message ?? 'failed'}`,
          'permanent',
        )
      await this.sleep(i < 5 ? 2000 : 5000)
    }
    throw new SocialError('Bluesky is taking too long to process the video.', 'transient')
  }

  /** The documented flow, one call. `state` remembers the blob so a retry does not upload twice. */
  async postVideo(a: {
    text: string
    file: string
    width: number
    height: number
    alt?: string
    state: Record<string, unknown>
    setState: (p: Record<string, unknown>) => void
    reply?: { root: BskyPostRef; parent: BskyPostRef }
  }): Promise<{ uri: string; cid: string; url: string }> {
    const s = await this.login()
    let blob = a.state.bskyBlob
    if (!blob) {
      const job = (await this.uploadVideo(a.file)) as { jobId?: string; blob?: unknown }
      blob = await this.waitForBlob(job)
      a.setState({ bskyBlob: blob })
    }
    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post',
      text: a.text,
      createdAt: new Date(this.now()).toISOString(),
      langs: ['en'],
      embed: {
        $type: 'app.bsky.embed.video',
        video: blob,
        aspectRatio: { width: a.width, height: a.height },
        alt: a.alt ?? '',
      },
    }
    if (a.reply) record.reply = a.reply
    const res = await this.pds('/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      json: { repo: s.did, collection: 'app.bsky.feed.post', record },
    })
    if (!res.ok) throw await httpError('Bluesky', res)
    const d = (await res.json()) as { uri: string; cid: string }
    const rkey = d.uri.split('/').pop()
    return { ...d, url: `https://bsky.app/profile/${this.creds.handle()}/post/${rkey}` }
  }

  async replyText(text: string, root: BskyPostRef, parent: BskyPostRef): Promise<BskyPostRef> {
    const s = await this.login()
    const res = await this.pds('/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      json: {
        repo: s.did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text,
          createdAt: new Date(this.now()).toISOString(),
          langs: ['en'],
          reply: { root, parent },
        },
      },
    })
    if (!res.ok) throw await httpError('Bluesky', res)
    return (await res.json()) as BskyPostRef
  }

  /** Like, reply and repost counts. Bluesky does not report views. */
  async counts(uri: string): Promise<{ likes: number; replies: number; reposts: number }> {
    const res = await this.pds(`/xrpc/app.bsky.feed.getPosts?${new URLSearchParams({ uris: uri })}`)
    if (!res.ok) throw await httpError('Bluesky', res)
    const d = (await res.json()) as {
      posts?: Array<{ likeCount?: number; replyCount?: number; repostCount?: number }>
    }
    const p = d.posts?.[0]
    return { likes: p?.likeCount ?? 0, replies: p?.replyCount ?? 0, reposts: p?.repostCount ?? 0 }
  }

  async listReplies(uri: string): Promise<Array<Reply & { uri: string; cid: string }>> {
    const res = await this.pds(
      `/xrpc/app.bsky.feed.getPostThread?${new URLSearchParams({ uri, depth: '1' })}`,
    )
    if (!res.ok) throw await httpError('Bluesky', res)
    const d = (await res.json()) as {
      thread?: {
        replies?: Array<{
          post?: {
            uri: string
            cid: string
            author?: { handle?: string }
            record?: { text?: string; createdAt?: string }
          }
        }>
      }
    }
    return (d.thread?.replies ?? [])
      .filter((r) => r.post)
      .map((r) => ({
        id: r.post!.uri,
        uri: r.post!.uri,
        cid: r.post!.cid,
        text: r.post!.record?.text ?? '',
        username: r.post!.author?.handle ?? '',
        at: r.post!.record?.createdAt ?? '',
      }))
  }
}
