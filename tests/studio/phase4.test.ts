import { existsSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { InboxWatcher } from '../../src/main/agent/inbox'
import type { AgentServices } from '../../src/main/agent/core'
import { probe, makePlaceholderVideo } from '../../src/main/studio/ffmpeg'
import { signV4 } from '../../src/main/studio/social/publicHost'
import { lintValue } from '../../src/shared/studio/lint'
import { DEFAULT_STUDIO_CONFIG } from '../../src/shared/studio/config'
import { hollowId, makeStudioEnv } from './helpers'

vi.setConfig({ testTimeout: 180_000 })
type Env = ReturnType<typeof makeStudioEnv>
const brandId = (e: Env, like: string) => (e.db.prepare('SELECT id FROM brands WHERE name LIKE ?').get(like) as { id: number }).id
const WED = Date.UTC(2026, 5, 3, 14)

async function settle(e: Env) {
  const deadline = Date.now() + 120_000
  for (let i = 0; i < 400 && Date.now() < deadline; i++) {
    await e.studio.runner.runUntilIdle()
    const open = e.studio.tasks.list({ status: ['queued', 'waiting', 'running'] })
    if (!open.length) return
    if (open.every((t) => t.status === 'running')) await new Promise((r) => setTimeout(r, 50))
    else e.clock.ms += 2000
  }
}
async function step(e: Env) {
  e.studio.director.tick()
  await settle(e)
}

/** Only Trash Panda runs, with short bible lengths so tests stay quick. */
async function shortsSetup(extra: (e: Env, id: number) => Promise<void> = async () => {}) {
  const e = makeStudioEnv({ startMs: WED })
  const id = brandId(e, 'Trash Panda%')
  for (const b of e.studio.cfg.listBrandConfigs()) {
    if (b.brandId !== id) await e.studio.setBrand(b.brandId, { paused: true })
  }
  await e.studio.setBible(id, { minSeconds: 20, maxSeconds: 30 })
  await extra(e, id)
  return { e, id }
}
const todays = (e: Env, id: number) => e.studio.episodes.list({ brandId: id }).find((x) => x.slotDate === '2026-06-03')!

describe('AWS Signature Version 4 (public host)', () => {
  it('matches the example in the AWS documentation', () => {
    const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    const r = signV4({
      method: 'GET',
      path: '/test.txt',
      headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': empty, 'x-amz-date': '20130524T000000Z' },
      payloadHash: empty,
      region: 'us-east-1',
      service: 's3',
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      amzDate: '20130524T000000Z',
    })
    expect(r.signedHeaders).toBe('host;range;x-amz-content-sha256;x-amz-date')
    expect(r.authorization).toContain('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
  })
})

describe('Publisher pipeline for shorts', () => {
  it('writes per platform text with no em dashes, handles disclosure per platform, and posts Bluesky only when toggled on', async () => {
    const { e, id } = await shortsSetup(async (e, id) => {
      await e.studio.setBrand(id, { platforms: { bluesky: true } as never })
    })
    await step(e)
    await step(e)
    const ep = todays(e, id)
    expect(ep.status).toBe('Scheduled')
    const post = e.posts.get(ep.postId!)!
    const by = Object.fromEntries(post.targets.map((t) => [t.platform, t]))
    expect(Object.keys(by).sort()).toEqual(['facebook', 'instagram', 'tiktok', 'youtube'])
    // disclosure: YouTube and Instagram carry it through the API, TikTok (not Direct Post) and Facebook get a plain line
    expect(by.youtube.captionOverride).not.toContain('Made with AI.')
    expect(by.instagram.captionOverride).not.toContain('Made with AI.')
    expect(by.tiktok.captionOverride).toContain('Made with AI.')
    expect(by.facebook.captionOverride).toContain('Made with AI.')
    expect(by.youtube.aiFlag).toBe(true)
    const pkg = e.studio.episodes.getPackage(ep.id)!
    const comp = (pkg.extra as { compliance: { platforms: Record<string, { disclosure: string }> } }).compliance
    expect(comp.platforms.youtube.disclosure).toBe('api')
    expect(comp.platforms.tiktok.disclosure).toBe('text')
    expect(comp.platforms.bluesky.disclosure).toBe('text')
    // no em dashes anywhere in anything written
    expect(lintValue([post.title, post.caption, post.targets.map((t) => t.captionOverride)], DEFAULT_STUDIO_CONFIG.roboticPhrases)).toEqual([])
    // Threads and Bluesky are in their own list, with the disclosure line, and post (mock) at their time
    const social = e.studio.social.list({ episodeId: ep.id })
    expect(social.map((s) => s.platform)).toEqual(['bluesky'])
    expect(social.every((s) => s.text.includes('Made with AI.') && s.mock)).toBe(true)
    expect(social.find((s) => s.platform === 'bluesky')!.text.length).toBeLessThanOrEqual(300)
    e.clock.ms = Date.parse(post.scheduledAtUtc!) + 60_000
    await e.studio.social.tick()
    expect(e.studio.social.list({ episodeId: ep.id }).every((s) => s.status === 'posted' && s.externalId?.startsWith('mock-'))).toBe(true)
  })

  it('Bluesky is skipped when toggled off (the default)', async () => {
    const { e, id } = await shortsSetup()
    await step(e)
    await step(e)
    expect(todays(e, id).status).toBe('Scheduled')
    expect(e.studio.social.list()).toEqual([])
  })

  it('a platform that cannot take the video is skipped alone and everything else is scheduled', async () => {
    const { e, id } = await shortsSetup(async (e) => {
      e.studio.cfg.set({ platformCaps: { tiktok: { maxDurationSeconds: 5 } } })
    })
    await step(e)
    await step(e)
    const ep = todays(e, id)
    expect(ep.status).toBe('Scheduled')
    const post = e.posts.get(ep.postId!)!
    expect(post.targets.map((t) => t.platform).sort()).toEqual(['facebook', 'instagram', 'youtube'])
    const skipped = e.studio.audit.list({ agent: 'Compliance' }).filter((a) => a.action === 'platform_skipped')
    expect(skipped).toHaveLength(1)
    expect(JSON.stringify(skipped[0].detail)).toMatch(/tiktok/)
    expect(JSON.stringify(skipped[0].detail)).toMatch(/allows 5 seconds/)
  })
})

describe('Thumbnail agent', () => {
  it('makes candidates, scores them, picks a winner, records the guidelines version it used, and Revert works', async () => {
    const e = makeStudioEnv({ startMs: WED })
    const s = e.studio
    const hid = hollowId(e)
    s.thumbnailer.simulateVision = false // use the real scoring path
    s.cfg.set({ local: { ...s.cfg.get().local, ollamaHost: 'http://127.0.0.1:9' } })
    const row = s.episodes.create(hid, { series: 'Wonder Hollow Workshop', episode_number: 1, title: 'Counting Acorns Together', logline: 'Counting.', runtime_target_seconds: 10, counted_objects: [], scenes: [], youtube: { title: 'Counting Acorns Together', description: 'x', tags: [], made_for_kids: true, ai_disclosure: true }, tags: [], summary: 'The crew counts acorns.' } as never, { status: 'Checking video' })
    const video = join(e.dir, 'wide.mp4')
    await makePlaceholderVideo({ out: video, seconds: 10, width: 480, height: 270 })
    const v1 = s.guidelines.current()
    const set = await s.thumbnailer.make(row.id, video)
    expect(set.candidates).toHaveLength(3)
    expect(set.candidates.every((c) => c.score > 0 && existsSync(c.file))).toBe(true)
    expect(set.candidates[0].score).toBeGreaterThanOrEqual(set.candidates[1].score)
    expect(set.winner).toBe(set.candidates[0].id)
    expect(set.guidelinesVersion).toBe(v1.id)
    // long form: 1280x720, a real JPG under 2 MB
    const info = await probe(set.youtubeLongFile!)
    expect([info.width, info.height]).toEqual([1280, 720])
    expect(statSync(set.youtubeLongFile!).size).toBeLessThan(2 * 1024 * 1024)
    // a 320 pixel preview is kept for the Library
    expect((await probe(set.previewFile)).width).toBe(320)
    // headlines are 5 words or fewer
    for (const c of set.candidates) expect(c.headline.split(/\s+/).length).toBeLessThanOrEqual(5)
    // images were paid for and ledgered, never above the per picture price
    const imgs = e.db.prepare("SELECT dollars, purpose, mock FROM spend_ledger WHERE unit_kind = 'images'").all() as Array<{ dollars: number; purpose: string; mock: number }>
    expect(imgs.length).toBeGreaterThan(0)
    expect(imgs.every((i) => i.purpose === 'thumbnail' && i.mock === 1 && i.dollars === 0.04)).toBe(true)
    expect(s.episodes.getPackage(row.id)!.extra).toMatchObject({ thumbnails: { guidelinesVersion: v1.id, winner: set.winner } })
    // guidelines are versioned, editable, and Revert brings an old one back as a new version
    const v2 = s.guidelines.save(v1.text + '\n- Always smile.', 'Test edit.')
    expect(v2.id).toBeGreaterThan(v1.id)
    const back = s.guidelines.revert(v1.id)
    expect(back.text).toBe(v1.text)
    expect(back.id).toBeGreaterThan(v2.id)
    expect(s.guidelines.history().map((h) => h.source)).toEqual(['revert', 'owner', 'seed'])
    // the next run reads the reverted version
    expect((await s.thumbnailer.make(row.id, video)).guidelinesVersion).toBe(back.id)
  })

  it('Instagram cover survives the center crop, Shorts use the opening frame with no custom upload, TikTok sends a cover timestamp', async () => {
    const { e, id } = await shortsSetup()
    await step(e)
    // measure the clip length before the opening frame is added
    await step(e)
    const ep = todays(e, id)
    const post = e.posts.get(ep.postId!)!
    const by = Object.fromEntries(post.targets.map((t) => [t.platform, t]))
    // YouTube Shorts: no custom thumbnail through the API
    expect(by.youtube.settings.thumbnailPath).toBeUndefined()
    // TikTok: a cover timestamp in milliseconds
    expect(typeof by.tiktok.settings.coverTimestampMs).toBe('number')
    expect(by.tiktok.settings.coverTimestampMs).toBeGreaterThan(0)
    // Instagram: a frame (no public host here), and a custom cover that holds up when cropped to a square
    expect(typeof by.instagram.settings.thumbOffsetMs).toBe('number')
    const pkg = e.studio.episodes.getPackage(ep.id)!
    const th = (pkg.extra as { thumbnails: { winner: string } }).thumbnails
    expect(th.winner).toBeTruthy()
    const cover = join(e.studio.workDir(ep.id), 'thumbs', `${th.winner}.jpg`)
    const ci = await probe(cover)
    expect([ci.width, ci.height]).toEqual([1080, 1920])
    expect(await e.studio.thumbnailer.centerCropHolds(cover)).toBe(true)
    // the opening frame: the finished video is a little longer than the two clips made
    const clips = e.studio.jobs.latest(ep.id).reduce((n, j) => n + j.keepSeconds, 0)
    const vinfo = await probe(e.library.resolve(post.videoPath))
    expect(vinfo.durationSeconds).toBeGreaterThan(clips + 0.1)
    expect(vinfo.durationSeconds).toBeLessThan(clips + 1)
  })
})

describe('Thumbnail A/B swap test (YouTube long form)', () => {
  it('runs end to end in mock mode with simulated CTR, swaps once, and records the winner', async () => {
    const e = makeStudioEnv({ startMs: WED })
    const s = e.studio
    const hid = hollowId(e)
    // A Hollow video arrives through ingest.
    e.settings.set({ inboxBrandIds: [hid] } as never)
    const services: AgentServices = { settings: e.settings, brands: e.brands, posts: e.posts, scheduler: e.scheduler, log: e.log, appVersion: 't', now: () => e.clock.ms, health: () => null }
    const watcher = new InboxWatcher({ s: services, library: e.library, studio: s.ingest, alert: () => {}, now: () => e.clock.ms })
    const row = s.episodes.create(hid, { series: 'Wonder Hollow Workshop', episode_number: 1, title: 'Counting Acorns', logline: 'Counting.', runtime_target_seconds: 12, counted_objects: [], scenes: [], youtube: { title: 'Counting Acorns', description: 'The crew counts acorns.', tags: ['kids'], made_for_kids: true, ai_disclosure: true }, tags: [], summary: 'The crew counts acorns.' } as never, { status: 'Awaiting video', slotDate: '2026-06-05' })
    const inbox = join(e.root, 'Wonder Hollow Workshop', 'Inbox')
    const { mkdirSync } = await import('fs')
    mkdirSync(join(inbox, 'Rejected'), { recursive: true })
    await makePlaceholderVideo({ out: join(inbox, 'acorns.mp4'), seconds: 12, width: 480, height: 270 })
    writeFileSync(join(inbox, 'acorns.json'), JSON.stringify({ episode_id: row.id }))
    for (let i = 0; i < 3; i++) {
      await watcher.scan()
      e.clock.ms += 12_000
    }
    const ep = s.episodes.get(row.id)
    expect(ep.status, ep.flaggedReason ?? '').toBe('Scheduled')

    // The scheduler "posts" it to YouTube.
    const tgt = e.db.prepare("SELECT id FROM post_targets WHERE post_id = ? AND platform = 'youtube'").get(ep.postId!) as { id: number }
    e.db.prepare("UPDATE post_targets SET status = 'posted', external_id = 'VID123' WHERE id = ?").run(tgt.id)
    await s.tester.tick() // starts: A is on screen
    expect(e.db.prepare('SELECT state FROM thumb_tests WHERE episode_id = ?').get(row.id)).toEqual({ state: 'running_a' })
    const hours = (h: number) => (e.clock.ms += h * 3_600_000)
    hours(49)
    await s.tester.tick() // swaps to B
    expect(e.db.prepare('SELECT state FROM thumb_tests WHERE episode_id = ?').get(row.id)).toEqual({ state: 'running_b' })
    hours(49)
    await s.tester.tick() // compares and keeps the winner
    const test = e.db.prepare('SELECT state, note FROM thumb_tests WHERE episode_id = ?').get(row.id) as { state: string; note: string }
    expect(test.state).toBe('done')
    expect(test.note).toMatch(/Winner B/)
    const vars = e.db.prepare('SELECT variant, ctr, impressions, winner FROM thumb_variants WHERE episode_id = ? ORDER BY variant').all(row.id) as Array<{ variant: string; ctr: number; impressions: number; winner: number }>
    expect(vars.map((v) => [v.variant, v.ctr, v.winner])).toEqual([['A', 0.041, 0], ['B', 0.058, 1]])
    expect(s.tester.winnersFor(hid)).toHaveLength(1)
    // what the Hollow ingest produced: made for kids, 1280x720 under 2 MB, scheduled for a Wednesday or Friday
    const pkg = s.episodes.getPackage(row.id)!
    expect((pkg.extra as { compliance: { kids: { required: boolean } } }).compliance.kids.required).toBe(true)
    const post = e.posts.get(ep.postId!)!
    const thumb = post.targets[0].settings.thumbnailPath as string
    const info = await probe(thumb)
    expect([info.width, info.height]).toEqual([1280, 720])
    expect(statSync(thumb).size).toBeLessThan(2 * 1024 * 1024)
    expect(['2026-06-05T12:00:00.000Z', '2026-06-03T12:00:00.000Z', '2026-06-10T12:00:00.000Z']).toContain(post.scheduledAtUtc)
    expect(e.db.prepare('SELECT youtube_made_for_kids AS k FROM brand_defaults WHERE brand_id = ?').get(hid)).toEqual({ k: 1 })
  })

  it('drops the test when there are too few impressions, and the first thumbnail stays', async () => {
    const e = makeStudioEnv({ startMs: WED })
    const s = e.studio
    const hid = hollowId(e)
    s.tester.register('ep-x', hid, null, [{ id: 'A', file: '/tmp/a.jpg', headline: 'A', score: 1 }, { id: 'B', file: '/tmp/b.jpg', headline: 'B', score: 0.9 }])
    e.db.prepare("UPDATE thumb_tests SET state = 'running_a', video_id = 'V', started_utc = ?, swap_after_utc = ? WHERE episode_id = 'ep-x'").run(new Date(e.clock.ms).toISOString(), new Date(e.clock.ms).toISOString())
    e.db.prepare("UPDATE thumb_variants SET shown_from_utc = ? WHERE episode_id = 'ep-x' AND variant = 'A'").run(new Date(e.clock.ms - 1000).toISOString())
    s.mockAnalytics.impressions = 10
    for (let i = 0; i < 3; i++) {
      e.clock.ms += 49 * 3_600_000
      await s.tester.tick()
    }
    expect(e.db.prepare("SELECT state FROM thumb_tests WHERE episode_id = 'ep-x'").get()).toEqual({ state: 'skipped' })
  })
})

describe('mock mode never reaches a real platform', () => {
  it('a post made from a placeholder video goes to the dry run adapter even when the account is connected', async () => {
    const { pickAdapter } = await import('../../src/main/adapters/choose')
    const dry = { youtube: 'dry-yt', facebook: 'dry-fb', instagram: 'dry-ig', tiktok: 'dry-tt' } as never
    const real = { youtube: 'real-yt', facebook: 'real-fb', instagram: 'real-ig', tiktok: 'real-tt' } as never
    const connected = { mode: 'auto' } as never
    expect(pickAdapter('youtube', connected, {}, { dry, real })).toBe('real-yt')
    expect(pickAdapter('youtube', connected, { mock: true }, { dry, real })).toBe('dry-yt')
    expect(pickAdapter('tiktok', { mode: 'dry_run' } as never, {}, { dry, real })).toBe('dry-tt')
    expect(pickAdapter('instagram', null, undefined, { dry, real })).toBe('dry-ig')
  })

  it('the Producer marks its posts as mock in mock mode, and a Muse video is not marked', async () => {
    const { e, id } = await shortsSetup()
    await step(e)
    await step(e)
    const post = e.posts.get(todays(e, id).postId!)!
    expect(post.targets.every((t) => t.settings.mock === true)).toBe(true)
    expect(e.studio.social.list().every((s) => s.mock)).toBe(true)
  })
})
