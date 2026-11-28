import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import { VentureStore } from '../src/main/ventures/store'
import { VentureRegistry } from '../src/main/ventures/registry'
import { seedMockData } from '../src/main/ventures/mock'
import { CacheProvider } from '../src/main/ventures/etsy/provider'
import { VenturesService } from '../src/main/ventures/service'

const NOW = Date.UTC(2026, 5, 10, 16, 0, 0)

function setup(etsy?: ConstructorParameters<typeof VenturesService>[0]['etsy'], afterConnect?: () => Promise<unknown>) {
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
    afterConnect,
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

describe('VenturesService mailbox', () => {
  const mk = () => {
    const saved: Array<Record<string, string>> = []
    const { svc } = setup()
    const svc2 = new VenturesService({
      registry: (svc as any).d.registry,
      store: (svc as any).d.store,
      now: () => NOW,
      syncers: {},
      mail: {
        save: (c) => void saved.push(c),
        status: () => ({ configured: saved.length > 0, host: saved[0]?.host ?? '', user: saved[0]?.user ?? '', folder: saved[0]?.folder ?? '' }),
        test: async () => ({ ok: true, found: 2 }),
      },
    })
    return { svc2, saved }
  }
  it('needs host, user and password, trims them and defaults the folder', () => {
    const { svc2, saved } = mk()
    expect(() => svc2.saveMailbox({ host: '', user: 'a', password: 'b', folder: '' })).toThrow(/host, user and password/i)
    svc2.saveMailbox({ host: ' imap.x.com ', user: ' me ', password: ' pw ', folder: '' })
    expect(saved[0]).toEqual({ host: 'imap.x.com', user: 'me', password: 'pw', folder: 'INBOX' })
  })
  it('never returns the password', () => {
    const { svc2 } = mk()
    svc2.saveMailbox({ host: 'h', user: 'u', password: 'SECRETPW', folder: 'Etsy' })
    expect(JSON.stringify(svc2.mailboxStatus())).not.toContain('SECRETPW')
  })
})

describe('VenturesService connect keeps what is real', () => {
  const fakeEtsy = { connect: async () => ({ shopId: '1', shopName: 'MyShop' }), disconnect: () => {}, saveKeys: () => {}, hasKeys: () => true }
  it('keeps pending drafts, mailbox settings, default category and real messages, and then pushes the drafts', async () => {
    let pushed = 0
    const { svc, store } = setup(fakeEtsy, async () => void pushed++)
    const rowId = store.addPending('etsy', 'create', 'pending-1', { title: 'Waiting draft' })
    store.setPendingTarget(rowId, 'pending-1')
    store.upsertListing('etsy', { id: 'pending-1', title: 'Waiting draft', thumbUrl: null, priceCents: 600, currency: 'USD', views: 0, favorites: 0, quantity: 1, state: 'draft', url: '', description: 'd', tags: [], images: [], priceHistory: [], sales: 0 })
    store.setState('etsy', 'mail_host', 'imap.example.com')
    store.setState('etsy', 'mail_user', 'me')
    store.setState('etsy', 'default_taxonomy_id', '1234')
    store.addNotification({ storefront: 'etsy', kind: 'message', title: 'New message from Sam', detail: '', at: '2026-06-01T00:00:00.000Z', url: null }, 'message:abc')
    await svc.connectEtsy()
    expect(store.listPending('etsy')).toHaveLength(1)
    expect(store.getListing('etsy', 'pending-1')?.title).toBe('Waiting draft')
    expect(store.getState('etsy', 'mail_host')).toBe('imap.example.com')
    expect(store.getState('etsy', 'mail_user')).toBe('me')
    expect(store.getState('etsy', 'default_taxonomy_id')).toBe('1234')
    expect(store.notifications('etsy').map((n) => n.title)).toEqual(['New message from Sam'])
    expect(store.listingRows('etsy').map((l) => l.id)).toEqual(['pending-1'])
    expect(pushed).toBe(1)
  })
  it('does not wipe real data on a reconnect', async () => {
    const { svc, store } = setup(fakeEtsy)
    await svc.connectEtsy()
    store.upsertListing('etsy', { id: '555', title: 'Real listing', thumbUrl: null, priceCents: 900, currency: 'USD', views: 0, favorites: 0, quantity: 1, state: 'active', url: 'https://www.etsy.com/listing/555', description: '', tags: [], images: [], priceHistory: [], sales: 0 })
    store.addNotification({ storefront: 'etsy', kind: 'order', title: 'Real order', detail: '', at: '2026-06-01T00:00:00.000Z', url: null }, 'order:1')
    store.setState('etsy', 'since:receipts', '123')
    await svc.connectEtsy()
    expect(store.getListing('etsy', '555')?.title).toBe('Real listing')
    expect(store.unreadCount('etsy')).toBe(1)
    expect(store.getState('etsy', 'since:receipts')).toBe('123')
  })
})

describe('VenturesService draft defaults and waiting drafts', () => {
  it('saves and clears the default category and shipping profile, and refuses nonsense', () => {
    const { svc } = setup()
    expect(svc.draftDefaults()).toEqual({ taxonomyId: null, shippingProfileId: null })
    svc.saveDraftDefaults({ taxonomyId: 1234, shippingProfileId: 55 })
    expect(svc.draftDefaults()).toEqual({ taxonomyId: 1234, shippingProfileId: 55 })
    svc.saveDraftDefaults({ taxonomyId: null, shippingProfileId: null })
    expect(svc.draftDefaults()).toEqual({ taxonomyId: null, shippingProfileId: null })
    for (const bad of [0, -3, 1.5, Number.NaN]) expect(() => svc.saveDraftDefaults({ taxonomyId: bad, shippingProfileId: null })).toThrow(/whole number/i)
  })
  it('lists waiting drafts with the reason one is stuck', () => {
    const { svc, store } = setup()
    const a = store.addPending('etsy', 'create', 'pending-1', { title: 'Planner' })
    store.setPendingTarget(a, 'pending-1')
    store.failPending(a, 'This draft needs a category. Set a default category or send taxonomyId.')
    store.addPending('etsy', 'update', '777', { title: 'New title' })
    const list = svc.pendingDrafts()
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual({ id: 'pending-1', kind: 'create', title: 'Planner', error: 'This draft needs a category. Set a default category or send taxonomyId.' })
    expect(list[1]).toMatchObject({ id: '777', kind: 'update', title: 'New title', error: null })
  })
})
