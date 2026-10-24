import { AdapterError } from '../adapters/types'
import { isNetworkError } from '../google/errors'

/** Turns an answer from a platform into a plain AdapterError: retry later (transient) or stop and tell the owner (permanent). */
export function failure(name: string, status: number, body: string): AdapterError {
  const text = body.replace(/\s+/g, ' ').slice(0, 300)
  if (status === 401)
    return new AdapterError(
      `${name} refused the saved login (401). Reconnect ${name} on the Connections screen. ${text}`.trim(),
      'permanent',
    )
  if (status === 403)
    return new AdapterError(
      `${name} refused the request (403). The app may not have the permission or the plan for this. ${text}`.trim(),
      'permanent',
    )
  if (status === 429 || status >= 500)
    return new AdapterError(`${name} had a problem (${status}). ${text}`.trim(), 'transient')
  return new AdapterError(`${name} rejected the request (${status}). ${text}`.trim(), 'permanent')
}

/** fetch with a timeout, where a dropped connection becomes a retryable error. */
export async function call(
  name: string,
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 60_000) })
  } catch (e) {
    if (
      isNetworkError(e) ||
      (e as Error).name === 'TimeoutError' ||
      (e as Error).name === 'AbortError'
    )
      throw new AdapterError(`Could not reach ${name}: ${(e as Error).message}`, 'transient')
    throw e
  }
}

/** Reads a JSON answer, or throws the right AdapterError for a failed one. */
export async function json<T>(name: string, res: Response): Promise<T> {
  const text = await res.text()
  if (!res.ok) throw failure(name, res.status, text)
  try {
    return (text ? JSON.parse(text) : {}) as T
  } catch {
    throw new AdapterError(`${name} sent an answer ELO could not read.`, 'transient')
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
