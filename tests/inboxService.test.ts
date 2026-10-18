import { writeFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { InboxService } from '../src/main/pipeline/inboxService'
import { Reconciler } from '../src/main/pipeline/reconcile'
import { pipelineSetup } from './pipelineHelpers'

function service(t: ReturnType<typeof pipelineSetup>) {
  const reconciler = new Reconciler({
    db: t.env.db,
    posts: t.env.posts,
    library: t.env.library,
    settings: t.env.settings,
    notify: () => {},
    now: () => t.env.clock.ms,
  })
  return new InboxService({
    db: t.env.db,
    posts: t.env.posts,
    library: t.env.library,
    settings: t.env.settings,
    intake: t.pipeline,
    drops: t.drops,
    audit: t.audit,
    reconciler,
    freshStart: {} as never,
    openPath: async () => {},
    emit: () => {},
  })
}

describe('Inbox view (test 10)', () => {
  it('lists exactly the waiting drops and the badge counts them with held ones', async () => {
    const t = pipelineSetup({ patch: { inboxAutoScheduleBrandIds: [] } })
    t.drop('Trash Panda', 'trash-panda', 1)
    t.drop('Trash Panda', 'trash-panda', 2, {}, { file: 'final-cut.mp4' }) // held: name lacks the id
    await t.settle()
    t.env.settings.set({ inboxAutoScheduleBrandIds: [1] })
    t.drop('Trash Panda', 'trash-panda', 3) // scheduled automatically, never waiting
    await t.settle()
    const s = service(t)
    expect(s.waiting().map((w) => w.episodeId)).toEqual(['trash-panda-2026-0001'])
    expect(s.held().map((w) => w.episodeId)).toEqual(['trash-panda-2026-0002'])
    expect(s.counts()).toMatchObject({ waiting: 1, held: 1 })
    expect(s.counts().badge).toBe(2 + s.counts().issues)
  })

  it('schedule, pick slot, hold, release, reject all work and are audited; nothing is deleted', async () => {
    const t = pipelineSetup({ patch: { inboxAutoScheduleBrandIds: [] } })
    for (const n of [1, 2, 3]) {
      t.drop('Trash Panda', 'trash-panda', n)
      t.env.clock.ms += 1000
    }
    await t.settle()
    const s = service(t)
    const [a, b, c] = s.waiting().map((w) => w.postId)
    expect((await s.schedule(a)).ok).toBe(true)
    const open = s.openSlots(b, 5)
    expect((await s.pickSlot(b, open[1])).scheduledAtUtc).toBe(open[1])
    expect((await s.pickSlot(c, '2031-01-01T00:00:00.000Z')).ok).toBe(false) // not an open slot
    s.hold(c, 'wait for Josh')
    expect(s.held().map((h) => h.postId)).toEqual([c])
    expect((await s.release(c, false)).ok).toBe(true)
    s.reject(c, 'bad ending')
    expect(t.env.posts.get(c)!.status).toBe('canceled')
    expect(t.drops.forPost(c)).toMatchObject({ result: 'rejected', reason: 'bad ending' })
    const actions = t.audit.list().map((e) => e.action)
    expect(actions).toEqual(
      expect.arrayContaining(['post.hold', 'post.release', 'drop.rejected', 'post.schedule']),
    )
    expect(t.env.library.resolve(t.env.posts.get(c)!.videoPath)).toBeTruthy()
  })

  it('a held swapped file stays held until the owner accepts it as it is', async () => {
    const t = pipelineSetup()
    t.drop('Trash Panda', 'trash-panda', 7)
    await t.settle()
    const s = service(t)
    const post = t.env.posts.list()[0]
    writeFileSync(t.env.library.resolve(post.videoPath), 'edited by someone')
    s.hold(post.id, 'check this')
    expect((await s.release(post.id, false)).ok).toBe(false)
    expect(t.env.posts.get(post.id)!.holdReason).toMatch(/changed after it was dropped/)
    expect((await s.release(post.id, true)).ok).toBe(true)
    expect(t.env.posts.get(post.id)!.holdReason).toBeNull()
  })

  it('channel rules validate and are audited', () => {
    const t = pipelineSetup()
    const s = service(t)
    expect(s.setChannelRules(1, { maxPerDay: 2, blackoutDates: ['2026-12-25'] })).toMatchObject({
      maxPerDay: 2,
      blackoutDates: ['2026-12-25'],
    })
    expect(() => s.setChannelRules(1, { maxPerDay: 99 })).toThrow(/whole number/)
    expect(() => s.setChannelRules(1, { blackoutDates: ['xmas'] })).toThrow(/YYYY-MM-DD/)
    expect(t.audit.list().some((e) => e.action === 'channel.rules')).toBe(true)
    expect(
      t.env.posts.nextSlots(1, 2, '2026-12-24T00:00:00Z').every((x) => !x.startsWith('2026-12-25')),
    ).toBe(true)
  })
})
