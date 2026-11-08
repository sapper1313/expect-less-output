import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import { UploadPostService, uploadPostOn } from '../src/main/services/uploadPost'
import { UploadPostTikTokAdapter } from '../src/main/adapters/uploadPostTikTok'
import { UploadPostClient, UploadPostError, type UploadPostStatus } from '../src/main/uploadpost/client'
import { realPlatforms } from '../src/main/pipeline/verify'
import { SecretStore } from '../src/main/services/secrets'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Account, Platform } from '../src/shared/types'
import type { PlatformAdapter } from '../src/main/adapters/types'

const MIN = 60_000
const fakeCrypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
}

function setup(opts: { statuses?: UploadPostStatus[]; uploadError?: Error } = {}) {
  const calls = { uploads: [] as any[], statuses: 0 }
  const queue = [...(opts.statuses ?? [])]
  const client = {
    async uploadTikTok(_key: string, i: any) {
      calls.uploads.push(i)
      if (opts.uploadError) throw opts.uploadError
    },
    async status() {
      calls.statuses++
      return queue.shift() ?? { status: 'in_progress', results: [] }
    },
  }
  // eslint-disable-next-line prefer-const
  let svc!: UploadPostService
  const env = makeEnv(Date.UTC(2026, 5, 1, 12, 0, 0), {
    adapterFor: (platform: Platform, account: Account | null, ts?: Record<string, unknown>) => {
      if (platform === 'tiktok' && account && (ts?.upRequestId || svc.active(account.brandId, 'tiktok')))
        return adapter
      throw new Error(`unexpected adapter request for ${platform}`)
    },
  } as any)
  const secrets = new SecretStore(join(mkdtempSync(join(tmpdir(), 'up-')), 'secrets.bin'), fakeCrypto)
  svc = new UploadPostService(env.db, secrets, client as unknown as UploadPostClient)
  const adapter = new UploadPostTikTokAdapter({
    client: client as any,
    apiKey: () => svc.apiKey(),
    profileFor: (b) => svc.profileFor(b),
    host: { log: () => {} },
  }) as unknown as PlatformAdapter
  return { env, svc, calls }
}

describe('Upload-Post settings', () => {
  it('keeps the key hidden, and ticking TikTok makes the channel able to post to TikTok', () => {
    const { env, svc } = setup()
    expect(svc.state().hasKey).toBe(false)
    svc.setKey('  secret-key-1234 ')
    const s = svc.state()
    expect(s.hasKey).toBe(true)
    expect(s.masked.endsWith('1234')).toBe(true)
    expect(JSON.stringify(s)).not.toContain('secret-key')
    expect(realPlatforms(env.db, 1)).not.toContain('tiktok')
    svc.setLink(1, 'clock_out_early', { tiktok: true, instagram: true })
    expect(uploadPostOn(env.db, 1, 'tiktok')).toBe(true)
    expect(uploadPostOn(env.db, 1, 'youtube')).toBe(false)
    expect(realPlatforms(env.db, 1)).toContain('tiktok')
    svc.setLink(1, 'clock_out_early', { instagram: true })
    expect(realPlatforms(env.db, 1)).not.toContain('tiktok')
  })

  it('needs a profile name before TikTok can be turned on, and keeps a channel TikTok login as the fallback', () => {
    const { env, svc } = setup()
    expect(() => svc.setLink(1, ' ', { tiktok: true })).toThrow(/profile name/)
    env.db
      .prepare("UPDATE accounts SET mode = 'inbox', status = 'needs_reauth', external_id = 'x' WHERE brand_id = 1 AND platform = 'tiktok'")
      .run()
    svc.setLink(1, 'p', { tiktok: true })
    // Its own login needs signing in again, but Upload-Post still counts.
    expect(realPlatforms(env.db, 1)).toContain('tiktok')
    svc.setLink(1, 'p', {})
    const row = env.db.prepare("SELECT mode FROM accounts WHERE brand_id = 1 AND platform = 'tiktok'").get() as any
    expect(row.mode).toBe('inbox')
  })

  it('tests the key and says what is wrong', async () => {
    const { svc } = setup()
    expect((await svc.test()).ok).toBe(false)
    const bad = new UploadPostService(
      (svc as any).db,
      (svc as any).secrets,
      { profiles: async () => { throw new UploadPostError('nope', 401) } } as unknown as UploadPostClient,
    )
    bad.setKey('k')
    expect((await bad.test()).message).toMatch(/not valid/)
  })
})

