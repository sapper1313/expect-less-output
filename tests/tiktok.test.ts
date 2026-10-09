import { existsSync, writeFileSync } from 'fs'
import { afterEach, describe, expect, it } from 'vitest'
import { planChunks } from '../src/main/tiktok/config'
import { classifyTikTokError } from '../src/main/tiktok/client'
import {
  commercialNotice,
  consentKind,
  emptyTikTokSettings,
  tiktokSettingsProblem,
} from '../src/shared/tiktok'
import { ttTokensKey } from '../src/main/tiktok/config'
import type { TikTokPostSettings } from '../src/shared/types'
import { connectTikTok, makeTikTokEnv } from './tiktokHelpers'

const MIN = 60_000
const HOUR = 60 * MIN
const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})
type T = Awaited<ReturnType<typeof makeTikTokEnv>>
async function env(): Promise<T> {
  const t = await makeTikTokEnv()
  closers.push(t.close)
  return t
}
const target = (t: T, postId: number) =>
  t.env.posts.get(postId)!.targets.find((x) => x.platform === 'tiktok')!
const valid = (over: Partial<TikTokPostSettings> = {}): TikTokPostSettings => ({
  ...emptyTikTokSettings(),
  privacy: 'SELF_ONLY',
  consent: true,
  ...over,
})
const bigFile = (t: T, mb: number) => {
  const p = `${t.env.root}/big-${mb}.mp4`
  writeFileSync(p, Buffer.alloc(mb * 1024 * 1024, 5))
  return p
}

describe('chunk plan', () => {
  it('follows TikTok rules: up to 64 MB goes up whole, bigger files use 5 to 64 MB chunks with the remainder in the last', () => {
    const MiB = 1024 * 1024
    expect(planChunks(3 * MiB)).toEqual({ chunkSize: 3 * MiB, count: 1 })
    expect(planChunks(14_072_933)).toEqual({ chunkSize: 14_072_933, count: 1 }) // the video that TikTok refused before
    expect(planChunks(64 * MiB)).toEqual({ chunkSize: 64 * MiB, count: 1 })
    expect(planChunks(100 * MiB)).toEqual({ chunkSize: 10 * MiB, count: 10 })
    const huge = planChunks(10 * 1024 * MiB)
    expect(huge.count).toBeLessThanOrEqual(1000)
    expect(huge.chunkSize).toBeLessThanOrEqual(64 * MiB)
    expect(huge.chunkSize).toBeGreaterThanOrEqual(5 * MiB)
    expect(() => planChunks(0)).toThrow()
  })
})

describe('TikTok error classification', () => {
  it('maps codes to retry, deferral or stop', () => {
    expect(classifyTikTokError(401, 'access_token_invalid', '')).toMatchObject({
      kind: 'transient',
      needsRefresh: true,
    })
    const cap = classifyTikTokError(429, 'spam_risk_too_many_posts', '')
    expect(cap).toMatchObject({ kind: 'transient' })
    expect(cap.retryAfterMs).toBe(3_600_000)
    expect(
      classifyTikTokError(400, 'unaudited_client_can_only_post_to_private_accounts', '').message,
    ).toContain('Only me')
    expect(classifyTikTokError(400, 'privacy_level_option_mismatch', '')).toMatchObject({
      kind: 'permanent',
    })
    expect(classifyTikTokError(500, 'internal_error', '')).toMatchObject({ kind: 'transient' })
    expect(classifyTikTokError(400, 'invalid_param', 'x')).toMatchObject({ kind: 'permanent' })
  })
})

