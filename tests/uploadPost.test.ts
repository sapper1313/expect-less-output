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
