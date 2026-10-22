import { describe, expect, it } from 'vitest'
import { addEpisodeLink } from '../src/main/pipeline/clipLink'
import { Reconciler } from '../src/main/pipeline/reconcile'
import { handleAgentRequest } from '../src/main/agent/server'
import type { AgentServices } from '../src/main/agent/core'
import { pipelineSetup } from './pipelineHelpers'

const TP = 'Trash Panda'
const probeOf =
  (w: number, h: number, secs: number, audio = true) =>
  async () => ({
    width: w,
    height: h,
    durationSeconds: secs,
    hasAudio: audio,
  })
const setCfg = (t: ReturnType<typeof pipelineSetup>, cfg: Record<string, unknown>) =>
  t.env.db
    .prepare('INSERT OR REPLACE INTO studio_brands (brand_id, config_json) VALUES (1, ?)')
    .run(JSON.stringify(cfg))
const et = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
  })

describe('clips: tagging and validation', () => {
  it('a sidecar without post_type is an episode, exactly as before', async () => {
    const t = pipelineSetup({ probe: probeOf(1080, 1920, 30) })
    t.drop(TP, 'trash-panda', 101)
    await t.settle()
    const p = t.env.posts.list()[0]
    expect(p).toMatchObject({ postType: 'episode', sourceEpisodeRef: null, status: 'scheduled' })
    expect(t.drops.list()[0].postType).toBe('episode')
  })

  it('a clip must be 9:16 and 5 to 90 seconds, even on a show whose episodes are wide', async () => {
    const wide = pipelineSetup({ probe: probeOf(1920, 1080, 30) })
    setCfg(wide, { format: 'long', clipPostDays: [2] })
    wide.drop(TP, 'trash-panda', 102, { post_type: 'clip', platforms: ['youtube'] })
    await wide.settle()
    expect(wide.rejectReasons(TP).reasons[0].code).toBe('bad_format')
    const long = pipelineSetup({ probe: probeOf(1080, 1920, 120) })
    long.drop(TP, 'trash-panda', 103, { post_type: 'clip', platforms: ['youtube'] })
    await long.settle()
    expect(long.rejectReasons(TP).reasons[0].code).toBe('bad_duration')
    const short = pipelineSetup({ probe: probeOf(1080, 1920, 3) })
    short.drop(TP, 'trash-panda', 104, { post_type: 'clip', platforms: ['youtube'] })
    await short.settle()
    expect(short.rejectReasons(TP).reasons[0].code).toBe('bad_duration')
    // an episode on the same wide show still follows the show's own rule
    const ep = pipelineSetup({ probe: probeOf(1920, 1080, 420) })
    setCfg(ep, { format: 'long' })
    ep.drop(TP, 'trash-panda', 105, {})
    await ep.settle()
    expect(ep.env.posts.list()).toHaveLength(1)
  })

  it('accepts a clip id with -c1, rejects it on an episode', async () => {
    const t = pipelineSetup({ probe: probeOf(1080, 1920, 40) })
    setCfg(t, { clipPostDays: [2, 4] })
    t.drop(
      TP,
      'trash-panda',
      106,
      { post_type: 'clip', episode_id: 'trash-panda-2026-0101-c1', platforms: ['youtube'] },
      { file: 'trash-panda-2026-0101-c1.mp4' },
    )
    await t.settle()
    expect(t.env.posts.list()[0]).toMatchObject({
      postType: 'clip',
      episodeRef: 'trash-panda-2026-0101-c1',
    })
    const bad = pipelineSetup({ probe: probeOf(1080, 1920, 40) })
    bad.drop(
      TP,
      'trash-panda',
      107,
      { episode_id: 'trash-panda-2026-0101-c1' },
      { file: 'trash-panda-2026-0101-c1.mp4' },
    )
    await bad.settle()
    expect(bad.rejectReasons(TP).reasons[0].code).toBe('bad_episode_id')
  })
})