describe('Content Sharing Guidelines rules', () => {
  const info = {
    nickname: 'n',
    username: 'u',
    avatarUrl: null,
    privacyOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
    commentDisabled: false,
    duetDisabled: true,
    stitchDisabled: false,
    maxDurationSec: 60,
  }
  it('starts with nothing chosen and asks for each required thing in order', () => {
    const s = emptyTikTokSettings()
    expect(s).toMatchObject({
      privacy: null,
      allowComment: false,
      allowDuet: false,
      allowStitch: false,
      commercialOn: false,
      consent: false,
    })
    expect(tiktokSettingsProblem(s, info, 10)).toContain('no default')
    s.privacy = 'MUTUAL_FOLLOW_FRIENDS'
    expect(tiktokSettingsProblem(s, info, 10)).toContain('no longer available')
    s.privacy = 'SELF_ONLY'
    expect(tiktokSettingsProblem(s, info, 10)).toContain('consent')
    s.consent = true
    expect(tiktokSettingsProblem(s, info, 10)).toBeNull()
  })
  it('enforces the commercial content rules and creator limits', () => {
    expect(tiktokSettingsProblem(valid({ commercialOn: true }), info, 10)).toContain(
      'promotes yourself, a third party, or both',
    )
    expect(
      tiktokSettingsProblem(valid({ commercialOn: true, brandedContent: true }), info, 10),
    ).toBe('Branded content visibility cannot be set to private.')
    expect(
      tiktokSettingsProblem(
        valid({ commercialOn: true, brandedContent: true, privacy: 'PUBLIC_TO_EVERYONE' }),
        info,
        10,
      ),
    ).toBeNull()
    expect(tiktokSettingsProblem(valid({ allowDuet: true }), info, 10)).toContain(
      'Duet is turned off',
    )
    expect(tiktokSettingsProblem(valid(), info, 90)).toContain('up to 60 seconds')
  })
  it('names the right label and consent policy', () => {
    expect(commercialNotice(valid())).toBeNull()
    expect(commercialNotice(valid({ commercialOn: true, yourBrand: true }))).toContain(
      'Promotional content',
    )
    expect(commercialNotice(valid({ commercialOn: true, brandedContent: true }))).toContain(
      'Paid partnership',
    )
    expect(
      commercialNotice(valid({ commercialOn: true, yourBrand: true, brandedContent: true })),
    ).toContain('Paid partnership')
    expect(consentKind(valid({ commercialOn: true, yourBrand: true }))).toBe('music')
    expect(consentKind(valid({ commercialOn: true, brandedContent: true }))).toBe('branded')
  })
})

