import { closeSync, fstatSync, openSync, readSync } from 'fs'
import {
  AdapterError,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
} from '../adapters/types'
import { durationProblem } from '@shared/platformLimits'
import { fitText } from '@shared/growth'
import type { Account } from '@shared/types'
import { call, failure, json, sleep } from './http'

export const X_PORT = 47831
export const X_REDIRECT = `http://127.0.0.1:${X_PORT}/callback`
export const X_SCOPES = 'tweet.read tweet.write users.read media.write offline.access'
const CHUNK = 4 * 1024 * 1024

export interface XUrls {
  authorize: string
  api: string
}
export const xUrls = (env: NodeJS.ProcessEnv = process.env): XUrls => {
  const base = env['ELO_X_BASE']
  return base
    ? { authorize: `${base.replace(/\/$/, '')}/i/oauth2/authorize`, api: base.replace(/\/$/, '') }
    : { authorize: 'https://x.com/i/oauth2/authorize', api: 'https://api.x.com' }
}

export interface XClientDeps {
  urls: XUrls
  fetchImpl?: typeof fetch
}

/** The few X calls ELO needs: sign in, who am I, upload a video in chunks, post. */
export class XClient {
  private f: typeof fetch
  constructor(private d: XClientDeps) {
    this.f = d.fetchImpl ?? fetch
  }

  authUrl(clientId: string, state: string, challenge: string): string {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: X_REDIRECT,
      scope: X_SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    return `${this.d.urls.authorize}?${q}`
  }

  private async token(clientId: string, clientSecret: string, form: Record<string, string>) {
    const res = await call('X', this.f, `${this.d.urls.api}/2/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams(form),
    })
    const j = await json<{ access_token: string; refresh_token?: string; expires_in?: number }>(
      'X',
      res,
    )
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? null,
      expiresIn: j.expires_in ?? null,
    }
  }

  exchange(clientId: string, clientSecret: string, code: string, verifier: string) {
    return this.token(clientId, clientSecret, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: X_REDIRECT,
      code_verifier: verifier,
      client_id: clientId,
    })
  }

  refresh(clientId: string, clientSecret: string, refreshToken: string) {
    return this.token(clientId, clientSecret, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    })
  }

  async me(token: string): Promise<{ id: string; username: string }> {
    const res = await call('X', this.f, `${this.d.urls.api}/2/users/me`, {
      headers: { authorization: `Bearer ${token}` },
    })
    return (await json<{ data: { id: string; username: string } }>('X', res)).data
  }

  /** Uploads a video in 4 MB pieces and waits until X has processed it. Returns the media id. */
  async uploadVideo(
    token: string,
    file: string,
    onProgress: (f: number) => void,
    saved: { mediaId?: string; segment?: number },
    save: (p: { mediaId?: string; segment?: number }) => void,
  ): Promise<string> {
    const fd = openSync(file, 'r')
    try {
      const total = fstatSync(fd).size
      const auth = { authorization: `Bearer ${token}` }
      let id = saved.mediaId
      if (!id) {
        const res = await call('X', this.f, `${this.d.urls.api}/2/media/upload/initialize`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({
            media_type: 'video/mp4',
            total_bytes: total,
            media_category: 'tweet_video',
          }),
        })
        id = (await json<{ data: { id: string } }>('X', res)).data.id
        save({ mediaId: id, segment: 0 })
      }
      const parts = Math.max(1, Math.ceil(total / CHUNK))
      for (let i = saved.segment ?? 0; i < parts; i++) {
        const buf = Buffer.alloc(Math.min(CHUNK, total - i * CHUNK))
        readSync(fd, buf, 0, buf.length, i * CHUNK)
        const form = new FormData()
        form.set('segment_index', String(i))
        form.set('media', new Blob([buf]), 'chunk')
        const res = await call('X', this.f, `${this.d.urls.api}/2/media/upload/${id}/append`, {
          method: 'POST',
          headers: auth,
          body: form,
          timeoutMs: 120_000,
        })
        if (!res.ok) throw failure('X', res.status, await res.text())
        save({ mediaId: id, segment: i + 1 })
        onProgress((i + 1) / parts)
      }
      const fin = await call('X', this.f, `${this.d.urls.api}/2/media/upload/${id}/finalize`, {
        method: 'POST',
        headers: auth,
      })
      let info = (
        await json<{
          data: {
            processing_info?: {
              state: string
              check_after_secs?: number
              error?: { message?: string }
            }
          }
        }>('X', fin)
      ).data.processing_info
      for (let tries = 0; info && info.state !== 'succeeded' && tries < 60; tries++) {
        if (info.state === 'failed')
          throw new AdapterError(
            `X could not process the video: ${info.error?.message ?? 'unknown reason'}`,
            'permanent',
          )
        await sleep(Math.min(30, info.check_after_secs ?? 3) * 1000)
        const st = await call(
          'X',
          this.f,
          `${this.d.urls.api}/2/media/upload?command=STATUS&media_id=${id}`,
          {
            headers: auth,
          },
        )
        info = (await json<{ data: { processing_info?: typeof info } }>('X', st)).data
          .processing_info
      }
      return id
    } finally {
      closeSync(fd)
    }
  }

  async post(token: string, text: string, mediaId: string): Promise<string> {
    const res = await call('X', this.f, `${this.d.urls.api}/2/tweets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text, media: { media_ids: [mediaId] } }),
    })
    return (await json<{ data: { id: string } }>('X', res)).data.id
  }
}

