import { existsSync } from 'fs'
import { afterEach, describe, expect, it } from 'vitest'
import { connectAndAssign, makeMetaEnv } from './metaHelpers'

const MIN = 60_000
const HOUR = 60 * MIN
const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})

type M = Awaited<ReturnType<typeof makeMetaEnv>>
async function setup(opts: Parameters<typeof makeMetaEnv>[0] = {}): Promise<M> {
  const m = await makeMetaEnv(opts)
  closers.push(m.close)
  await connectAndAssign(m, 1)
  return m
}
const target = (m: M, postId: number, platform: string) =>
  m.env.posts.get(postId)!.targets.find((t) => t.platform === platform)!
const reqs = (m: M, re: RegExp) =>
  m.fake.state.requests.filter((r) => re.test(`${r.method} ${r.path}`))

describe('Facebook Reels', () => {
  it('hands off early with SCHEDULED and the exact publish time, then reports posted with the permalink', async () => {
    const m = await setup()
    const when = m.env.clock.ms + 5 * HOUR
    const post = await m.env.makePost({
      whenMs: when,
      platforms: ['facebook'],
      title: 'Fridge Math',
    })
    m.env.db
      .prepare('UPDATE posts SET caption = ? WHERE id = ?')
      .run('Do the math #trashpanda', post.id)

    await m.env.scheduler.tick()
    expect(reqs(m, /video_reels/)).toHaveLength(0) // 5 hours early: too soon

    m.env.clock.ms = when - 3 * HOUR + 1000
    await m.env.scheduler.tick()
    const t = target(m, post.id, 'facebook')
    expect(t.status).toBe('handed_off')
    const video = Object.values(m.fake.state.fbVideos)[0]
    expect(video.bytes).toBe(video.fileSize)
    expect(video.finishParams).toMatchObject({
      upload_phase: 'finish',
      video_state: 'SCHEDULED',
      description: 'Do the math #trashpanda',
    })
    const sentTime = Number(video.finishParams!.scheduled_publish_time)
    const dbTime = Math.floor(new Date(m.env.posts.get(post.id)!.scheduledAtUtc!).getTime() / 1000)
    expect(sentTime).toBe(dbTime)
    expect(reqs(m, /video_reels/).filter((r) => r.params.upload_phase === 'start')).toHaveLength(1)

    // Facebook publishes it by itself at the time.
    video.published = true
    m.env.clock.ms = new Date(m.env.posts.get(post.id)!.scheduledAtUtc!).getTime() + 30_000
    await m.env.scheduler.tick()
    const done = target(m, post.id, 'facebook')
    expect(done.status).toBe('posted')
    expect(done.externalUrl).toMatch(/^https:\/\/www\.facebook\.com\/reel\/fbv\d+\/$/)
    expect(Object.keys(m.fake.state.fbVideos)).toHaveLength(1) // never uploaded twice
    expect(m.env.posts.get(post.id)!.status).toBe('posted')
    expect(existsSync(m.env.library.resolve(m.env.posts.get(post.id)!.videoPath))).toBe(true)
  })

  it('publishes at the scheduled time when less than 15 minutes remain', async () => {
    const m = await setup()
    const when = m.env.clock.ms + 10 * MIN
    const post = await m.env.makePost({ whenMs: when, platforms: ['facebook'] })
    await m.env.scheduler.tick()
    expect(Object.keys(m.fake.state.fbVideos)).toHaveLength(0)
    m.env.clock.ms = when + 1000
    await m.env.scheduler.tick()
    const video = Object.values(m.fake.state.fbVideos)[0]
    expect(video.finishParams!.video_state).toBe('PUBLISHED')
    expect(video.finishParams!.scheduled_publish_time).toBeUndefined()
    expect(target(m, post.id, 'facebook').status).toBe('processing')
    await m.env.scheduler.tick()
    expect(target(m, post.id, 'facebook').status).toBe('posted')
  })

  it('blocks a 2 minute video with a clear message, when scheduling and again at upload time', async () => {
    const media = {
      probe: async (p: string) => ({
        durationSeconds: /long/.test(p) ? 120 : 20,
        width: 1080,
        height: 1920,
        videoCodec: 'h264',
        audioCodec: 'aac',
        sizeBytes: 10,
        fps: 30,
        container: 'mp4',
      }),
      poster: async () => null,
    } as never
    const m = await setup({ media })
    const src = m.env.root + '/long-clip.mp4'
    const { writeFileSync } = await import('fs')
    writeFileSync(src, 'x')
    await expect(
      m.env.posts.create({
        brandId: 1,
        sourcePath: src,
        title: 'Long',
        caption: '',
        scheduledAtUtc: new Date(m.env.clock.ms + HOUR).toISOString(),
        status: 'scheduled',
        targets: [{ platform: 'facebook', aiFlag: false }],
      }),
    ).rejects.toThrow('Facebook Reels must be 3 to 90 seconds')
    // YouTube is not capped this way, and a dry run account only warns.
    await expect(
      m.env.posts.create({
        brandId: 2,
        sourcePath: src,
        title: 'Long dry',
        caption: '',
        scheduledAtUtc: new Date(m.env.clock.ms + HOUR).toISOString(),
        status: 'scheduled',
        targets: [{ platform: 'facebook', aiFlag: false }],
      }),
    ).resolves.toBeTruthy()

    // A post that got in some other way is still stopped before any upload.
    const post = await m.env.makePost({ whenMs: m.env.clock.ms + MIN, platforms: ['facebook'] })
    m.env.db
      .prepare('UPDATE posts SET video_meta_json = ? WHERE id = ?')
      .run(JSON.stringify({ durationSeconds: 120 }), post.id)
    m.env.clock.ms += 2 * MIN
    await m.env.scheduler.tick()
    const t = target(m, post.id, 'facebook')
    expect(t.status).toBe('failed')
    expect(t.lastError).toContain('Facebook Reels must be 3 to 90 seconds')
    expect(Object.keys(m.fake.state.fbVideos)).toHaveLength(0)
  })

  it('resumes the upload from where Meta stopped after the connection drops', async () => {
    const m = await setup()
    m.fake.state.uploadFault = (n) => (n === 1 ? 'drop' : null)
    const post = await m.env.makePost({
      whenMs: m.env.clock.ms + 10 * MIN,
      platforms: ['facebook'],
      bytes: 400_000,
    })
    m.env.clock.ms += 11 * MIN
    await m.env.scheduler.tick()
    const video = Object.values(m.fake.state.fbVideos)[0]
    expect(m.fake.state.uploadCount).toBeGreaterThanOrEqual(2)
    expect(video.bytes).toBe(video.fileSize)
    expect(target(m, post.id, 'facebook').status).toBe('processing')
  })

  it("stops at Facebook's 30 Reels per Page per day", async () => {
    const m = await setup()
    for (let i = 0; i < 30; i++) m.service.recordFbPublish('P1')
    const post = await m.env.makePost({ whenMs: m.env.clock.ms + MIN, platforms: ['facebook'] })
    m.env.clock.ms += 2 * MIN
    await m.env.scheduler.tick()
    expect(target(m, post.id, 'facebook').lastError).toContain('30 API Reels per Page')
    expect(Object.keys(m.fake.state.fbVideos)).toHaveLength(0)
  })

  it('marks Meta needs sign in and alerts once when the token is rejected', async () => {
    const m = await setup()
    m.fake.state.failNext.push({
      match: /video_reels/,
      status: 400,
      body: {
        error: {
          code: 190,
          message: 'Session has expired',
          error_subcode: 463,
          type: 'OAuthException',
        },
      },
    })
    const post = await m.env.makePost({ whenMs: m.env.clock.ms + MIN, platforms: ['facebook'] })
    m.env.clock.ms += 2 * MIN
    await m.env.scheduler.tick()
    const t = target(m, post.id, 'facebook')
    expect(t.status).toBe('failed')
    expect(t.attempts).toBe(1)
    expect(t.lastError).toContain('Reconnect Meta')
    expect(m.service.status().status).toBe('needs_reauth')
    expect(m.alerts.filter((a) => a[0] === 'Meta needs you to sign in again.')).toHaveLength(1)
    expect(m.env.events.failures).toHaveLength(1)
  })

  it('retries a temporary Meta problem on the normal schedule', async () => {
    const m = await setup()
    m.fake.state.failNext.push({
      match: /video_reels/,
      status: 500,
      body: { error: { code: 2, message: 'Service temporarily unavailable', is_transient: true } },
    })
    const post = await m.env.makePost({ whenMs: m.env.clock.ms + MIN, platforms: ['facebook'] })
    m.env.clock.ms += 2 * MIN
    await m.env.scheduler.tick()
    expect(target(m, post.id, 'facebook')).toMatchObject({ status: 'pending', attempts: 1 })
    m.env.clock.ms += 2 * MIN + 1000
    await m.env.scheduler.tick()
    expect(target(m, post.id, 'facebook').status).toBe('processing')
  })

  it('adds the Add AI label in app checklist and a notification when the AI flag is on', async () => {
    const m = await setup()
    const post = await m.env.makePost({
      whenMs: m.env.clock.ms + MIN,
      platforms: ['facebook'],
      title: 'Robot Clip',
    })
    m.env.db.prepare('UPDATE post_targets SET ai_flag = 1 WHERE post_id = ?').run(post.id)
    m.env.clock.ms += 2 * MIN
    await m.env.scheduler.tick()
    await m.env.scheduler.tick()
    const t = target(m, post.id, 'facebook')
    expect(t.status).toBe('posted')
    expect(t.checklist).toBe('Add AI label in app')
    expect(m.notes).toEqual([
      ['Add AI label in app', expect.stringContaining('Trash Panda: Robot Clip')],
    ])
    m.env.posts.dismissChecklist(t.id)
    expect(target(m, post.id, 'facebook').checklist).toBeNull()
    expect(Object.values(m.fake.state.fbVideos)[0].finishParams).not.toHaveProperty('video_labels') // no unverified field
  })
})

