import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import { VentureStore } from '../src/main/ventures/store'
import { DraftService, PartialDraftError, type DraftClient } from '../src/main/ventures/drafts'
import { DraftListingBody, UpdateDraftBody } from '../src/shared/agentSchemas'
import { AgentError } from '../src/main/agent/core'
import type { ListingDetail } from '../src/shared/ventures'

const beth = { kind: 'bot', actor: 'beth', bot: { name: 'beth', role: 'orchestrator', channels: [] } } as any
const other = { kind: 'bot', actor: 'scout', bot: { name: 'scout', role: 'drop', channels: [] } } as any
const owner = { kind: 'owner', actor: 'josh' } as any

const input = { title: 'Weekly Planner', description: 'A planner', tags: ['planner', 'printable'], priceCents: 600, images: [], taxonomyId: 1234 }

function setup(live: boolean, opts: { etsyState?: () => string | null; checkFiles?: (f: any) => Promise<void>; createImpl?: DraftClient['createDraft'] } = {}) {
  const store = new VentureStore(makeEnv().db)
  const audits: any[] = []
  const calls: Array<{ kind: string; shopId: string; id?: string; fields: any }> = []
  const client: DraftClient = {
    createDraft: opts.createImpl ?? (async (shopId, fields, existing) => (calls.push({ kind: 'create', shopId, id: existing, fields }), { listingId: existing ?? '9001' })),
    listingState: async () => (opts.etsyState ? opts.etsyState() : 'draft'),
    updateDraft: async (shopId, id, fields) => void calls.push({ kind: 'update', shopId, id, fields }),
  }
  const svc = new DraftService({
    store,
    live: () => (live ? { client, shopId: '55' } : null),
    audit: { write: (e) => void audits.push(e) },
    defaultTaxonomy: () => null,
    defaultShippingProfile: () => null,
    checkFiles: opts.checkFiles,
  })
  return { store, svc, audits, calls }
}

const cached = (over: Partial<ListingDetail>): ListingDetail => ({
  id: '777', title: 'Live thing', thumbUrl: null, priceCents: 1000, currency: 'USD', views: 0, favorites: 0, quantity: 1,
  state: 'active', url: 'https://www.etsy.com/listing/777', description: '', tags: [], images: [], priceHistory: [], sales: 0, ...over,
})

describe('draft schemas', () => {
  it('accept a normal draft', () => expect(DraftListingBody.safeParse(input).success).toBe(true))
  it('refuse a state field of any kind', () => {
    expect(DraftListingBody.safeParse({ ...input, state: 'active' }).success).toBe(false)
    expect(UpdateDraftBody.safeParse({ state: 'active' }).success).toBe(false)
  })
  it('keep to Etsy limits', () => {
    expect(DraftListingBody.safeParse({ ...input, tags: Array.from({ length: 14 }, (_, i) => `t${i}`) }).success).toBe(false)
    expect(DraftListingBody.safeParse({ ...input, tags: ['x'.repeat(21)] }).success).toBe(false)
    expect(DraftListingBody.safeParse({ ...input, title: 'x'.repeat(141) }).success).toBe(false)
    expect(DraftListingBody.safeParse({ ...input, priceCents: 19 }).success).toBe(false)
    expect(DraftListingBody.safeParse({ ...input, images: Array.from({ length: 11 }, () => 'a.png') }).success).toBe(false)
  })
  it('need at least one field to update', () => expect(UpdateDraftBody.safeParse({}).success).toBe(false))
})

