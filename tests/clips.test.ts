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

describe('clips: channel link and the Related video reminder', () => {
  const clipSidecar = (over: Record<string, unknown> = {}) => ({
    post_type: 'clip',
    episode_id: 'trash-panda-2026-0101-c1',
    source_episode_id: 'trash-panda-2026-0101',
    platforms: ['youtube', 'instagram'],
    caption_overrides: { instagram: 'IG text' },
    ...over,
  })
  const file = { file: 'trash-panda-2026-0101-c1.mp4' }
  async function rig(over: Record<string, unknown> = {}) {
    const t = pipelineSetup({
      probe: probeOf(1080, 1920, 40),
      live: [
        [1, 'youtube'],
        [1, 'instagram'],
      ],
    })
    t.env.db
      .prepare(
        "UPDATE accounts SET external_id = 'UCshow' WHERE brand_id = 1 AND platform = 'youtube'",
      )
      .run()
    setCfg(t, {
      clipPostDays: [2],
      clipPlatforms: { youtube: true, instagram: true, facebook: false, tiktok: false },
    })
    t.drop(TP, 'trash-panda', 150, clipSidecar(over), file)
    await t.settle()
    const clip = t.env.posts.list()[0]
    return { t, clip }
  }
  const goLive = async (t: ReturnType<typeof pipelineSetup>) => {
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
        "UPDATE post_targets SET status = 'posted', external_url = 'https://youtu.be/ep1' WHERE post_id = ?",
      )
      .run(ep.id)
  }

  it('adds the channel link to every platform, after the episode line, and keeps that order', async () => {
    const { t, clip } = await rig()
    expect(addEpisodeLink(t.env.db, clip.id)).toBe(true) // channel link first, the episode is not live yet
    const url = 'https://www.youtube.com/channel/UCshow'
    let c = t.env.posts.get(clip.id)!
    expect(c.caption.endsWith(url)).toBe(true)
    expect(c.targets.find((x) => x.platform === 'instagram')!.captionOverride).toMatch(
      /IG text\n\nhttps:\/\/www.youtube.com\/channel\/UCshow$/,
    )
    await goLive(t)
    expect(addEpisodeLink(t.env.db, clip.id)).toBe(true)
    c = t.env.posts.get(clip.id)!
    expect(c.caption).toMatch(
      /Full episode on YouTube: https:\/\/youtu.be\/ep1\n\nhttps:\/\/www.youtube.com\/channel\/UCshow$/,
    )
    expect(c.targets.find((x) => x.platform === 'instagram')!.captionOverride).toMatch(
      /Full episode on YouTube: https:\/\/youtu.be\/ep1\n\nhttps:\/\/www.youtube.com\/channel\/UCshow$/,
    )
    expect(addEpisodeLink(t.env.db, clip.id)).toBe(false)
    expect(c.caption.match(/UCshow/g)).toHaveLength(1)
  })

  it('channel_link false leaves it off, and an episode never gets it', async () => {
    const { t, clip } = await rig({ channel_link: false })
    expect(addEpisodeLink(t.env.db, clip.id)).toBe(false)
    expect(t.env.posts.get(clip.id)!.caption).not.toContain('UCshow')
    const e = pipelineSetup({ probe: probeOf(1080, 1920, 40), live: [[1, 'youtube']] })
    e.env.db
      .prepare(
        "UPDATE accounts SET external_id = 'UCshow' WHERE brand_id = 1 AND platform = 'youtube'",
      )
      .run()
    e.drop(TP, 'trash-panda', 151, { channel_link: true })
    await e.settle()
    const ep = e.env.posts.list()[0]
    expect(addEpisodeLink(e.env.db, ep.id)).toBe(false)
    expect(ep.caption).not.toContain('UCshow')
  })

  it('shows a Related video reminder with the episode link once it is live, and Done clears it', async () => {
    const { t, clip } = await rig()
    expect(clip.relatedVideo).toEqual({
      episodeId: 'trash-panda-2026-0101',
      url: null,
      done: false,
    })
    await goLive(t)
    expect(t.env.posts.get(clip.id)!.relatedVideo).toEqual({
      episodeId: 'trash-panda-2026-0101',
      url: 'https://youtu.be/ep1',
      done: false,
    })
    t.env.posts.setRelatedDone(clip.id, true)
    expect(t.env.posts.get(clip.id)!.relatedVideo!.done).toBe(true)
    // no reminder without a YouTube Short, and none on an episode
    const none = pipelineSetup({ probe: probeOf(1080, 1920, 40), live: [[1, 'instagram']] })
    setCfg(none, { clipPostDays: [2] })
    none.drop(TP, 'trash-panda', 152, clipSidecar({ platforms: ['instagram'] }), file)
    await none.settle()
    expect(none.env.posts.list()[0].relatedVideo).toBeNull()
  })

  it('writes the reminder to the Activity Log when the clip posts and when its episode goes live', async () => {
    const { t, clip } = await rig()
    const sched = t.env.scheduler as unknown as { logRelatedVideo(row: unknown): void }
    sched.logRelatedVideo({ post_id: clip.id, title: clip.title, platform: 'youtube' })
    const logs = () => t.env.log.list({ limit: 50 }).map((l) => l.message)
    expect(logs().some((m) => /not live yet.*Set it by hand in YouTube Studio/.test(m))).toBe(true)
    await goLive(t)
    t.env.db
      .prepare(
        "UPDATE post_targets SET status = 'posted' WHERE post_id = ? AND platform = 'youtube'",
      )
      .run(clip.id)
    const ep = t.env.db
      .prepare("SELECT id, title FROM posts WHERE post_type = 'episode'")
      .get() as { id: number; title: string }
    sched.logRelatedVideo({ post_id: ep.id, title: ep.title, platform: 'youtube' })
    expect(
      logs().some(
        (m) =>
          /is live\. Set the Related video of the clip/.test(m) &&
          m.includes('https://youtu.be/ep1'),
      ),
    ).toBe(true)
  })

  it('the API shows the reminder', async () => {
    const { t, clip } = await rig()
    const s = {
      settings: t.env.settings,
      brands: t.env.brands,
      posts: t.env.posts,
      scheduler: t.env.scheduler,
      log: t.env.log,
      appVersion: 't',
      health: () => null,
    } as AgentServices
    const r = await handleAgentRequest(s, () => 'tok', {
      method: 'GET',
      url: `/v1/posts/${clip.id}`,
      headers: { host: '127.0.0.1:1', authorization: 'Bearer tok' },
      body: '',
      port: 1,
    })
    expect((r.body as any).related_video).toEqual({
      episode_id: 'trash-panda-2026-0101',
      url: null,
      done: false,
    })
  })
})

describe('clips and the Upcoming warning', () => {
  it('a clip does not need an Upcoming entry, but an episode still does', async () => {
    const { UpcomingService } = await import('../src/main/pipeline/upcoming')
    const t = pipelineSetup({ probe: probeOf(1080, 1920, 40) })
    setCfg(t, { clipPostDays: [2] })
    t.drop(
      TP,
      'trash-panda',
      160,
      { post_type: 'clip', episode_id: 'trash-panda-2026-0102-c1', platforms: ['youtube'] },
      { file: 'trash-panda-2026-0102-c1.mp4' },
    )
    await t.settle()
    const up = new UpcomingService({
      db: t.env.db,
      settings: t.env.settings,
      brands: t.env.brands,
      audit: t.audit,
      notify: () => {},
      mediaRoot: () => t.env.root,
      now: () => t.env.clock.ms,
    })
    expect(up.issues().some((i) => /has no entry in Upcoming/.test(i.detail))).toBe(false)
    t.drop(TP, 'trash-panda', 161, {})
    await t.settle()
    expect(up.issues().some((i) => /has no entry in Upcoming/.test(i.detail))).toBe(true)
  })
})
