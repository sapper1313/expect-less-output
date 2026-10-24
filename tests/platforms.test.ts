import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { SecretStore } from '../src/main/services/secrets'
import { PlatformService } from '../src/main/platforms/service'
import { XAdapter, XClient, xUrls } from '../src/main/platforms/x'
import {
  LinkedInAdapter,
  LinkedInClient,
  linkedinUrls,
  escapeCommentary,
} from '../src/main/platforms/linkedin'
import { PinterestAdapter, PinterestClient, pinterestUrls } from '../src/main/platforms/pinterest'
import { SnapchatAdapter } from '../src/main/platforms/snapchat'
import { BlueskyAdapter } from '../src/main/platforms/bluesky'
import { AdapterError, type AdapterContext } from '../src/main/adapters/types'
import { SocialError } from '../src/main/studio/social/errors'
import type { Account } from '../src/shared/types'
import { fakeCrypto } from './googleHelpers'
import { fakePlatforms } from './platformsFake'
import { makeEnv } from './helpers'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})

async function rig(opts: { bluesky?: (b: number) => string | null } = {}) {
  const fake = await fakePlatforms()
  closers.push(fake.close)
  const env = makeEnv()
  const dir = mkdtempSync(join(tmpdir(), 'elo-plat-'))
  const secrets = new SecretStore(join(dir, 's.bin'), fakeCrypto)
  const env2 = {
    ELO_X_BASE: fake.base,
    ELO_LINKEDIN_BASE: fake.base,
    ELO_PINTEREST_BASE: fake.base,
  } as NodeJS.ProcessEnv
  const clients = {
    x: new XClient({ urls: xUrls(env2) }),
    linkedin: new LinkedInClient({ urls: linkedinUrls(env2) }),
    pinterest: new PinterestClient({ urls: pinterestUrls(env2) }),
  }
  const alerts: string[][] = []
  const svc = new PlatformService({
    db: env.db,
    secrets,
    log: env.log,
    clients,
    bluesky: { notReady: opts.bluesky ?? (() => 'no login'), handle: () => 'veda.bsky.social' },
    // The "browser": approve right away by calling the address the sign-in waits on.
    openBrowser: async (url) => {
      const u = new URL(url)
      const redirect = u.searchParams.get('redirect_uri') as string
      const state = u.searchParams.get('state') as string
      void fetch(`${redirect}?code=abc&state=${state}`)
    },
    alert: (h, d) => alerts.push([h, d]),
    emit: () => {},
    now: () => env.clock.ms,
  })
  const video = join(dir, 'v.mp4')
  writeFileSync(video, Buffer.alloc(6 * 1024 * 1024, 3))
  const logs: string[] = []
  const state: Record<string, unknown> = {}
  const ctxFor = (a: Account | null, over: Partial<AdapterContext> = {}): AdapterContext => ({
    postId: 1,
    targetId: 1,
    brandId: 1,
    brandName: 'The Math of It',
    title: 'Skip the latte',
    caption: 'Skip the $6 latte (really) #money',
    aiFlag: true,
    videoAbsPath: video,
    externalId: null,
    videoDurationSeconds: 30,
    videoSizeBytes: 6 * 1024 * 1024,
    videoWidth: 1080,
    videoHeight: 1920,
    scheduledAtUtc: new Date(env.clock.ms).toISOString(),
    account: a,
    getState: () => state,
    setState: (p) => void Object.assign(state, p),
    settings: {},
    nowMs: () => env.clock.ms,
    reportProgress: () => {},
    ...over,
  })
  const account = (platform: string) =>
    env.brands.listAccounts(1).find((a) => a.platform === platform) as Account
  return { fake, env, svc, clients, alerts, ctxFor, account, logs, state, video }
}
const log = () => {}