describe('Instagram Reels', () => {
  it('sends a custom cover address (cover_url) when the studio made one', async () => {
    const m = await setup()
    const post = await m.env.makePost({ whenMs: m.env.clock.ms + MIN, platforms: ['instagram'] })
    m.env.db
      .prepare('UPDATE post_targets SET settings_json = ? WHERE post_id = ?')
      .run(JSON.stringify({ coverUrl: 'https://cdn.example.com/covers/ep1.jpg' }), post.id)
    m.env.clock.ms += 2 * MIN
    await m.env.scheduler.tick()
    const c = Object.values(m.fake.state.igContainers)[0]
    expect(c.params).toMatchObject({ cover_url: 'https://cdn.example.com/covers/ep1.jpg' })
  })

  it('creates a REELS container, uploads the file, waits, publishes once, and stores the permalink', async () => {
    const m = await setup()
    const post = await m.env.makePost({ whenMs: m.env.clock.ms + MIN, platforms: ['instagram'] })
    m.env.db.prepare('UPDATE posts SET caption = ? WHERE id = ?').run('Hello #funny', post.id)
    m.env.db
      .prepare('UPDATE post_targets SET settings_json = ? WHERE post_id = ?')
      .run(JSON.stringify({ thumbOffsetMs: 1500 }), post.id)
    m.env.clock.ms += 2 * MIN
    await m.env.scheduler.tick()
    const c = Object.values(m.fake.state.igContainers)[0]
    expect(c.params).toMatchObject({
      media_type: 'REELS',
      upload_type: 'resumable',
      caption: 'Hello #funny',
      share_to_feed: 'true',
      thumb_offset: '1500',
    })
    expect(c.params).not.toHaveProperty('is_ai_generated')
    expect(c.bytes).toBe(c.fileSize)
    expect(target(m, post.id, 'instagram').status).toBe('processing')

    // polls each tick while IN_PROGRESS, then publishes exactly once
    let ticks = 0
    while (target(m, post.id, 'instagram').status !== 'posted' && ticks++ < 10) {
      m.env.clock.ms += 30_000
      await m.env.scheduler.tick()
    }
    const done = target(m, post.id, 'instagram')
    expect(done.status).toBe('posted')
    expect(done.externalUrl).toMatch(/^https:\/\/www\.instagram\.com\/reel\/igm\d+\/$/)
    expect(m.fake.state.igPublished).toHaveLength(1)
    expect(ticks).toBeGreaterThanOrEqual(2)
    expect(m.env.posts.get(post.id)!.videoPath).toMatch(/Posted\//)
    await m.env.scheduler.tick()
    expect(m.fake.state.igPublished).toHaveLength(1)
  })

  it('passes is_ai_generated when the AI flag is on, and share_to_feed false from the brand setting', async () => {
    const m = await setup()
    m.env.db
      .prepare('UPDATE brand_defaults SET instagram_share_to_feed = 0 WHERE brand_id = 1')
      .run()
    const post = await m.env.makePost({ whenMs: m.env.clock.ms + MIN, platforms: ['instagram'] })
    m.env.db.prepare('UPDATE post_targets SET ai_flag = 1 WHERE post_id = ?').run(post.id)
    m.env.clock.ms += 2 * MIN
    await m.env.scheduler.tick()
    const c = Object.values(m.fake.state.igContainers)[0]
    expect(c.params.is_ai_generated).toBe('true')
    expect(c.params.share_to_feed).toBe('false')
    expect(target(m, post.id, 'instagram').checklist).toBeNull() // Instagram has a real field, no to-do
  })

  it('reports a processing error clearly, and Retry starts a fresh container', async () => {
    const m = await setup()
    m.fake.state.igFinalStatus = 'ERROR'
    const post = await m.env.makePost({ whenMs: m.env.clock.ms + MIN, platforms: ['instagram'] })
    m.env.clock.ms += 2 * MIN
    for (let i = 0; i < 6 && target(m, post.id, 'instagram').status !== 'failed'; i++) {
      await m.env.scheduler.tick()
      m.env.clock.ms += 30_000
    }
    const t = target(m, post.id, 'instagram')
    expect(t.status).toBe('failed')
    expect(t.lastError).toContain('Instagram could not process the Reel')
    expect(t.lastError).toContain('2207026')
    expect(m.fake.state.igPublished).toHaveLength(0)

    m.fake.state.igFinalStatus = null
    m.env.scheduler.retryTarget(t.id)
    await m.env.scheduler.idle()
    for (let i = 0; i < 8 && target(m, post.id, 'instagram').status !== 'posted'; i++) {
      m.env.clock.ms += 30_000
      await m.env.scheduler.tick()
    }
    expect(target(m, post.id, 'instagram').status).toBe('posted')
    expect(Object.keys(m.fake.state.igContainers)).toHaveLength(2)
  })

  it('gives up on a container stuck for 15 minutes and starts over on the retry schedule', async () => {
    const m = await setup()
    m.fake.state.igPollsUntilFinished = 10_000
    const post = await m.env.makePost({ whenMs: m.env.clock.ms + MIN, platforms: ['instagram'] })
    m.env.clock.ms += 2 * MIN
    await m.env.scheduler.tick()
    expect(target(m, post.id, 'instagram').status).toBe('processing')
    m.env.clock.ms += 16 * MIN
    await m.env.scheduler.tick()
    const t = target(m, post.id, 'instagram')
    expect(t.status).toBe('pending')
    expect(t.lastError).toContain('more than 15 minutes')
    m.fake.state.igPollsUntilFinished = 1
    m.env.clock.ms += 3 * MIN
    for (let i = 0; i < 8 && target(m, post.id, 'instagram').status !== 'posted'; i++) {
      await m.env.scheduler.tick()
      m.env.clock.ms += 30_000
    }
    expect(target(m, post.id, 'instagram').status).toBe('posted')
  })

  it('respects the 100 posts per 24 hours limit before creating anything', async () => {
    const m = await setup()
    m.fake.state.igQuotaUsage = 100
    const post = await m.env.makePost({ whenMs: m.env.clock.ms + MIN, platforms: ['instagram'] })
    m.env.clock.ms += 2 * MIN
    await m.env.scheduler.tick()
    expect(target(m, post.id, 'instagram').lastError).toContain('100 API posts per 24 hours')
    expect(Object.keys(m.fake.state.igContainers)).toHaveLength(0)
  })

  it('checks caption and hashtag limits before uploading', async () => {
    const m = await setup()
    const post = await m.env.makePost({ whenMs: m.env.clock.ms + MIN, platforms: ['instagram'] })
    m.env.db
      .prepare('UPDATE posts SET caption = ? WHERE id = ?')
      .run(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' '), post.id)
    m.env.clock.ms += 2 * MIN
    await m.env.scheduler.tick()
    expect(target(m, post.id, 'instagram').lastError).toContain('31 hashtags')
    expect(Object.keys(m.fake.state.igContainers)).toHaveLength(0)
  })

  it('resumes the upload after a dropped connection', async () => {
    const m = await setup()
    m.fake.state.uploadFault = (n) => (n === 1 ? 'drop' : null)
    const post = await m.env.makePost({
      whenMs: m.env.clock.ms + MIN,
      platforms: ['instagram'],
      bytes: 400_000,
    })
    m.env.clock.ms += 2 * MIN
    await m.env.scheduler.tick()
    const c = Object.values(m.fake.state.igContainers)[0]
    expect(c.bytes).toBe(c.fileSize)
    expect(target(m, post.id, 'instagram').status).toBe('processing')
    expect(Object.keys(m.fake.state.igContainers)).toHaveLength(1)
  })
})

describe('both platforms together', () => {
  it('posts a Reel to Facebook and Instagram for one brand and moves the file once both are done', async () => {
    const m = await setup()
    const post = await m.env.makePost({
      whenMs: m.env.clock.ms + MIN,
      platforms: ['facebook', 'instagram'],
    })
    m.env.clock.ms += 2 * MIN
    for (let i = 0; i < 10 && m.env.posts.get(post.id)!.status !== 'posted'; i++) {
      await m.env.scheduler.tick()
      m.env.clock.ms += 30_000
    }
    const done = m.env.posts.get(post.id)!
    expect(done.status).toBe('posted')
    expect(done.videoPath).toMatch(/Posted\//)
  })
})
