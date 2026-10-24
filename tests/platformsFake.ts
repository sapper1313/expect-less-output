import { createServer, type IncomingMessage, type Server } from 'http'
import { AddressInfo } from 'net'

export interface Seen {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

/** A tiny local server that plays X, LinkedIn and Pinterest. Every request is recorded. */
export async function fakePlatforms(): Promise<{
  base: string
  seen: Seen[]
  close: () => Promise<void>
  failNext: (path: string, status: number) => void
}> {
  const seen: Seen[] = []
  const fails = new Map<string, number>()
  let uploads = 0
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = Buffer.concat(chunks).toString('latin1')
    const path = req.url ?? ''
    seen.push({ method: req.method ?? '', path, headers: req.headers, body })
    const send = (status: number, json?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(json === undefined ? '' : JSON.stringify(json))
    }
    const bare = path.split('?')[0] as string
    const f = fails.get(bare)
    if (f) {
      fails.delete(bare)
      return send(f, { error: 'forced' })
    }
    // ---- X
    if (bare === '/2/oauth2/token')
      return send(200, { access_token: 'x-access', refresh_token: 'x-refresh', expires_in: 7200 })
    if (bare === '/2/users/me') return send(200, { data: { id: '42', username: 'mathofit' } })
    if (bare === '/2/media/upload/initialize') return send(200, { data: { id: 'media-1' } })
    if (/^\/2\/media\/upload\/media-1\/append$/.test(bare)) return send(204)
    if (bare === '/2/media/upload/media-1/finalize') return send(200, { data: { id: 'media-1' } })
    if (bare === '/2/tweets') return send(201, { data: { id: 'tweet-9' } })
    // ---- LinkedIn
    if (bare === '/oauth/v2/accessToken')
      return send(200, { access_token: 'li-access', expires_in: 5184000 })
    if (bare === '/v2/userinfo') return send(200, { sub: 'abc123', name: 'Veda Host' })
    if (bare === '/rest/videos' && path.includes('initializeUpload'))
      return send(200, {
        value: {
          video: 'urn:li:video:V1',
          uploadToken: 'tok',
          uploadInstructions: [
            { uploadUrl: `${base()}/upload/part1`, firstByte: 0, lastByte: 4194303 },
          ],
        },
      })
    if (bare === '/upload/part1') {
      uploads++
      return send(200, undefined, { etag: '"etag-part-1"' })
    }
    if (bare === '/rest/videos' && path.includes('finalizeUpload')) return send(200, {})
    if (bare.startsWith('/rest/videos/urn')) return send(200, { status: 'AVAILABLE' })
    if (bare === '/rest/posts') return send(201, undefined, { 'x-restli-id': 'urn:li:share:S1' })
    // ---- Pinterest
    if (bare === '/v5/oauth/token')
      return send(200, {
        access_token: 'pin-access',
        refresh_token: 'pin-refresh',
        expires_in: 2592000,
      })
    if (bare === '/v5/user_account') return send(200, { username: 'mathofit' })
    if (bare === '/v5/boards') return send(200, { items: [{ id: 'b1', name: 'Money tips' }] })
    if (bare === '/v5/media' && req.method === 'POST')
      return send(200, {
        media_id: 'm-7',
        upload_url: `${base()}/s3upload`,
        upload_parameters: { key: 'k', policy: 'p' },
      })
    if (bare === '/s3upload') {
      uploads++
      return send(204)
    }
    if (bare === '/v5/media/m-7') return send(200, { status: 'succeeded' })
    if (bare === '/v5/pins') return send(201, { id: 'pin-5' })
    send(404, { error: `no route ${bare}` })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    base: base(),
    seen,
    failNext: (p, s) => void fails.set(p, s),
    close: () => new Promise((r) => server.close(() => r())),
  }
}
