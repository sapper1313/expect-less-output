import { describe, expect, it } from 'vitest'
import { GapWarner, openSlotsFor } from '../src/main/pipeline/gaps'
import { InboxService } from '../src/main/pipeline/inboxService'
import { Reconciler } from '../src/main/pipeline/reconcile'
import { pipelineSetup } from './pipelineHelpers'

const TP = 'Trash Panda'
const probeOk = async () => ({ width: 1080, height: 1920, durationSeconds: 40, hasAudio: true })
const window = (t: ReturnType<typeof pipelineSetup>, days = 7) =>
  [
    new Date(t.env.clock.ms).toISOString(),
    new Date(t.env.clock.ms + days * 86_400_000).toISOString(),
  ] as const

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
    brands: t.env.brands,
    freshStart: {} as never,
    openPath: async () => {},
    emit: () => {},
  })
}

async function waitingRig(n = 3) {
  const t = pipelineSetup({
    probe: probeOk,
    patch: { inboxAutoScheduleBrandIds: [] },
    live: [[1, 'youtube']],
  })
  for (let i = 1; i <= n; i++) {
    t.drop(TP, 'trash-panda', 400 + i)
    t.env.clock.ms += 1000
  }
  await t.settle()
  return t
}

describe('fill a slot from the Calendar', () => {
  it('puts a chosen waiting video into the exact open slot that was clicked', async () => {
    const t = await waitingRig(2)
    const s = service(t)
    const [from, to] = window(t)
    const slots = openSlotsFor(
      { db: t.env.db, brands: t.env.brands, posts: t.env.posts },
      from,
      to,
      1,
    )
    expect(slots.every((x) => x.waiting === 2)).toBe(true)
    const third = slots[2]
    const post = s.waiting()[1]
    const r = await s.pickSlot(post.postId, third.whenUtc)
    expect(r).toMatchObject({ ok: true, scheduledAtUtc: third.whenUtc })
    const after = openSlotsFor(
      { db: t.env.db, brands: t.env.brands, posts: t.env.posts },
      from,
      to,
      1,
    )
    expect(after.map((x) => x.whenUtc)).not.toContain(third.whenUtc)
    expect(after[0].waiting).toBe(1)
  })
})

describe('fill all, and undo', () => {
  it('assigns the oldest waiting videos to the open slots in order, skips paused channels, and undo frees the slots', async () => {
    const t = await waitingRig(3)
    const s = service(t)
    const [from, to] = window(t, 10)
    const res = await s.fillAll(from, to)
    expect(res.filled.map((f) => f.title)).toEqual([
      'Title trash-panda-2026-0401',
      'Title trash-panda-2026-0402',
      'Title trash-panda-2026-0403',
    ])
    const times = res.filled.map((f) => f.whenUtc)
    expect([...times].sort()).toEqual(times)
    expect(new Set(times).size).toBe(3)
    expect(res.leftWaiting).toBe(0)
    expect(t.env.posts.list().every((p) => p.status === 'scheduled')).toBe(true)
    const freed = s.unschedule(res.filled.map((f) => f.postId))
    expect(freed).toBe(3)
    expect(t.env.posts.list().every((p) => p.status === 'draft' && p.scheduledAtUtc === null)).toBe(
      true,
    )
    expect(t.drops.list()[0].scheduledSlot).toBeNull()
    // fill again after the undo lands on the same first slot
    const again = await s.fillAll(from, to)
    expect(again.filled[0].whenUtc).toBe(times[0])
  })

  it('leaves a paused channel alone and reports videos that did not fit', async () => {
    const t = await waitingRig(3)
    const s = service(t)
    const [from] = window(t)
    const oneDay = new Date(t.env.clock.ms + 1 * 86_400_000).toISOString()
    const few = await s.fillAll(from, oneDay)
    expect(few.filled.length).toBeLessThan(3)
    expect(few.leftWaiting).toBe(3 - few.filled.length)
    t.env.settings.set({ pausedBrandIds: [1] })
    const paused = await s.fillAll(from, new Date(t.env.clock.ms + 10 * 86_400_000).toISOString())
    expect(paused.filled).toHaveLength(0)
    expect(paused.skipped[0].reason).toMatch(/paused/)
  })
})

describe('gap warnings', () => {
  const setup = () => {
    const t = pipelineSetup({
      probe: probeOk,
      live: [
        [1, 'youtube'],
        [2, 'youtube'],
      ],
    })
    const sent: string[] = []
    const w = new GapWarner({
      db: t.env.db,
      brands: t.env.brands,
      posts: t.env.posts,
      settings: t.env.settings,
      send: async (x) => void sent.push(x),
      now: () => t.env.clock.ms,
    })
    return { t, w, sent }
  }

  it('lists empty slots from now to the end of tomorrow for running channels, with clips marked', async () => {
    const { t, w } = setup()
    t.env.db
      .prepare('INSERT OR REPLACE INTO studio_brands (brand_id, config_json) VALUES (1, ?)')
      .run(JSON.stringify({ clipPostDays: [1, 2, 3, 4, 5, 6, 7], clipTime: '12:00' }))
    const text = w.message()!
    expect(text).toMatch(/^Empty slots coming up:/)
    expect(text).toContain('Trash Panda')
    expect(text).toContain('Clock Out Early')
    expect(text).toMatch(/Trash Panda 12:00pm \(clip\)/)
    expect(text).toMatch(/Tomorrow, \w{3} \d+\/\d+:/)
    t.env.settings.set({ pausedBrandIds: [1, 2, 3, 4, 5] })
    expect(w.message()).toBeNull()
  })

  it('leaves clip slots out while the AI Studio is off, but keeps episode slots', async () => {
    const { t } = setup()
    t.env.db
      .prepare('INSERT OR REPLACE INTO studio_brands (brand_id, config_json) VALUES (1, ?)')
      .run(JSON.stringify({ clipPostDays: [1, 2, 3, 4, 5, 6, 7], clipTime: '12:00' }))
    const make = (on: boolean) =>
      new GapWarner({
        db: t.env.db,
        brands: t.env.brands,
        posts: t.env.posts,
        settings: t.env.settings,
        send: async () => {},
        clipsOn: () => on,
        now: () => t.env.clock.ms,
      })
    expect(make(true).message()).toMatch(/\(clip\)/)
    const off = make(false).message()!
    expect(off).toContain('Trash Panda')
    expect(off).not.toMatch(/\(clip\)/)
  })

  it('sends once a day, after the set time, and only when something is empty', async () => {
    const { t, w, sent } = setup()
    t.env.settings.set({ gapWarnTime: '18:00' })
    expect(await w.check()).toBe(false) // it is 10 AM
    t.env.clock.ms += 9 * 3_600_000 // 7 PM
    expect(await w.check()).toBe(true)
    expect(await w.check()).toBe(false) // already sent today
    expect(sent).toHaveLength(1)
    t.env.clock.ms += 86_400_000
    t.env.settings.set({ gapWarnEnabled: false })
    expect(await w.check()).toBe(false)
  })
})