describe('DraftService', () => {
  it('lets beth create a draft and logs who, what and when', async () => {
    const { svc, audits, calls } = setup(true)
    const r = await svc.create(beth, input)
    expect(r).toEqual({ id: '9001', state: 'draft', pending: false })
    expect(calls[0].fields.state).toBeUndefined()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ actor: 'beth', action: 'ventures.draft.create', target: 'etsy listing 9001' })
    expect(audits[0].after.fields).toContain('title')
  })
  it('refuses another bot and logs the refusal', async () => {
    const { svc, audits } = setup(true)
    const e = (await svc.create(other, input).catch((x) => x)) as AgentError
    expect(e).toBeInstanceOf(AgentError)
    expect(e.status).toBe(403)
    expect(audits[0]).toMatchObject({ actor: 'scout', action: 'api.denied' })
  })
  it('refuses to change a listing that is not a draft, and logs it', async () => {
    const { svc, store, audits } = setup(true)
    store.upsertListing('etsy', cached({ state: 'active' }))
    const e = (await svc.update(beth, '777', { title: 'New title' }).catch((x) => x)) as AgentError
    expect(e.code).toBe('drafts_only')
    expect(audits[0].action).toBe('api.denied')
  })
  it('changes a cached draft', async () => {
    const { svc, store, calls, audits } = setup(true)
    store.upsertListing('etsy', cached({ id: '778', state: 'draft' }))
    const r = await svc.update(owner, '778', { title: 'Better title' })
    expect(r).toEqual({ id: '778', state: 'draft', pending: false })
    expect(calls[0]).toMatchObject({ kind: 'update', id: '778' })
    expect(calls[0].fields.state).toBeUndefined()
    expect(audits[0]).toMatchObject({ actor: 'josh', action: 'ventures.draft.update' })
  })
  it('says 404 for a listing it has never seen', async () => {
    const { svc } = setup(true)
    expect(((await svc.update(beth, '12345', { title: 'x' }).catch((e) => e)) as AgentError).status).toBe(404)
  })
  it('holds a draft as pending when no shop is connected, and shows it on the Listings page', async () => {
    const { svc, store, calls } = setup(false)
    const r = await svc.create(beth, input)
    expect(r.pending).toBe(true)
    expect(r.id).toMatch(/^pending-/)
    expect(calls).toHaveLength(0)
    expect(store.getListing('etsy', r.id)?.state).toBe('draft')
  })
  it('pushes pending drafts after connect, always as drafts, and clears them', async () => {
    const { svc, store, calls } = setup(false)
    const r = await svc.create(beth, input)
    await svc.update(beth, r.id, { title: 'Renamed before push' })
    const live = setup(true)
    // Same store and pending rows, now with a connected shop.
    const svc2 = new DraftService({
      store,
      live: () => ({ client: { createDraft: async (s, f) => (live.calls.push({ kind: 'create', shopId: s, fields: f }), { listingId: '9100' }), updateDraft: async () => {}, listingState: async () => 'draft' }, shopId: '55' }),
      audit: { write: () => {} },
      defaultTaxonomy: () => null,
      defaultShippingProfile: () => null,
    })
    expect(await svc2.pushPending()).toEqual({ pushed: 1, failed: 0 })
    expect(live.calls[0].fields.title).toBe('Renamed before push')
    expect(live.calls[0].fields.state).toBeUndefined()
    expect(store.getListing('etsy', r.id)).toBeNull()
    expect(await svc2.pushPending()).toEqual({ pushed: 0, failed: 0 })
    expect(calls).toHaveLength(0)
  })
  it('keeps a pending draft and notes why when Etsy has no category for it', async () => {
    const { svc, store } = setup(false)
    await svc.create(beth, { ...input, taxonomyId: undefined })
    const svc2 = new DraftService({ store, live: () => ({ client: { createDraft: async () => ({ listingId: '1' }), updateDraft: async () => {}, listingState: async () => 'draft' }, shopId: '55' }), audit: { write: () => {} }, defaultTaxonomy: () => null, defaultShippingProfile: () => null })
    expect(await svc2.pushPending()).toEqual({ pushed: 0, failed: 1 })
  })
  it('never writes file contents or paths of secrets into the log', async () => {
    const { svc, audits } = setup(true)
    await svc.create(beth, { ...input, digitalFile: '/tmp/secret-file.pdf' })
    expect(JSON.stringify(audits)).not.toContain('secret-file')
  })
})

describe('etsyDraftClient', () => {
  it('sends form fields in dollars and never a state', async () => {
    const { etsyDraftClient } = await import('../src/main/ventures/etsy/draftClient')
    const sent: Array<{ method: string; path: string; body: any }> = []
    const fake = { send: async (method: string, path: string, body: any) => (sent.push({ method, path, body }), { listing_id: 4242 }) } as any
    const c = etsyDraftClient(fake)
    const r = await c.createDraft('55', { title: 'T', description: 'D', tags: ['a', 'b'], priceCents: 1850, quantity: 5, taxonomyId: 7, images: [] })
    expect(r.listingId).toBe('4242')
    expect(sent[0]).toMatchObject({ method: 'POST', path: '/v3/application/shops/55/listings' })
    const p = sent[0].body as URLSearchParams
    expect(p.get('price')).toBe('18.50')
    expect(p.get('tags')).toBe('a,b')
    expect(p.get('taxonomy_id')).toBe('7')
    expect(p.has('state')).toBe(false)
    await c.updateDraft('55', '4242', { title: 'New' })
    expect(sent[1]).toMatchObject({ method: 'PATCH', path: '/v3/application/shops/55/listings/4242' })
    expect((sent[1].body as URLSearchParams).has('state')).toBe(false)
  })
})


