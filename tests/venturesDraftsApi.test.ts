import { describe, expect, it } from 'vitest'
import { BotStore } from '../src/main/agent/bots'
import { handleAgentRequest } from '../src/main/agent/server'
import type { AgentServices } from '../src/main/agent/core'
import { Reconciler } from '../src/main/pipeline/reconcile'
import { pipelineSetup } from './pipelineHelpers'
import { VentureStore } from '../src/main/ventures/store'
import { DraftService } from '../src/main/ventures/drafts'

function setup() {
  const t = pipelineSetup({})
  const bots = new BotStore(t.env.db, () => t.env.clock.ms)
  const store = new VentureStore(t.env.db)
  const drafts = new DraftService({ store, live: () => null, audit: t.audit, defaultTaxonomy: () => null, defaultShippingProfile: () => null })
  const s: AgentServices = {
    settings: t.env.settings, brands: t.env.brands, posts: t.env.posts, scheduler: t.env.scheduler, log: t.env.log,
    appVersion: 't', now: () => t.env.clock.ms, health: () => null, drops: t.drops, audit: t.audit, bots,
    reconciler: new Reconciler({ db: t.env.db, posts: t.env.posts, library: t.env.library, settings: t.env.settings, notify: () => {}, now: () => t.env.clock.ms }),
    ventureDrafts: () => drafts,
  } as AgentServices
  const call = (token: string, method: string, path: string, body?: unknown) =>
    handleAgentRequest(s, () => 'owner-token', {
      method, url: path, port: 1,
      headers: { host: '127.0.0.1:1', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? '' : JSON.stringify(body),
    })
  return { ...t, bots, call }
}
const good = { title: 'Planner', description: 'd', tags: ['a'], priceCents: 600, taxonomyId: 1 }

describe('Etsy draft routes over HTTP', () => {
  it('beth can create a draft, which stays pending with no shop, and it is audited', async () => {
    const t = setup()
    const { token } = t.bots.create('beth', [], 'orchestrator')
    const r = await t.call(token, 'POST', '/v1/ventures/etsy/drafts', good)
    expect(r.status).toBe(201)
    expect((r.body as any).pending).toBe(true)
    expect(t.audit.list().some((e) => e.action === 'ventures.draft.create' && e.actor === 'agent:beth')).toBe(true)
  })
  it('another bot is refused', async () => {
    const t = setup()
    const { token } = t.bots.create('scout', [], 'writer')
    expect((await t.call(token, 'POST', '/v1/ventures/etsy/drafts', good)).status).toBe(403)
  })
  it('a request that tries to set a state is refused and the refusal is audited', async () => {
    const t = setup()
    const { token } = t.bots.create('beth', [], 'orchestrator')
    const r = await t.call(token, 'POST', '/v1/ventures/etsy/drafts', { ...good, state: 'active' })
    expect(r.status).toBe(400)
    const e = t.audit.list().find((x) => x.action === 'api.denied' && x.target.includes('createEtsyDraft'))
    expect(e).toBeTruthy()
    expect(e!.actor).toBe('agent:beth')
  })
})
