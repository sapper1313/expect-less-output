import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import type { PlatformSlot } from '../src/shared/types'

const MON = Date.UTC(2026, 10, 9, 14, 0, 0) // Monday 9 Nov 2026, 9 AM Eastern
const H = (h: number, m = 0) => Date.UTC(2026, 10, 10, h, m, 0) // Tue 10 Nov 2026 in UTC
const iso = (ms: number) => new Date(ms).toISOString()
const MIN = 60_000

const slot = (platform: PlatformSlot['platform'], dayType: PlatformSlot['dayType'], timeLocal: string, kind: PlatformSlot['kind'] = 'short'): PlatformSlot => ({
  platform, kind, dayType, timeLocal, enabled: true,
})

/** Channel 1 with: YouTube 7:30 PM, TikTok 8:00 PM, Instagram 6 PM and 9 PM on weekdays; TikTok 12 PM on weekends. */
function rig() {
  const env = makeEnv(MON)
  env.db.prepare("UPDATE channel_rules SET max_per_day = 0").run()
  env.db.prepare("INSERT OR REPLACE INTO channel_rules (brand_id, max_per_day, blackout_json) VALUES (1, 0, '[]')").run()
  env.brands.setPlatformSlots(1, [
    slot('youtube', 'weekday', '19:30'),
    slot('tiktok', 'weekday', '20:00'),
    slot('instagram', 'weekday', '18:00'),
    slot('instagram', 'weekday', '21:00'),
    slot('tiktok', 'weekend', '12:00'),
  ])
  return env
}

describe('per platform posting times', () => {
  it('seeds every platform of a channel from its old list and keeps the combined list', () => {
    const env = makeEnv(MON)
    const rows = env.brands.getPlatformSlots(1)
    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows.map((r) => r.platform)).size).toBeGreaterThan(1)
  })

  it('rebuilds the combined list as the earliest time of each position across platforms', () => {
    const env = rig()
    const combined = env.brands.getSlots(1).filter((s) => s.dayType === 'weekday' && s.kind === 'short').map((s) => s.timeLocal).sort()
    expect(combined).toEqual(['18:00', '21:00'])
  })

  it('gives each platform its own next open time and a taken time blocks only that platform', async () => {
    const env = rig()
    const plan = env.posts.slotPlans(1, 1, 'short', ['youtube', 'tiktok', 'instagram'])[0]!
    // Monday 9 AM now: the first YouTube slot is Monday 7:30 PM Eastern = Tuesday 00:30 UTC
    expect(plan.youtube).toBe(iso(H(0, 30)))
    expect(plan.tiktok).toBe(iso(H(1, 0)))
    expect(plan.instagram).toBe(iso(H(23, 0) - 24 * 3_600_000))
    // book YouTube's slot with a post: YouTube moves on, TikTok does not
    await env.makePost({ brandId: 1, whenMs: H(0, 30), platforms: ['youtube'] })
    expect(env.posts.nextSlotsFor(1, 'youtube', 1, undefined, [], 'short')[0]).not.toBe(iso(H(0, 30)))
    expect(env.posts.nextSlotsFor(1, 'tiktok', 1, undefined, [], 'short')[0]).toBe(iso(H(1, 0)))
  })

  it('plans several videos at once, one slot for each platform per video', () => {
    const env = rig()
    const plans = env.posts.slotPlans(1, 3, 'short', ['youtube', 'instagram'])
    expect(plans).toHaveLength(3)
    expect(new Set(plans.map((p) => p.youtube)).size).toBe(3)
    expect(new Set(plans.map((p) => p.instagram)).size).toBe(3)
  })

  it('never lets another channel block a time (no minimum gap)', async () => {
    const env = rig()
    await env.makePost({ brandId: 2, whenMs: H(0, 30), platforms: ['youtube'] })
    expect(env.posts.nextSlotsFor(1, 'youtube', 1, undefined, [], 'short')[0]).toBe(iso(H(0, 30)))
  })
})