describe('draft safety after review', () => {
  it('asks Etsy for the live state before changing a draft, and refuses if it was activated meanwhile', async () => {
    const { svc, store, audits, calls } = setup(true, { etsyState: () => 'active' })
    store.upsertListing('etsy', cached({ id: '780', state: 'draft' })) // the cache is up to 20 minutes old
    const e = (await svc.update(beth, '780', { title: 'x' }).catch((x) => x)) as AgentError
    expect(e.code).toBe('drafts_only')
    expect(calls.filter((c) => c.kind === 'update')).toHaveLength(0)
    expect(audits.some((a) => a.action === 'api.denied')).toBe(true)
  })
  it('checks the live state again before sending a waiting update', async () => {
    const { svc, store, audits } = setup(false)
    store.upsertListing('etsy', cached({ id: '781', state: 'draft' }))
    await svc.update(beth, '781', { title: 'queued' })
    const updates: string[] = []
    const svc2 = new DraftService({
      store,
      live: () => ({ client: { createDraft: async () => ({ listingId: '1' }), updateDraft: async (_s, id) => void updates.push(id), listingState: async () => 'active' }, shopId: '55' }),
      audit: { write: (e) => void audits.push(e) },
      defaultTaxonomy: () => null,
      defaultShippingProfile: () => null,
    })
    expect(await svc2.pushPending()).toEqual({ pushed: 0, failed: 1 })
    expect(updates).toHaveLength(0)
    expect(store.listPending('etsy')).toHaveLength(0)
    expect(audits.some((a) => a.action === 'api.denied' && a.target.includes('781'))).toBe(true)
  })
  it('does not make a second Etsy listing when the pictures failed after the first one was made', async () => {
    let posts = 0
    const withExisting: Array<string | undefined> = []
    let failFirst = true
    const createImpl: DraftClient['createDraft'] = async (_s, _f, existing) => {
      withExisting.push(existing)
      if (!existing) posts++
      if (failFirst) throw new PartialDraftError('9005')
      return { listingId: existing ?? '9005' }
    }
    const { svc, store } = setup(true, { createImpl })
    const r = await svc.create(beth, input)
    expect(r.pending).toBe(true)
    expect(r.id).toMatch(/^pending-/)
    failFirst = false
    const svc2 = new DraftService({
      store,
      live: () => ({ client: { createDraft: createImpl, updateDraft: async () => {}, listingState: async () => 'draft' }, shopId: '55' }),
      audit: { write: () => {} },
      defaultTaxonomy: () => null,
      defaultShippingProfile: () => null,
    })
    expect(await svc2.pushPending()).toEqual({ pushed: 1, failed: 0 })
    expect(posts).toBe(1)
    expect(withExisting).toEqual([undefined, '9005'])
  })
  it('keeps the same Etsy listing id across repeated failed pushes', async () => {
    let n = 0
    const createImpl: DraftClient['createDraft'] = async (_s, _f, existing) => {
      n++
      throw new PartialDraftError(existing ?? '9006')
    }
    const { svc, store } = setup(true, { createImpl })
    await svc.create(beth, input)
    const svc2 = new DraftService({ store, live: () => ({ client: { createDraft: createImpl, updateDraft: async () => {}, listingState: async () => 'draft' }, shopId: '55' }), audit: { write: () => {} }, defaultTaxonomy: () => null, defaultShippingProfile: () => null })
    await svc2.pushPending()
    await svc2.pushPending()
    expect(store.listPending('etsy')[0].payload.etsyId).toBe('9006')
    expect(n).toBe(3)
  })
  it('refuses bad files before anything is sent, and says so in the log', async () => {
    const { svc, audits, calls } = setup(true, { checkFiles: async () => { throw new Error('A picture or file is not allowed.') } })
    const e = (await svc.create(beth, { ...input, images: ['/etc/passwd'] }).catch((x) => x)) as AgentError
    expect(e).toBeInstanceOf(AgentError)
    expect(e.code).toBe('validation')
    expect(calls).toHaveLength(0)
    expect(audits.some((a) => a.action === 'api.denied')).toBe(true)
    expect(JSON.stringify(audits)).not.toContain('/etc/passwd')
  })
  it('logs an unknown listing and an Etsy failure as refusals', async () => {
    const a = setup(true)
    await a.svc.update(beth, '99999', { title: 'x' }).catch(() => {})
    expect(a.audits.some((x) => x.action === 'api.denied')).toBe(true)
    const b = setup(true, { createImpl: async () => { throw new Error('socket hang up /Users/me/secret.png') } })
    const e = (await b.svc.create(beth, input).catch((x) => x)) as AgentError
    expect(e.code).toBe('server_error')
    expect(e.message).not.toContain('secret.png')
    expect(b.audits.some((x) => x.action === 'api.denied')).toBe(true)
    expect(JSON.stringify(b.audits)).not.toContain('secret.png')
  })
  it('does not accept images or a digital file on an update', () => {
    expect(UpdateDraftBody.safeParse({ images: ['a.png'] }).success).toBe(false)
    expect(UpdateDraftBody.safeParse({ digitalFile: '/x.pdf' }).success).toBe(false)
    expect(UpdateDraftBody.safeParse({ title: 'ok', shippingProfileId: 5 }).success).toBe(true)
  })
  it('caches a freshly made live draft so it can be changed straight away', async () => {
    const { svc, store } = setup(true)
    const r = await svc.create(beth, input)
    expect(store.getListing('etsy', r.id)?.state).toBe('draft')
    expect((await svc.update(beth, r.id, { title: 'Second thoughts' })).pending).toBe(false)
  })
})