describe('X', () => {
  it('signs in, uploads in pieces, posts, and keeps the login fresh', async () => {
    const r = await rig()
    r.svc.saveCredentials('x', 'cid', 'csec')
    const v = await r.svc.connect(1, 'x')
    expect(v).toMatchObject({ platform: 'x', state: 'connected', displayName: '@mathofit' })
    const adapter = new XAdapter({
      client: r.clients.x,
      accessToken: (id, f) => r.svc.accessToken(id, f),
      log,
    })
    const ctx = r.ctxFor(r.account('x'))
    await adapter.validate(ctx)
    const res = await adapter.publish(ctx)
    expect(res).toMatchObject({
      status: 'posted',
      externalId: 'tweet-9',
      externalUrl: 'https://x.com/@mathofit/status/tweet-9'.replace('@', ''),
    })
    const paths = r.fake.seen.map((s) => s.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        '/2/media/upload/initialize',
        '/2/media/upload/media-1/append',
        '/2/media/upload/media-1/finalize',
        '/2/tweets',
      ]),
    )
    expect(paths.filter((p) => p.endsWith('/append'))).toHaveLength(2) // 6 MB in 4 MB pieces
    const tweet = r.fake.seen.find((s) => s.path === '/2/tweets')!
    expect(tweet.headers.authorization).toBe('Bearer x-access')
    expect(JSON.parse(tweet.body)).toEqual({
      text: 'Skip the $6 latte (really) #money',
      media: { media_ids: ['media-1'] },
    })
    // A second try after success does not post again.
    const before = r.fake.seen.length
    await adapter.publish(ctx)
    expect(r.fake.seen.length).toBe(before)
  })

  it('refreshes a login that is about to end, and flags a refused one', async () => {
    const r = await rig()
    r.svc.saveCredentials('x', 'cid', 'csec')
    await r.svc.connect(1, 'x')
    r.env.clock.ms += 3 * 3_600_000 // past the 2 hours the fake gave
    expect(await r.svc.accessToken(r.account('x').id)).toBe('x-access')
    expect(
      r.fake.seen.some((s) => s.path === '/2/oauth2/token' && s.body.includes('refresh_token')),
    ).toBe(true)
    r.fake.failNext('/2/oauth2/token', 400)
    await expect(r.svc.accessToken(r.account('x').id, true)).rejects.toBeInstanceOf(AdapterError)
    expect(r.account('x').status).toBe('needs_reauth')
    expect(r.alerts[0]![0]).toContain('sign in again')
  })

  it('treats a busy answer as retryable and a refusal as final', async () => {
    const r = await rig()
    r.svc.saveCredentials('x', 'cid', 'csec')
    await r.svc.connect(1, 'x')
    const adapter = new XAdapter({
      client: r.clients.x,
      accessToken: (id, f) => r.svc.accessToken(id, f),
      log,
    })
    r.fake.failNext('/2/tweets', 429)
    await expect(adapter.publish(r.ctxFor(r.account('x')))).rejects.toMatchObject({
      kind: 'transient',
    })
    r.fake.failNext('/2/tweets', 403)
    await expect(adapter.publish(r.ctxFor(r.account('x')))).rejects.toMatchObject({
      kind: 'permanent',
    })
  })

  it('needs the app keys first', async () => {
    const r = await rig()
    await expect(r.svc.connect(1, 'x')).rejects.toThrow(/Client ID/)
  })
})

describe('LinkedIn', () => {
  it('uploads the video, finishes it, and posts as the person', async () => {
    const r = await rig()
    r.svc.saveCredentials('linkedin', 'cid', 'csec')
    expect(await r.svc.connect(1, 'linkedin')).toMatchObject({
      displayName: 'Veda Host',
      externalId: 'abc123',
    })
    const adapter = new LinkedInAdapter({
      client: r.clients.linkedin,
      accessToken: (id) => r.svc.accessToken(id),
      log,
    })
    const res = await adapter.publish(r.ctxFor(r.account('linkedin')))
    expect(res).toMatchObject({ status: 'posted', externalId: 'urn:li:share:S1' })
    const post = JSON.parse(r.fake.seen.find((s) => s.path === '/rest/posts')!.body)
    expect(post.author).toBe('urn:li:person:abc123')
    expect(post.commentary).toBe('Skip the $6 latte \\(really\\) #money')
    expect(post.content.media.id).toBe('urn:li:video:V1')
    const init = r.fake.seen.find((s) => s.path.includes('initializeUpload'))!
    expect(init.headers['linkedin-version']).toBeTruthy()
    expect(init.headers['x-restli-protocol-version']).toBe('2.0.0')
    const fin = JSON.parse(r.fake.seen.find((s) => s.path.includes('finalizeUpload'))!.body)
    expect(fin.finalizeUploadRequest.uploadedPartIds).toEqual(['etag-part-1'])
  })

  it('warns a week before a login that cannot refresh runs out', async () => {
    const r = await rig()
    r.svc.saveCredentials('linkedin', 'cid', 'csec')
    await r.svc.connect(1, 'linkedin')
    r.env.clock.ms += 55 * 86_400_000 // 60 day login, 5 days left
    expect(r.svc.checkHealth()).toBe(1)
    expect(r.svc.checkHealth()).toBe(0)
    expect(r.alerts[0]![0]).toContain('ends soon')
  })

  it('escapes the characters LinkedIn reads as formatting', () => {
    expect(escapeCommentary('a (b) [c] {d} <e> @f *g* _h_ ~i~ |j| \\k')).toBe(
      'a \\(b\\) \\[c\\] \\{d\\} \\<e\\> \\@f \\*g\\* \\_h\\_ \\~i\\~ \\|j\\| \\\\k',
    )
  })
})

