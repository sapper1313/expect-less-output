// A tiny local stand-in for Google (sign-in, tokens, YouTube API, resumable upload).
// Only erasable TypeScript syntax is used so plain Node can also run this file for the e2e scripts.
import { createServer } from 'http'
import type { IncomingMessage, Server, ServerResponse } from 'http'
import { createHash } from 'crypto'

export interface FakeChannel {
  id: string
  title: string
}

export interface FakeState {
  clientId: string
  clientSecret: string
  channels: FakeChannel[]
  /** Leave the refresh token out of the token response (to test that error). */
  omitRefreshToken: boolean
  /** Make every refresh answer invalid_grant. */
  refreshInvalid: boolean
  tokenRequests: Array<Record<string, string>>
  refreshCount: number
  revoked: string[]
  challenges: Map<string, string>
  uploads: Array<{ id: string; metadata: any; bytes: number; complete: boolean }>
  /** What YouTube reports for videos.list. */
  videoPrivacy: Record<string, string>
  /** Force every finished upload to report this privacy (to mimic the unverified-project lock). */
  forcePrivacy: string | null
  playlistItems: Array<{ playlistId: string; videoId: string }>
  /** Called with the 1-based number of each PUT. Return 'drop' to kill the connection, '503' for a server error, '404' to expire. */
  putFault: ((n: number, sessionId: string) => 'drop' | '503' | '404' | null) | null
  putCount: number
  accessTokens: Set<string>
  auth401Once: boolean
}

export interface FakeGoogle {
  base: string
  state: FakeState
  close(): Promise<void>
}

