import { createReadStream } from 'fs'
import { Readable, Transform } from 'stream'
import { AdapterError } from '../adapters/types'
import { isNetworkError } from '../google/errors'
import { describeNetworkError, withNetworkRetry } from '../network'
import { GRAPH_VERSION, type MetaUrls } from './config'

/** A Meta failure. `needsReauth` means the saved login no longer works. */
export class MetaApiError extends AdapterError {
  constructor(
    message: string,
    kind: 'transient' | 'permanent',
    public code: number,
    public subcode: number,
    public needsReauth = false,
  ) {
    super(message, kind)
    this.name = 'MetaApiError'
  }
}

const TRANSIENT_CODES = new Set([
  1, 2, 4, 17, 32, 341, 613, 9007, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009,
  80014,
])

interface MetaErrorBody {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    is_transient?: boolean
    error_user_msg?: string
  }
}

/** Turns a Meta error response into transient (retry) or permanent (stop and tell the owner). */
export function classifyMetaError(
  status: number,
  body: MetaErrorBody | null | undefined,
): MetaApiError {
  const e = body?.error ?? {}
  const code = e.code ?? 0
  const sub = e.error_subcode ?? 0
  const text = e.error_user_msg || e.message || `Meta returned an error (HTTP ${status}).`
  if (code === 190 || (e.type === 'OAuthException' && [458, 459, 460, 463, 467].includes(sub))) {
    return new MetaApiError(
      'Meta no longer accepts the saved login. Reconnect Meta on the Connections screen.',
      'permanent',
      code,
      sub,
      true,
    )
  }
  if (code === 10 || (code >= 200 && code <= 299)) {
    return new MetaApiError(
      `Meta says this login is missing a permission: ${text} Reconnect Meta and approve every permission.`,
      'permanent',
      code,
      sub,
    )
  }
  if (
    code === 4 ||
    code === 17 ||
    code === 32 ||
    code === 613 ||
    (code >= 80000 && code <= 80014)
  ) {
    return new MetaApiError(
      `Meta is limiting requests right now (code ${code}). ${text}`,
      'transient',
      code,
      sub,
    )
  }
  if (code === 368)
    return new MetaApiError(
      `Meta blocked this action as a policy problem: ${text}`,
      'permanent',
      code,
      sub,
    )
  if (e.is_transient || TRANSIENT_CODES.has(code) || status >= 500 || status === 429) {
    return new MetaApiError(
      `Meta had a temporary problem (code ${code || status}). ${text}`,
      'transient',
      code,
      sub,
    )
  }
  return new MetaApiError(
    `Meta rejected the request (code ${code || status}). ${text}`,
    'permanent',
    code,
    sub,
  )
}

export interface GraphDeps {
  urls: MetaUrls
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Thin wrapper over the Graph API. Tokens go in the Authorization header, never in a URL. */
export class GraphClient {
  constructor(private d: GraphDeps) {}

  private get f(): typeof fetch {
    return this.d.fetchImpl ?? fetch
  }

  private async send(
    method: string,
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    token?: string,
  ) {
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(params)) if (v !== undefined) clean[k] = String(v)
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    let url = path.startsWith('http') ? path : `${this.d.urls.graph}${path}`
    let body: string | undefined
    if (method === 'GET' || method === 'DELETE') {
      const qs = new URLSearchParams(clean).toString()
      if (qs) url += (url.includes('?') ? '&' : '?') + qs
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = new URLSearchParams(clean).toString()
    }
    let res: Response
    try {
      // A read can safely be asked again. A write is sent once, so it is never done twice.
      const send = () => this.f(url, { method, headers, body })
      res = await (method === 'GET' ? withNetworkRetry(send, isNetworkError) : send())
    } catch (err) {
      if (isNetworkError(err))
        throw new MetaApiError(
          `Could not reach Meta: ${describeNetworkError(err)}`,
          'transient',
          0,
          0,
        )
      throw err
    }
    let json: any = null
    try {
      json = await res.json()
    } catch {
      // not JSON
    }
    if (!res.ok || json?.error) throw classifyMetaError(res.status, json)
    return json
  }

  get<T = any>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
    token?: string,
  ): Promise<T> {
    return this.send('GET', path, params, token)
  }
  post<T = any>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
    token?: string,
  ): Promise<T> {
    return this.send('POST', path, params, token)
  }
  delete<T = any>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
    token?: string,
  ): Promise<T> {
    return this.send('DELETE', path, params, token)
  }

  /** Follows paging.next for list endpoints. */
  async getAll<T = any>(
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    token: string,
    max = 500,
  ): Promise<T[]> {
    const out: T[] = []
    let page = await this.get<{ data: T[]; paging?: { next?: string } }>(path, params, token)
    for (;;) {
      out.push(...(page.data ?? []))
      if (!page.paging?.next || out.length >= max) return out
      page = await this.get(page.paging.next, {}, token)
    }
  }

  /**
   * Uploads a local file to Meta's upload host (used for both Facebook Reels and Instagram Reels).
   * After a dropped connection it asks Meta how many bytes arrived and sends only the rest.
   */
  async uploadFile(opts: {
    url: string
    token: string
    filePath: string
    fileSize: number
    onProgress?: (fraction: number) => void
    maxFailures?: number
  }): Promise<void> {
    const sleep = this.d.sleep ?? defaultSleep
    const max = opts.maxFailures ?? 6
    let offset = 0
    let failures = 0
    const wait = async () => {
      failures++
      if (failures > max)
        throw new MetaApiError(
          'The upload to Meta kept failing. Check the internet connection and retry.',
          'transient',
          0,
          0,
        )
      await sleep(Math.min(20_000, 2 ** failures * 500))
    }
    for (;;) {
      try {
        let sent = offset
        const source = createReadStream(opts.filePath, { start: offset })
        const counted = Readable.toWeb(
          source.pipe(
            new Transform({
              transform(chunk, _enc, cb) {
                sent += chunk.length
                opts.onProgress?.(opts.fileSize ? sent / opts.fileSize : 1)
                cb(null, chunk)
              },
            }),
          ),
        ) as unknown as ReadableStream
        const res = await this.f(opts.url, {
          method: 'POST',
          headers: {
            Authorization: `OAuth ${opts.token}`,
            offset: String(offset),
            file_size: String(opts.fileSize),
            'Content-Length': String(opts.fileSize - offset),
          },
          body: counted,
          // @ts-expect-error Node needs this to stream a request body
          duplex: 'half',
        })
        const json: any = await res.json().catch(() => null)
        if (res.ok && json?.success !== false && !json?.error) {
          opts.onProgress?.(1)
          return
        }
        const err = classifyMetaError(res.status, json)
        if (err.kind === 'permanent') throw err
        await wait()
      } catch (err) {
        if (err instanceof MetaApiError && err.kind === 'permanent') throw err
        if (!(err instanceof MetaApiError) && !isNetworkError(err)) throw err
        if (failures >= max) throw err
        await wait()
      }
      offset = await this.uploadedBytes(opts.url, opts.token).catch(() => offset)
    }
  }

  private async uploadedBytes(url: string, token: string): Promise<number> {
    const res = await this.f(url, { method: 'GET', headers: { Authorization: `OAuth ${token}` } })
    const json: any = await res.json().catch(() => null)
    return Number(json?.file_offset ?? 0)
  }
}

export { GRAPH_VERSION }