describe('TikTok through Upload-Post', () => {
  const live = (setupResult: ReturnType<typeof setup>) => {
    setupResult.svc.setKey('k')
    setupResult.svc.setLink(1, 'clock_out_early', { tiktok: true })
  }

  it('sends the video, waits, then marks the post as posted with its link', async () => {
    const s = setup({
      statuses: [
        { status: 'in_progress', results: [] },
        { status: 'completed', results: [{ platform: 'tiktok', success: true, postId: '777', postUrl: 'https://www.tiktok.com/@a/video/777' }] },
      ],
    })
    live(s)
    const post = await s.env.makePost({ whenMs: s.env.clock.ms + MIN, platforms: ['tiktok'] })
    s.env.clock.ms += 2 * MIN
    await s.env.scheduler.tick()
    expect(s.calls.uploads).toHaveLength(1)
    expect(s.calls.uploads[0]).toMatchObject({ user: 'clock_out_early', privacy: 'PUBLIC_TO_EVERYONE' })
    s.env.clock.ms += MIN
    await s.env.scheduler.tick()
    s.env.clock.ms += MIN
    await s.env.scheduler.tick()
    const t = s.env.posts.get(post.id)!.targets.find((x) => x.platform === 'tiktok')!
    expect(t.status).toBe('posted')
    expect(t.externalUrl).toContain('/video/777')
    expect(s.calls.uploads).toHaveLength(1)
  })

  it('retries on its own, and explains the reason after the second failure', async () => {
    const boom: UploadPostStatus = { status: 'completed', results: [{ platform: 'tiktok', success: false, message: 'internal_error' }] }
    const s = setup({ statuses: [boom, boom] })
    live(s)
    await s.env.makePost({ whenMs: s.env.clock.ms + MIN, platforms: ['tiktok'] })
    for (let i = 0; i < 12; i++) {
      s.env.clock.ms += 3 * MIN
      await s.env.scheduler.tick()
    }
    const twice = s.env.events.failures.filter(([h]) => /failed twice/i.test(h))
    expect(twice).toHaveLength(1)
    expect(twice[0]![1]).toMatch(/internal_error/)
    expect(s.calls.uploads.length).toBeGreaterThanOrEqual(3)
  })

  it('stops with a plain message when the TikTok login needs signing in again', async () => {
    const s = setup({ statuses: [{ status: 'completed', results: [{ platform: 'tiktok', success: false, message: 'reauth_required' }] }] })
    live(s)
    const post = await s.env.makePost({ whenMs: s.env.clock.ms + MIN, platforms: ['tiktok'] })
    for (let i = 0; i < 4; i++) {
      s.env.clock.ms += 2 * MIN
      await s.env.scheduler.tick()
    }
    const t = s.env.posts.get(post.id)!.targets.find((x) => x.platform === 'tiktok')!
    expect(t.status).toBe('failed')
    expect(t.lastError).toMatch(/signed in again on Upload-Post/)
  })

  it('does not wait on a wrong key', async () => {
    const s = setup({ uploadError: new UploadPostError('Invalid or expired token', 401) })
    live(s)
    const post = await s.env.makePost({ whenMs: s.env.clock.ms + MIN, platforms: ['tiktok'] })
    s.env.clock.ms += 2 * MIN
    await s.env.scheduler.tick()
    const t = s.env.posts.get(post.id)!.targets.find((x) => x.platform === 'tiktok')!
    expect(t.status).toBe('failed')
    expect(t.lastError).toMatch(/does not accept the key/)
  })
})