describe('posts with a time for each platform', () => {
  it('keeps each platform on its own time and the post on the earliest', async () => {
    const env = makeEnv(MON)
    const post = await env.makePost({
      whenMs: H(0, 30),
      platforms: ['youtube', 'tiktok'],
      times: { youtube: H(0, 30), tiktok: H(1, 0) },
    })
    expect(post.scheduledAtUtc).toBe(iso(H(0, 30)))
    const by = Object.fromEntries(post.targets.map((t) => [t.platform, t.scheduledAtUtc]))
    expect(by).toEqual({ youtube: iso(H(0, 30)), tiktok: iso(H(1, 0)) })
  })

  it('posts each platform at its own time', async () => {
    const env = makeEnv(H(0, 0) - 5 * MIN)
    const post = await env.makePost({
      whenMs: H(0, 10),
      platforms: ['instagram', 'tiktok'],
      times: { instagram: H(0, 10), tiktok: H(0, 40) },
    })
    env.clock.ms = H(0, 15)
    await env.scheduler.tick()
    let t = Object.fromEntries(env.posts.get(post.id)!.targets.map((x) => [x.platform, x.status]))
    expect(t).toEqual({ instagram: 'posted', tiktok: 'pending' })
    env.clock.ms = H(0, 45)
    await env.scheduler.tick()
    t = Object.fromEntries(env.posts.get(post.id)!.targets.map((x) => [x.platform, x.status]))
    expect(t).toEqual({ instagram: 'posted', tiktok: 'posted' })
  })

  it('changes one platform alone, takes any time, and moves everything back with one time', async () => {
    const env = makeEnv(MON)
    const post = await env.makePost({ whenMs: H(0, 30), platforms: ['instagram', 'tiktok'], times: { instagram: H(0, 30), tiktok: H(1, 0) } })
    // any time at all, off every slot
    const odd = iso(H(3, 17))
    const a = env.posts.update(post.id, { targets: post.targets.map((t) => ({ platform: t.platform, aiFlag: false, scheduledAtUtc: t.platform === 'tiktok' ? odd : t.scheduledAtUtc })) })
    expect(a.targets.find((t) => t.platform === 'tiktok')!.scheduledAtUtc).toBe(odd)
    expect(a.targets.find((t) => t.platform === 'instagram')!.scheduledAtUtc).toBe(iso(H(0, 30)))
    expect(a.scheduledAtUtc).toBe(iso(H(0, 30)))
    // an earlier time for TikTok moves the post's own time, Instagram stays put
    const earlier = iso(H(0, 5))
    const b = env.posts.update(post.id, { targets: a.targets.map((t) => ({ platform: t.platform, aiFlag: false, scheduledAtUtc: t.platform === 'tiktok' ? earlier : t.scheduledAtUtc })) })
    expect(b.scheduledAtUtc).toBe(earlier)
    expect(b.targets.find((t) => t.platform === 'instagram')!.scheduledAtUtc).toBe(iso(H(0, 30)))
    // moving the whole post puts every platform on one time
    const c = env.posts.update(post.id, { scheduledAtUtc: iso(H(5, 0)) })
    expect(new Set(c.targets.map((t) => t.scheduledAtUtc))).toEqual(new Set([iso(H(5, 0))]))
  })

  it('a save that sends the same times back changes nothing, and unscheduling clears every platform time', async () => {
    const env = makeEnv(MON)
    const post = await env.makePost({ whenMs: H(0, 30), platforms: ['instagram', 'tiktok'], times: { instagram: H(0, 30), tiktok: H(1, 0) } })
    const same = env.posts.update(post.id, { scheduledAtUtc: post.scheduledAtUtc, targets: post.targets.map((t) => ({ platform: t.platform, aiFlag: false, scheduledAtUtc: t.scheduledAtUtc })) })
    expect(same.targets.map((t) => t.scheduledAtUtc)).toEqual(post.targets.map((t) => t.scheduledAtUtc))
    const off = env.posts.update(post.id, { status: 'draft', scheduledAtUtc: null })
    expect(off.scheduledAtUtc).toBeNull()
    expect(off.targets.every((t) => t.scheduledAtUtc === null)).toBe(true)
  })

  it('swapping two posts keeps each platform its distance from the post time', async () => {
    const env = makeEnv(MON)
    const a = await env.makePost({ whenMs: H(0, 30), platforms: ['instagram', 'tiktok'], times: { instagram: H(0, 30), tiktok: H(1, 0) } })
    const b = await env.makePost({ whenMs: H(5, 0), platforms: ['instagram', 'tiktok'], times: { instagram: H(5, 0), tiktok: H(5, 30) } })
    env.posts.swapTimes(a.id, b.id)
    const na = env.posts.get(a.id)!
    expect(na.scheduledAtUtc).toBe(iso(H(5, 0)))
    expect(na.targets.find((t) => t.platform === 'tiktok')!.scheduledAtUtc).toBe(iso(H(5, 30)))
  })
})

import { pipelineSetup } from './pipelineHelpers'

describe('a dropped video takes each platform its own time', () => {
  it('schedules every platform at its own next open time', async () => {
    const t = pipelineSetup({
      probe: async () => ({ width: 1080, height: 1920, durationSeconds: 40, hasAudio: true }),
      patch: { inboxAutoScheduleBrandIds: [] },
      live: [[1, 'youtube'], [1, 'tiktok'], [1, 'instagram']],
    })
    t.env.db.prepare("INSERT OR REPLACE INTO channel_rules (brand_id, max_per_day, blackout_json) VALUES (1, 0, '[]')").run()
    t.env.brands.setPlatformSlots(1, [
      slot('youtube', 'weekday', '19:00'),
      slot('tiktok', 'weekday', '20:30'),
      slot('instagram', 'weekday', '18:00'),
    ])
    t.drop('Trash Panda', 'trash-panda', 901, { platforms: ['youtube', 'tiktok', 'instagram'] })
    await t.settle()
    const post = t.env.posts.list()[0]!
    const r = await t.pipeline.scheduleDrop(post.id)
    expect(r.ok).toBe(true)
    const after = t.env.posts.get(post.id)!
    const by = Object.fromEntries(after.targets.map((x) => [x.platform, x.scheduledAtUtc!.slice(11, 16)]))
    // Monday Oct 19 2026 9:00 AM Eastern now (EDT): 18:00 = 22:00Z, 19:00 = 23:00Z, 20:30 = 00:30Z next day
    expect(by).toEqual({ instagram: '22:00', youtube: '23:00', tiktok: '00:30' })
    expect(after.scheduledAtUtc!.slice(11, 16)).toBe('22:00')
    expect(after.status).toBe('scheduled')
  })
})

