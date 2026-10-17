import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { BotStore } from '../src/main/agent/bots'
import { handleAgentRequest } from '../src/main/agent/server'
import type { AgentServices } from '../src/main/agent/core'
import { Reconciler } from '../src/main/pipeline/reconcile'
import { UpcomingService } from '../src/main/pipeline/upcoming'
import { pipelineSetup } from './pipelineHelpers'

function setup(patch: Record<string, unknown> = {}) {
  const hooks: {
    onAccepted?: (i: { channel: string; episodeId: string; dropId: string }) => void
  } = {}
  const t = pipelineSetup({ hooks, patch })
  const file = join(mkdtempSync(join(tmpdir(), 'elo-up-')), 'Shared', 'upcoming.json')
  t.env.settings.set({ upcomingFilePath: file, upcomingLiveWatch: false })
  const alerts: string[][] = []
  const bots = new BotStore(t.env.db, () => t.env.clock.ms)
  const up = new UpcomingService({
    db: t.env.db,
    settings: t.env.settings,
    brands: t.env.brands,
    audit: t.audit,
    notify: (h, d) => alerts.push([h, d]),
    mediaRoot: () => t.env.root,
    now: () => t.env.clock.ms,
    studioIdeas: () => [],
  })
  hooks.onAccepted = (i) => void up.markDropped(i.channel, i.episodeId, i.dropId)
  const grok = bots.create(
    'grok-bot',
    ['trash-panda', 'clock-out-early', 'math-of-it', 'wonder-hollow'],
    'writer',
  )
  const kids = bots.create('kids-comedy', ['backup-heroes', 'complaint-department'], 'writer')
  const beth = bots.create('beth', [], 'orchestrator')
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
    audit: t.audit,
    bots,
    upcoming: up,
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
  const read = () => JSON.parse(readFileSync(file, 'utf8'))
  return { ...t, up, file, alerts, bots, grok, kids, beth, call, read }
}

const JOSH = { name: 'josh' }
const GROK = {
  name: 'grok-bot',
  role: 'writer' as const,
  channels: ['trash-panda', 'clock-out-early', 'math-of-it', 'wonder-hollow'],
}
const KIDS = {
  name: 'kids-comedy',
  role: 'writer' as const,
  channels: ['backup-heroes', 'complaint-department'],
}
const BETH = { name: 'beth', role: 'orchestrator' as const, channels: [] }

