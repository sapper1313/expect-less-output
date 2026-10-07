// A tiny local stand-in for TikTok (login, tokens, creator info, upload to inbox, direct post, status).
// Only erasable TypeScript syntax is used so plain Node can also run this file for the e2e scripts.
import { createServer } from 'http'
import type { IncomingMessage, Server, ServerResponse } from 'http'
import { createHash } from 'crypto'

export interface FakeTikTokState {
  clientKey: string
  clientSecret: string
  grantedScope: string
  user: { open_id: string; display_name: string; avatar_url: string }
  creator: {
    creator_nickname: string
    creator_username: string
    creator_avatar_url: string
    privacy_level_options: string[]
    comment_disabled: boolean
    duet_disabled: boolean
    stitch_disabled: boolean
    max_video_post_duration_sec: number
  }
  accessTokens: Set<string>
  refreshTokens: Set<string>
  /** Make every refresh answer invalid_grant. */
  refreshInvalid: boolean
  refreshCount: number
  tokenRequests: Array<Record<string, string>>
  challenges: Map<string, string>
  revoked: string[]
  requests: Array<{ method: string; path: string; body: any; headers: Record<string, string> }>
  inits: Array<{ mode: 'inbox' | 'direct'; body: any }>
  uploads: Record<
    string,
    {
      bytes: number
      size: number
      chunks: Array<[number, number]>
      mode: 'inbox' | 'direct'
      complete: boolean
      postInfo?: any
    }
  >
  /** Status polls a finished upload stays in processing before it settles. */
  pollsBeforeDone: number
  /** What the status becomes when processing ends for each mode. */
  doneStatus: { inbox: string; direct: string }
  failReason: string | null
  /** Queue of one-off failures. First matching entry is used once. */
  failNext: Array<{ match: RegExp; status: number; code: string; message?: string }>
  uploadFault: ((n: number) => 'drop' | '503' | '403' | null) | null
  uploadCount: number
  creatorCalls: number
  codes: Map<string, string>
}

export interface FakeTikTok {
  base: string
  state: FakeTikTokState
  close(): Promise<void>
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
const ok = (data: unknown) => ({ data, error: { code: 'ok', message: '', log_id: 'x' } })
const apiError = (res: ServerResponse, status: number, code: string, message = '') =>
  json(res, status, { data: {}, error: { code, message, log_id: 'x' } })

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

export async function startFakeTikTok(port = 0): Promise<FakeTikTok> {
  const state: FakeTikTokState = {
    clientKey: 'awfaketiktokkey',
    clientSecret: 'tiktok-secret',
    grantedScope: 'user.info.basic,video.upload',
    user: {
      open_id: 'OPEN1',
      display_name: 'Trash Panda TikTok',
      avatar_url: 'http://127.0.0.1/avatar.png',
    },
    creator: {
      creator_nickname: 'Trash Panda TikTok',
      creator_username: 'trashpanda',
      creator_avatar_url: 'http://127.0.0.1/avatar.png',
      privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
      comment_disabled: false,
      duet_disabled: false,
      stitch_disabled: true,
      max_video_post_duration_sec: 300,
    },
    accessTokens: new Set(),
    refreshTokens: new Set(),
    refreshInvalid: false,
    refreshCount: 0,
    tokenRequests: [],
    challenges: new Map(),
    revoked: [],
    requests: [],
    inits: [],
    uploads: {},
    pollsBeforeDone: 1,
    doneStatus: { inbox: 'SEND_TO_USER_INBOX', direct: 'PUBLISH_COMPLETE' },
    failReason: null,
    failNext: [],
    uploadFault: null,
    uploadCount: 0,
    creatorCalls: 0,
    codes: new Map(),
  }
  const polls: Record<string, number> = {}
  let seq = 0
  let base = ''

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) headers[k] = String(v)
    try {
      const isUpload = path.startsWith('/upload/')
      const raw = isUpload ? Buffer.alloc(0) : await readBody(req)
      let body: any = null
      if (raw.length) {
        const text = raw.toString()
        body = (headers['content-type'] ?? '').includes('json')
          ? JSON.parse(text)
          : Object.fromEntries(new URLSearchParams(text))
      }
      state.requests.push({ method: req.method ?? 'GET', path, body, headers })

      const fail = state.failNext.findIndex((f) => f.match.test(`${req.method} ${path}`))
      if (fail >= 0) {
        const f = state.failNext.splice(fail, 1)[0]
        if (isUpload) await readBody(req).catch(() => null)
        return apiError(res, f.status, f.code, f.message)
      }

      // ----- login -----
      if (path === '/v2/auth/authorize/') {
        const code = `tt-code-${++seq}`
        state.codes.set(code, url.searchParams.get('client_key') ?? '')
        state.challenges.set(code, url.searchParams.get('code_challenge') ?? '')
        const back = new URL(url.searchParams.get('redirect_uri') as string)
        back.searchParams.set('code', code)
        back.searchParams.set('state', url.searchParams.get('state') ?? '')
        back.searchParams.set('scopes', url.searchParams.get('scope') ?? '')
        res.writeHead(302, { Location: back.toString() }).end()
        return
      }
      if (path === '/v2/oauth/token/') {
        state.tokenRequests.push(body)
        if (body.client_key !== state.clientKey || body.client_secret !== state.clientSecret) {
          return json(res, 401, {
            error: 'invalid_client',
            error_description: 'Client key or secret is wrong',
            log_id: 'x',
          })
        }
        if (body.grant_type === 'authorization_code') {
          const challenge = state.challenges.get(body.code)
          const expected = createHash('sha256')
            .update(body.code_verifier ?? '')
            .digest('base64url')
          if (!challenge || challenge !== expected)
            return json(res, 400, {
              error: 'invalid_grant',
              error_description: 'PKCE failed',
              log_id: 'x',
            })
        } else if (body.grant_type === 'refresh_token') {
          state.refreshCount++
          if (state.refreshInvalid || !state.refreshTokens.has(body.refresh_token)) {
            return json(res, 400, {
              error: 'invalid_grant',
              error_description: 'Refresh token is invalid or expired',
              log_id: 'x',
            })
          }
        }
        const access = `tt-access-${++seq}`
        const refresh = `tt-refresh-${seq}`
        state.accessTokens.add(access)
        state.refreshTokens.add(refresh)
        return json(res, 200, {
          access_token: access,
          expires_in: 86400,
          open_id: state.user.open_id,
          refresh_expires_in: 31536000,
          refresh_token: refresh,
          scope: state.grantedScope,
          token_type: 'Bearer',
        })
      }
      if (path === '/v2/oauth/revoke/') {
        state.revoked.push(body.token)
        return json(res, 200, {})
      }

      // ----- uploads (the address carries its own authority) -----
      let m = /^\/upload\/([^/]+)$/.exec(path)
      if (m && req.method === 'PUT') {
        const id = m[1]
        const u = state.uploads[id]
        state.uploadCount++
        const fault = state.uploadFault?.(state.uploadCount) ?? null
        if (!u || fault === '403') {
          await readBody(req).catch(() => null)
          return apiError(res, 403, 'forbidden', 'upload url expired')
        }
        if (fault === '503') {
          await readBody(req).catch(() => null)
          return apiError(res, 503, 'service_unavailable')
        }
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers['content-range'] ?? '')
        if (!range) return apiError(res, 416, 'invalid_range', 'bad Content-Range')
        const start = Number(range[1])
        const end = Number(range[2])
        if (start !== u.bytes) return apiError(res, 416, 'invalid_range', `expected ${u.bytes}`)
        if (fault === 'drop') {
          await new Promise<void>((r) => {
            req.on('data', () => {
              req.socket.destroy()
              r()
            })
            req.on('close', () => r())
          })
          return
        }
        const body2 = await readBody(req)
        if (body2.length !== end - start + 1)
          return apiError(res, 400, 'invalid_param', 'length mismatch')
        u.bytes = end + 1
        u.chunks.push([start, end])
        if (u.bytes >= u.size) {
          u.complete = true
          res.writeHead(201).end()
        } else res.writeHead(206).end()
        return
      }

