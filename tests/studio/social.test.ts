import { writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { BlueskyClient } from '../../src/main/studio/social/bluesky'
import { PublicHost } from '../../src/main/studio/social/publicHost'
import { SocialPublisher } from '../../src/main/studio/social/socialPublisher'
import { makePlaceholderVideo } from '../../src/main/studio/ffmpeg'
import { makeStudioEnv } from './helpers'

vi.setConfig({ testTimeout: 60_000 })
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
const noSleep = async () => {}

describe('Bluesky client', () => {
  function fake(opts: { expireFirst?: boolean } = {}) {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }> = []
    let logins = 0
    let jobPolls = 0
    let expired = !!opts.expireFirst
    const f = (async (url: string, init?: RequestInit) => {
      const u = new URL(url)
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
      let body: unknown
      if (typeof init?.body === 'string') body = JSON.parse(init.body)
      else if (init?.body) body = (await new Response(init.body as never).arrayBuffer()).byteLength
      calls.push({ url, method: init?.method ?? 'GET', headers, body })
      const p = u.pathname
      if (p.endsWith('createSession')) {
        logins++
        return json({ accessJwt: `jwt${logins}`, refreshJwt: 'r', did: 'did:plc:abc', didDoc: { service: [{ serviceEndpoint: 'https://pds.example.net' }] } })
      }
      if (p.endsWith('getServiceAuth')) {
        if (expired) {
          expired = false
          return json({ error: 'ExpiredToken' }, 400)
        }
        return json({ token: `svc-${u.searchParams.get('lxm')}` })
      }
      if (p.endsWith('getUploadLimits')) return json({ canUpload: true, remainingDailyVideos: 20, remainingDailyBytes: 1e9 })
      if (p.endsWith('uploadVideo')) return json({ jobStatus: { jobId: 'J1', state: 'JOB_STATE_CREATED' } })
      if (p.endsWith('getJobStatus')) return json({ jobStatus: { state: ++jobPolls < 2 ? 'JOB_STATE_PROCESSING' : 'JOB_STATE_COMPLETED', blob: { $type: 'blob', ref: { $link: 'bafy1' }, mimeType: 'video/mp4', size: 99 } } })
      if (p.endsWith('createRecord')) return json({ uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz', cid: 'cid1' })
      if (p.endsWith('getPostThread')) return json({ thread: { replies: [{ post: { uri: 'at://x/app.bsky.feed.post/r1', cid: 'c2', author: { handle: 'fan.bsky.social' }, record: { text: 'Love it', createdAt: '2026-06-01T00:00:00Z' } } }] } })
      return json({}, 404)
    }) as unknown as typeof fetch
    return { f, calls }
  }
  const creds = { handle: () => 'elo.bsky.social', password: () => 'app-pass' }

  it('logs in, uploads the video to the video service with a service token, waits for the job, and posts with the video embed', async () => {
    const { f, calls } = fake()
    const e = makeStudioEnv()
    const file = join(e.dir, 'b.mp4')
    await makePlaceholderVideo({ out: file, seconds: 2, width: 270, height: 480 })
    const c = new BlueskyClient(creds, f, undefined, noSleep)
    const state: Record<string, unknown> = {}
    const r = await c.postVideo({ text: 'Hello Bluesky', file, width: 270, height: 480, alt: 'A clip', state, setState: (p) => Object.assign(state, p) })
    expect(r.url).toBe('https://bsky.app/profile/elo.bsky.social/post/3kxyz')
    // service auth for the PDS, with the uploadBlob scope, then upload to video.bsky.app with that token
    const auth = calls.find((x) => x.url.includes('getServiceAuth'))!
    expect(new URL(auth.url).searchParams.get('aud')).toBe('did:web:pds.example.net')
    expect(new URL(auth.url).searchParams.get('lxm')).toBe('com.atproto.repo.uploadBlob')
    const up = calls.find((x) => x.url.includes('app.bsky.video.uploadVideo'))!
    expect(up.url.startsWith('https://video.bsky.app/')).toBe(true)
    expect(new URL(up.url).searchParams.get('did')).toBe('did:plc:abc')
    expect(up.headers.authorization).toBe('Bearer svc-com.atproto.repo.uploadBlob')
    expect(up.headers['content-type']).toBe('video/mp4')
    const rec = calls.find((x) => x.url.includes('createRecord'))!.body as { record: { text: string; embed: { $type: string; aspectRatio: unknown; video: unknown } } }
    expect(rec.record.text).toBe('Hello Bluesky')
    expect(rec.record.embed).toMatchObject({ $type: 'app.bsky.embed.video', aspectRatio: { width: 270, height: 480 }, alt: 'A clip' })
    expect(rec.record.embed.video).toMatchObject({ mimeType: 'video/mp4' })
    // a retry reuses the finished blob: no second upload
    await c.postVideo({ text: 'Hello Bluesky', file, width: 270, height: 480, state, setState: (p) => Object.assign(state, p) })
    expect(calls.filter((x) => x.url.includes('uploadVideo'))).toHaveLength(1)
  })

  it('signs in again when the token has expired, reads the daily limits, and handles replies', async () => {
    const { f, calls } = fake({ expireFirst: true })
    const c = new BlueskyClient(creds, f, undefined, noSleep)
    const limits = await c.uploadLimits()
    expect(limits).toMatchObject({ canUpload: true, remainingDailyVideos: 20 })
    expect(calls.filter((x) => x.url.includes('createSession'))).toHaveLength(2)
    const replies = await c.listReplies('at://did:plc:abc/app.bsky.feed.post/3kxyz')
    expect(replies[0]).toMatchObject({ text: 'Love it', username: 'fan.bsky.social' })
    const ref = await c.replyText('Thanks!', { uri: 'at://r', cid: 'c' }, { uri: replies[0].uri, cid: replies[0].cid })
    expect(ref.uri).toContain('3kxyz')
    const body = calls.filter((x) => x.url.includes('createRecord')).pop()!.body as { record: { reply: { root: unknown; parent: { uri: string } } } }
    expect(body.record.reply.parent.uri).toBe('at://x/app.bsky.feed.post/r1')
  })

  it('refuses a wrong app password with a plain message', async () => {
    const c = new BlueskyClient(creds, (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch)
    await expect(c.login()).rejects.toThrow(/refused that handle and app password/)
  })
})

describe('Public host (S3 compatible, Cloudflare R2)', () => {
  it('uploads with a signed request and returns the public address, and deletes after', async () => {
    const seen: Array<{ method: string; url: string; auth: string }> = []
    const f = (async (url: string, init?: RequestInit) => {
      seen.push({ method: init?.method ?? 'GET', url, auth: (init?.headers as Record<string, string>).authorization })
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch
    const e = makeStudioEnv({ fetchImpl: f })
    e.studio.cfg.set({ publicHost: { endpoint: 'https://acct123.r2.cloudflarestorage.com', bucket: 'elo-temp', publicBase: 'https://pub.example.com', region: 'auto' } })
    const host = new PublicHost(e.studio.cfg, e.secrets, f, () => Date.UTC(2026, 5, 3, 12))
    expect(host.configured()).toBe(false)
    await e.studio.setKey('r2id', 'KEYID123')
    await e.studio.setKey('r2secret', 'SECRET456')
    expect(host.configured()).toBe(true)
    const file = join(e.dir, 'c.jpg')
    writeFileSync(file, 'jpegbytes')
    const up = await host.upload(file, 'covers/x 1.jpg')
    expect(up.url).toBe('https://pub.example.com/covers/x 1.jpg')
    expect(seen[0].method).toBe('PUT')
    expect(seen[0].url).toBe('https://acct123.r2.cloudflarestorage.com/elo-temp/covers/x%201.jpg')
    expect(seen[0].auth).toMatch(/^AWS4-HMAC-SHA256 Credential=KEYID123\/20260603\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
    await host.remove(up.key)
    expect(seen[1].method).toBe('DELETE')
    // the secret itself is never part of any request
    expect(JSON.stringify(seen)).not.toContain('SECRET456')
  })
})

describe('Social publisher (Threads and Bluesky)', () => {
  function build(e: ReturnType<typeof makeStudioEnv>, bluesky: BlueskyClient) {
    const alerts: unknown[] = []
    const pub = new SocialPublisher({
      db: e.db,
      cfg: e.studio.cfg,
      bluesky: () => bluesky,
      alert: (i) => alerts.push(i),
      log: () => {},
      brandName: () => 'Trash Panda',
      now: () => e.clock.ms,
    })
    return { pub, alerts }
  }
  const row = (e: ReturnType<typeof makeStudioEnv>, platform: 'bluesky', video: string) => ({ episodeId: null, brandId: 1, platform, text: 'Hi', videoPath: video, title: 'A clip', scheduledAtUtc: new Date(e.clock.ms).toISOString(), mock: false })

  it('retries a busy platform after 2, 10 and 30 minutes, then fails once with the failure alert', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 12) })
    const busy = (async () => new Response('slow down', { status: 503 })) as unknown as typeof fetch
    const bs = new BlueskyClient({ handle: () => 'a.bsky.social', password: () => 'p' }, busy, undefined, noSleep)
    const { pub, alerts } = build(e, bs)
    const r = pub.add(row(e, 'bluesky', '/nonexistent.mp4'))
    await pub.tick()
    expect(pub.get(r.id)).toMatchObject({ status: 'scheduled', attempts: 1 })
    expect(await pub.tick()).toBe(0) // waiting for the 2 minute backoff
    e.clock.ms += 2 * 60_000
    await pub.tick()
    expect(pub.get(r.id)!.attempts).toBe(2)
    e.clock.ms += 10 * 60_000
    await pub.tick()
    expect(pub.get(r.id)!.attempts).toBe(3)
    e.clock.ms += 30 * 60_000
    await pub.tick()
    expect(pub.get(r.id)).toMatchObject({ status: 'failed', attempts: 4 })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ kind: 'failure', headline: 'Could not post. Probably for the best.', platform: 'Bluesky', brand: 'Trash Panda' })
    pub.retry(r.id)
    expect(pub.get(r.id)).toMatchObject({ status: 'scheduled', attempts: 0 })
  })
})