describe('Upcoming: add, ownership and API (tests 25, 26, 27)', () => {
  it('Josh adds an idea; the owning bot advances it but cannot reword it or set dropped', async () => {
    const t = setup()
    const e = await t.up.add(JOSH, {
      channel: 'trash-panda',
      working_title: 'Raccoon taxes',
      premise: 'He files on time',
    })
    expect(e).toMatchObject({
      status: 'idea',
      source_bot: 'josh',
      created_by: 'josh',
      episode_id: expect.stringMatching(/^trash-panda-\d{4}-0001$/),
      entry_revision: 1,
    })
    const adv = await t.up.patch(
      GROK,
      'trash-panda',
      e.episode_id,
      { status: 'scripted', script_path: '/x/script.md' },
      { entry_revision: 1 },
    )
    expect(adv.entry).toMatchObject({
      status: 'scripted',
      updated_by: 'grok-bot',
      entry_revision: 2,
    })
    await expect(
      t.up.patch(GROK, 'trash-panda', e.episode_id, { premise: 'new premise' }),
    ).rejects.toThrow(/cannot change the premise/)
    await expect(
      t.up.patch(GROK, 'trash-panda', e.episode_id, { status: 'dropped' }),
    ).rejects.toThrow(/Only ELO sets dropped/)
    await expect(
      t.up.patch(KIDS, 'trash-panda', e.episode_id, { status: 'queued' }),
    ).rejects.toThrow(/may not advance/)
    expect(t.read().episodes).toHaveLength(1)
    expect(t.read().revision).toBe(2)
  })

  it('shows on the board data and filters by channel, status and bot', async () => {
    const t = setup()
    await t.up.add(JOSH, { channel: 'trash-panda', working_title: 'A' })
    await t.up.add(GROK, { channel: 'clock-out-early', working_title: 'B' })
    const r = await t.call(t.grok.token, 'GET', '/v1/upcoming?channel=clock-out-early')
    expect((r.body as any).episodes.map((x: any) => x.working_title)).toEqual(['B'])
    const bot = await t.call(t.grok.token, 'GET', '/v1/upcoming?source_bot=josh')
    expect((bot.body as any).episodes.map((x: any) => x.working_title)).toEqual(['A'])
    const st = await t.call(t.grok.token, 'GET', '/v1/upcoming?status=idea')
    expect((st.body as any).episodes).toHaveLength(2)
    expect(t.up.view().rows.map((x) => x.channelName)).toEqual(['Trash Panda', 'Clock Out Early'])
  })

  it('a bot token against another bot channel gets 403, is audited, and leaves the file unchanged', async () => {
    const t = setup()
    const bh = t.env.brands.create('Backup Heroes', '#223344')
    expect(bh.slug).toBe('backup-heroes')
    const e = await t.up.add(KIDS, { channel: 'backup-heroes', working_title: 'Hero day' })
    const before = readFileSync(t.file, 'utf8')
    const r = await t.call(t.grok.token, 'PATCH', `/v1/upcoming/backup-heroes/${e.episode_id}`, {
      status: 'scripted',
    })
    expect(r.status).toBe(403)
    const add = await t.call(t.grok.token, 'POST', '/v1/upcoming', {
      channel: 'backup-heroes',
      working_title: 'Sneaky',
    })
    expect(add.status).toBe(403)
    expect(readFileSync(t.file, 'utf8')).toBe(before)
    expect(
      t.audit.list().filter((x) => x.action === 'upcoming.denied' && x.actor === 'agent:grok-bot'),
    ).toHaveLength(2)
    const kidsOnMath = await t.call(t.kids.token, 'POST', '/v1/upcoming', {
      channel: 'math-of-it',
      working_title: 'No',
    })
    expect(kidsOnMath.status).toBe(403)
  })

  it('B.E.T.H. advances any entry forward but not backward without a note; ELO only sets dropped', async () => {
    const t = setup()
    const e = await t.up.add(JOSH, {
      channel: 'math-of-it',
      working_title: 'Pi',
      status: 'scripted',
    })
    const q = await t.up.patch(BETH, 'math-of-it', e.episode_id, { status: 'queued' })
    expect(q.entry.status).toBe('queued')
    await expect(
      t.up.patch(BETH, 'math-of-it', e.episode_id, { status: 'scripted' }),
    ).rejects.toThrow(/needs a note/)
    const back = await t.up.patch(BETH, 'math-of-it', e.episode_id, {
      status: 'scripted',
      notes: 'script failed QC',
    })
    expect(back.entry.status).toBe('scripted')
    await expect(
      t.up
        .patch(GROK, 'math-of-it', e.episode_id, { status: 'queued' })
        .then(() => t.up.patch(GROK, 'math-of-it', e.episode_id, { status: 'scripted' })),
    ).rejects.toThrow(/back needs Josh/)
  })
})

