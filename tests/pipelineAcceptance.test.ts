import { existsSync } from 'fs'
import { describe, expect, it, vi } from 'vitest'
import { buildApi } from '../src/main/api'
import { AuditEvents } from '../src/main/pipeline/auditEvents'
import { pipelineSetup } from './pipelineHelpers'
import { makeStudioEnv } from './studio/helpers'

const MIN = 60_000
const TP = 'Trash Panda'

describe('full path with the Claude API off (test 1)', () => {
  it('drop, schedule and dry run post make zero requests to Anthropic', async () => {
    const seen: string[] = []
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (u: unknown) => {
      seen.push(String(u))
      return new Response('{}')
    }) as never)
    try {
      const t = pipelineSetup({
        patch: { claudeApiEnabled: false, studioProductionEnabled: false },
      })
      t.drop(TP, 'trash-panda', 1)
      await t.settle()
      const post = t.env.posts.list()[0]
      expect(post.status).toBe('scheduled')
      t.env.clock.ms = new Date(post.scheduledAtUtc!).getTime() + 1000
      await t.env.scheduler.tick()
      await t.env.scheduler.idle()
      expect(t.env.posts.get(post.id)!.status).toBe('posted')
      expect(seen.filter((u) => /anthropic/i.test(u))).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })
})

describe('kill switch, platform toggles and retries (tests 11, 12, 13)', () => {
  it('pausing everything stops a bot post; resuming posts it once', async () => {
    const t = pipelineSetup({ live: [[1, 'youtube']] })
    t.drop(TP, 'trash-panda', 2)
    await t.settle()
    const post = t.env.posts.list()[0]
    t.env.settings.set({ schedulerPaused: true })
    t.env.clock.ms = new Date(post.scheduledAtUtc!).getTime() + MIN
    await t.env.scheduler.tick()
    await t.env.scheduler.idle()
    expect(t.env.posts.get(post.id)!.status).toBe('scheduled')
    t.env.settings.set({ schedulerPaused: false })
    await t.env.scheduler.tick()
    await t.env.scheduler.idle()
    await t.env.scheduler.tick()
    await t.env.scheduler.idle()
    const done = t.env.posts.get(post.id)!
    expect(done.status).toBe('posted')
    expect(done.targets.filter((x) => x.status === 'posted')).toHaveLength(1)
    expect(done.targets[0].attempts).toBeLessThanOrEqual(1)
  })

  it('a paused channel does not post, and a platform switched off for the channel is skipped with a note', async () => {
    const t = pipelineSetup({
      live: [
        [1, 'youtube'],
        [1, 'tiktok'],
      ],
    })
    t.env.db
      .prepare('INSERT OR REPLACE INTO studio_brands (brand_id, config_json) VALUES (1, ?)')
      .run(JSON.stringify({ platforms: { youtube: true, tiktok: false } }))
    t.drop(TP, 'trash-panda', 3)
    await t.settle()
    const post = t.env.posts.list()[0]
    expect(post.targets.map((x) => x.platform)).toEqual(['youtube'])
    expect(t.drops.list()[0].notes).toMatch(/switched off for this channel\): tiktok/)
    t.env.settings.set({ pausedBrandIds: [1] })
    t.env.clock.ms = new Date(post.scheduledAtUtc!).getTime() + MIN
    await t.env.scheduler.tick()
    await t.env.scheduler.idle()
    expect(t.env.posts.get(post.id)!.status).toBe('scheduled')
  })

  it('retries fail twice then succeed: one post, three attempts, waits from the setting', async () => {
    const t = pipelineSetup({ live: [[1, 'youtube']], patch: { retryMinutes: [5, 15, 60] } })
    t.drop(TP, 'trash-panda', 4)
    await t.settle()
    const post = t.env.posts.list()[0]
    t.env.settings.set({ dryRunFailPlatform: 'youtube' })
    // the live youtube account is not a dry run, so make the dry adapter the one used by marking the target mock
    t.env.db
      .prepare('UPDATE post_targets SET settings_json = \'{"mock":true}\' WHERE post_id = ?')
      .run(post.id)
    const yt = () => t.env.posts.get(post.id)!.targets[0]
    t.env.clock.ms = new Date(post.scheduledAtUtc!).getTime() + 1000
    await t.env.scheduler.tick()
    await t.env.scheduler.idle()
    expect(yt().attempts).toBe(1)
    expect((new Date(yt().nextAttemptAtUtc!).getTime() - t.env.clock.ms) / MIN).toBe(5)
    t.env.clock.ms += 5 * MIN
    await t.env.scheduler.tick()
    await t.env.scheduler.idle()
    expect(yt().attempts).toBe(2)
    expect((new Date(yt().nextAttemptAtUtc!).getTime() - t.env.clock.ms) / MIN).toBe(15)
    t.env.settings.set({ dryRunFailPlatform: null })
    t.env.clock.ms += 15 * MIN
    await t.env.scheduler.tick()
    await t.env.scheduler.idle()
    const final = t.env.posts.get(post.id)!
    expect(final.status).toBe('posted')
    expect(final.targets).toHaveLength(1)
    expect(yt().attempts).toBe(3)
    // what was sent is in the activity log, with the checksum
    expect(
      t.env.log
        .list({ limit: 50 })
        .some(
          (l) =>
            /Sent to YouTube: episode trash-panda-2026-0004/.test(l.message) &&
            l.message.includes(post.checksum!),
        ),
    ).toBe(true)
  })
})