const json = (
  res: ServerResponse,
  code: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

export async function startFakeGoogle(port = 0): Promise<FakeGoogle> {
  const state: FakeState = {
    clientId: 'fake-client.apps.googleusercontent.com',
    clientSecret: 'fake-secret',
    channels: [{ id: 'UC_FAKE_1', title: 'Fake Channel' }],
    omitRefreshToken: false,
    refreshInvalid: false,
    tokenRequests: [],
    refreshCount: 0,
    revoked: [],
    challenges: new Map(),
    uploads: [],
    videoPrivacy: {},
    forcePrivacy: null,
    playlistItems: [],
    putFault: null,
    putCount: 0,
    accessTokens: new Set(),
    auth401Once: false,
  }
  const sessions = new Map<
    string,
    { size: number; received: number; metadata: any; videoId: string }
  >()
  let seq = 0
  let base = ''

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    try {
      // ----- sign in -----
      if (path === '/o/oauth2/v2/auth') {
        const redirect = url.searchParams.get('redirect_uri') as string
        const code = `code-${++seq}`
        state.challenges.set(code, url.searchParams.get('code_challenge') ?? '')
        const back = new URL(redirect)
        back.searchParams.set('code', code)
        back.searchParams.set('state', url.searchParams.get('state') ?? '')
        res.writeHead(302, { Location: back.toString() }).end()
        return
      }
      if (path === '/token') {
        const form = Object.fromEntries(new URLSearchParams((await readBody(req)).toString()))
        state.tokenRequests.push(form)
        if (form.client_id !== state.clientId || form.client_secret !== state.clientSecret) {
          return json(res, 401, { error: 'invalid_client' })
        }
        if (form.grant_type === 'authorization_code') {
          const challenge = state.challenges.get(form.code)
          const verifier = form.code_verifier ?? ''
          const expected = createHash('sha256').update(verifier).digest('base64url')
          if (!challenge || challenge !== expected)
            return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE failed' })
          const access = `access-${++seq}`
          state.accessTokens.add(access)
          return json(res, 200, {
            access_token: access,
            expires_in: 3600,
            token_type: 'Bearer',
            ...(state.omitRefreshToken ? {} : { refresh_token: `refresh-${seq}` }),
          })
        }
        if (form.grant_type === 'refresh_token') {
          state.refreshCount++
          if (state.refreshInvalid || state.revoked.includes(form.refresh_token)) {
            return json(res, 400, {
              error: 'invalid_grant',
              error_description: 'Token has been expired or revoked.',
            })
          }
          const access = `access-${++seq}`
          state.accessTokens.add(access)
          return json(res, 200, { access_token: access, expires_in: 3600, token_type: 'Bearer' })
        }
        return json(res, 400, { error: 'unsupported_grant_type' })
      }
      if (path === '/revoke') {
        const form = Object.fromEntries(new URLSearchParams((await readBody(req)).toString()))
        state.revoked.push(form.token)
        return json(res, 200, {})
      }

      // ----- YouTube API (needs a valid token) -----
      const bearer = (req.headers.authorization ?? '').replace('Bearer ', '')
      if (path.startsWith('/youtube/v3') || path.startsWith('/upload')) {
        if (state.auth401Once) {
          state.auth401Once = false
          return json(res, 401, {
            error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] },
          })
        }
        if (!state.accessTokens.has(bearer)) {
          return json(res, 401, {
            error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] },
          })
        }
      }
      if (path === '/youtube/v3/channels') {
        return json(res, 200, {
          items: state.channels.map((c) => ({
            id: c.id,
            snippet: {
              title: c.title,
              thumbnails: { default: { url: `${base}/avatar/${c.id}.png` } },
            },
          })),
        })
      }
      if (path === '/youtube/v3/videoCategories') {
        return json(res, 200, {
          items: [
            { id: '22', snippet: { title: 'People & Blogs', assignable: true } },
            { id: '28', snippet: { title: 'Science & Technology', assignable: true } },
            { id: '29', snippet: { title: 'Not assignable', assignable: false } },
          ],
        })
      }
      if (path === '/youtube/v3/playlists') {
        return json(res, 200, {
          items: [
            { id: 'PL1', snippet: { title: 'Shorts Playlist' } },
            { id: 'PL2', snippet: { title: 'Other' } },
          ],
        })
      }
      if (path === '/youtube/v3/playlistItems' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString())
        state.playlistItems.push({
          playlistId: body.snippet.playlistId,
          videoId: body.snippet.resourceId.videoId,
        })
        return json(res, 200, { id: 'PLI1' })
      }
      if (path === '/youtube/v3/videos' && req.method === 'GET') {
        const id = url.searchParams.get('id') as string
        const privacy = state.videoPrivacy[id]
        return json(res, 200, {
          items: privacy
            ? [{ id, status: { privacyStatus: privacy, uploadStatus: 'processed' } }]
            : [],
        })
      }

      // ----- resumable upload -----
      if (path === '/upload/youtube/v3/videos' && req.method === 'POST') {
        const metadata = JSON.parse((await readBody(req)).toString())
        const id = `vid${++seq}`
        const sessionId = `s${seq}`
        sessions.set(sessionId, {
          size: Number(req.headers['x-upload-content-length']),
          received: 0,
          metadata,
          videoId: id,
        })
        state.uploads.push({ id, metadata, bytes: 0, complete: false })
        res.writeHead(200, { Location: `${base}/upload/session/${sessionId}` }).end()
        return
      }
      if (path.startsWith('/upload/session/') && req.method === 'PUT') {
        const sessionId = path.split('/').pop() as string
        const s = sessions.get(sessionId)
        state.putCount++
        const fault = state.putFault?.(state.putCount, sessionId) ?? null
        if (!s || fault === '404') {
          await readBody(req).catch(() => null)
          return json(res, 404, { error: { code: 404, message: 'Not Found' } })
        }
        if (fault === 'drop') {
          // Take part of the body, then cut the connection.
          await new Promise<void>((r) => {
            let got = 0
            req.on('data', (c) => {
              got += c.length
              s.received = Math.max(s.received, 0)
              if (got > 1024) {
                req.socket.destroy()
                r()
              }
            })
            req.on('close', () => r())
          })
          return
        }
        if (fault === '503') {
          await readBody(req)
          return json(res, 503, { error: { code: 503, message: 'Backend Error' } })
        }
        const body = await readBody(req)
        const range = String(req.headers['content-range'] ?? '')
        const query = /^bytes \*\//.test(range)
        if (!query) {
          const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)
          if (!m) return json(res, 400, { error: { code: 400, message: 'bad range' } })
          const start = Number(m[1])
          if (start !== s.received)
            return json(res, 400, {
              error: { code: 400, message: `expected offset ${s.received} got ${start}` },
            })
          s.received = start + body.length
          const up = state.uploads.find((u) => u.id === s.videoId)
          if (up) up.bytes = s.received
        }
        if (s.received >= s.size) {
          const up = state.uploads.find((u) => u.id === s.videoId)
          if (up) up.complete = true
          const requested = s.metadata.status?.privacyStatus ?? 'private'
          const privacy = state.forcePrivacy ?? requested
          state.videoPrivacy[s.videoId] = privacy
          return json(res, 200, {
            id: s.videoId,
            status: { privacyStatus: privacy, publishAt: s.metadata.status?.publishAt },
          })
        }
        res.writeHead(308, s.received > 0 ? { Range: `bytes=0-${s.received - 1}` } : {}).end()
        return
      }
      json(res, 404, { error: { code: 404, message: `No fake route for ${req.method} ${path}` } })
    } catch (e) {
      json(res, 500, { error: { code: 500, message: String(e) } })
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