describe('Upcoming: file editing and conflicts (tests 28, 29, 30)', () => {
  it('detects a direct file edit by an actor who may not make it, flags it, and Restore previous works', async () => {
    const t = setup()
    const e = await t.up.add(JOSH, {
      channel: 'trash-panda',
      working_title: 'Original',
      premise: 'p',
    })
    const f = t.read()
    f.revision += 1
    f.episodes[0].premise = 'rewritten by a bot'
    f.episodes[0].updated_by = 'grok-bot'
    f.episodes[0].entry_revision += 1
    writeFileSync(t.file, JSON.stringify(f, null, 2))
    expect(t.up.load()).toBe(true)
    expect(t.alerts.some((a) => /Upcoming needs a look/.test(a[0]))).toBe(true)
    expect(t.up.issues().some((i) => /cannot change the premise/.test(i.detail))).toBe(true)
    await t.up.restorePrevious()
    expect(t.read().episodes[0].premise).toBe('p')
    expect(t.read().revision).toBeGreaterThan(f.revision)
    expect(t.up.issues().filter((i) => /premise/.test(i.detail))).toHaveLength(0)
    void e
  })

  it('a silent edit with no entry revision bump is flagged too, and a removed entry is reported, never deleted by ELO', async () => {
    const t = setup()
    await t.up.add(JOSH, { channel: 'trash-panda', working_title: 'One' })
    await t.up.add(JOSH, { channel: 'trash-panda', working_title: 'Two' })
    const f = t.read()
    f.revision += 1
    f.episodes.pop()
    writeFileSync(t.file, JSON.stringify(f))
    t.up.load()
    expect(t.up.issues().some((i) => /no longer in the file/.test(i.detail))).toBe(true)
    expect(t.up.view().rows).toHaveLength(1) // the file is the truth
  })

  it('two writers on the same entry revision: different fields merge, the same field keeps both and flags a conflict', async () => {
    const t = setup()
    const e = await t.up.add(JOSH, {
      channel: 'clock-out-early',
      working_title: 'Base',
      premise: 'p0',
    })
    await t.up.patch(
      JOSH,
      'clock-out-early',
      e.episode_id,
      { working_title: 'Josh title' },
      { entry_revision: 1 },
    )
    const merged = await t.up.patch(
      GROK,
      'clock-out-early',
      e.episode_id,
      { notes: 'bot note' },
      { entry_revision: 1 },
    )
    expect(merged.conflict).toBe(false)
    expect(merged.entry).toMatchObject({ working_title: 'Josh title', notes: 'bot note' })
    const clash = await t.up.patch(
      JOSH,
      'clock-out-early',
      e.episode_id,
      { working_title: 'Another title' },
      { entry_revision: 1 },
    )
    expect(clash.conflict).toBe(true)
    expect(clash.entry.conflict).toBe(true)
    expect(clash.entry.conflict_detail).toMatch(/Josh title/)
    expect(clash.entry.conflict_detail).toMatch(/Another title/)
    expect(t.alerts.some((a) => /conflict/i.test(a[0]))).toBe(true)
    expect(t.up.issues().some((i) => /has a conflict/.test(i.detail))).toBe(true)
    const r = await t.call(t.grok.token, 'PATCH', `/v1/upcoming/clock-out-early/${e.episode_id}`, {
      notes: 'x',
    })
    expect(r.status).toBe(409)
    await t.up.patch(JOSH, 'clock-out-early', e.episode_id, { clear_conflict: true })
    expect(t.up.view().rows[0].conflict).toBeUndefined()
  })

  it('a higher revision reloads without a restart; truncated JSON keeps the last good copy and alerts once', async () => {
    const t = setup()
    await t.up.add(JOSH, { channel: 'trash-panda', working_title: 'Keep me' })
    const good = readFileSync(t.file, 'utf8')
    const f = JSON.parse(good)
    f.revision += 1
    f.episodes.push({
      ...f.episodes[0],
      episode_id: 'trash-panda-2026-0099',
      working_title: 'From a bot',
      created_by: 'grok-bot',
      source_bot: 'grok-bot',
      updated_by: 'grok-bot',
    })
    writeFileSync(t.file, JSON.stringify(f))
    expect(t.up.load()).toBe(true)
    expect(t.up.view().rows.map((r) => r.working_title)).toEqual(['Keep me', 'From a bot'])
    writeFileSync(t.file, good.slice(0, 40))
    t.up.load()
    t.up.load()
    const v = t.up.view()
    expect(v.rows).toHaveLength(2)
    expect(v.invalidReason).toMatch(/not valid JSON/)
    expect(t.alerts.filter((a) => /invalid/.test(a[0]))).toHaveLength(1)
    await expect(t.up.add(JOSH, { channel: 'trash-panda', working_title: 'x' })).rejects.toThrow(
      /invalid/,
    )
    // an hour later the reconcile check says so
    t.env.clock.ms += 61 * 60_000
    expect(t.up.issues().some((i) => i.key === 'upcoming:invalid')).toBe(true)
    // fixed
    writeFileSync(t.file, JSON.stringify({ ...f, revision: f.revision + 1 }))
    t.up.load()
    expect(t.up.view().invalidReason).toBeNull()
  })
})

