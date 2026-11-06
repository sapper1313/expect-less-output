import { closeSync, fstatSync, openSync, readSync } from 'fs'
import {
  AdapterError,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
} from '../adapters/types'
import { durationProblem } from '@shared/platformLimits'
import type { Account } from '@shared/types'
import { call, failure, json, sleep } from './http'

export const LI_PORT = 47832
export const LI_REDIRECT = `http://127.0.0.1:${LI_PORT}/callback`
export const LI_SCOPES = 'openid profile w_member_social'
/** LinkedIn versions its API by month. */
export const LI_VERSION = '202602'
const PART = 4 * 1024 * 1024

export interface LinkedInUrls {
  authorize: string
  token: string
  api: string
}
export const linkedinUrls = (env: NodeJS.ProcessEnv = process.env): LinkedInUrls => {
  const base = env['ELO_LINKEDIN_BASE']?.replace(/\/$/, '')
  return base
    ? {
        authorize: `${base}/oauth/v2/authorization`,
        token: `${base}/oauth/v2/accessToken`,
        api: base,
      }
    : {
        authorize: 'https://www.linkedin.com/oauth/v2/authorization',
        token: 'https://www.linkedin.com/oauth/v2/accessToken',
        api: 'https://api.linkedin.com',
      }
}

/** LinkedIn reads some characters in a post as formatting. They are escaped so the text comes out as written. */
export const escapeCommentary = (t: string) => t.replace(/([\\(){}[\]<>@*_~|])/g, '\\$1')

export class LinkedInClient {
  private f: typeof fetch
  constructor(private d: { urls: LinkedInUrls; fetchImpl?: typeof fetch }) {
    this.f = d.fetchImpl ?? fetch
  }

  authUrl(clientId: string, state: string): string {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: LI_REDIRECT,
      state,
      scope: LI_SCOPES,
    })
    return `${this.d.urls.authorize}?${q}`
  }

  async exchange(clientId: string, clientSecret: string, code: string) {
    const res = await call('LinkedIn', this.f, this.d.urls.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LI_REDIRECT,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    const j = await json<{
      access_token: string
      expires_in?: number
      refresh_token?: string
      refresh_token_expires_in?: number
    }>('LinkedIn', res)
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? null,
      expiresIn: j.expires_in ?? null,
      refreshExpiresAt: j.refresh_token_expires_in
        ? Date.now() + j.refresh_token_expires_in * 1000
        : null,
    }
  }

  async refresh(clientId: string, clientSecret: string, refreshToken: string) {
    const res = await call('LinkedIn', this.f, this.d.urls.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    const j = await json<{ access_token: string; expires_in?: number; refresh_token?: string }>(
      'LinkedIn',
      res,
    )
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? refreshToken,
      expiresIn: j.expires_in ?? null,
    }
  }

  async me(token: string): Promise<{ id: string; name: string }> {
    const res = await call('LinkedIn', this.f, `${this.d.urls.api}/v2/userinfo`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const j = await json<{ sub: string; name?: string }>('LinkedIn', res)
    return { id: j.sub, name: j.name ?? 'LinkedIn member' }
  }

  private headers(token: string) {
    return {
      authorization: `Bearer ${token}`,
      'linkedin-version': LI_VERSION,
      'x-restli-protocol-version': '2.0.0',
      'content-type': 'application/json',
    }
  }

  /** Uploads a video in 4 MB parts and waits until LinkedIn says it is available. Returns the video URN. */
  async uploadVideo(
    token: string,
    owner: string,
    file: string,
    onProgress: (f: number) => void,
    saved: {
      videoUrn?: string
      uploadToken?: string
      etags?: string[]
      instructions?: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>
    },
    save: (p: Record<string, unknown>) => void,
  ): Promise<string> {
    const fd = openSync(file, 'r')
    try {
      const total = fstatSync(fd).size
      let st = saved
      if (!st.videoUrn) {
        const res = await call(
          'LinkedIn',
          this.f,
          `${this.d.urls.api}/rest/videos?action=initializeUpload`,
          {
            method: 'POST',
            headers: this.headers(token),
            body: JSON.stringify({
              initializeUploadRequest: {
                owner,
                fileSizeBytes: total,
                uploadCaptions: false,
                uploadThumbnail: false,
              },
            }),
          },
        )
        const v = (
          await json<{
            value: {
              video: string
              uploadToken: string
              uploadInstructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>
            }
          }>('LinkedIn', res)
        ).value
        st = {
          videoUrn: v.video,
          uploadToken: v.uploadToken,
          etags: [],
          instructions: v.uploadInstructions,
        }
        save({
          videoUrn: st.videoUrn,
          uploadToken: st.uploadToken,
          etags: [],
          instructions: st.instructions,
        })
      }
      const parts = st.instructions ?? []
      const etags = [...(st.etags ?? [])]
      for (let i = etags.length; i < parts.length; i++) {
        const p = parts[i] as { uploadUrl: string; firstByte: number; lastByte: number }
        const buf = Buffer.alloc(Math.min(p.lastByte - p.firstByte + 1, total - p.firstByte, PART))
        readSync(fd, buf, 0, buf.length, p.firstByte)
        const res = await call('LinkedIn', this.f, p.uploadUrl, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          body: buf,
          timeoutMs: 180_000,
        })
        if (!res.ok) throw failure('LinkedIn', res.status, await res.text())
        const etag = res.headers.get('etag')
        if (!etag)
          throw new AdapterError(
            'LinkedIn did not return a part id for an uploaded piece.',
            'transient',
          )
        etags.push(etag.replace(/^"|"$/g, ''))
        save({ etags })
        onProgress(etags.length / parts.length)
      }
      if (!(st as { finalized?: boolean }).finalized) {
        const res = await call(
          'LinkedIn',
          this.f,
          `${this.d.urls.api}/rest/videos?action=finalizeUpload`,
          {
            method: 'POST',
            headers: this.headers(token),
            body: JSON.stringify({
              finalizeUploadRequest: {
                video: st.videoUrn,
                uploadToken: st.uploadToken ?? '',
                uploadedPartIds: etags,
              },
            }),
          },
        )
        if (!res.ok) throw failure('LinkedIn', res.status, await res.text())
        save({ finalized: true })
      }
      for (let tries = 0; tries < 60; tries++) {
        const res = await call(
          'LinkedIn',
          this.f,
          `${this.d.urls.api}/rest/videos/${encodeURIComponent(st.videoUrn as string)}`,
          { headers: this.headers(token) },
        )
        const v = await json<{ status?: string; processingFailureReason?: string }>('LinkedIn', res)
        if (v.status === 'AVAILABLE') return st.videoUrn as string
        if (v.status === 'PROCESSING_FAILED')
          throw new AdapterError(
            `LinkedIn could not process the video: ${v.processingFailureReason ?? 'unknown reason'}`,
            'permanent',
          )
        await sleep(3000)
      }
      throw new AdapterError(
        'LinkedIn is still processing the video. ELO will try again.',
        'transient',
      )
    } finally {
      closeSync(fd)
    }
  }

  /** Creates the post. Returns the post URN. */
  async post(
    token: string,
    author: string,
    text: string,
    title: string,
    videoUrn: string,
  ): Promise<string> {
    const res = await call('LinkedIn', this.f, `${this.d.urls.api}/rest/posts`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({
        author,
        commentary: escapeCommentary(text),
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: { media: { title: title.slice(0, 200), id: videoUrn } },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    })
    if (!res.ok) throw failure('LinkedIn', res.status, await res.text())
    return res.headers.get('x-restli-id') ?? res.headers.get('x-linkedin-id') ?? ''
  }
}