describe('retention and audit (tests 17, 18)', () => {
  it('removes old posted files, never unposted ones, and writes an audit row per file', async () => {
    const removed: string[] = []
    const e = makeStudioEnv({
      startMs: Date.UTC(2026, 7, 20, 12),
      onRetentionDelete: (i) => removed.push(i.title),
    })
    const old = await e.makePost({
      whenMs: Date.UTC(2026, 5, 1, 21),
      title: 'Old posted',
      platforms: ['youtube'],
      bytes: 2000,
    })
    const waiting = await e.makePost({
      whenMs: Date.UTC(2026, 5, 1, 21),
      title: 'Old but not posted',
      platforms: ['youtube'],
      bytes: 2000,
    })
    e.db.prepare("UPDATE posts SET status = 'posted' WHERE id = ?").run(old.id)
    const oldFile = e.library.resolve(e.posts.get(old.id)!.videoPath)
    const keepFile = e.library.resolve(e.posts.get(waiting.id)!.videoPath)
    expect(e.studio.cfg.get().retentionDays).toBe(30)
    await e.studio.purge(false)
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(keepFile)).toBe(true)
    expect(removed).toEqual(['Old posted'])
  })

  it('every setting change is recorded with before and after, and secrets are hidden', async () => {
    const e = makeStudioEnv()
    const audit = new AuditEvents(e.db, () => e.clock.ms)
    const api = buildApi({
      settings: e.settings,
      audit,
      emit: () => {},
      beforeResume: () => {},
      afterResume: () => {},
      host: { applySettings: () => {} },
      inbox: { api: () => ({}) },
    } as never)
    await api.settings.set({ globalDryRun: true, minGapMinutes: 30 })
    await api.settings.set({ globalDryRun: true }) // no change, no row
    await api.settings.set({ blackoutDates: ['2026-12-25'] })
    const rows = audit.list({ action: 'settings.change' })
    expect(rows.map((r) => [r.actor, r.target, r.before, r.after]).reverse()).toEqual([
      ['josh', 'globalDryRun', false, true],
      ['josh', 'minGapMinutes', 0, 30],
      ['josh', 'blackoutDates', [], ['2026-12-25']],
    ])
    audit.write({ actor: 'josh', action: 'x', target: 'y', after: { apiToken: 'abc', ok: 1 } })
    expect(audit.list({ action: 'x' })[0].after).toEqual({ apiToken: '[hidden]', ok: 1 })
    expect(audit.csv()).toContain('globalDryRun')
  })
})

describe('Studio production off keeps the rest running (test 22)', () => {
  it('the Director still plans the daily analytics and comment passes', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 9, 19, 14, 0, 0) })
    e.settings.set({ studioProductionEnabled: false })
    e.studio.director.tick()
    const types = new Set(e.studio.tasks.list({}).map((t) => t.type))
    expect(types.has('write_episode')).toBe(false)
    expect(types.has('produce_episode')).toBe(false)
    expect(types.has('analytics_daily')).toBe(true)
  })
})

describe('TikTok (test 21)', () => {
  it('goes to Drafts accounts and is skipped, with a note, where it is a dry run or set to Direct post', async () => {
    const t = pipelineSetup({
      live: [
        [1, 'youtube'],
        [1, 'tiktok'],
        [2, 'youtube'],
        [2, 'tiktok'],
      ],
    })
    t.env.db
      .prepare("UPDATE accounts SET mode = 'drafts' WHERE brand_id = 1 AND platform = 'tiktok'")
      .run()
    t.env.db
      .prepare("UPDATE accounts SET mode = 'direct' WHERE brand_id = 2 AND platform = 'tiktok'")
      .run()
    t.drop(TP, 'trash-panda', 31, { platforms: ['youtube', 'tiktok'] })
    t.drop('Clock Out Early', 'clock-out-early', 32, { platforms: ['youtube', 'tiktok'] })
    t.drop('Teach Your Parents Tech', 'teach-your-parents-tech', 33, {
      platforms: ['youtube', 'tiktok'],
    })
    await t.settle()
    const by = (id: number) => t.env.posts.list({ brandId: id })[0].targets.map((x) => x.platform)
    expect(by(1)).toEqual(['youtube', 'tiktok'])
    expect(by(2)).toEqual(['youtube'])
    const notes = t.drops.list().map((d) => d.notes ?? '')
    expect(notes.filter((n) => /Skipped \(no real account\): tiktok/.test(n)).length).toBe(1)
    expect(t.env.posts.list({ brandId: 3 })[0].status).toBe('draft') // channel 3 has no real account at all, so it waits
  })
})
