import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { BotStore } from '../src/main/agent/bots'
import { handleAgentRequest } from '../src/main/agent/server'
import type { AgentServices } from '../src/main/agent/core'
import { GrowthService } from '../src/main/growth/service'
import { pipelineSetup } from './pipelineHelpers'

const TP = 'Trash Panda'

async function rig() {
  const t = pipelineSetup({
    live: [[1, 'youtube']],
    probe: async () => ({ width: 1080, height: 1920, durationSeconds: 40, hasAudio: true }),
  })
  const d = t.drop(TP, 'trash-panda', 401, { platforms: ['youtube'] })
  await t.settle()
  const bots = new BotStore(t.env.db, () => t.env.clock.ms)
  const beth = bots.create('beth', ['*'], 'orchestrator')
  const gemini = bots.create('gemini', ['trash-panda'], 'writer')
  const privacy: string[] = []
  const notices: string[][] = []
  const growth = new GrowthService({
    db: t.env.db,
    settings: t.env.settings,
    log: t.env.log,
    notify: () => {},
    send: async () => {},
    youtube: {
      postComment: async () => '',
      listComments: async () => [],
      setPrivacy: async (_a, v, p) => void privacy.push(`${v}:${p}`),
      videoStatus: async () => null,
    },
    refreshStats: async () => undefined,
    readRetention: async () => ({ avgViewPercent: null, curve: [] }),
    readCtr: async () => null,
    setThumbnail: async () => undefined,
    resolve: (r) => r,
    addIdea: async () => '',
    upcomingCounts: () => ({}),
    bestTimeLines: () => [],
    emptySlotCount: () => 0,
    sharedDir: () => join(t.env.root, 'Shared'),
    live: () => true,
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
    audit: t.audit,
    bots,
    growth,
    notifyOwner: (h, x) => notices.push([h, x]),
  }
  const call = (token: string, method: string, path: string) =>
    handleAgentRequest(s, () => 'owner', {
      method,
      url: path,
      headers: {
        host: '127.0.0.1:1',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '',
      port: 1,
    })
  return { t, d, beth, gemini, call, privacy, notices }
}

describe('retract an episode', () => {
  it('stops a post that has not gone out and tells the owner', async () => {
    const r = await rig()
    const res = await r.call(r.beth.token, 'POST', `/v1/episodes/${r.d.id}/retract`)
    expect(res.status).toBe(200)
    expect((res.body as any).results[0]).toMatchObject({ platform: 'youtube', outcome: 'skipped' })
    expect(r.notices[0]![0]).toContain('retracted')
  })

  it('sets a posted YouTube video private and lists the other platforms as manual', async () => {
    const r = await rig()
    r.t.env.db
      .prepare(
        "UPDATE post_targets SET status='posted', external_id='vid9', account_id=(SELECT id FROM accounts WHERE brand_id=1 AND platform='youtube')",
      )
      .run()
    r.t.env.db
      .prepare(
        "INSERT INTO post_targets (post_id, platform, status, external_id, external_url) SELECT id, 'tiktok', 'posted', 't1', 'https://tiktok.com/x' FROM posts LIMIT 1",
      )
      .run()
    const res = await r.call(r.beth.token, 'POST', `/v1/episodes/${r.d.id}/retract`)
    expect(res.status).toBe(200)
    expect(r.privacy).toEqual(['vid9:private'])
    const out = (res.body as any).results
    expect(out.find((x: any) => x.platform === 'tiktok')).toMatchObject({
      outcome: 'manual',
      url: 'https://tiktok.com/x',
    })
  })

  it('refuses a writer token and an unknown episode', async () => {
    const r = await rig()
    expect((await r.call(r.gemini.token, 'POST', `/v1/episodes/${r.d.id}/retract`)).status).toBe(
      403,
    )
    expect((await r.call(r.beth.token, 'POST', '/v1/episodes/nope/retract')).status).toBe(404)
  })
})