describe('connect TikTok', () => {
  it('signs in through the bounce link, uses PKCE, stores tokens encrypted and starts in Drafts', async () => {
    const t = await env()
    const acct = await connectTikTok(t)
    expect(acct).toMatchObject({
      platform: 'tiktok',
      mode: 'drafts',
      status: 'connected',
      displayName: 'Trash Panda TikTok',
      externalId: 'OPEN1',
    })
    expect(t.fake.state.tokenRequests[0]).toMatchObject({
      grant_type: 'authorization_code',
      redirect_uri: 'https://example.test/oauth/tiktok/',
    })
    expect(t.fake.state.tokenRequests[0].code_verifier).toBeTruthy()
    expect(t.secrets.has(ttTokensKey(acct.id))).toBe(true)
    expect(JSON.stringify(t.secrets.status([ttTokensKey(acct.id)]))).not.toContain('tt-access')
    expect(t.service.credentialsStatus().clientSecretMasked.endsWith('cret')).toBe(true)
  })

  it('asks for video.publish only when the toggle is on', async () => {
    const t = await env()
    const seen: string[] = []
    const orig = t.service['d'].openBrowser
    t.service['d'].openBrowser = async (url) => {
      seen.push(new URL(url).searchParams.get('scope') as string)
      return orig(url)
    }
    await connectTikTok(t, 1)
    expect(seen[0]).toBe('user.info.basic,video.upload')
    t.service.saveCredentials('', '', 'https://example.test/oauth/tiktok/', true)
    t.fake.state.user = { ...t.fake.state.user, open_id: 'OPEN2' }
    await connectTikTok(t, 2)
    expect(seen[1]).toBe('user.info.basic,video.upload,video.publish')
  })

  it('works with the Paste code fallback (raw code, encoded code, or the whole link)', async () => {
    for (const style of ['raw', 'encoded', 'link'] as const) {
      const t = await env()
      t.service['d'].openBrowser = async (url) => {
        const r = await fetch(url, { redirect: 'manual' })
        const back = new URL(r.headers.get('location') as string)
        const code = back.searchParams.get('code') as string
        const pasted =
          style === 'raw'
            ? code
            : style === 'encoded'
              ? encodeURIComponent(code)
              : `expectless://oauth/tiktok?code=${encodeURIComponent(code)}&state=${back.searchParams.get('state')}`
        setTimeout(() => t.service.submitCode(pasted), 5)
      }
      const acct = await connectTikTok(t)
      expect(acct.status).toBe('connected')
    }
  })

  it('rejects a link with the wrong state, a denied login, a missing permission, and a pasted code with no sign-in open', async () => {
    const t = await env()
    t.service['d'].openBrowser = async () => {
      setTimeout(() => t.service.handleOpenUrl('expectless://oauth/tiktok?code=x&state=wrong'), 5)
    }
    await expect(connectTikTok(t)).rejects.toThrow(/did not start here/)
    t.service['d'].openBrowser = async () => {
      setTimeout(() => t.service.handleOpenUrl('expectless://oauth/tiktok?error=access_denied'), 5)
    }
    await expect(connectTikTok(t)).rejects.toThrow(/canceled/)
    expect(() => t.service.submitCode('abc')).toThrow(/Click Connect TikTok first/)
    expect(t.service.handleOpenUrl('https://elsewhere.test/')).toBe(false)

    const t2 = await env()
    t2.fake.state.grantedScope = 'user.info.basic'
    await expect(connectTikTok(t2)).rejects.toThrow(/video\.upload/)
  })

  it('refuses a TikTok account already used by another brand, and can disconnect', async () => {
    const t = await env()
    const acct = await connectTikTok(t, 1)
    await expect(connectTikTok(t, 2)).rejects.toThrow(/already connected to Trash Panda/)
    await t.service.disconnect(1)
    expect(t.fake.state.revoked).toHaveLength(1)
    expect(t.secrets.has(ttTokensKey(acct.id))).toBe(false)
    expect(
      (
        t.env.db
          .prepare("SELECT mode FROM accounts WHERE brand_id = 1 AND platform = 'tiktok'")
          .get() as any
      ).mode,
    ).toBe('dry_run')
  })

  it('only allows Direct post after the owner confirms the audit and video.publish was requested', async () => {
    const t = await env()
    expect(() => t.service.setMode(1, 'drafts')).toThrow(/Connect a TikTok account/)
    await connectTikTok(t)
    expect(() => t.service.setMode(1, 'direct')).toThrow(/approve the audit/)
    expect(() => t.service.setMode(1, 'direct', true)).toThrow(/video\.publish/)
    t.service.saveCredentials('', '', 'https://example.test/oauth/tiktok/', true)
    t.service.setMode(1, 'direct', true)
    expect(
      (
        t.env.db
          .prepare("SELECT mode FROM accounts WHERE brand_id = 1 AND platform = 'tiktok'")
          .get() as any
      ).mode,
    ).toBe('direct')
    t.service.setMode(1, 'drafts')
  })
})

