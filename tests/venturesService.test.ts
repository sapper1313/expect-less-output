import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import { VentureStore } from '../src/main/ventures/store'
import { VentureRegistry } from '../src/main/ventures/registry'
import { seedMockData } from '../src/main/ventures/mock'
import { CacheProvider } from '../src/main/ventures/etsy/provider'
import { VenturesService } from '../src/main/ventures/service'

const NOW = Date.UTC(2026, 5, 10, 16, 0, 0)

function setup(etsy?: ConstructorParameters<typeof VenturesService>[0]['etsy']) {
  const store = new VentureStore(makeEnv().db)
  const registry = new VentureRegistry()
  const mk = (id: string, label: string) =>
    new CacheProvider({ id, label, store, now: () => NOW, status: () => ({ mode: 'mock', shopName: null, lastSyncAt: null, expiresAt: null }) })
  registry.register(mk('etsy', 'Etsy'))
  registry.register(mk('kdp', 'Amazon KDP'))
  seedMockData(store, 'etsy', NOW)
  seedMockData(store, 'kdp', NOW)
  const synced: string[] = []
  const svc = new VenturesService({
    registry,
    store,
    now: () => NOW,
    syncers: { etsy: { run: async () => void synced.push('etsy') } },
    etsy,
  })
  return { svc, synced, store }
}

describe('VenturesService', () => {
  it('lists more than one storefront with unread counts', () => {
    const { svc } = setup()
    const list = svc.storefronts()
    expect(list.map((s) => s.id)).toEqual(['etsy', 'kdp'])
    expect(list[0].unread).toBe(5)
  })
  it('serves every page for every storefront', () => {
    const { svc } = setup()
    for (const id of ['etsy', 'kdp']) {
      expect(svc.dashboard(id, '30d').orders).toBeGreaterThan(0)
      expect(svc.listings(id, {}).length).toBeGreaterThan(0)
      expect(svc.orders(id, '30d').length).toBeGreaterThan(0)
      expect(svc.reviews(id, 5).length).toBeGreaterThan(0)
      expect(svc.notifications(id).length).toBeGreaterThan(0)
      const first = svc.listings(id, {})[0]
      expect(svc.listing(id, first.id)?.id).toBe(first.id)
    }
  })
  it('refuses an unknown storefront', () => {
    const { svc } = setup()
    expect(() => svc.dashboard('nope', '7d')).toThrow('Unknown storefront.')
  })
  it('lowers the unread total when notifications are marked read', () => {
    const { svc } = setup()
    expect(svc.unreadTotal()).toBe(10)
    svc.markRead('etsy', svc.notifications('etsy').map((n) => n.id))
    expect(svc.unreadTotal()).toBe(5)
  })
  it('runs the syncer once for a storefront and skips ones without a syncer', async () => {
    const { svc, synced } = setup()
    await svc.syncNow('etsy')
    await svc.syncNow('kdp')
    expect(synced).toEqual(['etsy'])
  })
})

describe('VenturesService Etsy connection', () => {
  it('clears the sample data and syncs once when Etsy connects', async () => {
    const calls: string[] = []
    const { svc, synced, store } = setup({
      connect: async () => (calls.push('connect'), { shopId: '1', shopName: 'MyShop' }),
      disconnect: () => void calls.push('disconnect'),
      saveKeys: (k, s) => void calls.push(`keys:${k.length}:${s.length}`),
      hasKeys: () => true,
    })
    expect(store.listingRows('etsy').length).toBeGreaterThan(0)
    const r = await svc.connectEtsy()
    expect(r.shopName).toBe('MyShop')
    expect(store.listingRows('etsy')).toHaveLength(0)
    expect(store.unreadCount('etsy')).toBe(0)
    expect(store.getState('etsy', 'demo_cleared')).toBe('1')
    expect(store.listingRows('kdp').length).toBeGreaterThan(0)
    await new Promise((r) => setTimeout(r, 10))
    expect(synced).toEqual(['etsy'])
  })
  it('refuses to connect when nothing handles Etsy', async () => {
    const { svc } = setup()
    await expect(svc.connectEtsy()).rejects.toThrow('Etsy keys are not set up yet.')
  })
  it('trims and checks keys before saving them', () => {
    const saved: string[] = []
    const { svc } = setup({ connect: async () => ({ shopId: '1', shopName: 'x' }), disconnect: () => {}, saveKeys: (k, s) => void saved.push(k + '|' + s), hasKeys: () => false })
    expect(() => svc.saveEtsyKeys('  ', 'x')).toThrow(/both/i)
    svc.saveEtsyKeys('  KEY  ', ' SECRET ')
    expect(saved).toEqual(['KEY|SECRET'])
  })
})