describe('Pinterest', () => {
  it('connects, lists boards, uploads the video and creates the pin', async () => {
    const r = await rig()
    r.svc.saveCredentials('pinterest', 'cid', 'csec')
    await r.svc.connect(1, 'pinterest')
    const adapter = new PinterestAdapter({
      client: r.clients.pinterest,
      accessToken: (id) => r.svc.accessToken(id),
      log,
    })
    // No board yet: stopped before anything is uploaded.
    await expect(adapter.validate(r.ctxFor(r.account('pinterest')))).rejects.toThrow(/board/)
    expect(await r.svc.boards(1)).toEqual([{ id: 'b1', name: 'Money tips' }])
    r.svc.setBoard(1, 'b1', 'Money tips')
    const ctx = r.ctxFor(r.account('pinterest'))
    await adapter.validate(ctx)
    const res = await adapter.publish(ctx)
    expect(res).toMatchObject({
      status: 'posted',
      externalId: 'pin-5',
      externalUrl: 'https://www.pinterest.com/pin/pin-5/',
    })
    const pin = JSON.parse(r.fake.seen.find((s) => s.path === '/v5/pins')!.body)
    expect(pin).toMatchObject({
      board_id: 'b1',
      title: 'Skip the latte',
      media_source: { source_type: 'video_id', media_id: 'm-7' },
    })
    // Signing in again keeps the board.
    await r.svc.connect(1, 'pinterest')
    expect(r.account('pinterest').externalId).toBe('b1')
  })
})

describe('Snapchat, Bluesky and who counts as connected', () => {
  it('Snapchat waits for you and copies the caption', async () => {
    const notes: string[][] = []
    const copied: string[] = []
    const a = new SnapchatAdapter({
      host: { notify: (t, b) => notes.push([t, b]), copyText: (t) => copied.push(t), log },
    })
    const r = await rig()
    const res = await a.publish(r.ctxFor(null))
    expect(res.status).toBe('needs_action')
    expect(copied[0]).toContain('latte')
    expect(notes[0]![1]).toContain('Mark as posted')
  })

  it('Snapchat is connected by a name, and removed by clearing it', async () => {
    const r = await rig()
    expect(r.svc.connected(1)).toEqual([])
    r.svc.setSnapchat(1, '@mathofit')
    expect(r.svc.connected(1)).toEqual(['snapchat'])
    r.svc.setSnapchat(1, '')
    expect(r.svc.connected(1)).toEqual([])
  })

  it('a channel with a Bluesky login is connected, and one without is not', async () => {
    let ready = true
    const r = await rig({ bluesky: (b) => (b === 1 && ready ? null : 'no login') })
    expect(r.svc.connected(1)).toEqual(['bluesky'])
    expect(r.svc.connected(2)).toEqual([])
    ready = false
    expect(r.svc.connected(1)).toEqual([])
  })

  it('Bluesky posts with the saved login, and waits when the daily limit is used', async () => {
    const calls: Array<Record<string, unknown>> = []
    const mk = (canUpload: boolean) =>
      new BlueskyAdapter({
        client: () =>
          ({
            uploadLimits: async () => ({ canUpload, message: 'limit' }),
            postVideo: async (a: Record<string, unknown>) => (
              calls.push(a),
              { uri: 'at://x', cid: 'c', url: 'https://bsky.app/x' }
            ),
          }) as never,
        log,
      })
    const r = await rig()
    const acct = { id: 1, status: 'connected' } as Account
    const ok = await mk(true).publish(r.ctxFor(acct))
    expect(ok).toMatchObject({ status: 'posted', externalUrl: 'https://bsky.app/x' })
    expect(calls[0]).toMatchObject({ width: 1080, height: 1920, alt: 'Skip the latte' })
    await expect(mk(false).publish(r.ctxFor(acct))).rejects.toMatchObject({
      kind: 'transient',
      retryAfterMs: 3_600_000,
    })
    const bad = new BlueskyAdapter({
      client: () =>
        ({
          uploadLimits: async () => null,
          postVideo: async () => {
            throw new SocialError('bad login', 'permanent')
          },
        }) as never,
      log,
    })
    await expect(bad.publish(r.ctxFor(acct))).rejects.toMatchObject({ kind: 'permanent' })
    await expect(mk(true).validate(r.ctxFor(null))).rejects.toThrow(/login/)
    await expect(mk(true).validate(r.ctxFor(acct, { videoDurationSeconds: 400 }))).rejects.toThrow(
      /Bluesky/,
    )
  })
})