describe('clips: their own schedule', () => {
  it('uses the clip days and time, never moves or uses an episode slot, and does not count against the episode cap', async () => {
    const t = pipelineSetup({ probe: probeOf(1080, 1920, 40) })
    setCfg(t, { clipPostDays: [2, 4], clipTime: '12:00' })
    const before = t.env.posts.nextSlots(1, 3)
    t.drop(TP, 'trash-panda', 110, { post_type: 'clip', platforms: ['youtube'] })
    t.env.clock.ms += 1000
    t.drop(TP, 'trash-panda', 111, { post_type: 'clip', platforms: ['youtube'] })
    await t.settle()
    await t.settle()
    const clips = t.env.posts.list().filter((p) => p.postType === 'clip')
    expect(clips.map((c) => et(c.scheduledAtUtc!))).toEqual([
      'Tue, 10/20, 12 PM',
      'Thu, 10/22, 12 PM',
    ])
    expect(t.env.posts.nextSlots(1, 3)).toEqual(before)
    expect(t.env.posts.countOnDay(1, clips[0].scheduledAtUtc!)).toBe(0)
    // an episode still gets its normal first slot, even on a clip day
    t.drop(TP, 'trash-panda', 112, {})
    await t.settle()
    const ep = t.env.posts.list().find((p) => p.postType === 'episode')!
    expect(ep.scheduledAtUtc).toBe(before[0])
  })

  it('waits when no clip days are set, and is not flagged as a double booking next to an episode', async () => {
    const t = pipelineSetup({ probe: probeOf(1080, 1920, 40) })
    t.drop(TP, 'trash-panda', 113, { post_type: 'clip', platforms: ['youtube'] })
    await t.settle()
    const p = t.env.posts.list()[0]
    expect(p.status).toBe('draft')
    expect(t.pipeline.waitingReason(1, ['youtube'], 'clip')).toMatch(/No clip days/)
    setCfg(t, { clipPostDays: [2] })
    const r = await t.pipeline.scheduleDrop(p.id)
    expect(r.ok).toBe(true)
    // put an episode at the very same minute
    t.env.db
      .prepare("UPDATE posts SET status = 'scheduled', scheduled_at_utc = ? WHERE id = ?")
      .run(p.scheduledAtUtc, p.id)
    await t.env.makePost({
      whenMs: new Date(p.scheduledAtUtc!).getTime(),
      title: 'Episode at the same minute',
    })
    const rec = new Reconciler({
      db: t.env.db,
      posts: t.env.posts,
      library: t.env.library,
      settings: t.env.settings,
      notify: () => {},
      now: () => t.env.clock.ms,
    })
    expect((await rec.run()).some((i) => i.kind === 'double_booking')).toBe(false)
  })
})

describe('clips: platforms', () => {
  it('go to the platforms the show has on for clips, as Shorts on YouTube, and episodes keep their own platforms', async () => {
    const t = pipelineSetup({
      probe: probeOf(1080, 1920, 40),
      live: (['youtube', 'facebook', 'instagram', 'tiktok'] as const).map(
        (p) => [1, p] as [number, string],
      ),
    })
    t.env.db
      .prepare("UPDATE accounts SET mode = 'drafts' WHERE brand_id = 1 AND platform = 'tiktok'")
      .run()
    setCfg(t, {
      clipPostDays: [2],
      platforms: { youtube: true, facebook: false, instagram: false, tiktok: false },
      clipPlatforms: { youtube: true, facebook: true, instagram: true, tiktok: false },
    })
    t.drop(TP, 'trash-panda', 120, { post_type: 'clip', platforms: undefined })
    t.drop(TP, 'trash-panda', 121, { platforms: ['youtube', 'instagram'] })
    await t.settle()
    const clip = t.env.posts.list().find((p) => p.postType === 'clip')!
    expect(clip.targets.map((x) => x.platform).sort()).toEqual(['facebook', 'instagram', 'youtube'])
    expect(clip.targets.find((x) => x.platform === 'youtube')!.settings.shorts).toBe(true)
    const ep = t.env.posts.list().find((p) => p.postType === 'episode')!
    expect(ep.targets.map((x) => x.platform)).toEqual(['youtube'])
    expect(ep.targets[0].settings.shorts).toBeUndefined()
  })
})

