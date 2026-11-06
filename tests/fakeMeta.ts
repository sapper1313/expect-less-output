// A tiny local stand-in for Meta (login, tokens, Pages, Facebook Reels, Instagram Reels).
// Only erasable TypeScript syntax is used so plain Node can also run this file for the e2e scripts.
import { createServer } from 'http'
import type { IncomingMessage, Server, ServerResponse } from 'http'

const V = 'v25.0'

export interface FakePage {
  id: string
  name: string
  token: string
  ig?: { id: string; username: string }
}

export interface FakeMetaState {
  appId: string
  appSecret: string
  pages: FakePage[]
  /** Unix seconds. 0 means "never expires". */
  expiresAt: number
  dataAccessExpiresAt: number
  scopes: string[]
  /** Reject every call that uses a Bearer token with error 190. */
  invalidToken: boolean
  /** Page size for /me/accounts, to test paging. */
  accountsPageSize: number
  /** Queue of one-off failures. First matching entry is used once. */
  failNext: Array<{ match: RegExp; status: number; body: unknown }>
  requests: Array<{
    method: string
    path: string
    params: Record<string, string>
    headers: Record<string, string>
  }>
  fbVideos: Record<
    string,
    {
      page: string
      bytes: number
      fileSize: number
      finishParams?: Record<string, string>
      published: boolean
      error?: string
    }
  >
  /** Called with the 1-based upload request number. 'drop' cuts the connection mid-body. */
  uploadFault: ((n: number, id: string) => 'drop' | null) | null
  uploadCount: number
  igContainers: Record<
    string,
    {
      ig: string
      params: Record<string, string>
      bytes: number
      fileSize: number
      polls: number
      finishAfterPolls: number
      status: 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED'
      statusText?: string
    }
  >
  igPublished: Array<{ container: string; mediaId: string }>
  igQuotaUsage: number
  igQuotaTotal: number
  /** How many status polls a new container stays IN_PROGRESS. */
  igPollsUntilFinished: number
  /** If set, new containers end in this status instead of FINISHED. */
  igFinalStatus: 'ERROR' | 'EXPIRED' | null
  /** How many Instagram uploads to refuse with "container is not in the status to upload". */
  igRefuseUploads: number
  revokedPermissions: number
  codes: Map<string, string>
  /** The clock used to validate scheduled times. Tests point this at their mock clock. */
  nowMs: () => number
}

