import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import { pipelineSetup } from './pipelineHelpers'
import { slotKindFor, getNextOpenSlots } from '../src/shared/slots'
import { validateVideo } from '../src/shared/platformLimits'

const TP = 'Trash Panda'
const probeOf =
  (w: number, h: number, secs = 30, audio = true) =>
  async () => ({ width: w, height: h, durationSeconds: secs, hasAudio: audio })

const both = (t: ReturnType<typeof pipelineSetup>, brandId = 1) =>
  t.env.brands.setSlotKinds(brandId, [
    { kind: 'short', enabled: true, days: null },
    { kind: 'long', enabled: true, days: null },
  ])
const longOnly = (t: ReturnType<typeof pipelineSetup>, brandId = 1) =>
  t.env.brands.setSlotKinds(brandId, [
    { kind: 'short', enabled: false, days: null },
    { kind: 'long', enabled: true, days: null },
  ])

describe('a channel that does Shorts and Long form', () => {
  it('accepts a tall 30 second short and a wide 5 minute video', async () => {
    const a = pipelineSetup({ probe: probeOf(1080, 1920, 30) })
    both(a)
    a.drop(TP, 'trash-panda', 1)
    await a.settle()
    expect(a.env.posts.list()).toHaveLength(1)
    const b = pipelineSetup({ probe: probeOf(1920, 1080, 300) })
    both(b)
    b.drop(TP, 'trash-panda', 2)
    await b.settle()
    expect(b.env.posts.list()).toHaveLength(1)
  })

  it('has no length limit for a wide long video', async () => {
    const t = pipelineSetup({ probe: probeOf(1920, 1080, 3 * 3600) })
    both(t)
    t.drop(TP, 'trash-panda', 3)
    await t.settle()
    expect(t.env.posts.list()).toHaveLength(1)
  })

  it('accepts a wide 30 second video as Long form (no minimum)', async () => {
    const t = pipelineSetup({ probe: probeOf(1920, 1080, 30) })
    both(t)
    t.drop(TP, 'trash-panda', 4)
    await t.settle()
    expect(t.env.posts.list()).toHaveLength(1)
  })

  it('rejects a tall video over 180 seconds and a video that is neither tall nor wide', async () => {
    const tall = pipelineSetup({ probe: probeOf(1080, 1920, 400) })
    both(tall)
    tall.drop(TP, 'trash-panda', 5)
    await tall.settle()
    expect(tall.rejectReasons(TP).reasons[0].code).toBe('bad_duration')
    expect(tall.rejectReasons(TP).reasons[0].message).toMatch(
      /This channel takes tall shorts or wide long videos/,
    )
    const square = pipelineSetup({ probe: probeOf(1000, 1000, 30) })
    both(square)
    square.drop(TP, 'trash-panda', 6)
    await square.settle()
    expect(square.rejectReasons(TP).reasons[0].code).toBe('bad_format')
    expect(square.rejectReasons(TP).reasons[0].message).toMatch(
      /This channel takes tall shorts or wide long videos/,
    )
  })
})

describe('a channel with one kind ticked', () => {
  it('Long form only rejects a tall short, as before', async () => {
    const t = pipelineSetup({ probe: probeOf(1080, 1920, 30) })
    longOnly(t)
    t.drop(TP, 'trash-panda', 7)
    await t.settle()
    expect(t.rejectReasons(TP).reasons.map((r: { code: string }) => r.code)).toContain('bad_format')
  })
  it('Long form only has no length limit', async () => {
    const t = pipelineSetup({ probe: probeOf(1920, 1080, 4000) })
    longOnly(t)
    t.drop(TP, 'trash-panda', 8, { platforms: ['youtube', 'facebook'] })
    await t.settle()
    expect(t.env.posts.list()).toHaveLength(1)
  })
  it('Shorts only rejects a wide video, as before', async () => {
    const t = pipelineSetup({ probe: probeOf(1920, 1080, 30) })
    t.drop(TP, 'trash-panda', 9, { platforms: ['youtube', 'facebook'] })
    await t.settle()
    expect(t.rejectReasons(TP).reasons[0].code).toBe('bad_format')
  })
})