describe('clips: link to the full episode', () => {
  it('adds "Full episode on YouTube" once the source episode is live, and only once', async () => {
    const t = pipelineSetup({ probe: probeOf(1080, 1920, 40) })
    setCfg(t, { clipPostDays: [2] })
    t.drop(
      TP,
      'trash-panda',
      130,
      {
        post_type: 'clip',
        episode_id: 'trash-panda-2026-0101-c1',
        source_episode_id: 'trash-panda-2026-0101',
        platforms: ['youtube'],
      },
      { file: 'trash-panda-2026-0101-c1.mp4' },
    )
    await t.settle()
    const clip = t.env.posts.list()[0]
    expect(clip.sourceEpisodeRef).toBe('trash-panda-2026-0101')
    expect(addEpisodeLink(t.env.db, clip.id)).toBe(false) // not live yet
    const ep = await t.env.makePost({
      whenMs: t.env.clock.ms - 3_600_000,
      title: 'The episode',
      platforms: ['youtube'],
    })
    t.env.db
      .prepare(
        "UPDATE posts SET episode_ref = 'trash-panda-2026-0101', post_type = 'episode', status = 'posted' WHERE id = ?",
      )
      .run(ep.id)
    t.env.db
      .prepare(
        "UPDATE post_targets SET status = 'posted', external_url = 'https://youtu.be/abc' WHERE post_id = ?",
      )
      .run(ep.id)
    expect(addEpisodeLink(t.env.db, clip.id)).toBe(true)
    expect(t.env.posts.get(clip.id)!.caption).toContain(
      'Full episode on YouTube: https://youtu.be/abc',
    )
    expect(addEpisodeLink(t.env.db, clip.id)).toBe(false)
    expect(t.env.posts.get(clip.id)!.caption.match(/Full episode/g)).toHaveLength(1)
  })
})

describe('clips: API', () => {
  it('shows post_type, the clip schedule and filters posts by type', async () => {
    const t = pipelineSetup({ probe: probeOf(1080, 1920, 40) })
    setCfg(t, { clipPostDays: [2, 4], clipTime: '13:30' })
    t.drop(TP, 'trash-panda', 140, { post_type: 'clip', platforms: ['youtube'] })
    t.drop(TP, 'trash-panda', 141, {})
    await t.settle()
    const s = {
      settings: t.env.settings,
      brands: t.env.brands,
      posts: t.env.posts,
      scheduler: t.env.scheduler,
      log: t.env.log,
      appVersion: 't',
      now: () => t.env.clock.ms,
      health: () => null,
      drops: t.drops,
    } as AgentServices
    const call = (path: string) =>
      handleAgentRequest(s, () => 'tok', {
        method: 'GET',
        url: path,
        headers: { host: '127.0.0.1:1', authorization: 'Bearer tok' },
        body: '',
        port: 1,
      })
    const clips = (await call('/v1/posts?post_type=clip')).body as any
    expect(clips.posts).toHaveLength(1)
    expect(clips.posts[0]).toMatchObject({ post_type: 'clip', source_episode_id: null })
    const brands = ((await call('/v1/brands')).body as any).brands
    expect(brands.find((b: any) => b.slug === 'trash-panda')).toMatchObject({
      clip_post_days: [2, 4],
      clip_time: '13:30',
    })
    const drops = ((await call('/v1/drops')).body as any).drops
    expect(drops.map((d: any) => d.post_type).sort()).toEqual(['clip', 'episode'])
  })
})
