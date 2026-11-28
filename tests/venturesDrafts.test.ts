import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import { VentureStore } from '../src/main/ventures/store'
import { DraftService, type DraftClient } from '../src/main/ventures/drafts'
import { DraftListingBody, UpdateDraftBody } from '../src/shared/agentSchemas'
import { AgentError } from '../src/main/agent/core'
import type { ListingDetail } from '../src/shared/ventures'

const beth = { kind: 'bot', actor: 'beth', bot: { name: 'beth', role: 'orchestrator', channels: [] } } as any
const other = { kind: 'bot', actor: 'scout', bot: { name: 'scout', role: 'drop', channels: [] } } as any
const owner = { kind: 'owner', actor: 'josh' } as any

const input = { title: 'Weekly Planner', description: 'A planner', tags: ['planner', 'printable'], priceCents: 600, images: [], taxonomyId: 1234 }

function setup(live: boolean) {
  const store = new VentureStore(makeEnv().db)
  const audits: any[] = []
  const calls: Array<{ kind: string; shopId: string; id?: string; fields: any }> = []
  const client: DraftClient = {
    createDraft: async (shopId, fields) => (calls.push({ kind: 'create', shopId, fields }), { listingId: '9001' }),
    updateDraft: async (shopId, id, fields) => void calls.push({ kind: 'update', shopId, id, fields }),
  }
  const svc = new DraftService({
    store,
    live: () => (live ? { client, shopId: '55' } : null),
    audit: { write: (e) => void audits.push(e) },
    defaultTaxonomy: () => null,
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
      live: () => ({ client: { createDraft: async (s, f) => (live.calls.push({ kind: 'create', shopId: s, fields: f }), { listingId: '9100' }), updateDraft: async () => {} }, shopId: '55' }),
      audit: { write: () => {} },
      defaultTaxonomy: () => null,
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
    const svc2 = new DraftService({ store, live: () => ({ client: { createDraft: async () => ({ listingId: '1' }), updateDraft: async () => {} }, shopId: '55' }), audit: { write: () => {} }, defaultTaxonomy: () => null })
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