export interface FakeMeta {
  base: string
  state: FakeMetaState
  close(): Promise<void>
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
const metaError = (
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  extra: Record<string, unknown> = {},
) =>
  json(res, status, { error: { message, type: 'OAuthException', code, fbtrace_id: 'x', ...extra } })

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

export async function startFakeMeta(port = 0): Promise<FakeMeta> {
  const state: FakeMetaState = {
    appId: '123456789012345',
    appSecret: 'meta-secret',
    pages: [
      {
        id: 'P1',
        name: 'Trash Panda Money',
        token: 'page-token-P1',
        ig: { id: 'IG1', username: 'trashpanda' },
      },
    ],
    expiresAt: Math.floor(Date.now() / 1000) + 60 * 86400,
    dataAccessExpiresAt: Math.floor(Date.now() / 1000) + 90 * 86400,
    scopes: [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'business_management',
      'instagram_basic',
      'instagram_content_publish',
      'read_insights',
      'instagram_manage_insights',
    ],
    invalidToken: false,
    accountsPageSize: 100,
    failNext: [],
    requests: [],
    fbVideos: {},
    uploadFault: null,
    uploadCount: 0,
    igContainers: {},
    igPublished: [],
    igQuotaUsage: 3,
    igQuotaTotal: 100,
    igPollsUntilFinished: 2,
    igFinalStatus: null,
    igRefuseUploads: 0,
    revokedPermissions: 0,
    codes: new Map(),
    nowMs: () => Date.now(),
  }
  const tokens = new Set<string>()
  let seq = 0
  let base = ''

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const params: Record<string, string> = Object.fromEntries(url.searchParams)
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) headers[k] = String(v)
    const isUpload = path.startsWith('/video-upload/') || path.startsWith('/ig-api-upload/')
    try {
      let body: Buffer = Buffer.alloc(0)
      if (!isUpload) {
        body = await readBody(req)
        if (req.method === 'POST' && (headers['content-type'] ?? '').includes('urlencoded')) {
          Object.assign(params, Object.fromEntries(new URLSearchParams(body.toString())))
        }
      }
      state.requests.push({ method: req.method ?? 'GET', path, params, headers })

      const fail = state.failNext.findIndex((f) => f.match.test(`${req.method} ${path}`))
      if (fail >= 0) {
        const f = state.failNext.splice(fail, 1)[0]
        if (isUpload) await readBody(req).catch(() => null)
        return json(res, f.status, f.body)
      }

      // ----- login -----
      if (path === '/dialog/oauth') {
        const code = `code-${++seq}`
        state.codes.set(code, params.client_id)
        const back = new URL(params.redirect_uri)
        back.searchParams.set('code', code)
        back.searchParams.set('state', params.state ?? '')
        res.writeHead(302, { Location: back.toString() }).end()
        return
      }
      if (path === `/${V}/oauth/access_token`) {
        if (params.client_id !== state.appId || params.client_secret !== state.appSecret)
          return metaError(res, 400, 101, 'Error validating client secret.')
        if (params.grant_type === 'fb_exchange_token') {
          if (!tokens.has(params.fb_exchange_token))
            return metaError(res, 400, 190, 'Invalid short token')
          const t = `long-${++seq}`
          tokens.add(t)
          return json(res, 200, { access_token: t, token_type: 'bearer', expires_in: 5184000 })
        }
        if (!state.codes.has(params.code))
          return metaError(res, 400, 100, 'This authorization code has expired.')
        const t = `short-${++seq}`
        tokens.add(t)
        return json(res, 200, { access_token: t, token_type: 'bearer', expires_in: 3600 })
      }

      // ----- everything else needs a token -----
      const bearer = (headers.authorization ?? '').replace(/^(Bearer|OAuth) /, '')
      if (!tokens.has(bearer) && !state.pages.some((p) => p.token === bearer)) {
        return metaError(res, 401, 190, 'Invalid OAuth access token.')
      }
      if (state.invalidToken)
        return metaError(res, 400, 190, 'Error validating access token: Session has expired.', {
          error_subcode: 463,
        })

      if (path === `/${V}/debug_token`) {
        return json(res, 200, {
          data: {
            is_valid: true,
            expires_at: state.expiresAt,
            data_access_expires_at: state.dataAccessExpiresAt,
            scopes: state.scopes,
          },
        })
      }
      if (path === `/${V}/me`) return json(res, 200, { id: 'U1', name: 'Test Owner' })
      if (path === `/${V}/me/permissions`) {
        if (req.method === 'DELETE') {
          state.revokedPermissions++
          return json(res, 200, { success: true })
        }
        return json(res, 200, {
          data: state.scopes.map((p) => ({ permission: p, status: 'granted' })),
        })
      }
      if (path === `/${V}/me/accounts`) {
        const after = Number(params.after ?? 0)
        const slice = state.pages.slice(after, after + state.accountsPageSize)
        const next =
          after + state.accountsPageSize < state.pages.length
            ? `${base}/${V}/me/accounts?after=${after + state.accountsPageSize}`
            : undefined
        return json(res, 200, {
          data: slice.map((p) => ({
            id: p.id,
            name: p.name,
            access_token: p.token,
            picture: { data: { url: `${base}/pic/${p.id}.png` } },
            ...(p.ig
              ? {
                  instagram_business_account: {
                    id: p.ig.id,
                    username: p.ig.username,
                    profile_picture_url: `${base}/pic/${p.ig.id}.png`,
                  },
                }
              : {}),
          })),
          ...(next ? { paging: { next } } : {}),
        })
      }

      // ----- Facebook Reels -----
      let m = new RegExp(`^/${V}/([^/]+)/video_reels$`).exec(path)
      if (m && req.method === 'POST') {
        const page = m[1]
        if (params.upload_phase === 'start') {
          const id = `fbv${++seq}`
          state.fbVideos[id] = { page, bytes: 0, fileSize: 0, published: false }
          return json(res, 200, { video_id: id, upload_url: `${base}/video-upload/${V}/${id}` })
        }
        if (params.upload_phase === 'finish') {
          const v = state.fbVideos[params.video_id]
          if (!v) return metaError(res, 400, 100, 'Unknown video')
          if (v.fileSize === 0 || v.bytes < v.fileSize)
            return metaError(res, 400, 100, 'Upload not finished')
          if (params.video_state === 'SCHEDULED') {
            const when = Number(params.scheduled_publish_time)
            if (!when || when * 1000 < state.nowMs() + 10 * 60_000)
              return metaError(
                res,
                400,
                100,
                'Scheduled time must be at least 10 minutes in the future.',
              )
          }
          v.finishParams = params
          if (params.video_state === 'PUBLISHED') v.published = true
          return json(res, 200, { success: true })
        }
      }
      m = new RegExp(`^/video-upload/${V}/([^/]+)$`).exec(path)
      if (m) {
        const v = state.fbVideos[m[1]]
        if (!v) return metaError(res, 400, 100, 'Unknown video')
        if (req.method === 'GET') return json(res, 200, { file_offset: v.bytes })
        return await handleUpload(req, res, headers, v, m[1])
      }
      m = new RegExp(`^/${V}/(fbv\\d+)$`).exec(path)
      if (m && req.method === 'GET') {
        const v = state.fbVideos[m[1]]
        if (!v) return metaError(res, 400, 100, 'Unknown video')
        const complete = v.published
        return json(res, 200, {
          id: m[1],
          permalink_url: `/reel/${m[1]}/`,
          status: {
            video_status: complete ? 'ready' : 'processing',
            uploading_phase: {
              status: v.error ? 'error' : 'complete',
              ...(v.error ? { errors: [{ message: v.error }] } : {}),
            },
            processing_phase: { status: 'complete' },
            publishing_phase: complete
              ? { status: 'complete', publish_status: 'published' }
              : { status: 'not_started', publish_status: 'scheduled' },
          },
        })
      }

      // ----- Instagram Reels -----
      m = new RegExp(`^/${V}/([^/]+)/content_publishing_limit$`).exec(path)
      if (m)
        return json(res, 200, {
          data: [
            {
              quota_usage: state.igQuotaUsage,
              config: { quota_total: state.igQuotaTotal, quota_duration: 86400 },
            },
          ],
        })
      m = new RegExp(`^/${V}/([^/]+)/media$`).exec(path)
      if (m && req.method === 'POST') {
        const id = `igc${++seq}`
        state.igContainers[id] = {
          ig: m[1],
          params,
          bytes: 0,
          fileSize: 0,
          polls: 0,
          finishAfterPolls: state.igPollsUntilFinished,
          status: 'IN_PROGRESS',
        }
        return json(res, 200, { id, uri: `${base}/ig-api-upload/${V}/${id}` })
      }
      m = new RegExp(`^/ig-api-upload/${V}/([^/]+)$`).exec(path)
      if (m) {
        const c = state.igContainers[m[1]]
        if (!c) return metaError(res, 400, 100, 'Unknown container')
        if (req.method === 'GET') return json(res, 200, { file_offset: c.bytes })
        if (state.igRefuseUploads > 0) {
          state.igRefuseUploads--
          return metaError(res, 400, 100, 'The ig container is not in the status to upload a video')
        }
        return await handleUpload(req, res, headers, c, m[1])
      }
      m = new RegExp(`^/${V}/(igc\\d+)$`).exec(path)
      if (m && req.method === 'GET') {
        const c = state.igContainers[m[1]]
        if (!c) return metaError(res, 400, 100, 'Unknown container')
        c.polls++
        if (c.status === 'IN_PROGRESS' && c.polls > c.finishAfterPolls && c.bytes >= c.fileSize) {
          c.status = state.igFinalStatus ?? 'FINISHED'
          if (state.igFinalStatus)
            c.statusText = 'Error: 2207026 The video format is not supported.'
        }
        return json(res, 200, {
          id: m[1],
          status_code: c.status,
          ...(c.statusText ? { status: c.statusText } : {}),
        })
      }
      m = new RegExp(`^/${V}/([^/]+)/media_publish$`).exec(path)
      if (m && req.method === 'POST') {
        const c = state.igContainers[params.creation_id]
        if (!c || c.status !== 'FINISHED')
          return metaError(res, 400, 9007, 'Media ID is not available', { error_subcode: 2207027 })
        const mediaId = `igm${++seq}`
        c.status = 'PUBLISHED'
        state.igPublished.push({ container: params.creation_id, mediaId })
        return json(res, 200, { id: mediaId })
      }
      m = new RegExp(`^/${V}/(igm\\d+)$`).exec(path)
      if (m && req.method === 'GET')
        return json(res, 200, { id: m[1], permalink: `https://www.instagram.com/reel/${m[1]}/` })

      metaError(res, 404, 100, `No fake route for ${req.method} ${path}`)
    } catch (e) {
      json(res, 500, { error: { message: String(e), code: 1 } })
    }
  })

  async function handleUpload(
    req: IncomingMessage,
    res: ServerResponse,
    headers: Record<string, string>,
    target: { bytes: number; fileSize: number },
    id: string,
  ) {
    state.uploadCount++
    const fault = state.uploadFault?.(state.uploadCount, id) ?? null
    const offset = Number(headers.offset ?? 0)
    const fileSize = Number(headers.file_size ?? 0)
    if (!headers.authorization?.startsWith('OAuth '))
      return metaError(res, 400, 190, 'Upload needs an OAuth header')
    if (!headers['content-length'] && headers['transfer-encoding'] !== 'chunked')
      return metaError(res, 400, 100, 'Missing length')
    if (offset !== target.bytes) {
      await readBody(req).catch(() => null)
      return metaError(res, 400, 100, `Bad offset ${offset}, expected ${target.bytes}`)
    }
    target.fileSize = fileSize
    let got = 0
    await new Promise<void>((resolve) => {
      req.on('data', (c: Buffer) => {
        got += c.length
        target.bytes = offset + got
        if (fault === 'drop' && got > 4096) {
          req.socket.destroy()
          resolve()
        }
      })
      req.on('end', () => resolve())
      req.on('close', () => resolve())
    })
    if (res.destroyed || req.socket.destroyed) return
    json(res, 200, { success: true })
  }

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