export interface XAdapterDeps {
  client: XClient
  accessToken: (accountId: number, force?: boolean) => Promise<string>
  /** Called with the title and details when something needs the owner. */
  log: (level: 'info' | 'warn' | 'error', message: string, ctx: AdapterContext) => void
}

export class XAdapter implements PlatformAdapter {
  readonly platform = 'x' as const
  constructor(private d: XAdapterDeps) {}
  wantsHandoff(): boolean {
    return false
  }
  minHandoffLeadMs(): number {
    return 0
  }
  async connect(): Promise<void> {}
  async refreshIfNeeded(): Promise<void> {}

  async validate(ctx: AdapterContext): Promise<void> {
    if (!ctx.account || ctx.account.status !== 'connected')
      throw new AdapterError(
        `${ctx.brandName} is not signed in to X. Connect it on the Connections screen.`,
        'permanent',
      )
    const problem = durationProblem('x', ctx.videoDurationSeconds)
    if (ctx.videoDurationSeconds > 0 && problem) throw new AdapterError(problem, 'permanent')
  }

  async publish(ctx: AdapterContext): Promise<AdapterResult> {
    const account = ctx.account as Account
    const st = ctx.getState() as { mediaId?: string; segment?: number; tweetId?: string }
    if (st.tweetId) return this.done(account, st.tweetId)
    let token = await this.d.accessToken(account.id)
    const text = fitText('x', ctx.caption || ctx.title, 280)
    const run = async () => {
      const mediaId = await this.d.client.uploadVideo(
        token,
        ctx.videoAbsPath,
        (f) => ctx.reportProgress(f),
        st,
        (p) => ctx.setState(p),
      )
      return this.d.client.post(token, text, mediaId)
    }
    let id: string
    try {
      id = await run()
    } catch (e) {
      // A login that just ran out is refreshed once and tried again.
      if (e instanceof AdapterError && /\(401\)/.test(e.message)) {
        token = await this.d.accessToken(account.id, true)
        id = await run()
      } else throw e
    }
    ctx.setState({ tweetId: id })
    this.d.log('info', 'Posted to X.', ctx)
    return this.done(account, id)
  }

  private done(account: Account, id: string): AdapterResult {
    const who = account.displayName?.replace(/^@/, '') || 'i'
    return { status: 'posted', externalId: id, externalUrl: `https://x.com/${who}/status/${id}` }
  }

  async checkStatus(): Promise<AdapterResult> {
    return { status: 'processing' }
  }
}
