import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeEnv } from './helpers'
import { VentureStore } from '../src/main/ventures/store'
import { VentureRegistry } from '../src/main/ventures/registry'
import { seedMockData } from '../src/main/ventures/mock'
import { CacheProvider } from '../src/main/ventures/etsy/provider'
import { VenturesService } from '../src/main/ventures/service'
import { handlePhoneRequest, type PhoneProvider } from '../src/main/agent/phone'

const NOW = Date.UTC(2026, 5, 10, 16, 0, 0)
const TOKEN = 'secret-token-123'

function setup() {
  const store = new VentureStore(makeEnv().db)
  const registry = new VentureRegistry()
  registry.register(
    new CacheProvider({ id: 'etsy', label: 'Etsy', store, now: () => NOW, status: () => ({ mode: 'mock', shopName: null, lastSyncAt: null, expiresAt: null }) }),
  )
  seedMockData(store, 'etsy', NOW)
  const dir = mkdtempSync(join(tmpdir(), 'elo-ventures-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'ventures.html'), '<html>ventures page</html>')
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(dir, 'secret.txt'), 'nope')
  const ventures = new VenturesService({ registry, store, now: () => NOW, syncers: {} })
  const p = {
    token: () => TOKEN,
    look: () => 'midnight',
    snapshot: async () => ({}),
    refresh: async () => ({}),
    week: async () => ({}),
    tiles: async () => ({}),
    ventures: { service: ventures, dir },
  } as unknown as PhoneProvider
  const get = (path: string, method = 'GET', token = TOKEN) =>
    handlePhoneRequest(p, { method, url: `/m/${token}/${path}`, headers: { host: '127.0.0.1:9' }, port: 9 }, () => false)
  return { get }
}

describe('phone ELS Ventures routes', () => {
  it('serves the page and a built asset', async () => {
    const { get } = setup()
    const page = await get('ventures/')
    expect(page?.status).toBe(200)
    expect(String(page?.body)).toContain('ventures page')
    const js = await get('ventures/assets/app.js')
    expect(js?.status).toBe(200)
    expect(js?.type).toContain('javascript')
  })
  it('answers every allowed read with real shapes', async () => {
    const { get } = setup()
    const stores = JSON.parse(String((await get('ventures/storefronts.json'))!.body))
    expect(stores[0].id).toBe('etsy')
    const dash = JSON.parse(String((await get('ventures/dashboard.json?storefront=etsy&preset=30d'))!.body))
    expect(dash.orders).toBeGreaterThan(0)
    const listings = JSON.parse(String((await get('ventures/listings.json?storefront=etsy&sort=price&dir=desc'))!.body))
    expect(listings.length).toBeGreaterThan(0)
    const one = JSON.parse(String((await get(`ventures/listing.json?storefront=etsy&id=${listings[0].id}`))!.body))
    expect(one.id).toBe(listings[0].id)
    for (const f of ['orders', 'reviews', 'notifications'])
      expect((await get(`ventures/${f}.json?storefront=etsy&preset=30d`))!.status).toBe(200)
    expect((await get('ventures/status.json?storefront=etsy'))!.status).toBe(200)
  })
  it('refuses writes, other paths and traversal', async () => {
    const { get } = setup()
    expect((await get('ventures/dashboard.json?storefront=etsy&preset=7d', 'POST'))!.status).toBe(405)
    for (const bad of ['ventures/connect', 'ventures/../settings', 'ventures/%2e%2e/x', 'ventures/assets/..%2fsecret.txt', 'ventures/assets/../secret.txt', 'ventures/markRead.json', 'ventures/syncNow.json'])
      expect((await get(bad))!.status).toBe(404)
  })
  it('gives a wrong token the same refusal as a missing page', async () => {
    const { get } = setup()
    const wrong = await get('ventures/storefronts.json', 'GET', 'WRONG')
    const missing = await get('nothing-here')
    expect(wrong?.status).toBe(404)
    expect(wrong?.body).toBe(missing?.body)
  })
  it('rejects bad input without crashing', async () => {
    const { get } = setup()
    expect((await get('ventures/dashboard.json?storefront=nope&preset=7d'))!.status).toBe(400)
    expect((await get('ventures/dashboard.json?storefront=etsy&preset=custom&from=2026-06-02&to=2026-06-01'))!.status).toBe(400)
    expect((await get('ventures/dashboard.json?storefront=etsy&preset=evil'))!.status).toBe(400)
  })
  it('never returns an email or address field', async () => {
    const { get } = setup()
    for (const f of ['orders', 'reviews', 'notifications', 'listings', 'dashboard']) {
      const body = String((await get(`ventures/${f}.json?storefront=etsy&preset=30d`))!.body)
      expect(body).not.toMatch(/"(email|address|name_|zip|street)/i)
      expect(body).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i)
    }
  })
})
