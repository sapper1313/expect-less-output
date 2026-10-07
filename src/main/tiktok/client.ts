import { open } from 'fs/promises'
import { AdapterError } from '../adapters/types'
import { isNetworkError } from '../google/errors'
import { planChunks, type TikTokUrls } from './config'
import type { TikTokCreatorInfo } from '@shared/types'

/** A TikTok failure. `needsRefresh` means the access token is no longer accepted. */
export class TikTokApiError extends AdapterError {
  constructor(
    message: string,
    kind: 'transient' | 'permanent',
    public code: string,
    public needsRefresh = false,
  ) {
    super(message, kind)
    this.name = 'TikTokApiError'
  }
}

const HOUR = 3_600_000

/** Turns a TikTok error code into transient (retry), deferred (try again in an hour) or permanent (explain). */
export function classifyTikTokError(status: number, code: string, message: string): TikTokApiError {
  const text = message ? ` ${message}` : ''
  switch (code) {
    case 'access_token_invalid':
    case 'access_token_expired':
      return new TikTokApiError(
        'TikTok no longer accepts the saved login. Refreshing it.',
        'transient',
        code,
        true,
      )
    case 'spam_risk_too_many_posts':
    case 'reached_active_user_cap': {
      const e = new TikTokApiError(
        `TikTok says this account reached its posting limit for now.${text}`,
        'transient',
        code,
      )
      e.retryAfterMs = HOUR
      return e
    }
    case 'rate_limit_exceeded':
      return new TikTokApiError(`TikTok is limiting requests right now.${text}`, 'transient', code)
    case 'unaudited_client_can_only_post_to_private_accounts':
      return new TikTokApiError(
        'TikTok has not approved this app for public posts yet. Choose "Only me" or use Drafts mode until the audit is approved.',
        'permanent',
        code,
      )
    case 'privacy_level_option_mismatch':
      return new TikTokApiError(
        'The chosen privacy option is not available for this TikTok account. Pick again.',
        'permanent',
        code,
      )
    case 'scope_not_authorized':
    case 'scope_permission_missed':
      return new TikTokApiError(
        'TikTok did not grant the needed permission. Reconnect TikTok and approve everything.',
        'permanent',
        code,
      )
    case 'url_ownership_unverified':
      return new TikTokApiError(
        'TikTok could not verify the website for this app. Check the URL properties step in SETUP_C.',
        'permanent',
        code,
      )
    case 'invalid_publish_id':
    case 'invalid_file_upload':
    case 'invalid_param':
    case 'file_format_check_failed':
    case 'duration_check_failed':
    case 'frame_rate_check_failed':
    case 'picture_size_check_failed':
      return new TikTokApiError(`TikTok rejected the video (${code}).${text}`, 'permanent', code)
    case 'internal_error':
    case 'service_unavailable':
      return new TikTokApiError(
        `TikTok had a temporary problem (${code}).${text}`,
        'transient',
        code,
      )
  }
  if (status >= 500 || status === 429)
    return new TikTokApiError(
      `TikTok had a temporary problem (${status}).${text}`,
      'transient',
      code || String(status),
    )
  return new TikTokApiError(
    `TikTok rejected the request (${code || status}).${text}`,
    'permanent',
    code || String(status),
  )
}

export interface TikTokTokens {
  accessToken: string
  refreshToken: string
  accessExpiresAt: number
  refreshExpiresAt: number
  openId: string
  scope: string
}