export class LinkedInAdapter implements PlatformAdapter {
  readonly platform = 'linkedin' as const
  constructor(
    private d: {
      client: LinkedInClient
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
    if (!ctx.account || ctx.account.status !== 'connected' || !ctx.account.externalId)
      throw new AdapterError(
        `${ctx.brandName} is not signed in to LinkedIn. Connect it in Setup Channels, on the Connections tab.`,
        'permanent',
      )
    const problem = durationProblem('linkedin', ctx.videoDurationSeconds)
    if (ctx.videoDurationSeconds > 0 && problem) throw new AdapterError(problem, 'permanent')
  }

  async publish(ctx: AdapterContext): Promise<AdapterResult> {
    const account = ctx.account as Account
    const author = `urn:li:person:${account.externalId}`
    const st = ctx.getState() as Record<string, any>
    if (st.postUrn) return this.done(st.postUrn)
    const token = await this.d.accessToken(account.id)
    const videoUrn = await this.d.client.uploadVideo(
      token,
      author,
      ctx.videoAbsPath,
      (f) => ctx.reportProgress(f),
      st,
      (p) => ctx.setState(p),
    )
    const urn = await this.d.client.post(
      token,
      author,
      ctx.caption || ctx.title,
      ctx.title,
      videoUrn,
    )
    ctx.setState({ postUrn: urn })
    this.d.log('info', 'Posted to LinkedIn.', ctx)
    return this.done(urn)
  }

  private done(urn: string): AdapterResult {
    return {
      status: 'posted',
      externalId: urn,
      externalUrl: urn ? `https://www.linkedin.com/feed/update/${urn}/` : undefined,
    }
  }

  async checkStatus(): Promise<AdapterResult> {
    return { status: 'processing' }
  }
}