describe('First comments', () => {
  const MINUTE = 60_000
  async function withComments(opts: { fail?: UploadPostError; tiktokStatus?: UploadPostStatus } = {}) {
    const s = setup()
    s.svc.setKey('k')
    s.svc.setLink(1, 'clock_out_early', { tiktok: true, youtube: true, instagram: true, facebook: true })
    const sent: any[] = []
    const { FirstCommentService } = await import('../src/main/services/firstComments')
    const alerts: string[][] = []
    const fc = new FirstCommentService({
      db: s.env.db,
      uploadPost: s.svc,
      client: {
        async createComment(_k: string, i: any) {
          if (opts.fail) throw opts.fail
          sent.push(i)
          return { id: 'c1', warnings: [] }
        },
        async status() {
          return opts.tiktokStatus ?? { status: 'in_progress', results: [] }
        },
      } as any,
      log: s.env.log,
      alert: (h, d) => alerts.push([h, d]),
      now: () => s.env.clock.ms,
    })
    return { s, fc, sent, alerts }
  }

  // A posted post with targets, made directly in the database so the test does not depend on adapters.
  function posted(s: ReturnType<typeof setup>, over: { platforms: Array<[string, string | null, string | null]>; pinned?: string | null; first?: string | null; perPlatform?: Record<string, string> }) {
    const id = Number(
      s.env.db
        .prepare(
          "INSERT INTO posts (brand_id, video_path, title, caption, status, scheduled_at_utc, first_comment, pinned_comment) VALUES (2, 'x.mp4', 'A video', 'c', 'posted', ?, ?, ?)",
        )
        .run(new Date(s.env.clock.ms).toISOString(), over.first ?? 'Which one first?', over.pinned ?? null).lastInsertRowid,
    )
    const ids: Record<string, number> = {}
    for (const [platform, extId, url] of over.platforms) {
      const settings = over.perPlatform?.[platform] ? JSON.stringify({ firstComment: over.perPlatform[platform] }) : '{}'
      ids[platform] = Number(
        s.env.db
          .prepare(
            "INSERT INTO post_targets (post_id, platform, status, external_id, external_url, posted_at_utc, settings_json) VALUES (?, ?, 'posted', ?, ?, ?, ?)",
          )
          .run(id, platform, extId, url, new Date(s.env.clock.ms).toISOString(), settings).lastInsertRowid,
      )
    }
    return { id, ids }
  }
  const job = (s: ReturnType<typeof setup>, target: number) =>
    s.env.db.prepare('SELECT * FROM first_comment_jobs WHERE target_id = ?').get(target) as any

  it('waits a minute, then comments on YouTube by video id and Facebook by link, and skips Instagram with a reason', async () => {
    const { s, fc, sent } = await withComments()
    s.svc.setLink(2, 'Clock_Out_Early', { tiktok: true, youtube: true, instagram: true, facebook: true })
    const { ids } = posted(s, {
      platforms: [
        ['youtube', 'vid123', null],
        ['facebook', '555', 'https://facebook.com/x/videos/555'],
        ['instagram', '999', 'https://instagram.com/reel/abc'],
      ],
    })
    await fc.sweep()
    expect(sent).toHaveLength(0)
    expect(job(s, ids.instagram).status).toBe('skipped')
    expect(job(s, ids.instagram).last_error).toMatch(/only reply/)
    s.env.clock.ms += 2 * MINUTE
    await fc.sweep()
    expect(sent.map((x) => x.platform).sort()).toEqual(['facebook', 'youtube'])
    expect(sent.find((x) => x.platform === 'youtube')).toMatchObject({ postId: 'vid123', user: 'Clock_Out_Early', message: 'Which one first?' })
    expect(sent.find((x) => x.platform === 'facebook')).toMatchObject({ postUrl: 'https://facebook.com/x/videos/555' })
    expect(job(s, ids.youtube).status).toBe('done')
    await fc.sweep()
    expect(sent).toHaveLength(2)
  })

  it('uses a platform text when there is one, skips unticked platforms and YouTube when pinned_comment covers it', async () => {
    const { s, fc, sent } = await withComments()
    s.svc.setLink(2, 'Clock_Out_Early', { facebook: true, youtube: true })
    const a = posted(s, { platforms: [['facebook', '5', null]], perPlatform: { facebook: 'Facebook only text' } })
    const b = posted(s, { platforms: [['youtube', 'v', null], ['bluesky', 'b', null]], pinned: 'pin me' })
    s.env.clock.ms += 2 * MINUTE
    await fc.sweep()
    expect(sent).toHaveLength(1)
    expect(sent[0].message).toBe('Facebook only text')
    expect(job(s, a.ids.facebook).status).toBe('done')
    expect(job(s, b.ids.youtube).status).toBe('skipped')
    expect(job(s, b.ids.bluesky).status).toBe('skipped')
    expect(job(s, b.ids.bluesky).last_error).toMatch(/not ticked/)
  })

  it('stops with a plain message and an alert when TikTok needs reconnecting, then Try again puts it back in line', async () => {
    const { s, fc, alerts } = await withComments({ fail: new UploadPostError('reconnect', 400, 'tiktok_reconnect_required') })
    s.svc.setLink(2, 'Clock_Out_Early', { tiktok: true })
    const { ids } = posted(s, { platforms: [['tiktok', '7000000000', null]] })
    s.env.clock.ms += 2 * MINUTE
    await fc.sweep()
    const j = job(s, ids.tiktok)
    expect(j.status).toBe('failed')
    expect(j.last_error).toMatch(/connect it again/i)
    expect(alerts[0]![0]).toMatch(/First comment failed on TikTok/)
    expect(alerts[0]![1]).toContain('Which one first?')
    fc.retry(ids.tiktok)
    expect(job(s, ids.tiktok).status).toBe('waiting')
  })

  it('finds the TikTok video id from Upload-Post before commenting', async () => {
    const { s, fc, sent } = await withComments({
      tiktokStatus: { status: 'completed', results: [{ platform: 'tiktok', success: true, postId: '7123', postUrl: 'https://www.tiktok.com/@a/video/7123' }] },
    })
    s.svc.setLink(2, 'Clock_Out_Early', { tiktok: true })
    const { ids } = posted(s, { platforms: [['tiktok', 'elo-5-1-999', null]] })
    s.env.clock.ms += 2 * MINUTE
    await fc.sweep()
    expect(sent[0]).toMatchObject({ platform: 'tiktok', postId: '7123' })
    const t = s.env.db.prepare('SELECT external_id FROM post_targets WHERE id = ?').get(ids.tiktok) as any
    expect(t.external_id).toBe('7123')
  })
})

describe('First comment from a bot drop', () => {
  it('keeps first_comment on the post and first_comments on the platform', async () => {
    const { pipelineSetup } = await import('./pipelineHelpers')
    const p = pipelineSetup({ live: [[1, 'youtube'], [1, 'facebook']] })
    const brand = p.env.brands.list().find((b) => b.id === 1)!
    p.drop(brand.name, brand.slug ?? 'clock-out-early', 1, {
      platforms: ['youtube', 'facebook'],
      first_comment: 'Which one first?',
      first_comments: { facebook: 'Tell us on Facebook' },
    })
    await p.settle()
    const post = p.env.posts.list({ status: 'all' } as any)[0]!
    expect(post.firstComment).toBe('Which one first?')
    expect(post.targets.find((t) => t.platform === 'facebook')!.settings.firstComment).toBe('Tell us on Facebook')
    expect(post.targets.find((t) => t.platform === 'youtube')!.settings.firstComment).toBeUndefined()
  })
})
