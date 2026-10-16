import dns from 'dns'
import net from 'net'

/**
 * Some home networks hand out IPv6 addresses that never connect. Node then waits ten seconds on the dead address
 * and gives up with "fetch failed" (UND_ERR_CONNECT_TIMEOUT), which looked like Reconnect failing at random.
 * Try IPv4 first and move on from a dead address after a fraction of a second.
 */
export function preferIpv4(): void {
  dns.setDefaultResultOrder('ipv4first')
  net.setDefaultAutoSelectFamily?.(true)
  net.setDefaultAutoSelectFamilyAttemptTimeout?.(400)
  // The settings above are not always enough (Node's fetch can still try the dead IPv6 address and wait ten
  // seconds), so a name that has IPv4 addresses is only ever looked up as IPv4. A name with no IPv4 address,
  // or a network that is IPv6 only, still works as before.
  if (patched) return
  patched = true
  const original = dns.lookup
  const lookup = function (this: unknown, hostname: string, options?: unknown, callback?: unknown) {
    let opts = options as dns.LookupOptions | number | undefined
    let cb = callback as ((...a: unknown[]) => void) | undefined
    if (typeof opts === 'function') {
      cb = opts as unknown as (...a: unknown[]) => void
      opts = {}
    }
    const o: dns.LookupOptions = typeof opts === 'number' ? { family: opts } : { ...(opts ?? {}) }
    if (!cb || (o.family !== undefined && o.family !== 0)) {
      return (original as (...a: unknown[]) => unknown).call(dns, hostname, o, cb)
    }
    return (original as (...a: unknown[]) => unknown).call(
      dns,
      hostname,
      o,
      (err: unknown, address: unknown, family: unknown) => {
        if (err || !o.all) return cb!(err, address, family)
        cb!(null, onlyIpv4IfAny(address as dns.LookupAddress[]))
      },
    )
  }
  Object.assign(lookup, original) // keeps helpers such as __promisify__
  ;(dns as { lookup: unknown }).lookup = lookup
}

let patched = false

/** The IPv4 addresses when there are any, otherwise the list as it was. */
export function onlyIpv4IfAny(list: dns.LookupAddress[]): dns.LookupAddress[] {
  const v4 = list.filter((a) => a.family === 4)
  return v4.length ? v4 : list
}

const CODE_HINTS: Array<[RegExp, string]> = [
  [/CONNECT_TIMEOUT|ETIMEDOUT/, 'The connection timed out.'],
  [
    /ENOTFOUND|EAI_AGAIN/,
    'The address could not be looked up. Check the internet connection and DNS.',
  ],
  [/ECONNRESET|UND_ERR_SOCKET|EPIPE/, 'The connection was cut off.'],
  [/ECONNREFUSED/, 'The connection was refused.'],
  [/ENETUNREACH|EHOSTUNREACH/, 'The network cannot reach that server.'],
]

/** The error code hidden inside a "fetch failed" error, for example UND_ERR_CONNECT_TIMEOUT. */
export function networkCode(err: unknown): string | null {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code ?? e?.cause?.code ?? null
}

/** A plain description of a network failure that keeps the real reason, not just "fetch failed". */
export function describeNetworkError(err: unknown): string {
  const message = (err as Error)?.message || 'network error'
  const code = networkCode(err)
  const hint = code ? (CODE_HINTS.find(([re]) => re.test(code))?.[1] ?? '') : ''
  return `${message}${code ? ` (${code})` : ''}${hint ? ` ${hint}` : ''}`
}

/** Runs a call that is safe to repeat, again after a network failure, with a short pause between tries. */
export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  isNetwork: (e: unknown) => boolean,
  tries = 3,
  pauseMs = 600,
): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (!isNetwork(e) || i === tries - 1) throw e
      await new Promise((r) => setTimeout(r, pauseMs * (i + 1)))
    }
  }
  throw last
}
