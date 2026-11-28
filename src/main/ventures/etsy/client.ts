export class EtsyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly permanent: boolean,
  ) {
    super(message)
    this.name = 'EtsyError'
  }
}

export interface EtsyClientOpts {
  /** Etsy wants "keystring:shared_secret" in the x-api-key header. Never logged. */
  apiKey: string | (() => string)
  token: () => Promise<string>
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  baseUrl?: string
}

const BACKOFF_MS = [2_000, 10_000, 30_000]
const MIN_GAP_MS = 200 // at most 5 calls a second

/** Talks to Etsy Open API v3. Spaces calls out, retries 429 and 5xx, and never puts a secret in an error. */
export class EtsyClient {
  private last = 0
  constructor(private o: EtsyClientOpts) {}

  private sleep = (ms: number) => (this.o.sleep ?? ((m) => new Promise<void>((r) => setTimeout(r, m))))(ms)

  async get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()
    const url = `${this.o.baseUrl ?? 'https://api.etsy.com'}${path}${qs ? '?' + qs : ''}`
    for (let attempt = 0; ; attempt++) {
      const gap = this.last + MIN_GAP_MS - Date.now()
      if (gap > 0) await this.sleep(gap)
      this.last = Date.now()
      const res = await (this.o.fetch ?? fetch)(url, {
        headers: { 'x-api-key': typeof this.o.apiKey === 'function' ? this.o.apiKey() : this.o.apiKey, Authorization: `Bearer ${await this.o.token()}`, Accept: 'application/json' },
      })
      if (res.ok) return (await res.json()) as T
      const transient = res.status === 429 || res.status >= 500
      if (!transient || attempt >= 3) {
        throw new EtsyError(`Etsy answered ${res.status} for ${path}.`, res.status, !transient)
      }
      const retryAfter = Number(res.headers.get('retry-after'))
      await this.sleep(retryAfter > 0 ? retryAfter * 1000 : BACKOFF_MS[attempt])
    }
  }
}