describe('TikTok tokens', () => {
  it('reuses a fresh token, refreshes when under an hour is left, and keeps the new refresh token', async () => {
    const t = await env()
    const acct = await connectTikTok(t)
    const a = await t.service.accessToken(acct.id)
    expect(await t.service.accessToken(acct.id)).toBe(a)
    expect(t.fake.state.refreshCount).toBe(0)
    t.env.clock.ms += 23.5 * HOUR
    const b = await t.service.accessToken(acct.id)
    expect(b).not.toBe(a)
    expect(t.fake.state.refreshCount).toBe(1)
    expect(JSON.parse(t.secrets.get(ttTokensKey(acct.id)) as string).refreshToken).toMatch(
      /^tt-refresh-/,
    )
  })

  it('flags needs_reauth with one alert when refresh fails with invalid_grant', async () => {
    const t = await env()
    const acct = await connectTikTok(t)
    t.fake.state.refreshInvalid = true
    t.env.clock.ms += 24 * HOUR
    await expect(t.service.accessToken(acct.id)).rejects.toMatchObject({ kind: 'permanent' })
    expect(
      (t.env.db.prepare('SELECT status FROM accounts WHERE id = ?').get(acct.id) as any).status,
    ).toBe('needs_reauth')
    expect(t.alerts).toEqual([
      ['TikTok needs you to sign in again.', expect.stringContaining('Trash Panda')],
    ])
    await expect(t.service.accessToken(acct.id)).rejects.toThrow(/sign in again/)
    expect(t.alerts).toHaveLength(1)
  })

  it('treats a network failure as temporary', async () => {
    const t = await env()
    const acct = await connectTikTok(t)
    t.env.clock.ms += 24 * HOUR
    await t.fake.close()
    await expect(t.service.accessToken(acct.id)).rejects.toMatchObject({ kind: 'transient' })
    expect(
      (t.env.db.prepare('SELECT status FROM accounts WHERE id = ?').get(acct.id) as any).status,
    ).toBe('connected')
  })

  it('shows the creator and caches the answer for 5 minutes', async () => {
    const t = await env()
    await connectTikTok(t)
    const a = await t.service.creatorInfo(1)
    expect(a).toMatchObject({
      nickname: 'Trash Panda TikTok',
      stitchDisabled: true,
      maxDurationSec: 300,
    })
    await t.service.creatorInfo(1)
    expect(t.fake.state.creatorCalls).toBe(1)
    await t.service.creatorInfo(1, true)
    expect(t.fake.state.creatorCalls).toBe(2)
  })
})