describe('Monthly guideline refresh', () => {
  it('skips the guideline refresh in mock mode, applies small edits with a logged diff, and parks big ones as a proposal', async () => {
    const seed = (await import('../../src/shared/studio/thumbnailGuidelines')).SEED_GUIDELINES
    let reply = seed + '\n- Test the thumbnail on a phone.\n'
    const f = (async (url: string) => {
      if (String(url).includes('api.anthropic.com')) return json({ content: [{ type: 'text', text: JSON.stringify({ text: reply, changes: ['Added a phone test'] }) }], usage: { input_tokens: 10, output_tokens: 10 } })
      return new Response('<html><p>Custom thumbnails help text</p></html>', { status: 200 })
    }) as unknown as typeof fetch
    const e = makeStudioEnv({ fetchImpl: f, startMs: Date.UTC(2026, 5, 3, 12) })
    const s = e.studio
    expect((await s.refreshGuidelines(true)).note).toMatch(/Mock mode/)
    await s.setKey('anthropic', 'sk-test')
    await s.setConfig({ mockMode: false })
    const small = await s.refreshGuidelines(true)
    expect(small.applied).toBe(true)
    expect(s.guidelines.current().text).toContain('phone')
    expect(s.guidelines.current().source).toBe('refresh')
    expect(s.audit.list({ agent: 'Thumbnail' }).some((a) => a.action === 'guideline_refresh_applied')).toBe(true)
    reply = '# Totally new\n' + Array.from({ length: 40 }, (_, i) => `- rule ${i}`).join('\n')
    const big = await s.refreshGuidelines(true)
    expect(big.applied).toBe(false)
    expect(big.note).toMatch(/waiting for you/)
    expect((await s.guidelineInfo()).proposal?.text).toContain('Totally new')
    const approved = await s.approveGuidelineProposal()
    expect(approved?.text).toContain('Totally new')
    // no web: skipped and logged
    const e2 = makeStudioEnv({ fetchImpl: (async () => new Response('x', { status: 503 })) as unknown as typeof fetch })
    await e2.studio.setConfig({ mockMode: false })
    expect((await e2.studio.refreshGuidelines(true)).note).toMatch(/could not be reached/)
  })
})
