import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'

const MIN = 60_000

async function postedOnYoutube(e: ReturnType<typeof makeEnv>, title = 'Old one') {
  const post = await e.makePost({ whenMs: e.clock.ms + MIN, platforms: ['youtube'], title })
  e.clock.ms += 2 * MIN
  await e.scheduler.tick()
  await e.scheduler.idle()
  return post
}
const connect = (e: ReturnType<typeof makeEnv>, platform: string, mode: string) =>
  e.db.prepare('UPDATE accounts SET mode = ?, status = ? WHERE brand_id = 1 AND platform = ?').run(mode, 'connected', platform)

describe('send older videos to another platform', () => {
  it('lists posted videos that never went to a platform and sends them one by one, keeping the old date', async () => {
    const e = makeEnv()
    const a = await postedOnYoutube(e, 'First')
    const b = await postedOnYoutube(e, 'Second')
    expect(e.posts.get(a.id)!.status).toBe('posted')
    const before = e.posts.get(a.id)!.scheduledAtUtc
    expect(e.posts.olderMissingPlatform(1, 'facebook').map((x) => x.title)).toEqual(['First', 'Second'])

    // Only a real account counts. The dry run placeholder is refused.
    const refused = e.posts.addPlatform([a.id], 'facebook')
    expect(refused.added).toBe(0)
    expect(refused.problems[0].reason).toMatch(/No real facebook account/)

    connect(e, 'facebook', 'live')
    const r = e.posts.addPlatform([a.id, b.id], 'facebook', { allowDryRun: true })
    expect(r.added).toBe(2)
    const ta = e.posts.get(a.id)!.targets.find((t) => t.platform === 'facebook')!
    const tb = e.posts.get(b.id)!.targets.find((t) => t.platform === 'facebook')!
    expect(ta.status).toBe('pending')
    expect(new Date(tb.nextAttemptAtUtc!).getTime() - new Date(ta.nextAttemptAtUtc!).getTime()).toBe(120_000)
    expect(e.posts.get(a.id)!.status).toBe('in_progress')
    expect(e.posts.get(a.id)!.scheduledAtUtc).toBe(before)
    expect(e.posts.olderMissingPlatform(1, 'facebook')).toEqual([])
    expect(e.posts.addPlatform([a.id], 'facebook').problems[0].reason).toMatch(/already has a facebook entry/)
  })

  it('actually posts to the platform on the scheduler, and finishes the post', async () => {
    const e = makeEnv()
    const a = await postedOnYoutube(e)
    connect(e, 'tiktok', 'drafts')
    e.posts.addPlatform([a.id], 'tiktok', { allowDryRun: true })
    for (let i = 0; i < 4; i++) {
      e.clock.ms += 3 * MIN
      await e.scheduler.tick()
      await e.scheduler.idle()
    }
    const t = e.posts.get(a.id)!.targets.find((x) => x.platform === 'tiktok')!
    expect(['posted', 'needs_action']).toContain(t.status)
  })

  it('refuses posts that did not go out, Direct post mode, and a video that is gone', async () => {
    const e = makeEnv()
    const draft = await e.makePost({ whenMs: e.clock.ms + 60 * MIN, platforms: ['youtube'] })
    connect(e, 'tiktok', 'drafts')
    expect(e.posts.addPlatform([draft.id], 'tiktok').problems[0].reason).toMatch(/already went out/)
    const a = await postedOnYoutube(e)
    connect(e, 'tiktok', 'direct')
    expect(e.posts.addPlatform([a.id], 'tiktok').problems[0].reason).toMatch(/Direct Post/)
    connect(e, 'tiktok', 'drafts')
    e.db.prepare('UPDATE posts SET media_purged_at = ? WHERE id = ?').run(new Date().toISOString(), a.id)
    expect(e.posts.olderMissingPlatform(1, 'tiktok')).toEqual([])
    expect(e.posts.addPlatform([a.id], 'tiktok').problems[0].reason).toMatch(/file is gone/)
  })

  it('can start later and space the videos by a chosen time', async () => {
    const e = makeEnv()
    const a = await postedOnYoutube(e, 'A')
    const b = await postedOnYoutube(e, 'B')
    const c = await postedOnYoutube(e, 'C')
    connect(e, 'tiktok', 'drafts')
    const start = new Date(e.clock.ms + 3 * 86_400_000).toISOString()
    const r = e.posts.addPlatform([a.id, b.id, c.id], 'tiktok', { allowDryRun: true, schedule: { mode: 'start', startAtUtc: start, everyMinutes: 1440 } })
    expect(r.times).toEqual([0, 1, 2].map((n) => new Date(new Date(start).getTime() + n * 86_400_000).toISOString()))
    const targets = [a, b, c].map((p) => e.posts.get(p.id)!.targets.find((t) => t.platform === 'tiktok')!)
    expect(targets.map((t) => t.nextAttemptAtUtc)).toEqual(r.times)
    // Nothing goes before its time.
    e.clock.ms += 2 * 86_400_000
    await e.scheduler.tick()
    await e.scheduler.idle()
    expect(e.posts.get(a.id)!.targets.find((t) => t.platform === 'tiktok')!.status).toBe('pending')
  })

  it('can use the channel posting times, one video for each', async () => {
    const e = makeEnv()
    const a = await postedOnYoutube(e, 'A')
    const b = await postedOnYoutube(e, 'B')
    connect(e, 'facebook', 'live')
    const r = e.posts.addPlatform([a.id, b.id], 'facebook', { allowDryRun: true, schedule: { mode: 'channel' } })
    expect(r.added).toBe(2)
    expect(r.times[0] < r.times[1]).toBe(true)
    expect(new Date(r.times[0]).getTime()).toBeGreaterThan(e.clock.ms)
    const slots = e.posts.channelPostingTimes(1, 2, e.clock.ms + 60_000)
    expect(r.times).toEqual(slots)
  })
})
