import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import { VentureStore } from '../src/main/ventures/store'
import { EtsyClient, EtsyError } from '../src/main/ventures/etsy/client'
import { EtsySyncer } from '../src/main/ventures/etsy/sync'

const KEY = 'KEYSTRING123:SHAREDSECRET456'
const TOKEN = 'TOKEN-ABC-789'
const resp = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

describe('EtsyClient unauthorized', () => {
  it('refreshes once on a 401 and retries', async () => {
    let n = 0
    let refreshed = 0
    const c = new EtsyClient({ apiKey: KEY, token: async () => TOKEN, sleep: async () => {}, onUnauthorized: async () => void refreshed++, fetch: (async () => (n++, n === 1 ? resp(401, {}) : resp(200, { ok: 1 }))) as any })
    expect(await c.get('/v3/x')).toEqual({ ok: 1 })
    expect(refreshed).toBe(1)
  })
  it('gives up if the second try is also a 401', async () => {
    let n = 0
    const c = new EtsyClient({ apiKey: KEY, token: async () => TOKEN, sleep: async () => {}, onUnauthorized: async () => {}, fetch: (async () => (n++, resp(401, {}))) as any })
    const e = (await c.get('/v3/x').catch((x) => x)) as EtsyError
    expect(e.permanent).toBe(true)
    expect(n).toBe(2)
  })
})

describe('EtsyClient writes', () => {
  it('never retries a POST after a 500, so a draft cannot be made twice', async () => {
    let n = 0
    const c = new EtsyClient({ apiKey: KEY, token: async () => TOKEN, sleep: async () => {}, fetch: (async () => (n++, resp(500, {}))) as any })
    await expect(c.send('POST', '/v3/x', new URLSearchParams({ a: '1' }))).rejects.toBeInstanceOf(EtsyError)
    expect(n).toBe(1)
  })
  it('does retry a POST after a 429', async () => {
    let n = 0
    const c = new EtsyClient({ apiKey: KEY, token: async () => TOKEN, sleep: async () => {}, fetch: (async () => (n++, n === 1 ? resp(429, {}, { 'retry-after': '1' }) : resp(200, { ok: 1 }))) as any })
    await c.send('POST', '/v3/x', new URLSearchParams())
    expect(n).toBe(2)
  })
})

describe('EtsyClient', () => {
  it('retries a 429 using Retry-After and then succeeds', async () => {
    const calls: string[] = []
    const waits: number[] = []
    const c = new EtsyClient({
      apiKey: KEY,
      token: async () => TOKEN,
      sleep: async (ms) => void waits.push(ms),
      fetch: (async (_url: string, init: any) => {
        calls.push(init.headers['x-api-key'])
        return calls.length === 1 ? resp(429, {}, { 'retry-after': '1' }) : resp(200, { ok: true })
      }) as any,
    })
    expect(await c.get<{ ok: boolean }>('/v3/x')).toEqual({ ok: true })
    expect(calls).toHaveLength(2)
    expect(waits).toContain(1000)
    expect(calls[0]).toBe(KEY)
  })
  it('gives up after four attempts on 500s and leaks no secret', async () => {
    let n = 0
    const c = new EtsyClient({
      apiKey: KEY,
      token: async () => TOKEN,
      sleep: async () => {},
      fetch: (async () => (n++, resp(500, { error: `bad ${KEY} ${TOKEN}` }))) as any,
    })
    const err = (await c.get('/v3/x').catch((e) => e)) as Error
    expect(err).toBeInstanceOf(EtsyError)
    expect(n).toBe(4)
    expect(String(err.message)).not.toContain('KEYSTRING')
    expect(String(err.message)).not.toContain('TOKEN-ABC')
  })
  it('treats 401 as permanent and does not retry', async () => {
    let n = 0
    const c = new EtsyClient({ apiKey: KEY, token: async () => TOKEN, sleep: async () => {}, fetch: (async () => (n++, resp(401, {}))) as any })
    const err = (await c.get('/v3/x').catch((e) => e)) as EtsyError
    expect(err.permanent).toBe(true)
    expect(n).toBe(1)
  })
})

const price = (cents: number) => ({ amount: cents, divisor: 100, currency_code: 'USD' })
const listingPage = (ids: number[], state = 'active') => ({
  count: ids.length,
  results: ids.map((id) => ({
    listing_id: id, title: `Item ${id}`, description: 'd', state, quantity: 3, url: `https://www.etsy.com/listing/${id}`,
    num_favorers: 2, price: price(1500), tags: ['a'], images: [{ url_170x135: 't.jpg', url_fullxfull: 'f.jpg' }],
  })),
})

function harness(route: (path: string, q: Record<string, any>) => unknown) {
  const store = new VentureStore(makeEnv().db)
  const seen: string[] = []
  const client = {
    get: async (path: string, q: Record<string, any> = {}) => {
      seen.push(path + '?' + new URLSearchParams(q as any).toString())
      return route(path, q)
    },
  } as unknown as EtsyClient
  const notes: Array<{ kind: string; key: string }> = []
  const syncer = new EtsySyncer({
    client, store, shopId: () => '99', now: () => Date.UTC(2026, 5, 10),
    notify: (n, key) => void notes.push({ kind: n.kind, key }),
  })
  return { store, syncer, notes, seen }
}

