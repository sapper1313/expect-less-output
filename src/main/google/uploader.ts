import { open } from 'fs/promises'
import { AdapterError } from '../adapters/types'
import { classifyGoogleError, isNetworkError } from './errors'

export const CHUNK_SIZE = 8 * 1024 * 1024 // must be a multiple of 256 KiB

export interface UploadedVideo {
  id: string
  privacyStatus?: string
  publishAt?: string
}

export interface UploadParams {
  initUrl: string
  /** Pass true to force a fresh token after a 401. */
  accessToken: (forceRefresh?: boolean) => Promise<string>
  metadata: unknown
  filePath: string
  fileSize: number
  mime?: string
  /** A saved session lets an interrupted upload continue where it stopped. */
  sessionUrl?: string | null
  onSession?: (url: string | null) => void
  onProgress?: (sent: number, total: number) => void
  chunkSize?: number
  maxFailures?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

class SessionGone extends Error {}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** YouTube resumable upload: start a session, send chunks, and resume from the server's offset after any hiccup. */
export async function resumableUpload(p: UploadParams): Promise<UploadedVideo> {
  try {
    return await run(p, p.sessionUrl ?? null)
  } catch (err) {
    if (err instanceof SessionGone) {
      p.onSession?.(null)
      return await run(p, null) // one fresh start when the saved session expired
    }
    throw err
  }
}

async function run(p: UploadParams, savedSession: string | null): Promise<UploadedVideo> {
  const doFetch = p.fetchImpl ?? fetch
  const sleep = p.sleep ?? defaultSleep
  const chunkSize = p.chunkSize ?? CHUNK_SIZE
  const maxFailures = p.maxFailures ?? 8
  const mime = p.mime ?? 'video/*'
  let failures = 0
  let forceToken = false

  const backoff = async () => {
    failures++
    if (failures > maxFailures)
      throw new AdapterError(
        'The upload kept failing. Check the internet connection and retry.',
        'transient',
      )
    await sleep(Math.min(30_000, 2 ** failures * 500) + Math.random() * 250)
  }
  const auth = async () => ({ Authorization: `Bearer ${await p.accessToken(forceToken)}` })

  // 1. Start (or reuse) the upload session.
  let session = savedSession
  while (!session) {
    try {
      const res = await doFetch(p.initUrl, {
        method: 'POST',
        headers: {
          ...(await auth()),
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(p.fileSize),
          'X-Upload-Content-Type': mime,
        },
        body: JSON.stringify(p.metadata),
      })
      forceToken = false
      if (res.status === 401) {
        forceToken = true
        await backoff()
        continue
      }
      if (!res.ok) throw await apiError(res)
      session = res.headers.get('location')
      if (!session) throw new AdapterError('Google did not return an upload address.', 'transient')
      p.onSession?.(session)
    } catch (err) {
      if (isNetworkError(err)) {
        await backoff()
        continue
      }
      if (
        err instanceof AdapterError &&
        err.kind === 'transient' &&
        !/did not return/.test(err.message)
      ) {
        await backoff()
        continue
      }
      throw err
    }
  }

  // 2. Send the file in chunks. `offset` is what the server has confirmed.
  const fh = await open(p.filePath, 'r')
  try {
    let offset = savedSession ? await queryOffset() : 0
    p.onProgress?.(offset, p.fileSize)
    while (true) {
      const end = Math.min(offset + chunkSize, p.fileSize)
      const buf = Buffer.alloc(end - offset)
      if (buf.length > 0) await fh.read(buf, 0, buf.length, offset)
      let res: Response
      try {
        res = await doFetch(session, {
          method: 'PUT',
          headers: {
            ...(await auth()),
            'Content-Length': String(buf.length),
            'Content-Range':
              buf.length === 0
                ? `bytes */${p.fileSize}`
                : `bytes ${offset}-${end - 1}/${p.fileSize}`,
          },
          body: buf.length ? buf : undefined,
        })
        forceToken = false
      } catch (err) {
        if (!isNetworkError(err)) throw err
        await backoff()
        offset = await queryOffset()
        continue
      }
      if (res.status === 200 || res.status === 201) {
        p.onProgress?.(p.fileSize, p.fileSize)
        const body = (await res.json()) as {
          id: string
          status?: { privacyStatus?: string; publishAt?: string }
        }
        p.onSession?.(null)
        return {
          id: body.id,
          privacyStatus: body.status?.privacyStatus,
          publishAt: body.status?.publishAt,
        }
      }
      if (res.status === 308) {
        failures = 0
        offset = parseRange(res.headers.get('range'))
        p.onProgress?.(offset, p.fileSize)
        continue
      }
      if (res.status === 401) {
        forceToken = true
        await backoff()
        continue
      }
      if (res.status === 404 || res.status === 410) throw new SessionGone()
      if (res.status >= 500 || res.status === 429) {
        await backoff()
        offset = await queryOffset()
        continue
      }
      throw await apiError(res)
    }
  } finally {
    await fh.close()
  }

  async function queryOffset(): Promise<number> {
    while (true) {
      try {
        const res = await doFetch(session as string, {
          method: 'PUT',
          headers: {
            ...(await auth()),
            'Content-Length': '0',
            'Content-Range': `bytes */${p.fileSize}`,
          },
        })
        if (res.status === 308) return parseRange(res.headers.get('range'))
        if (res.status === 200 || res.status === 201) return p.fileSize
        if (res.status === 404 || res.status === 410) throw new SessionGone()
        if (res.status === 401) forceToken = true
        if (res.status < 500 && res.status !== 401 && res.status !== 429) throw await apiError(res)
        await backoff()
      } catch (err) {
        if (!isNetworkError(err)) throw err
        await backoff()
      }
    }
  }
}

function parseRange(header: string | null): number {
  if (!header) return 0
  const m = /bytes=0-(\d+)/.exec(header)
  return m ? Number(m[1]) + 1 : 0
}

async function apiError(res: Response): Promise<AdapterError> {
  let reason = ''
  let message = ''
  try {
    const j = (await res.json()) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> }
    }
    reason = j.error?.errors?.[0]?.reason ?? ''
    message = j.error?.message ?? ''
  } catch {
    // body was not JSON
  }
  return classifyGoogleError(res.status, reason, message)
}