describe('canceled posts and their slots', () => {
  it('a canceled post frees its slot, unless a platform already posted there', async () => {
    const env = rig()
    const post = await env.makePost({ brandId: 1, whenMs: H(0, 30), platforms: ['youtube', 'tiktok'], times: { youtube: H(0, 30), tiktok: H(1, 0) } })
    expect(env.posts.nextSlotsFor(1, 'youtube', 1, undefined, [], 'short')[0]).not.toBe(iso(H(0, 30)))
    env.posts.cancel([post.id])
    expect(env.posts.nextSlotsFor(1, 'youtube', 1, undefined, [], 'short')[0]).toBe(iso(H(0, 30)))
    // YouTube already posted before the post was canceled: that time stays used
    const live = await env.makePost({ brandId: 1, whenMs: H(0, 30), platforms: ['youtube'], times: { youtube: H(0, 30) } })
    env.db.prepare("UPDATE post_targets SET status = 'posted' WHERE post_id = ?").run(live.id)
    env.posts.cancel([live.id])
    expect(env.posts.nextSlotsFor(1, 'youtube', 1, undefined, [], 'short')[0]).not.toBe(iso(H(0, 30)))
  })
})

describe('one video, one day', () => {
  // Tue 10 Nov 2026 Eastern: Facebook 4 PM and Instagram 6 PM on weekdays; YouTube 7 PM. Booking Tuesday's YouTube
  // slot with an earlier post is what used to push the next video's YouTube to Wednesday and leave the rest on Tuesday.
  function rigDays() {
    const env = makeEnv(MON)
    env.db.prepare("INSERT OR REPLACE INTO channel_rules (brand_id, max_per_day, blackout_json) VALUES (1, 0, '[]')").run()
    env.brands.setPlatformSlots(1, [
      slot('facebook', 'weekday', '16:00'),
      slot('instagram', 'weekday', '18:00'),
      slot('youtube', 'weekday', '19:00'),
    ])
    return env
  }
  const dayOf = (isoStr: string) => new Date(isoStr).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  it('puts every platform of a video on the same Eastern day', () => {
    const env = rigDays()
    for (const plan of env.posts.slotPlans(1, 4, 'short', ['facebook', 'instagram', 'youtube'])) {
      expect(new Set(Object.values(plan).map((t) => dayOf(t!))).size).toBe(1)
    }
  })

  it('keeps each platform on its own time of day', () => {
    const env = rigDays()
    const plan = env.posts.slotPlans(1, 1, 'short', ['facebook', 'instagram', 'youtube'])[0]!
    const hm = (t: string) => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })
    expect([hm(plan.facebook!), hm(plan.instagram!), hm(plan.youtube!)]).toEqual(['16:00', '18:00', '19:00'])
  })

  it('moves a whole video to the next day when one platform is full that day, instead of splitting it', async () => {
    const env = rigDays()
    const first = env.posts.slotPlans(1, 1, 'short', ['facebook', 'instagram', 'youtube'])[0]!
    // an earlier post already holds that day's YouTube slot only
    await env.makePost({ brandId: 1, whenMs: Date.parse(first.youtube!), platforms: ['youtube'] })
    const plan = env.posts.slotPlans(1, 1, 'short', ['facebook', 'instagram', 'youtube'])[0]!
    expect(new Set(Object.values(plan).map((t) => dayOf(t!))).size).toBe(1)
    expect(dayOf(plan.youtube!) > dayOf(first.youtube!)).toBe(true)
    // the slots it skipped stay open for anything that can use them
    expect(env.posts.nextSlotsFor(1, 'facebook', 1, undefined, [], 'short')[0]).toBe(first.facebook)
  })

  it('still places a platform whose days never meet the others', () => {
    const env = rigDays()
    env.brands.setPlatformSlots(1, [
      slot('facebook', 'weekday', '16:00'),
      slot('youtube', 'weekend', '12:00'),
    ])
    const plan = env.posts.slotPlans(1, 1, 'short', ['facebook', 'youtube'])[0]!
    expect(plan.facebook).toBeTruthy()
    expect(plan.youtube).toBeTruthy()
  })
})