describe('TikTok Drafts mode (upload to inbox)', () => {
  it('uploads, waits for TikTok, then waits for you with the draft notification, and Mark as posted finishes it', async () => {
    const t = await env()
    await connectTikTok(t)
    const post = await t.env.makePost({
      whenMs: t.env.clock.ms + MIN,
      platforms: ['tiktok'],
      title: 'Draft Test',
    })
    t.env.clock.ms += 2 * MIN
    await t.env.scheduler.tick()
    expect(t.fake.state.inits).toHaveLength(1)
    expect(t.fake.state.inits[0].mode).toBe('inbox')
    expect(t.fake.state.inits[0].body.post_info).toBeUndefined()
    expect(Object.values(t.fake.state.uploads)[0].complete).toBe(true)
    expect(target(t, post.id).status).toBe('processing')

    let ticks = 0
    while (target(t, post.id).status !== 'needs_action' && ticks++ < 6) {
      t.env.clock.ms += 30_000
      await t.env.scheduler.tick()
    }
    expect(target(t, post.id).status).toBe('needs_action')
    expect(t.notes).toEqual([
      [
        'TikTok draft ready',
        'TikTok draft ready for Trash Panda. Open TikTok, tap the inbox notification, add the AI label if needed, and post.',
      ],
    ])
    expect(t.env.posts.get(post.id)!.status).toBe('partial')
    expect(t.env.posts.get(post.id)!.videoPath).toContain('/Queue/')
    await t.env.scheduler.tick()
    expect(t.notes).toHaveLength(1) // no second notification

    t.env.scheduler.markPosted(target(t, post.id).id, 'https://www.tiktok.com/@trashpanda/video/1')
    expect(t.env.posts.get(post.id)!.status).toBe('posted')
    expect(existsSync(t.env.library.resolve(t.env.posts.get(post.id)!.videoPath))).toBe(true)
  })

  it('uploads a file over 64 MB in order with the right ranges and reports progress', async () => {
    const t = await env()
    await connectTikTok(t)
    const post = await t.env.posts.create({
      brandId: 1,
      sourcePath: bigFile(t, 70),
      title: 'Big',
      caption: '',
      scheduledAtUtc: new Date(t.env.clock.ms + MIN).toISOString(),
      status: 'scheduled',
      targets: [{ platform: 'tiktok', aiFlag: false }],
    })
    t.env.clock.ms += 2 * MIN
    await t.env.scheduler.tick()
    const u = Object.values(t.fake.state.uploads)[0]
    const MiB = 1024 * 1024
    expect(u.chunks).toEqual(
      Array.from({ length: 7 }, (_, i) => [i * 10 * MiB, (i + 1) * 10 * MiB - 1]),
    )
    expect(u.complete).toBe(true)
    expect(t.fake.state.inits[0].body.source_info).toMatchObject({
      video_size: 70 * MiB,
      chunk_size: 10 * MiB,
      total_chunk_count: 7,
    })
    expect(t.env.posts.get(post.id)!.targets[0].progress).toBe(1)
  })

  it('uploads a 14 MB file whole in one piece', async () => {
    const t = await env()
    await connectTikTok(t)
    await t.env.posts.create({
      brandId: 1,
      sourcePath: bigFile(t, 14),
      title: 'Whole',
      caption: '',
      scheduledAtUtc: new Date(t.env.clock.ms + MIN).toISOString(),
      status: 'scheduled',
      targets: [{ platform: 'tiktok', aiFlag: false }],
    })
    t.env.clock.ms += 2 * MIN
    await t.env.scheduler.tick()
    const MiB = 1024 * 1024
    expect(t.fake.state.inits[0].body.source_info).toMatchObject({
      video_size: 14 * MiB,
      chunk_size: 14 * MiB,
      total_chunk_count: 1,
    })
    expect(Object.values(t.fake.state.uploads)[0].chunks).toEqual([[0, 14 * MiB - 1]])
  })

  it('retries a chunk after a dropped connection and a temporary server error', async () => {
    const t = await env()
    await connectTikTok(t)
    t.fake.state.uploadFault = (n) => (n === 1 ? 'drop' : n === 2 ? '503' : null)
    const post = await t.env.makePost({
      whenMs: t.env.clock.ms + MIN,
      platforms: ['tiktok'],
      bytes: 300_000,
    })
    t.env.clock.ms += 2 * MIN
    await t.env.scheduler.tick()
    expect(Object.values(t.fake.state.uploads)[0].complete).toBe(true)
    expect(Object.keys(t.fake.state.uploads)).toHaveLength(1)
    expect(target(t, post.id).status).toBe('processing')
  })

  it('starts a fresh upload when the upload address has expired', async () => {
    const t = await env()
    await connectTikTok(t)
    t.fake.state.uploadFault = (n) => (n === 1 ? '403' : null)
    const post = await t.env.makePost({ whenMs: t.env.clock.ms + MIN, platforms: ['tiktok'] })
    t.env.clock.ms += 2 * MIN
    await t.env.scheduler.tick()
    expect(target(t, post.id)).toMatchObject({ status: 'pending', attempts: 1 })
    t.env.clock.ms += 2 * MIN + 1000
    await t.env.scheduler.tick()
    expect(Object.keys(t.fake.state.uploads)).toHaveLength(2)
    expect(target(t, post.id).status).toBe('processing')
  })

  it('reports why TikTok failed a video, and retries only temporary reasons', async () => {
    const t = await env()
    await connectTikTok(t)
    t.fake.state.failReason = 'file_format_check_failed'
    const post = await t.env.makePost({ whenMs: t.env.clock.ms + MIN, platforms: ['tiktok'] })
    t.env.clock.ms += 2 * MIN
    for (let i = 0; i < 5 && target(t, post.id).status !== 'failed'; i++) {
      await t.env.scheduler.tick()
      t.env.clock.ms += 30_000
    }
    expect(target(t, post.id).status).toBe('failed')
    expect(target(t, post.id).lastError).toContain('file_format_check_failed')

    const t2 = await env()
    await connectTikTok(t2)
    t2.fake.state.failReason = 'internal_error'
    const p2 = await t2.env.makePost({ whenMs: t2.env.clock.ms + MIN, platforms: ['tiktok'] })
    t2.env.clock.ms += 2 * MIN
    for (let i = 0; i < 4 && !target(t2, p2.id).lastError; i++) {
      await t2.env.scheduler.tick()
      t2.env.clock.ms += 30_000
    }
    expect(target(t2, p2.id)).toMatchObject({ status: 'pending' })
    expect(target(t2, p2.id).lastError).toContain('internal_error')
  })

  it('refreshes the token once when TikTok says it is no longer accepted', async () => {
    const t = await env()
    await connectTikTok(t)
    t.fake.state.failNext.push({
      match: /inbox\/video\/init/,
      status: 401,
      code: 'access_token_invalid',
    })
    const post = await t.env.makePost({ whenMs: t.env.clock.ms + MIN, platforms: ['tiktok'] })
    t.env.clock.ms += 2 * MIN
    await t.env.scheduler.tick()
    expect(t.fake.state.refreshCount).toBe(1)
    expect(target(t, post.id).status).toBe('processing')
  })

  it('pushes a post an hour later when the daily limit is hit, alerts once, and never uses up retries', async () => {
    const t = await env()
    await connectTikTok(t)
    t.fake.state.failNext.push({
      match: /inbox\/video\/init/,
      status: 429,
      code: 'spam_risk_too_many_posts',
      message: 'limit',
    })
    t.fake.state.failNext.push({
      match: /inbox\/video\/init/,
      status: 429,
      code: 'spam_risk_too_many_posts',
      message: 'limit',
    })
    const post = await t.env.makePost({
      whenMs: t.env.clock.ms + MIN,
      platforms: ['tiktok'],
      title: 'Busy',
    })
    t.env.clock.ms += 2 * MIN
    await t.env.scheduler.tick()
    const first = target(t, post.id)
    expect(first).toMatchObject({ status: 'pending', attempts: 0 })
    expect((new Date(first.nextAttemptAtUtc!).getTime() - t.env.clock.ms) / MIN).toBe(60)
    expect(t.env.events.failures).toHaveLength(1)
    expect(t.env.events.failures[0][0]).toBe('TikTok is full for today.')

    t.env.clock.ms += 30 * MIN
    await t.env.scheduler.tick() // too early
    expect(t.fake.state.inits).toHaveLength(0)
    t.env.clock.ms += 31 * MIN
    await t.env.scheduler.tick() // second cap hit
    expect(t.env.events.failures).toHaveLength(1) // no second alert
    expect(target(t, post.id).attempts).toBe(0)
    t.env.clock.ms += 61 * MIN
    await t.env.scheduler.tick()
    expect(target(t, post.id).status).toBe('processing')
  })
})

