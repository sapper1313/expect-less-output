import { createHash, timingSafeEqual } from 'crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'http'
import { ZodError } from 'zod'
import { ROUTES, type RouteDef } from '@shared/agentRoutes'
import { buildOpenApi } from '@shared/openapi'
import { AgentError, type AgentServices } from './core'
import { HANDLERS } from './handlers'

export interface AgentRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: string
  /** The port this server listens on, used to check the Host header. */
  port: number
}

export interface AgentResponse {
  status: number
  body: unknown
}

const MAX_BODY = 1_000_000

const err = (status: number, code: string, message: string, details?: unknown): AgentResponse => ({
  status,
  body: { error: { code, message, ...(details !== undefined ? { details } : {}) } },
})

function issuesOf(e: ZodError) {
  return e.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
}

const routeRegex = (r: RouteDef) => new RegExp('^' + r.path.replace(/\{[^}]+\}/g, '([^/]+)') + '$')

const safeEqual = (a: string, b: string): boolean =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())

/**
 * Handles one request. No sockets in here, so tests can call it directly.
 * Checks, in order: Host and Origin (blocks web pages and DNS tricks), the bearer token, the route, the schemas.
 */
export async function handleAgentRequest(
  s: AgentServices,
  token: () => string | null,
  req: AgentRequest,
  onDenied: (reason: string) => void = () => {},
): Promise<AgentResponse> {
  const host = String(req.headers.host ?? '').toLowerCase()
  if (host !== `127.0.0.1:${req.port}` && host !== `localhost:${req.port}`) {
    onDenied('bad Host header')
    return err(403, 'forbidden', 'Requests must go to 127.0.0.1 or localhost.')
  }
  if (req.headers.origin !== undefined) {
    onDenied('browser Origin header')
    return err(
      403,
      'forbidden',
      'Browser requests are not allowed. This API is for local programs.',
    )
  }
  const expected = token()
  if (!expected)
    return err(
      401,
      'unauthorized',
      'No token has been generated yet. The owner creates one in Settings, under Agents.',
    )
  const auth = String(req.headers.authorization ?? '')
  const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!given || !safeEqual(given, expected)) {
    onDenied('wrong or missing token')
    return err(401, 'unauthorized', 'Missing or wrong token. Send "Authorization: Bearer <token>".')
  }

  let url: URL
  try {
    url = new URL(req.url, `http://127.0.0.1:${req.port}`)
  } catch {
    return err(400, 'bad_request', 'Bad URL.')
  }
  if (url.pathname === '/v1/openapi.json' && req.method === 'GET')
    return { status: 200, body: buildOpenApi() }

  let matched: { route: RouteDef; params: Record<string, string> } | null = null
  let pathKnown = false
  for (const r of ROUTES) {
    const m = routeRegex(r).exec(url.pathname)
    if (!m) continue
    pathKnown = true
    if (r.method !== req.method) continue
    const names = [...r.path.matchAll(/\{([^}]+)\}/g)].map((x) => x[1])
    matched = {
      route: r,
      params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])),
    }
    break
  }
  if (!matched)
    return pathKnown
      ? err(405, 'method_not_allowed', `${req.method} is not available for ${url.pathname}.`)
      : err(404, 'not_found', `No such endpoint: ${url.pathname}.`)
  const { route } = matched

  try {
    const params = route.params ? route.params.parse(matched.params) : {}
    const query = route.query ? route.query.parse(Object.fromEntries(url.searchParams)) : {}
    let body: unknown = undefined
    if (route.body) {
      if (req.body.length > MAX_BODY) return err(400, 'bad_request', 'Request body is too large.')
      const ct = String(req.headers['content-type'] ?? '')
      if (!ct.includes('application/json'))
        return err(400, 'bad_request', 'Send the body as JSON with Content-Type: application/json.')
      let raw: unknown
      try {
        raw = JSON.parse(req.body || '{}')
      } catch {
        return err(400, 'bad_request', 'The body is not valid JSON.')
      }
      body = route.body.parse(raw)
    }
    const handler = HANDLERS[route.id]
    const result = await handler({ s, params, query, body })
    return { status: route.success, body: result }
  } catch (e) {
    if (e instanceof ZodError)
      return err(400, 'validation', 'The request did not match the schema.', issuesOf(e))
    if (e instanceof AgentError) return err(e.status, e.code, e.message, e.details)
    s.log.log('error', `Agent API error on ${req.method} ${url.pathname}: ${(e as Error).message}`)
    return err(500, 'server_error', 'Something went wrong inside the app. Check the Activity Log.')
  }
}

/** The real server. Bound to 127.0.0.1 only. */
export class AgentServer {
  private server: Server | null = null
  private lastDeniedLog = 0
  constructor(
    private s: AgentServices,
    private getToken: () => string | null,
  ) {}

  get running(): boolean {
    return this.server !== null
  }

  address(): { address: string; port: number } | null {
    const a = this.server?.address()
    return a && typeof a === 'object' ? { address: a.address, port: a.port } : null
  }

  async start(port: number): Promise<void> {
    if (this.server) await this.stop()
    await new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        const chunks: Buffer[] = []
        let size = 0
        let tooBig = false
        req.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_BODY + 1) tooBig = true
          else chunks.push(c)
        })
        req.on('end', async () => {
          const out = tooBig
            ? err(400, 'bad_request', 'Request body is too large.')
            : await handleAgentRequest(
                this.s,
                this.getToken,
                {
                  method: req.method ?? 'GET',
                  url: req.url ?? '/',
                  headers: req.headers,
                  body: Buffer.concat(chunks).toString('utf8'),
                  port: (server.address() as { port: number }).port,
                },
                (reason) => {
                  const now = Date.now()
                  if (now - this.lastDeniedLog > 60_000) {
                    this.lastDeniedLog = now
                    this.s.log.log('warn', `Agent API refused a request (${reason}).`)
                  }
                },
              )
          res.writeHead(out.status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          })
          res.end(JSON.stringify(out.body))
        })
      })
      server.on('error', (e: NodeJS.ErrnoException) => {
        reject(
          e.code === 'EADDRINUSE'
            ? new Error(
                `Port ${port} is already in use. Pick another port in Settings, under Agents.`,
              )
            : e,
        )
      })
      server.listen(port, '127.0.0.1', () => {
        this.server = server
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>((resolve) => {
      server.closeAllConnections?.()
      server.close(() => resolve())
    })
  }
}