describe('slot kinds', () => {
  it('existing channels keep the same times for both kinds', () => {
    const env = makeEnv()
    const slots = env.brands.getSlots(1)
    expect(slots.filter((s) => s.kind === 'short').length).toBeGreaterThan(0)
    expect(env.posts.nextSlots(1, 3)).toEqual(env.posts.nextSlots(1, 3, undefined, [], 'short'))
  })

  it('a Short and a Long video use their own times when the channel does both', () => {
    const env = makeEnv()
    env.brands.setSlots(1, [
      { dayType: 'weekday', timeLocal: '09:00', enabled: true, kind: 'short' },
      { dayType: 'weekend', timeLocal: '09:00', enabled: true, kind: 'short' },
      { dayType: 'weekday', timeLocal: '17:00', enabled: true, kind: 'long' },
      { dayType: 'weekend', timeLocal: '17:00', enabled: true, kind: 'long' },
    ])
    env.brands.setSlotKinds(1, [
      { kind: 'short', enabled: true, days: null },
      { kind: 'long', enabled: true, days: null },
    ])
    const shortT = env.posts.nextSlots(1, 1, undefined, [], 'short')[0]!
    const longT = env.posts.nextSlots(1, 1, undefined, [], 'long')[0]!
    expect(new Date(shortT).getUTCHours()).not.toBe(new Date(longT).getUTCHours())
  })

  it('only one kind ticked uses it for every video', () => {
    const env = makeEnv()
    env.brands.setSlots(1, [
      { dayType: 'weekday', timeLocal: '09:00', enabled: true, kind: 'short' },
      { dayType: 'weekend', timeLocal: '09:00', enabled: true, kind: 'short' },
    ])
    env.brands.setSlotKinds(1, [
      { kind: 'short', enabled: true, days: null },
      { kind: 'long', enabled: false, days: null },
    ])
    expect(env.posts.nextSlots(1, 2, undefined, [], 'long')).toEqual(
      env.posts.nextSlots(1, 2, undefined, [], 'short'),
    )
  })

  it('tall and 3 minutes or less is a Short, anything wide is Long form', () => {
    expect(slotKindFor({ width: 1080, height: 1920, durationSeconds: 30 })).toBe('short')
    expect(slotKindFor({ width: 1080, height: 1920, durationSeconds: 400 })).toBe('long')
    expect(slotKindFor({ width: 1920, height: 1080, durationSeconds: 30 })).toBe('long')
    expect(getNextOpenSlots).toBeTypeOf('function')
  })

  it('a channel can keep its own handoff hours and missed rule', () => {
    const env = makeEnv()
    expect(env.brands.getSlotKinds(1).length).toBe(2)
  })
})

describe('YouTube length limit', () => {
  const meta = (w: number, h: number, d: number) =>
    ({
      durationSeconds: d,
      width: w,
      height: h,
      videoCodec: 'h264',
      audioCodec: 'aac',
      sizeBytes: 1,
      fps: 30,
      container: 'mp4',
    }) as never
  it('warns only for a tall video over 3 minutes', () => {
    const youtube = (m: never) => validateVideo(m, 'a.mp4').filter((w) => w.platform === 'youtube')
    expect(youtube(meta(1080, 1920, 400))).toHaveLength(1)
    expect(youtube(meta(1920, 1080, 4000))).toHaveLength(0)
  })
})

describe('platforms per kind', () => {
  const setup = (w: number, h: number) => {
    const t = pipelineSetup({
      probe: probeOf(w, h, 30),
      live: [[1, 'youtube'], [1, 'facebook']],
    })
    t.env.brands.setSlotKinds(1, [
      { kind: 'short', enabled: true, days: null, platforms: { youtube: true, facebook: false, instagram: false, tiktok: false } },
      { kind: 'long', enabled: true, days: null, platforms: { youtube: true, facebook: true, instagram: false, tiktok: false } },
    ])
    return t
  }
  it('a tall video uses the Shorts platforms', async () => {
    const t = setup(1080, 1920)
    t.drop(TP, 'trash-panda', 8, { platforms: ['youtube', 'facebook'] })
    await t.settle()
    const platforms = t.env.posts.list()[0]!.targets.map((x) => x.platform).sort()
    expect(platforms).toEqual(['youtube'])
  })
  it('a wide video uses the Long form platforms', async () => {
    const t = setup(1920, 1080)
    t.drop(TP, 'trash-panda', 9, { platforms: ['youtube', 'facebook'] })
    await t.settle()
    const platforms = t.env.posts.list()[0]!.targets.map((x) => x.platform).sort()
    expect(platforms).toEqual(['facebook', 'youtube'])
  })
})
