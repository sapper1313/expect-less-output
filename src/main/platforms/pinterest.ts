import { readFileSync } from 'fs'
import {
  AdapterError,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
} from '../adapters/types'
import { durationProblem } from '@shared/platformLimits'
import type { Account } from '@shared/types'
import { call, failure, json, sleep } from './http'

export const PIN_PORT = 47833
export const PIN_REDIRECT = `http://127.0.0.1:${PIN_PORT}/callback`
export const PIN_SCOPES = 'boards:read,boards:write,pins:read,pins:write,user_accounts:read'

export interface PinterestUrls {
  authorize: string
  api: string
}
export const pinterestUrls = (env: NodeJS.ProcessEnv = process.env): PinterestUrls => {
  const base = env['ELO_PINTEREST_BASE']?.replace(/\/$/, '')
  return base
    ? { authorize: `${base}/oauth/`, api: base }
    : { authorize: 'https://www.pinterest.com/oauth/', api: 'https://api.pinterest.com' }
}

export class PinterestClient {
  private f: typeof fetch
  constructor(private d: { urls: PinterestUrls; fetchImpl?: typeof fetch }) {
    this.f = d.fetchImpl ?? fetch
  }

  authUrl(clientId: string, state: string): string {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: PIN_REDIRECT,
      scope: PIN_SCOPES,
      state,
    })
    return `${this.d.urls.authorize}?${q}`
  }

  private async token(clientId: string, clientSecret: string, form: Record<string, string>) {
    const res = await call('Pinterest', this.f, `${this.d.urls.api}/v5/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams(form),
    })
    const j = await json<{
      access_token: string
      refresh_token?: string
      expires_in?: number
      refresh_token_expires_in?: number
    }>('Pinterest', res)
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? null,
      expiresIn: j.expires_in ?? null,
      refreshExpiresAt: j.refresh_token_expires_in
        ? Date.now() + j.refresh_token_expires_in * 1000
        : null,
    }
  }

  exchange(clientId: string, clientSecret: string, code: string) {
    return this.token(clientId, clientSecret, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: PIN_REDIRECT,
    })
  }

  refresh(clientId: string, clientSecret: string, refreshToken: string) {
    return this.token(clientId, clientSecret, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
  }

  private auth(token: string) {
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  }

  async me(token: string): Promise<{ username: string }> {
    const res = await call('Pinterest', this.f, `${this.d.urls.api}/v5/user_account`, {
      headers: this.auth(token),
    })
    return json('Pinterest', res)
  }

  async boards(token: string): Promise<Array<{ id: string; name: string }>> {
    const res = await call('Pinterest', this.f, `${this.d.urls.api}/v5/boards?page_size=100`, {
      headers: this.auth(token),
    })
    return (
      (await json<{ items?: Array<{ id: string; name: string }> }>('Pinterest', res)).items ?? []
    )
  }

  /** Registers, uploads and waits for the video. Returns the media id. */
  async uploadVideo(
    token: string,
    file: string,
    saved: { mediaId?: string; uploaded?: boolean },
    save: (p: Record<string, unknown>) => void,
  ): Promise<string> {
    let id = saved.mediaId
    if (!id) {
      const res = await call('Pinterest', this.f, `${this.d.urls.api}/v5/media`, {
        method: 'POST',
        headers: this.auth(token),
        body: JSON.stringify({ media_type: 'video' }),
      })
      const j = await json<{
        media_id: string
        upload_url: string
        upload_parameters: Record<string, string>
      }>('Pinterest', res)
      id = j.media_id
      const form = new FormData()
      for (const [k, v] of Object.entries(j.upload_parameters ?? {})) form.set(k, v)
      form.set('file', new Blob([readFileSync(file)]), 'video.mp4')
      // The storage address takes no bearer token.
      const up = await call('Pinterest', this.f, j.upload_url, {
        method: 'POST',
        body: form,
        timeoutMs: 300_000,
      })
      if (!up.ok && up.status !== 204) throw failure('Pinterest', up.status, await up.text())
      save({ mediaId: id, uploaded: true })
    }
    for (let tries = 0; tries < 60; tries++) {
      const res = await call('Pinterest', this.f, `${this.d.urls.api}/v5/media/${id}`, {
        headers: this.auth(token),
      })
      const j = await json<{ status?: string }>('Pinterest', res)
      if (j.status === 'succeeded') return id
      if (j.status === 'failed')
        throw new AdapterError('Pinterest could not process the video.', 'permanent')
      await sleep(3000)
    }
    throw new AdapterError(
      'Pinterest is still processing the video. ELO will try again.',
      'transient',
    )
  }

  async pin(
    token: string,
    a: { boardId: string; title: string; description: string; mediaId: string },
  ): Promise<string> {
    const res = await call('Pinterest', this.f, `${this.d.urls.api}/v5/pins`, {
      method: 'POST',
      headers: this.auth(token),
      body: JSON.stringify({
        board_id: a.boardId,
        title: a.title.slice(0, 100),
        description: a.description.slice(0, 800),
        media_source: {
          source_type: 'video_id',
          media_id: a.mediaId,
          cover_image_key_frame_time: 1000,
        },
      }),
    })
    return (await json<{ id: string }>('Pinterest', res)).id
  }
}

export class PinterestAdapter implements PlatformAdapter {
  readonly platform = 'pinterest' as const
  constructor(
    private d: {
      client: PinterestClient
      accessToken: (accountId: number) => Promise<string>
      log: (level: 'info' | 'warn' | 'error', message: string, ctx: AdapterContext) => void
    },
  ) {}
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
        `${ctx.brandName} is not signed in to Pinterest. Connect it on the Connections screen.`,
        'permanent',
      )
    if (!ctx.account.externalId)
      throw new AdapterError(
        `${ctx.brandName} has no Pinterest board chosen. Pick one on the Connections screen.`,
        'permanent',
      )
    const problem = durationProblem('pinterest', ctx.videoDurationSeconds)
    if (ctx.videoDurationSeconds > 0 && problem) throw new AdapterError(problem, 'permanent')
  }

  async publish(ctx: AdapterContext): Promise<AdapterResult> {
    const account = ctx.account as Account
    const st = ctx.getState() as { mediaId?: string; uploaded?: boolean; pinId?: string }
    if (st.pinId) return this.done(st.pinId)
    const token = await this.d.accessToken(account.id)
    const mediaId = await this.d.client.uploadVideo(token, ctx.videoAbsPath, st, (p) =>
      ctx.setState(p),
    )
    const id = await this.d.client.pin(token, {
      boardId: account.externalId as string,
      title: ctx.title,
      description: ctx.caption,
      mediaId,
    })
    ctx.setState({ pinId: id })
    this.d.log('info', 'Posted to Pinterest.', ctx)
    return this.done(id)
  }

  private done(id: string): AdapterResult {
    return { status: 'posted', externalId: id, externalUrl: `https://www.pinterest.com/pin/${id}/` }
  }

  async checkStatus(): Promise<AdapterResult> {
    return { status: 'processing' }
  }
}