export interface TikTokClientDeps {
  urls: TikTokUrls
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class TikTokClient {
  constructor(private d: TikTokClientDeps) {}

  private get f(): typeof fetch {
    return this.d.fetchImpl ?? fetch
  }

  private async call(
    method: string,
    path: string,
    opts: { token?: string; json?: unknown; form?: Record<string, string> },
  ): Promise<any> {
    const headers: Record<string, string> = {}
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`
    let body: string | undefined
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json; charset=UTF-8'
      body = JSON.stringify(opts.json)
    } else if (opts.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = new URLSearchParams(opts.form).toString()
    }
    let res: Response
    try {
      res = await this.f(`${this.d.urls.api}${path}`, { method, headers, body })
    } catch (err) {
      if (isNetworkError(err))
        throw new TikTokApiError(
          `Could not reach TikTok: ${(err as Error).message}`,
          'transient',
          'network',
        )
      throw err
    }
    const json: any = await res.json().catch(() => null)
    // The token endpoints answer with a flat {error, error_description}. The API answers with {error:{code,message}}.
    const flat = typeof json?.error === 'string' ? json.error : null
    if (flat) throw this.oauthError(res.status, flat, json.error_description ?? '')
    const code = json?.error?.code
    if (!res.ok || (code && code !== 'ok'))
      throw classifyTikTokError(res.status, code ?? '', json?.error?.message ?? '')
    return json
  }

  private oauthError(status: number, code: string, desc: string): TikTokApiError {
    if (code === 'invalid_grant')
      return new TikTokApiError(
        'TikTok says the saved login is no longer valid.',
        'permanent',
        'invalid_grant',
        false,
      )
    if (code === 'invalid_client')
      return new TikTokApiError(
        'TikTok rejected the Client Key or Client Secret. Check them on the Connections screen.',
        'permanent',
        code,
      )
    if (status >= 500)
      return new TikTokApiError(`TikTok had a temporary problem (${status}).`, 'transient', code)
    return new TikTokApiError(
      `TikTok refused the login (${code}). ${desc}`.trim(),
      'permanent',
      code,
    )
  }

  // ---------- login ----------

  private tokensFrom(j: any, now: number): TikTokTokens {
    if (!j?.access_token || !j?.refresh_token)
      throw new TikTokApiError('TikTok did not return the login tokens.', 'permanent', 'no_tokens')
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      accessExpiresAt: now + Number(j.expires_in ?? 86400) * 1000,
      refreshExpiresAt: now + Number(j.refresh_expires_in ?? 31_536_000) * 1000,
      openId: j.open_id ?? '',
      scope: String(j.scope ?? ''),
    }
  }

  async exchangeCode(
    p: {
      clientKey: string
      clientSecret: string
      code: string
      redirectUri: string
      codeVerifier: string
    },
    now = Date.now(),
  ): Promise<TikTokTokens> {
    const j = await this.call('POST', '/v2/oauth/token/', {
      form: {
        client_key: p.clientKey,
        client_secret: p.clientSecret,
        code: p.code,
        grant_type: 'authorization_code',
        redirect_uri: p.redirectUri,
        code_verifier: p.codeVerifier,
      },
    })
    return this.tokensFrom(j, now)
  }

  async refresh(
    p: { clientKey: string; clientSecret: string; refreshToken: string },
    now = Date.now(),
  ): Promise<TikTokTokens> {
    const j = await this.call('POST', '/v2/oauth/token/', {
      form: {
        client_key: p.clientKey,
        client_secret: p.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: p.refreshToken,
      },
    })
    return this.tokensFrom(j, now)
  }

  async revoke(p: { clientKey: string; clientSecret: string; token: string }): Promise<void> {
    await this.call('POST', '/v2/oauth/revoke/', {
      form: { client_key: p.clientKey, client_secret: p.clientSecret, token: p.token },
    })
  }

  async userInfo(
    token: string,
  ): Promise<{ openId: string; displayName: string; avatarUrl: string | null }> {
    const j = await this.call(
      'GET',
      '/v2/user/info/?fields=open_id,union_id,avatar_url,display_name',
      { token },
    )
    const u = j?.data?.user
    if (!u?.open_id)
      throw new TikTokApiError('TikTok did not return the account details.', 'permanent', 'no_user')
    return {
      openId: u.open_id,
      displayName: u.display_name ?? 'TikTok account',
      avatarUrl: u.avatar_url ?? null,
    }
  }

  // ---------- posting ----------

  async creatorInfo(token: string): Promise<TikTokCreatorInfo> {
    const j = await this.call('POST', '/v2/post/publish/creator_info/query/', { token, json: {} })
    const d = j?.data ?? {}
    return {
      nickname: d.creator_nickname ?? '',
      username: d.creator_username ?? '',
      avatarUrl: d.creator_avatar_url ?? null,
      privacyOptions: Array.isArray(d.privacy_level_options) ? d.privacy_level_options : [],
      commentDisabled: !!d.comment_disabled,
      duetDisabled: !!d.duet_disabled,
      stitchDisabled: !!d.stitch_disabled,
      maxDurationSec: Number(d.max_video_post_duration_sec ?? 0),
    }
  }

  /** Starts an upload. `inbox` sends the video to the creator's drafts, `direct` posts it. */
  async init(
    token: string,
    mode: 'inbox' | 'direct',
    fileSize: number,
    postInfo?: Record<string, unknown>,
  ): Promise<{ publishId: string; uploadUrl: string; chunkSize: number; count: number }> {
    const plan = planChunks(fileSize)
    const body: Record<string, unknown> = {
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: fileSize,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.count,
      },
    }
    if (mode === 'direct') body.post_info = postInfo
    const path =
      mode === 'direct' ? '/v2/post/publish/video/init/' : '/v2/post/publish/inbox/video/init/'
    const j = await this.call('POST', path, { token, json: body })
    if (!j?.data?.publish_id || !j?.data?.upload_url)
      throw new TikTokApiError(
        'TikTok did not return an upload address.',
        'transient',
        'no_upload_url',
      )
    return { publishId: j.data.publish_id, uploadUrl: j.data.upload_url, ...plan }
  }

  /** Sends the file in order, one chunk at a time. Each chunk is retried on network trouble. */
  async uploadChunks(p: {
    uploadUrl: string
    filePath: string
    fileSize: number
    chunkSize: number
    count: number
    mime: string
    startAtChunk?: number
    onProgress?: (fraction: number, chunkDone: number) => void
    maxFailures?: number
  }): Promise<void> {
    const sleep = this.d.sleep ?? defaultSleep
    const fh = await open(p.filePath, 'r')
    try {
      for (let i = p.startAtChunk ?? 0; i < p.count; i++) {
        const start = i * p.chunkSize
        const end = i === p.count - 1 ? p.fileSize : start + p.chunkSize
        const buf = Buffer.alloc(end - start)
        await fh.read(buf, 0, buf.length, start)
        let failures = 0
        for (;;) {
          try {
            const res = await this.f(p.uploadUrl, {
              method: 'PUT',
              headers: {
                'Content-Type': p.mime,
                'Content-Length': String(buf.length),
                'Content-Range': `bytes ${start}-${end - 1}/${p.fileSize}`,
              },
              body: buf,
            })
            if (res.status === 206 || res.status === 201 || res.status === 200) break
            const j: any = await res.json().catch(() => null)
            const err = classifyTikTokError(
              res.status,
              j?.error?.code ?? '',
              j?.error?.message ?? `Upload step failed (HTTP ${res.status}).`,
            )
            if (res.status === 403 || res.status === 404) {
              throw new TikTokApiError(
                'The TikTok upload address expired. Starting the upload again.',
                'transient',
                'upload_url_expired',
              )
            }
            if (err.kind === 'permanent') throw err
            throw new TikTokApiError(err.message, 'transient', err.code)
          } catch (err) {
            const retryable =
              isNetworkError(err) ||
              (err instanceof TikTokApiError &&
                err.kind === 'transient' &&
                err.code !== 'upload_url_expired')
            if (!retryable) throw err
            failures++
            if (failures > (p.maxFailures ?? 5))
              throw new TikTokApiError(
                'The upload to TikTok kept failing. Check the internet connection and retry.',
                'transient',
                'upload_failed',
              )
            await sleep(Math.min(15_000, 2 ** failures * 500))
          }
        }
        p.onProgress?.(end / p.fileSize, i + 1)
      }
    } finally {
      await fh.close()
    }
  }

  async status(
    token: string,
    publishId: string,
  ): Promise<{ status: string; failReason?: string; postIds: string[]; uploadedBytes?: number }> {
    const j = await this.call('POST', '/v2/post/publish/status/fetch/', {
      token,
      json: { publish_id: publishId },
    })
    const d = j?.data ?? {}
    return {
      status: d.status ?? 'UNKNOWN',
      failReason: d.fail_reason,
      postIds: (d.publicaly_available_post_id ?? d.publicly_available_post_id ?? []).map(String),
      uploadedBytes: d.uploaded_bytes,
    }
  }
}

export function mimeFor(path: string): string {
  const p = path.toLowerCase()
  if (p.endsWith('.mov')) return 'video/quicktime'
  if (p.endsWith('.webm')) return 'video/webm'
  return 'video/mp4'
}
