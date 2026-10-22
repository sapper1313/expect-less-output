import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { BotStore } from '../src/main/agent/bots'
import { handleAgentRequest } from '../src/main/agent/server'
import type { AgentServices } from '../src/main/agent/core'
import { UpcomingService } from '../src/main/pipeline/upcoming'
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
    upcoming: new UpcomingService({
      db: t.env.db,
      settings: t.env.settings,
      brands: t.env.brands,
      audit: t.audit,
      notify: () => {},
      mediaRoot: () => t.env.root,
      now: () => t.env.clock.ms,
    }),
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
    const r = await t.call(token, 'POST', '/v1/posts/1/retry')
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

describe('sync surface for the bot box', () => {
  it('brands expose distinct states, aliases and rules; the heartbeat and changes feed work; archived channels refuse writes', async () => {
    const t = setup()
    t.env.db.prepare('UPDATE channel_rules SET on_hold = 1 WHERE brand_id = 2').run()
    t.env.settings.set({ pausedBrandIds: [3] })
    t.env.brands.archive(4, true)
    const r = await t.call('owner-token', 'GET', '/v1/brands')
    const by = Object.fromEntries((r.body as any).brands.map((b: any) => [b.slug, b]))
    expect(by['trash-panda'].state).toBe('active')
    expect(by['clock-out-early']).toMatchObject({ state: 'on-hold', on_hold: true })
    expect(by['teach-your-parents-tech'].state).toBe('paused')
    expect(by['math-of-it'].state).toBe('archived')
    expect(by['trash-panda'].daily_cap).toBe(1)
    const hb = await t.call('owner-token', 'GET', '/v1/sync')
    expect(hb.status).toBe(200)
    expect(hb.body as any).toMatchObject({
      mechanism: 'agent-api-tailscale/1',
      agent_may_schedule: true,
    })
    expect((hb.body as any).server_time).toMatch(/-0[45]:00$/)
    const before = (hb.body as any).last_change_id
    t.audit.write({ actor: 'josh', action: 'post.schedule', target: 'x', after: { slot: 1 } })
    const ch = await t.call('owner-token', 'GET', `/v1/changes?since_id=${before}`)
    expect((ch.body as any).events.map((e: any) => e.action)).toEqual(['post.schedule'])
    expect((ch.body as any).cursor).toBe(before + 1)
    // aliases map to the canonical channel; archived channels take nothing
    const { token } = t.bots.create('grok-bot', ['math-of-it', 'trash-panda'], 'writer')
    const add = await t.call(token, 'POST', '/v1/upcoming', {
      channel: 'the-math-of-it',
      working_title: 'x',
    })
    expect(add.status).toBe(409)
    const ok = await t.call(token, 'POST', '/v1/upcoming', {
      channel: 'trash-panda',
      working_title: 'fine',
    })
    expect(ok.status).toBe(201)
    const slots = await t.call('owner-token', 'GET', '/v1/slots/next-open?channel=the-math-of-it')
    expect(slots.status).toBe(200)
  })

  it('a drop for an on-hold channel waits, and a QC requirement rejects a drop without sign-off', async () => {
    const t = setup({ pipelineRequireQc: true })
    t.drop('Trash Panda', 'trash-panda', 51)
    await t.settle()
    expect(t.rejectReasons('Trash Panda').reasons[0].code).toBe('no_qc')
    t.env.settings.set({ pipelineRequireQc: false })
    t.env.db.prepare('UPDATE channel_rules SET on_hold = 1 WHERE brand_id = 1').run()
    t.drop('Trash Panda', 'trash-panda', 52)
    await t.settle()
    expect(t.env.posts.list().find((p) => p.episodeRef === 'trash-panda-2026-0052')!.status).toBe(
      'draft',
    )
    expect(t.pipeline.waitingReason(1)).toMatch(/on hold/)
  })

  it('lists a past-due scheduled post as a missed slot and filters posts by past_due', async () => {
    const t = setup()
    const p = await t.env.makePost({ whenMs: t.env.clock.ms - 2 * 3_600_000, title: 'Late one' })
    const r = await t.call('owner-token', 'GET', '/v1/posts?past_due=true')
    expect((r.body as any).posts.map((x: any) => x.id)).toEqual([p.id])
    const { Reconciler } = await import('../src/main/pipeline/reconcile')
    const rec = new Reconciler({
      db: t.env.db,
      posts: t.env.posts,
      library: t.env.library,
      settings: t.env.settings,
      notify: () => {},
      now: () => t.env.clock.ms,
    })
    expect((await rec.run()).some((i) => i.kind === 'missed_slot')).toBe(true)
  })
})
