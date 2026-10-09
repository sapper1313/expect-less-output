import { existsSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { YoutubeAdapter } from '../src/main/adapters/youtube'
import { DryRunAdapter } from '../src/main/adapters/dryRun'
import { AdapterError, type PlatformAdapter } from '../src/main/adapters/types'
import type { UploadArgs, VideoStatus, YoutubeClientLike } from '../src/main/google/youtubeClient'
import type { Account, Platform } from '../src/shared/types'
import { makeEnv } from './helpers'

const MIN = 60_000
const HOUR = 60 * MIN

/** A mock YouTube. Records every call so tests can check exactly what would have been sent. */
class MockClient implements YoutubeClientLike {
  uploads: Array<{ accountId: number; args: UploadArgs }> = []
  playlistAdds: Array<{ playlistId: string; videoId: string }> = []
  statusCalls = 0
  privacy: Record<string, string> = {}
  forcePrivacy: string | null = null
  failUploadsWith: AdapterError | null = null
  failPlaylist = false
  async uploadVideo(accountId: number, args: UploadArgs) {
    if (this.failUploadsWith) throw this.failUploadsWith
    this.uploads.push({ accountId, args })
    const id = `vid${this.uploads.length}`
    const privacyStatus = this.forcePrivacy ?? args.metadata.status.privacyStatus
    this.privacy[id] = privacyStatus
    args.onProgress?.(1)
    return { id, privacyStatus, publishAt: args.metadata.status.publishAt }
  }
  async videoStatus(_a: number, id: string): Promise<VideoStatus | null> {
    this.statusCalls++
    return this.privacy[id] ? { privacyStatus: this.privacy[id] } : null
  }
  thumbnails: Array<{ videoId: string; file: string }> = []
  failThumbnail = false
  async setThumbnail(_a: number, videoId: string, file: string) {
    if (this.failThumbnail) throw new Error('channel not verified')
    this.thumbnails.push({ videoId, file })
  }
  async addToPlaylist(_a: number, playlistId: string, videoId: string) {
    if (this.failPlaylist) throw new Error('playlist boom')
    this.playlistAdds.push({ playlistId, videoId })
  }
}

function setup(mode: string, opts: { status?: string; handoffHours?: number } = {}) {
  const client = new MockClient()
  const host = { notified: [] as string[][], copied: [] as string[], opened: [] as string[] }
  const ref = { env: null as unknown as ReturnType<typeof makeEnv> }
  const yt = () =>
    new YoutubeAdapter({
      client,
      host: {
        notify: (t, b) => host.notified.push([t, b]),
        copyText: (t) => host.copied.push(t),
        openExternal: (u) => host.opened.push(u),
      },
      brandDefaults: (id) => ref.env.brands.getDefaults(id),
      log: (level, message, ctx) =>
        ref.env.log.log(level, message, { postId: ctx.postId, platform: 'youtube' }),
    })
  const dry = (env: ReturnType<typeof makeEnv>, p: Platform) =>
    new DryRunAdapter(p, { getSettings: () => env.settings.get(), sleep: async () => {} })
  const adapter = yt()
  const env = makeEnv(Date.UTC(2026, 5, 1, 12, 0, 0), {
    adapterFor: (platform: Platform, account: Account | null): PlatformAdapter =>
      platform === 'youtube' && account && account.mode !== 'dry_run'
        ? adapter
        : dry(ref.env, platform),
  })
  ref.env = env
  env.db
    .prepare(
      "UPDATE accounts SET mode = ?, status = ?, external_id = 'UC1', display_name = 'Chan' WHERE brand_id = 1 AND platform = 'youtube'",
    )
    .run(mode, opts.status ?? 'connected')
  if (opts.handoffHours !== undefined) env.settings.set({ handoffHoursYoutube: opts.handoffHours })
  return { env, client, host }
}

const target = (env: ReturnType<typeof makeEnv>, postId: number) =>
  env.posts.get(postId)!.targets[0]

describe('YouTube Auto mode: early handoff', () => {
  it('uploads private with publishAt exactly 3 hours before, not earlier, then marks posted when YouTube shows it public', async () => {
    const { env, client } = setup('auto')
    const when = env.clock.ms + 5 * HOUR
    const post = await env.makePost({ whenMs: when, platforms: ['youtube'] })

    await env.scheduler.tick() // 5h before: nothing yet
    expect(client.uploads).toHaveLength(0)
    expect(target(env, post.id).status).toBe('pending')

    env.clock.ms = when - 3 * HOUR - MIN // still 1 minute early
    await env.scheduler.tick()
    expect(client.uploads).toHaveLength(0)

    env.clock.ms = when - 3 * HOUR + 1000 // handoff window open
    await env.scheduler.tick()
    expect(client.uploads).toHaveLength(1)
    const sent = client.uploads[0].args.metadata
    expect(sent.status.privacyStatus).toBe('private')
    expect(sent.status.publishAt).toBe(new Date(when).toISOString())
    expect(sent.status.selfDeclaredMadeForKids).toBe(false)
    expect(target(env, post.id).status).toBe('handed_off')
    expect(target(env, post.id).externalUrl).toBe('https://youtube.com/shorts/vid1')

    // YouTube has not published yet at the scheduled minute: stays handed off, never uploads again.
    env.clock.ms = when + 30_000
    await env.scheduler.tick()
    expect(target(env, post.id).status).toBe('handed_off')
    expect(client.uploads).toHaveLength(1)

    // YouTube flips it to public.
    client.privacy['vid1'] = 'public'
    env.clock.ms = when + 60_000
    await env.scheduler.tick()
    expect(target(env, post.id).status).toBe('posted')
    expect(env.posts.get(post.id)!.status).toBe('posted')
    expect(client.uploads).toHaveLength(1)
    expect(env.posts.get(post.id)!.videoPath).toMatch(/Posted\//)
  })

  it('honors a different handoff setting', async () => {
    const { env, client } = setup('auto', { handoffHours: 6 })
    const when = env.clock.ms + 7 * HOUR
    await env.makePost({ whenMs: when, platforms: ['youtube'] })
    env.clock.ms = when - 6 * HOUR + 1000
    await env.scheduler.tick()
    expect(client.uploads).toHaveLength(1)
  })

  it('uploads public at the scheduled time when it is less than 15 minutes away', async () => {
    const { env, client } = setup('auto')
    const when = env.clock.ms + 10 * MIN
    const post = await env.makePost({ whenMs: when, platforms: ['youtube'] })
    await env.scheduler.tick()
    expect(client.uploads).toHaveLength(0) // no early handoff, it would be too tight
    env.clock.ms = when + 1000
    await env.scheduler.tick()
    expect(client.uploads).toHaveLength(1)
    const sent = client.uploads[0].args.metadata
    expect(sent.status.privacyStatus).toBe('public')
    expect(sent.status.publishAt).toBeUndefined()
    expect(target(env, post.id).status).toBe('posted')
  })

  it('exactly 15 minutes away still hands off, 14 does not', async () => {
    const a = setup('auto')
    const t = a.env.clock.ms + 15 * MIN
    await a.env.makePost({ whenMs: t, platforms: ['youtube'] })
    await a.env.scheduler.tick()
    expect(a.client.uploads).toHaveLength(1)
    const b = setup('auto')
    await b.env.makePost({ whenMs: b.env.clock.ms + 14 * MIN, platforms: ['youtube'] })
    await b.env.scheduler.tick()
    expect(b.client.uploads).toHaveLength(0)
  })

  it('reports the "not approved yet" lock when YouTube leaves a scheduled video private after the time', async () => {
    const { env } = setup('auto')
    const when = env.clock.ms + 4 * HOUR
    const post = await env.makePost({ whenMs: when, platforms: ['youtube'] })
    env.clock.ms = when - 3 * HOUR + 1000
    await env.scheduler.tick()
    env.clock.ms = when + 11 * MIN // 10 minute grace passed, still private
    await env.scheduler.tick()
    const t = target(env, post.id)
    expect(t.status).toBe('failed')
    expect(t.lastError).toContain('Google has not approved your app yet')
    expect(t.lastError).toContain('Use Manual assist')
    expect(env.events.failures).toHaveLength(1)
  })

  it('reports the lock when a public upload comes back private', async () => {
    const { env, client } = setup('auto')
    client.forcePrivacy = 'private'
    const post = await env.makePost({ whenMs: env.clock.ms + 5 * MIN, platforms: ['youtube'] })
    env.clock.ms += 6 * MIN
    await env.scheduler.tick()
    expect(target(env, post.id).lastError).toContain('Google has not approved your app yet')
    expect(target(env, post.id).attempts).toBe(1) // permanent, not retried
  })

  it('does not post twice: a retry after a playlist or later failure reuses the uploaded video', async () => {
    const { env, client } = setup('auto')
    env.db
      .prepare('UPDATE brand_defaults SET youtube_playlist_id = ? WHERE brand_id = 1')
      .run('PL1')
    client.failPlaylist = true
    const when = env.clock.ms + 4 * HOUR
    const post = await env.makePost({ whenMs: when, platforms: ['youtube'] })
    env.clock.ms = when - 3 * HOUR + 1000
    await env.scheduler.tick()
    expect(client.uploads).toHaveLength(1)
    expect(target(env, post.id).status).toBe('handed_off') // playlist trouble does not fail the post
  })

  it('retries a temporary upload failure on the normal schedule without duplicating', async () => {
    const { env, client } = setup('auto')
    client.failUploadsWith = new AdapterError('Google had a problem (503).', 'transient')
    const when = env.clock.ms + 4 * HOUR
    const post = await env.makePost({ whenMs: when, platforms: ['youtube'] })
    env.clock.ms = when - 3 * HOUR + 1000
    await env.scheduler.tick()
    expect(target(env, post.id).status).toBe('pending')
    expect(target(env, post.id).attempts).toBe(1)
    client.failUploadsWith = null
    env.clock.ms += 2 * MIN + 1000
    await env.scheduler.tick()
    expect(target(env, post.id).status).toBe('handed_off')
    expect(client.uploads).toHaveLength(1)
  })

  it('refuses to move a post that YouTube is already holding, and warns on cancel', async () => {
    const { env } = setup('auto')
    const when = env.clock.ms + 4 * HOUR
    const post = await env.makePost({ whenMs: when, platforms: ['youtube'] })
    env.clock.ms = when - 3 * HOUR + 1000
    await env.scheduler.tick()
    expect(() =>
      env.posts.update(post.id, { scheduledAtUtc: new Date(when + HOUR).toISOString() }),
    ).toThrow(/already scheduled inside YouTube/)
    env.posts.cancel([post.id])
    const warn = env.log.list({ level: 'warn' }).map((l) => l.message)
    expect(warn.some((m) => m.includes('Delete the scheduled video in YouTube Studio'))).toBe(true)
  })
})

describe('YouTube metadata sent', () => {
  it('passes the AI flag, brand category, kids setting, #Shorts and playlist', async () => {
    const { env, client } = setup('test_private')
    env.db
      .prepare(
        "UPDATE brand_defaults SET youtube_category_id = '27', youtube_made_for_kids = 1, youtube_append_shorts = 1, youtube_playlist_id = 'PL9' WHERE brand_id = 1",
      )
      .run()
    const src = await env.makePost({
      whenMs: env.clock.ms + MIN,
      platforms: ['youtube'],
      title: 'Aye Eye',
    })
    env.db.prepare('UPDATE post_targets SET ai_flag = 1 WHERE post_id = ?').run(src.id)
    env.db
      .prepare('UPDATE posts SET caption = ? WHERE id = ?')
      .run('Look #funny #trashpanda', src.id)
    env.clock.ms += 2 * MIN
    await env.scheduler.tick()
    const m = client.uploads[0].args.metadata
    expect(m.status.containsSyntheticMedia).toBe(true)
    expect(m.status.selfDeclaredMadeForKids).toBe(true)
    expect(m.snippet.categoryId).toBe('27')
    expect(m.snippet.description).toBe('Look #funny #trashpanda\n\n#Shorts')
    expect(m.snippet.tags).toEqual(['funny', 'trashpanda', 'Shorts'])
    expect(client.playlistAdds).toEqual([{ playlistId: 'PL9', videoId: 'vid1' }])
  })

  it('uses the YouTube caption override when there is one', async () => {
    const { env, client } = setup('test_private')
    const post = await env.makePost({ whenMs: env.clock.ms + MIN, platforms: ['youtube'] })
    env.db
      .prepare('UPDATE post_targets SET caption_override = ? WHERE post_id = ?')
      .run('Only for YouTube', post.id)
    env.clock.ms += 2 * MIN
    await env.scheduler.tick()
    expect(client.uploads[0].args.metadata.snippet.description).toBe('Only for YouTube')
  })
})

describe('YouTube Test private mode', () => {
  it('uploads private with no publishAt and finishes the post', async () => {
    const { env, client } = setup('test_private')
    const post = await env.makePost({ whenMs: env.clock.ms + MIN, platforms: ['youtube'] })
    env.clock.ms += 2 * MIN
    await env.scheduler.tick()
    const m = client.uploads[0].args.metadata
    expect(m.status.privacyStatus).toBe('private')
    expect(m.status.publishAt).toBeUndefined()
    expect(env.posts.get(post.id)!.status).toBe('posted')
    expect(client.uploads).toHaveLength(1)
  })

  it('records upload progress on the target', async () => {
    const { env } = setup('test_private')
    const post = await env.makePost({ whenMs: env.clock.ms + MIN, platforms: ['youtube'] })
    env.clock.ms += 2 * MIN
    await env.scheduler.tick()
    expect(env.posts.get(post.id)!.targets[0].progress).toBe(1)
  })
})

describe('YouTube Manual assist mode', () => {
  it('notifies, copies title and description, opens Studio, then waits for Mark as posted', async () => {
    const { env, client, host } = setup('manual_assist')
    const post = await env.makePost({
      whenMs: env.clock.ms + MIN,
      platforms: ['youtube', 'tiktok'],
      title: 'Fridge Math',
    })
    env.db
      .prepare('UPDATE posts SET caption = ? WHERE id = ?')
      .run('Do the math #trashpanda', post.id)
    env.clock.ms += 2 * MIN
    await env.scheduler.tick()

    expect(client.uploads).toHaveLength(0)
    expect(host.notified).toEqual([['Time to post on YouTube', 'Trash Panda: Fridge Math']])
    expect(host.copied).toEqual(['Fridge Math\n\nDo the math #trashpanda'])
    expect(host.opened).toEqual(['https://studio.youtube.com'])
    const yt = env.posts.get(post.id)!.targets.find((t) => t.platform === 'youtube')!
    expect(yt.status).toBe('needs_action')
    const after = env.posts.get(post.id)!
    expect(after.status).toBe('partial') // TikTok done, YouTube waiting for the owner
    expect(after.videoPath).toContain('/Queue/') // file stays until the owner finishes

    env.scheduler.markPosted(yt.id, 'https://youtube.com/shorts/abc')
    const done = env.posts.get(post.id)!
    expect(done.status).toBe('posted')
    expect(done.targets.find((t) => t.platform === 'youtube')!.externalUrl).toBe(
      'https://youtube.com/shorts/abc',
    )
    expect(done.videoPath).toMatch(/Posted\//)
    expect(existsSync(env.library.resolve(done.videoPath))).toBe(true)
  })

  it('does not open Studio twice on later ticks', async () => {
    const { env, host } = setup('manual_assist')
    await env.makePost({ whenMs: env.clock.ms + MIN, platforms: ['youtube'] })
    env.clock.ms += 2 * MIN
    await env.scheduler.tick()
    await env.scheduler.tick()
    await env.scheduler.tick()
    expect(host.opened).toHaveLength(1)
  })

  it('markPosted works without a link and rejects bad input', async () => {
    const { env } = setup('manual_assist')
    const post = await env.makePost({ whenMs: env.clock.ms + MIN, platforms: ['youtube'] })
    env.clock.ms += 2 * MIN
    await env.scheduler.tick()
    const t = env.posts.get(post.id)!.targets[0]
    expect(() => env.scheduler.markPosted(t.id, 'javascript:alert(1)')).toThrow(/http/)
    env.scheduler.markPosted(t.id)
    expect(env.posts.get(post.id)!.status).toBe('posted')
    expect(() => env.scheduler.markPosted(t.id)).toThrow(/waiting for you/)
  })
})

describe('YouTube sign-in problems', () => {
  it('fails clearly without retrying when the account needs reauth', async () => {
    const { env, client } = setup('auto', { status: 'needs_reauth' })
    const post = await env.makePost({ whenMs: env.clock.ms + MIN, platforms: ['youtube'] })
    env.clock.ms += 2 * MIN
    await env.scheduler.tick()
    const t = target(env, post.id)
    expect(t.status).toBe('failed')
    expect(t.lastError).toContain('sign in again')
    expect(t.attempts).toBe(1)
    expect(client.uploads).toHaveLength(0)
  })

  it('catches a bad title before uploading anything', async () => {
    const { env, client } = setup('test_private')
    const post = await env.makePost({
      whenMs: env.clock.ms + MIN,
      platforms: ['youtube'],
      title: 'x'.repeat(120),
    })
    env.clock.ms += 2 * MIN
    await env.scheduler.tick()
    expect(target(env, post.id).lastError).toContain('limit is 100')
    expect(client.uploads).toHaveLength(0)
  })
})

describe('YouTube custom thumbnail (long form only)', () => {
  it('sets the thumbnail after the upload, and a thumbnail failure never causes a second upload', async () => {
    const { env, client } = setup('auto', { handoffHours: 3 })
    const post = await env.makePost({ whenMs: env.clock.ms + 5 * HOUR, platforms: ['youtube'] })
    env.db.prepare('UPDATE post_targets SET settings_json = ? WHERE post_id = ?').run(JSON.stringify({ thumbnailPath: '/tmp/thumb-a.jpg' }), post.id)
    client.failThumbnail = true
    env.clock.ms += 3 * HOUR
    await env.scheduler.tick()
    expect(client.uploads).toHaveLength(1)
    expect(client.thumbnails).toHaveLength(0)
    expect(env.log.list({ limit: 50 }).some((l) => /custom thumbnail was not set: channel not verified/.test(l.message))).toBe(true)
    // a later tick never uploads again, and never retries the thumbnail either
    env.clock.ms += 10 * MIN
    await env.scheduler.tick()
    expect(client.uploads).toHaveLength(1)

    const ok = await env.makePost({ whenMs: env.clock.ms + 5 * HOUR, platforms: ['youtube'] })
    env.db.prepare('UPDATE post_targets SET settings_json = ? WHERE post_id = ?').run(JSON.stringify({ thumbnailPath: '/tmp/thumb-b.jpg' }), ok.id)
    client.failThumbnail = false
    env.clock.ms += 3 * HOUR
    await env.scheduler.tick()
    expect(client.thumbnails).toEqual([{ videoId: 'vid2', file: '/tmp/thumb-b.jpg' }])
  })
})