describe('etsyDraftClient fields and files', () => {
  it('sends is_supply false and the shipping profile when there is one', async () => {
    const { etsyDraftClient } = await import('../src/main/ventures/etsy/draftClient')
    const sent: any[] = []
    const fake = { send: async (_m: string, _p: string, body: any) => (sent.push(body), { listing_id: 1 }) } as any
    const c = etsyDraftClient(fake, { roots: () => [], fetch: async () => new Response('') })
    await c.createDraft('55', { title: 'T', description: 'D', tags: [], priceCents: 600, quantity: 1, taxonomyId: 7, shippingProfileId: 321, images: [] })
    expect((sent[0] as URLSearchParams).get('is_supply')).toBe('false')
    expect((sent[0] as URLSearchParams).get('shipping_profile_id')).toBe('321')
  })
  it('reads only inside the allowed folders, only pictures for images, and says nothing about the path', async () => {
    const { checkFilesIn } = await import('../src/main/ventures/etsy/draftClient')
    const { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const root = mkdtempSync(join(tmpdir(), 'elo-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'elo-out-'))
    writeFileSync(join(root, 'ok.png'), 'png')
    writeFileSync(join(root, 'notes.txt'), 'x')
    writeFileSync(join(root, 'book.pdf'), 'pdf')
    writeFileSync(join(outside, 'secret.png'), 'x')
    symlinkSync(join(outside, 'secret.png'), join(root, 'link.png'))
    mkdirSync(join(root, 'sub'))
    const check = checkFilesIn(() => [root])
    await expect(check({ images: [join(root, 'ok.png')], digitalFile: join(root, 'book.pdf') })).resolves.toBeUndefined()
    for (const bad of [{ images: [join(outside, 'secret.png')] }, { images: [join(root, 'link.png')] }, { images: [join(root, 'notes.txt')] }, { images: [join(root, 'missing.png')] }, { images: [], digitalFile: join(outside, 'secret.png') }, { images: ['http://example.com/a.png'] }, { images: ['https://127.0.0.1/a.png'] }, { images: ['https://localhost/a.png'] }, { images: ['https://192.168.1.5/a.png'] }]) {
      const e = (await check(bad as any).catch((x) => x)) as Error
      expect(e).toBeInstanceOf(Error)
      expect(e.message).not.toContain(outside)
      expect(e.message).not.toContain(root)
    }
    await expect(check({ images: ['https://example.com/a.png'] })).resolves.toBeUndefined()
  })
  it('refuses a file over 20 MB', async () => {
    const { checkFilesIn } = await import('../src/main/ventures/etsy/draftClient')
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const root = mkdtempSync(join(tmpdir(), 'elo-big-'))
    writeFileSync(join(root, 'big.png'), Buffer.alloc(21 * 1024 * 1024))
    await expect(checkFilesIn(() => [root])({ images: [join(root, 'big.png')] })).rejects.toThrow()
  })
})
