import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { BotStore } from '../src/main/agent/bots'
import { handleAgentRequest } from '../src/main/agent/server'
import type { AgentServices } from '../src/main/agent/core'
import { Reconciler } from '../src/main/pipeline/reconcile'
import { pipelineSetup, sha } from './pipelineHelpers'

function setup(patch: Record<string, unknown> = {}) {
  const t = pipelineSetup({ patch })
  const bots = new BotStore(t.env.db, () => t.env.clock.ms)
  const reconciler = new Reconciler({
    db: t.env.db,
    posts: t.env.posts,
    library: t.env.library,
    settings: t.env.settings,
    notify: () => {},
    now: () => t.env.clock.ms,
  })
  const s: AgentServices = {
    settings: t.env.settings,
    brands: t.env.brands,
    posts: t.env.posts,
    scheduler: t.env.scheduler,
    log: t.env.log,
    appVersion: 't',
    now: () => t.env.clock.ms,
    health: () => null,
    drops: t.drops,
    reconciler,
    audit: t.audit,
    bots,
    pipeline: { receive: (c, sc, f, a) => t.watcher.receive(c, sc, f, a) },
  }
  const call = (token: string, method: string, path: string, body?: unknown) =>
    handleAgentRequest(s, () => 'owner-token', {
      method,
      url: path,
      headers: {
        host: '127.0.0.1:1',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? '' : JSON.stringify(body),
      port: 1,
    })
  return { ...t, s, bots, call }
}

describe('bot tokens', () => {
  it('a bot token authenticates as that bot, a revoked or unknown one does not, and the owner token still works', async () => {
    const t = setup()
    const { bot, token } = t.bots.create('grok-bot', ['trash-panda'], 'writer')
    expect((await t.call(token, 'GET', '/v1/brands')).status).toBe(200)
    expect((await t.call('owner-token', 'GET', '/v1/brands')).status).toBe(200)
    expect((await t.call('nope', 'GET', '/v1/brands')).status).toBe(401)
    t.bots.revoke(bot.id)
    expect((await t.call(token, 'GET', '/v1/brands')).status).toBe(401)
    const again = t.bots.create('grok-bot', [], 'writer')
    expect(t.bots.regenerate(again.bot.id).token).not.toBe(again.token)
    expect(t.bots.authenticate(again.token)).toBeNull()
  })

  it('a bot token cannot use owner endpoints, and the refusal is audited', async () => {
    const t = setup()
    const { token } = t.bots.create('grok-bot', ['trash-panda'], 'writer')
    const r = await t.call(token, 'POST', '/v1/posts/1/cancel')
    expect(r.status).toBe(403)
    expect(
      t.audit.list().some((e) => e.action === 'api.denied' && e.actor === 'agent:grok-bot'),
    ).toBe(true)
  })
})

describe('drops over the API', () => {
  it('POST /v1/drops puts the video in the Inbox, applies the rules and returns the decision; GET lists it', async () => {
    const t = setup()
    const { token } = t.bots.create('grok-bot', ['trash-panda'], 'writer')
    const dir = mkdtempSync(join(tmpdir(), 'elo-drop-'))
    const file = join(dir, 'trash-panda-2026-0042.mp4')
    const bytes = 'api video bytes'
    writeFileSync(file, bytes)
    const sidecar = {
      schema_version: '1.0',
      channel: 'trash-panda',
      episode_id: 'trash-panda-2026-0042',
      title: 'API drop',
      description: 'hello',
      video_file: 'trash-panda-2026-0042.mp4',
      platforms: ['youtube'],
      approval: { approved_by: 'Josh', approved_at: '2026-10-16T15:30:00-04:00' },
      checksum: { algo: 'sha256', value: sha(bytes) },
      source_bot: 'grok-bot',
      preferred_slot: '2030-01-01T00:00:00-05:00',
    }
    const r = await t.call(token, 'POST', '/v1/drops', { sidecar, file_path: file })
    expect(r.status).toBe(201)
    expect((r.body as any).drop).toMatchObject({
      result: 'accepted',
      channel: 'trash-panda',
      sha256: sha(bytes),
    })
    expect((r.body as any).drop.scheduled_slot).toBeTruthy()
    const list = await t.call(token, 'GET', '/v1/drops?channel=trash-panda')
    expect((list.body as any).drops).toHaveLength(1)
    const one = await t.call(token, 'GET', `/v1/drops/${(r.body as any).drop.drop_id}`)
    expect(one.status).toBe(200)
    const posts = await t.call(token, 'GET', '/v1/posts?origin=inbox&held=false')
    expect((posts.body as any).posts[0]).toMatchObject({
      origin: 'inbox',
      episode_id: 'trash-panda-2026-0042',
      source_bot: 'grok-bot',
    })
  })

  it('a bot may only drop into its own channels', async () => {
    const t = setup()
    const { token } = t.bots.create('kids-comedy', ['backup-heroes'], 'writer')
    const r = await t.call(token, 'POST', '/v1/drops', {
      sidecar: {
        channel: 'trash-panda',
        video_file: 'x.mp4',
        video_url: 'https://example.com/x.mp4',
      },
    })
    expect(r.status).toBe(403)
    expect(t.audit.list().some((e) => e.action === 'api.denied')).toBe(true)
  })

  it('stays waiting when agents are limited to drafts', async () => {
    const t = setup({ agentMaySchedule: false })
    t.drop('Trash Panda', 'trash-panda', 5)
    await t.settle()
    expect(t.env.posts.list()[0].status).toBe('draft')
  })
})

describe('slots and reconcile over the API', () => {
  it('slots by channel slug with a day range, and reconcile is read only', async () => {
    const t = setup()
    const a = await t.call(
      'owner-token',
      'GET',
      '/v1/slots/next-open?channel=trash-panda&count=30&days=3',
    )
    expect(a.status).toBe(200)
    const body = a.body as any
    expect(body.channel).toBe('trash-panda')
    expect(body.slots.length).toBeGreaterThan(0)
    expect(body.slots.length).toBeLessThanOrEqual(4)
    expect((await t.call('owner-token', 'GET', '/v1/slots/next-open?channel=nope')).status).toBe(
      404,
    )
    expect((await t.call('owner-token', 'GET', '/v1/slots/next-open')).status).toBe(400)
    const r = await t.call('owner-token', 'GET', '/v1/reconcile')
    expect(r.status).toBe(200)
    expect(Array.isArray((r.body as any).issues)).toBe(true)
    expect((await t.call('owner-token', 'POST', '/v1/reconcile', {})).status).toBe(405)
  })
})