      // ----- API -----
      const bearer = (headers.authorization ?? '').replace('Bearer ', '')
      if (!state.accessTokens.has(bearer))
        return apiError(
          res,
          401,
          'access_token_invalid',
          'The access token is invalid or not found in the request.',
        )

      if (path === '/v2/user/info/') return json(res, 200, ok({ user: state.user }))
      if (path === '/v2/post/publish/creator_info/query/') {
        state.creatorCalls++
        return json(res, 200, ok(state.creator))
      }
      m = /^\/v2\/post\/publish\/(inbox\/)?video\/init\/$/.exec(path)
      if (m) {
        const mode = m[1] ? 'inbox' : 'direct'
        const src = body?.source_info
        if (!src || src.source !== 'FILE_UPLOAD')
          return apiError(res, 400, 'invalid_param', 'source_info missing')
        const size = Number(src.video_size)
        const chunk = Number(src.chunk_size)
        const count = Number(src.total_chunk_count)
        if (size >= 5 * 1024 * 1024) {
          if (chunk < 5 * 1024 * 1024 || chunk > 64 * 1024 * 1024)
            return apiError(res, 400, 'invalid_param', 'chunk_size out of range')
          if (count !== Math.floor(size / chunk))
            return apiError(res, 400, 'invalid_param', 'total_chunk_count mismatch')
        } else if (chunk !== size || count !== 1)
          return apiError(res, 400, 'invalid_param', 'small videos must be one chunk')
        if (mode === 'direct') {
          const pi = body.post_info ?? {}
          if (!state.creator.privacy_level_options.includes(pi.privacy_level))
            return apiError(res, 400, 'privacy_level_option_mismatch', 'not allowed')
        }
        state.inits.push({ mode, body })
        const id = `v_pub_${++seq}`
        state.uploads[id] = {
          bytes: 0,
          size,
          chunks: [],
          mode,
          complete: false,
          postInfo: body.post_info,
        }
        return json(res, 200, ok({ publish_id: id, upload_url: `${base}/upload/${id}` }))
      }
      if (path === '/v2/post/publish/status/fetch/') {
        const id = body?.publish_id
        const u = state.uploads[id]
        if (!u) return apiError(res, 400, 'invalid_publish_id', 'unknown')
        polls[id] = (polls[id] ?? 0) + 1
        if (!u.complete)
          return json(res, 200, ok({ status: 'PROCESSING_UPLOAD', uploaded_bytes: u.bytes }))
        if (state.failReason)
          return json(res, 200, ok({ status: 'FAILED', fail_reason: state.failReason }))
        if (polls[id] <= state.pollsBeforeDone)
          return json(res, 200, ok({ status: 'PROCESSING_DOWNLOAD' }))
        const s = state.doneStatus[u.mode]
        return json(
          res,
          200,
          ok({
            status: s,
            ...(s === 'PUBLISH_COMPLETE'
              ? { publicaly_available_post_id: ['7000000000000000001'] }
              : {}),
          }),
        )
      }
      apiError(res, 404, 'not_found', `No fake route for ${req.method} ${path}`)
    } catch (e) {
      apiError(res, 500, 'internal_error', String(e))
    }
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return {
    base,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
