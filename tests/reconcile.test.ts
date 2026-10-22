import { writeFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { Reconciler } from '../src/main/pipeline/reconcile'
import { pipelineSetup } from './pipelineHelpers'

function make(t: ReturnType<typeof pipelineSetup>) {
  const notices: string[][] = []
  const r = new Reconciler({
    db: t.env.db,
    posts: t.env.posts,
    library: t.env.library,
    settings: t.env.settings,
    notify: (k, h, d) => notices.push([k, h, d]),
    reschedule: (id, slot) => void t.env.posts.update(id, { scheduledAtUtc: slot }),
    now: () => t.env.clock.ms,
  })
  return { r, notices }
}

describe('reconcile (tests 9, 23)', () => {
  it('reports a double booking, a blackout conflict and file drift, and deletes nothing', async () => {
    const t = pipelineSetup({ patch: { reconcileAutoFix: false } })
    const when = Date.UTC(2026, 9, 21, 13, 0, 0)
    await t.env.makePost({ whenMs: when, title: 'A' })
    await t.env.makePost({ whenMs: when, title: 'B' })
    t.drop('Trash Panda', 'trash-panda', 1)
    await t.settle()
    const piped = t.env.posts.list().find((p) => p.episodeRef)!
    writeFileSync(t.env.library.resolve(piped.videoPath), 'tampered')
    const day = new Date(piped.scheduledAtUtc!).toLocaleDateString('en-CA', {
      timeZone: 'America/New_York',
    })
    t.env.db
      .prepare('UPDATE channel_rules SET blackout_json = ? WHERE brand_id = 1')
      .run(JSON.stringify([day]))
    const before = (t.env.db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n
    const { r, notices } = make(t)
    const issues = await r.run()
    const kinds = [...new Set(issues.map((i) => i.kind))]
    expect(kinds).toEqual(expect.arrayContaining(['double_booking', 'file_drift', 'invalid_slot']))
    expect((t.env.db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n).toBe(
      before,
    )
    // Told once; a second run does not repeat it.
    const told = notices.length
    expect(told).toBeGreaterThan(0)
    await r.run()
    expect(notices.length).toBe(told)
    // Fixing the cause clears the issue.
    t.env.db.prepare("UPDATE channel_rules SET blackout_json = '[]' WHERE brand_id = 1").run()
    expect((await r.run()).some((i) => i.kind === 'invalid_slot')).toBe(false)
  })

  it('flags a waiting drop older than 7 days', async () => {
    const t = pipelineSetup({ patch: { inboxAutoScheduleBrandIds: [] } })
    t.drop('Trash Panda', 'trash-panda', 2)
    await t.settle()
    t.env.db.prepare('UPDATE posts SET created_at = ?').run(new Date(t.env.clock.ms).toISOString())
    const { r } = make(t)
    expect((await r.run()).some((i) => i.kind === 'waiting_too_long')).toBe(false)
    t.env.clock.ms += 8 * 86_400_000
    expect((await r.run()).some((i) => i.kind === 'waiting_too_long')).toBe(true)
  })

  it('alerts once when a channel drops under N days, and never for a paused channel', async () => {
    const t = pipelineSetup({
      patch: { lowQueueDays: 3 },
      live: [
        [1, 'youtube'],
        [2, 'youtube'],
      ],
    })
    const { r, notices } = make(t)
    let issues = await r.run()
    expect(
      issues
        .filter((i) => i.kind === 'low_queue')
        .map((i) => i.brandId)
        .sort(),
    ).toEqual([1, 2])
    await r.run()
    expect(notices.filter((n) => n[0] === 'low_queue')).toHaveLength(2)
    t.env.settings.set({ pausedBrandIds: [2] })
    issues = await r.run()
    expect(issues.filter((i) => i.kind === 'low_queue').map((i) => i.brandId)).toEqual([1])
  })

  it('auto fix moves the later bot post out of a taken slot, and only when switched on', async () => {
    const t = pipelineSetup()
    t.drop('Trash Panda', 'trash-panda', 3)
    await t.settle()
    const first = t.env.posts.list()[0]
    t.drop('Trash Panda', 'trash-panda', 4)
    await t.settle()
    const second = t.env.posts.list().find((p) => p.id !== first.id)!
    t.env.db
      .prepare('UPDATE posts SET scheduled_at_utc = ? WHERE id = ?')
      .run(first.scheduledAtUtc, second.id)
    const { r } = make(t)
    expect((await r.run()).some((i) => i.kind === 'double_booking')).toBe(true)
    t.env.settings.set({ reconcileAutoFix: true })
    const open = await r.run()
    expect(open.some((i) => i.kind === 'double_booking')).toBe(false)
    expect(t.env.posts.get(second.id)!.scheduledAtUtc).not.toBe(first.scheduledAtUtc)
  })

  it('ignores posts whose time has passed, such as a partly posted one', async () => {
    const t = pipelineSetup()
    await t.env.makePost({ whenMs: t.env.clock.ms - 3 * 86_400_000, title: 'Old partial' })
    await t.env.makePost({ whenMs: t.env.clock.ms - 3 * 86_400_000, title: 'Old partial 2' })
    t.env.db.prepare("UPDATE posts SET status = 'partial'").run()
    t.env.db.prepare('UPDATE channel_rules SET blackout_json = ? WHERE brand_id = 1').run(
      JSON.stringify([
        new Date(t.env.clock.ms - 3 * 86_400_000).toLocaleDateString('en-CA', {
          timeZone: 'America/New_York',
        }),
      ]),
    )
    const { r } = make(t)
    const kinds = (await r.run()).map((i) => i.kind)
    expect(kinds).not.toContain('double_booking')
    expect(kinds).not.toContain('invalid_slot')
  })

  it('Dismiss and Clear all hide messages until the problem goes away and comes back', async () => {
    const t = pipelineSetup({
      live: [
        [1, 'youtube'],
        [2, 'youtube'],
      ],
    })
    const { r } = make(t)
    let open = await r.run()
    expect(open.length).toBeGreaterThan(1) // low queue for the two live channels
    r.dismiss(open[0].id)
    expect((await r.run()).length).toBe(open.length - 1) // still the same problem, stays hidden
    expect(r.dismissAll()).toBe(open.length - 1)
    expect(await r.run()).toEqual([])
    expect(r.open()).toEqual([])
    // the problem goes away (a post fills the queue for 5 days) and the issue is resolved
    const day = 86_400_000
    for (let i = 1; i <= 5; i++)
      await t.env.makePost({ brandId: 1, whenMs: t.env.clock.ms + i * day, title: `Fill ${i}` })
    expect((await r.run()).some((i) => i.brandId === 1 && i.kind === 'low_queue')).toBe(false)
    // and when it happens again it shows again
    t.env.db.prepare("UPDATE posts SET status = 'canceled'").run()
    open = await r.run()
    expect(open.some((i) => i.brandId === 1 && i.kind === 'low_queue')).toBe(true)
  })
})