const empty = { count: 0, results: [] }

describe('EtsySyncer ledger', () => {
  it('always sends both min_created and max_created, backfilling a year on the first run', async () => {
    const queries: Array<Record<string, any>> = []
    const h = harness((path, q) => (path.endsWith('/ledger-entries') && queries.push(q), empty))
    await h.syncer.run()
    const NOW_SEC = Math.floor(Date.UTC(2026, 5, 10) / 1000)
    expect(queries[0].max_created).toBe(NOW_SEC)
    expect(queries[0].min_created).toBe(NOW_SEC - 365 * 86_400)
    await h.syncer.run()
    expect(queries[1].min_created).toBe(NOW_SEC - 86_400)
    expect(queries[1].max_created).toBe(NOW_SEC)
  })
  it('still loads orders and reviews when the fee lookup fails', async () => {
    const h = harness((path) => {
      if (path.endsWith('/ledger-entries')) throw new Error('400')
      if (path.endsWith('/receipts'))
        return { count: 1, results: [{ receipt_id: 3, buyer_user_id: 9, create_timestamp: 1780000000, transactions: [{ listing_id: 1, title: 'Mug', quantity: 1, price: price(900) }] }] }
      return empty
    })
    const r = await h.syncer.run()
    expect(r.orders).toBe(1)
  })
  it('syncs sold out listings too', async () => {
    const states: string[] = []
    const h = harness((path, q) => (path.endsWith('/listings') && states.push(String(q.state)), empty))
    await h.syncer.run()
    expect(states).toContain('sold_out')
  })
})


describe('EtsySyncer', () => {
  it('pages through listings and stores them', async () => {
    const h = harness((path, q) => {
      if (path.endsWith('/listings') && q.state === 'active')
        return Number(q.offset) === 0 ? listingPage(Array.from({ length: 100 }, (_, i) => i + 1)) : listingPage([101, 102])
      return empty
    })
    const r = await h.syncer.run()
    expect(r.listings).toBe(102)
    expect(h.store.listingRows('etsy')).toHaveLength(102)
  })
  it('keeps page one and resumes from the cursor after a failure on page two', async () => {
    let fail = true
    const h = harness((path, q) => {
      if (path.endsWith('/listings') && q.state === 'active') {
        if (Number(q.offset) === 0) return listingPage(Array.from({ length: 100 }, (_, i) => i + 1))
        if (fail) throw new Error('boom')
        return listingPage([101])
      }
      return empty
    })
    await expect(h.syncer.run()).rejects.toThrow('boom')
    expect(h.store.listingRows('etsy')).toHaveLength(100)
    fail = false
    h.seen.length = 0
    await h.syncer.run()
    expect(h.store.listingRows('etsy')).toHaveLength(101)
    expect(h.seen.filter((s) => s.includes('state=active') && s.includes('offset=0'))).toHaveLength(0)
  })
  it('stores orders by buyer id only and fees from the ledger, without a flood on the first sync', async () => {
    const h = harness((path) => {
      if (path.endsWith('/receipts'))
        return { count: 1, results: [{ receipt_id: 7, buyer_user_id: 4455, name: 'Real Name', buyer_email: 'x@y.com', create_timestamp: 1780000000, transactions: [{ listing_id: 1, title: 'Mug', quantity: 2, price: price(1500) }] }] }
      if (path.endsWith('/ledger-entries'))
        return { count: 2, results: [
          { entry_id: 1, amount: -250, description: 'Transaction fee: Mug', reference_type: 'receipt', reference_id: '7', create_date: 1780000100, currency: 'USD' },
          { entry_id: 2, amount: -20, description: 'Listing fee', reference_type: 'listing', reference_id: '1', create_date: 1780000200, currency: 'USD' },
        ] }
      return empty
    })
    await h.syncer.run()
    const all = h.store.ordersBetween('etsy', '2020-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z')
    expect(all).toHaveLength(1)
    expect(all[0].buyerUsername).toBe('buyer_4455')
    expect(all[0].feesCents).toBe(250)
    expect(JSON.stringify(all)).not.toContain('Real Name')
    expect(JSON.stringify(all)).not.toContain('x@y.com')
    expect(h.notes).toHaveLength(0)
  })
  it('notifies once for new orders and reviews after the first sync, and flags 1 star as low', async () => {
    let round = 0
    const h = harness((path) => {
      if (path.endsWith('/receipts') && round === 1)
        return { count: 1, results: [{ receipt_id: 8, buyer_user_id: 1, create_timestamp: 1780000000, transactions: [{ listing_id: 1, title: 'Mug', quantity: 1, price: price(900) }] }] }
      if (path.endsWith('/reviews') && round === 1)
        return { count: 1, results: [{ listing_id: 1, rating: 1, review: 'bad', create_timestamp: 1780000000 }] }
      return empty
    })
    await h.syncer.run()
    round = 1
    await h.syncer.run()
    await h.syncer.run()
    expect(h.notes.map((n) => n.kind).sort()).toEqual(['low_review', 'order'])
  })
})