describe('Upcoming: drop link and reconcile (tests 31, 32, 33, 34)', () => {
  it('needs-review becomes dropped when a drop with the exact id arrives; a different id changes nothing', async () => {
    const t = setup()
    const a = await t.up.add(JOSH, {
      channel: 'trash-panda',
      working_title: 'Match',
      episode_id: 'trash-panda-2026-0001',
      status: 'needs-review',
    })
    const b = await t.up.add(JOSH, {
      channel: 'trash-panda',
      working_title: 'Mismatch',
      episode_id: 'trash-panda-2026-0007',
      status: 'needs-review',
    })
    t.drop('Trash Panda', 'trash-panda', 1)
    await t.settle()
    await new Promise((r) => setTimeout(r, 20))
    const dropId = t.drops.list()[0].dropId
    const rows = t.up.view().rows
    expect(rows.find((r) => r.episode_id === a.episode_id)).toMatchObject({
      status: 'dropped',
      drop_id: dropId,
      updated_by: 'system',
    })
    expect(rows.find((r) => r.episode_id === a.episode_id)!.postId).toBeTruthy()
    expect(rows.find((r) => r.episode_id === b.episode_id)!.status).toBe('needs-review')
    t.drop('Trash Panda', 'trash-panda', 8) // no entry
    await t.settle()
    expect(t.up.issues().some((i) => /has no entry in Upcoming/.test(i.detail))).toBe(true)
  })

  it('a drop that arrives before the status caught up is not advanced and raises a warning', async () => {
    const t = setup()
    await t.up.add(JOSH, {
      channel: 'trash-panda',
      working_title: 'Early',
      episode_id: 'trash-panda-2026-0001',
      status: 'rendering',
    })
    t.drop('Trash Panda', 'trash-panda', 1)
    await t.settle()
    await new Promise((r) => setTimeout(r, 20))
    expect(t.up.view().rows[0].status).toBe('rendering')
    expect(t.up.issues().some((i) => /before the status caught up/.test(i.detail))).toBe(true)
  })

  it('reconcile reports a duplicate id, a dropped entry with no drop row, and a stale needs-review, and deletes nothing', async () => {
    const t = setup()
    const rec = new Reconciler({
      db: t.env.db,
      posts: t.env.posts,
      library: t.env.library,
      settings: t.env.settings,
      notify: () => {},
      extra: [() => t.up.issues()],
      now: () => t.env.clock.ms,
    })
    await t.up.add(JOSH, {
      channel: 'trash-panda',
      working_title: 'Stale',
      episode_id: 'trash-panda-2026-0003',
      status: 'needs-review',
    })
    const f = t.read()
    f.revision += 1
    f.episodes.push({
      ...f.episodes[0],
      episode_id: 'trash-panda-2026-0004',
      status: 'dropped',
      drop_id: 'nope',
      working_title: 'Ghost',
    })
    writeFileSync(t.file, JSON.stringify(f))
    t.up.load()
    t.env.clock.ms += 8 * 86_400_000
    const issues = (await rec.run()).filter((i) => i.kind === 'upcoming').map((i) => i.detail)
    expect(issues.some((d) => /more than 7 days/.test(d))).toBe(true)
    expect(issues.some((d) => /no matching row in the drop log/.test(d))).toBe(true)
    const dup = t.read()
    dup.revision += 1
    dup.episodes.push({ ...dup.episodes[0] })
    writeFileSync(t.file, JSON.stringify(dup))
    t.up.load()
    expect((await rec.run()).some((i) => /more than once/.test(i.detail))).toBe(true)
    expect(t.read().episodes).toHaveLength(3)
    await expect(
      t.up.add(JOSH, { channel: 'trash-panda', working_title: 'blocked' }),
    ).rejects.toThrow(/duplicate/)
  })

  it('switching Upcoming off leaves the file alone, and without live watch it still reloads through polling', async () => {
    const t = setup()
    await t.up.add(JOSH, { channel: 'trash-panda', working_title: 'On' })
    const before = readFileSync(t.file, 'utf8')
    t.env.settings.set({ upcomingEnabled: false })
    await expect(t.up.add(JOSH, { channel: 'trash-panda', working_title: 'Off' })).rejects.toThrow(
      /switched off/,
    )
    expect(t.up.load()).toBe(false)
    expect(t.up.issues()).toEqual([])
    expect(t.up.needsReviewCount()).toBe(0)
    expect(readFileSync(t.file, 'utf8')).toBe(before)
    t.env.settings.set({ upcomingEnabled: true, upcomingLiveWatch: false, upcomingPollSeconds: 2 })
    t.up.start()
    expect((t.up as unknown as { watcher: unknown }).watcher).toBeNull()
    const f = JSON.parse(before)
    f.revision += 1
    f.episodes[0].working_title = 'Polled'
    f.episodes[0].updated_by = 'josh'
    f.episodes[0].entry_revision += 1
    writeFileSync(t.file, JSON.stringify(f))
    expect(t.up.load()).toBe(true)
    expect(t.up.view().rows[0].working_title).toBe('Polled')
    t.up.stop()
  })

  it('moves the Studio ideas into Upcoming once', async () => {
    const t = setup()
    const ideas = [
      { id: 1, brandId: 1, text: 'Raccoon opens a bank' },
      { id: 2, brandId: 2, text: 'The meeting that could have been an email' },
    ]
    const up = new UpcomingService({
      db: t.env.db,
      settings: t.env.settings,
      brands: t.env.brands,
      audit: t.audit,
      notify: () => {},
      mediaRoot: () => t.env.root,
      now: () => t.env.clock.ms,
      studioIdeas: () => ideas,
    })
    expect(await up.moveStudioIdeas()).toBe(2)
    expect(await up.moveStudioIdeas()).toBe(0)
    const rows = up.view().rows
    expect(rows.map((r) => [r.channel, r.status, r.source_bot])).toEqual([
      ['trash-panda', 'idea', 'josh'],
      ['clock-out-early', 'idea', 'josh'],
    ])
    expect(existsSync(t.file)).toBe(true)
  })
})

describe('Upcoming: delete', () => {
  it('Josh removes an entry, it can be restored, and a dropped one cannot be removed', async () => {
    const t = setup()
    const a = await t.up.add(
      { name: 'josh' },
      { channel: 'trash-panda', working_title: 'Unwanted' },
    )
    const b = await t.up.add(
      { name: 'josh' },
      { channel: 'trash-panda', working_title: 'Done', status: 'needs-review' },
    )
    await t.up.remove('trash-panda', a.episode_id)
    expect(t.up.view().rows.map((r) => r.working_title)).toEqual(['Done'])
    expect(t.audit.list().some((e) => e.action === 'upcoming.remove')).toBe(true)
    await t.up.restorePrevious()
    expect(t.up.view().rows).toHaveLength(2)
    await t.up.markDropped('trash-panda', b.episode_id, 'd1')
    await expect(t.up.remove('trash-panda', b.episode_id)).rejects.toThrow(/cannot be removed/)
    await expect(t.up.remove('trash-panda', 'nope')).rejects.toThrow(/No entry/)
  })
})