describe('TikTok Direct post (mocked, real posts only after audit approval)', () => {
  async function direct(t: T) {
    await connectTikTok(t)
    t.service.saveCredentials('', '', 'https://example.test/oauth/tiktok/', true)
    t.service.setMode(1, 'direct', true)
  }
  const sched = (
    t: T,
    settings?: TikTokPostSettings,
    extra: Partial<Parameters<T['env']['posts']['create']>[0]> = {},
  ) =>
    t.env.posts.create({
      brandId: 1,
      sourcePath: (() => {
        const p = `${t.env.root}/d-${Math.random().toString(36).slice(2)}.mp4`
        writeFileSync(p, 'direct video bytes')
        return p
      })(),
      title: 'Direct',
      caption: 'Hello #funny',
      scheduledAtUtc: new Date(t.env.clock.ms + MIN).toISOString(),
      status: 'scheduled',
      targets: [
        { platform: 'tiktok', aiFlag: true, settings: settings ? { tiktok: settings } : undefined },
      ],
      ...extra,
    })

  it('refuses to schedule without the creator choices, with a clear message', async () => {
    const t = await env()
    await direct(t)
    await expect(sched(t)).rejects.toThrow(/TikTok: Choose the TikTok privacy/)
    await expect(sched(t, valid({ privacy: null }))).rejects.toThrow(/no default/)
    await expect(sched(t, valid({ consent: false }))).rejects.toThrow(/consent line/)
    await expect(sched(t, valid({ commercialOn: true, brandedContent: true }))).rejects.toThrow(
      /cannot be set to private/,
    )
    // Drafts mode does not need any of it
    t.service.setMode(1, 'drafts')
    await expect(sched(t)).resolves.toBeTruthy()
  })

  it('sends the creator choices, the commercial toggles and the AI flag, then reports posted with a link', async () => {
    const t = await env()
    await direct(t)
    const post = await sched(
      t,
      valid({
        privacy: 'PUBLIC_TO_EVERYONE',
        allowComment: true,
        allowStitch: false,
        commercialOn: true,
        yourBrand: true,
      }),
    )
    t.env.clock.ms += 2 * MIN
    await t.env.scheduler.tick()
    const init = t.fake.state.inits[0]
    expect(init.mode).toBe('direct')
    expect(init.body.post_info).toEqual({
      title: 'Hello #funny',
      privacy_level: 'PUBLIC_TO_EVERYONE',
      disable_comment: false,
      disable_duet: true,
      disable_stitch: true,
      brand_content_toggle: false,
      brand_organic_toggle: true,
      is_aigc: true,
    })
    let ticks = 0
    while (target(t, post.id).status !== 'posted' && ticks++ < 6) {
      t.env.clock.ms += 30_000
      await t.env.scheduler.tick()
    }
    const done = target(t, post.id)
    expect(done.status).toBe('posted')
    expect(done.externalUrl).toBe('https://www.tiktok.com/@/video/7000000000000000001')
    expect(t.env.posts.get(post.id)!.status).toBe('posted')
  })

  it('sends the cover frame as video_cover_timestamp_ms in Direct Post', async () => {
    const t = await env()
    await direct(t)
    const post = await sched(t, valid({ privacy: 'PUBLIC_TO_EVERYONE' }))
    t.env.db
      .prepare('UPDATE post_targets SET settings_json = ? WHERE post_id = ?')
      .run(JSON.stringify({ tiktok: valid({ privacy: 'PUBLIC_TO_EVERYONE' }), coverTimestampMs: 2300 }), post.id)
    t.env.clock.ms += 2 * MIN
    await t.env.scheduler.tick()
    expect(t.fake.state.inits[0].body.post_info).toMatchObject({ video_cover_timestamp_ms: 2300 })
  })

  it('asks TikTok again right before posting and stops if the chosen privacy option is gone', async () => {
    const t = await env()
    await direct(t)
    const post = await sched(t, valid({ privacy: 'MUTUAL_FOLLOW_FRIENDS' }))
    t.fake.state.creator.privacy_level_options = ['SELF_ONLY']
    t.service.cancelConnect()
    t.env.clock.ms += 2 * MIN
    const before = t.fake.state.creatorCalls
    await t.env.scheduler.tick()
    expect(t.fake.state.creatorCalls).toBeGreaterThan(before)
    const x = target(t, post.id)
    expect(x.status).toBe('failed')
    expect(x.lastError).toContain('no longer available')
    expect(t.fake.state.inits).toHaveLength(0)
  })

  it('stops when the video is longer than the creator allows, or when a toggle was turned off in TikTok', async () => {
    const t = await env()
    await direct(t)
    const post = await sched(t, valid())
    t.env.db
      .prepare('UPDATE posts SET video_meta_json = ? WHERE id = ?')
      .run(JSON.stringify({ durationSeconds: 400 }), post.id)
    t.env.clock.ms += 2 * MIN
    await t.env.scheduler.tick()
    expect(target(t, post.id).lastError).toContain('up to 300 seconds')
    const t2 = await env()
    await direct(t2)
    const p2 = await sched(t2, valid({ allowStitch: true }))
    t2.env.clock.ms += 2 * MIN
    await t2.env.scheduler.tick()
    expect(target(t2, p2.id).lastError).toContain('Stitch is turned off')
  })

  it('explains the unaudited app rule when TikTok blocks a public post', async () => {
    const t = await env()
    await direct(t)
    t.fake.state.failNext.push({
      match: /\/video\/init/,
      status: 403,
      code: 'unaudited_client_can_only_post_to_private_accounts',
    })
    const post = await sched(t, valid({ privacy: 'PUBLIC_TO_EVERYONE' }))
    t.env.clock.ms += 2 * MIN
    await t.env.scheduler.tick()
    expect(target(t, post.id)).toMatchObject({ status: 'failed', attempts: 1 })
    expect(target(t, post.id).lastError).toContain('not approved this app for public posts')
  })
})
