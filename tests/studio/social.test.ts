import { writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { BlueskyClient } from '../../src/main/studio/social/bluesky'
import { ThreadsClient } from '../../src/main/studio/social/threads'
import { PublicHost } from '../../src/main/studio/social/publicHost'
import { SocialPublisher } from '../../src/main/studio/social/socialPublisher'
import { SocialError } from '../../src/main/studio/social/errors'
import { makePlaceholderVideo } from '../../src/main/studio/ffmpeg'
import { makeStudioEnv } from './helpers'

vi.setConfig({ testTimeout: 60_000 })
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
const noSleep = async () => {}

describe('Threads client', () => {
  function fake() {
    const calls: Array<{ method: string; path: string; params: Record<string, string> }> = []
    let polls = 0
    const f = (async (url: string, init?: RequestInit) => {
      const u = new URL(url)
      const params = Object.fromEntries(u.searchParams)
      const body = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {}
      calls.push({ method: init?.method ?? 'GET', path: u.pathname, params: { ...params, ...body } })
      if (u.pathname.endsWith('/me')) return json({ id: 'U1', username: 'elo' })
      if (u.pathname === '/v1.0/U1/threads' && init?.method === 'POST') return json({ id: 'C1' })
      if (u.pathname === '/v1.0/C1') return json({ status: ++polls < 3 ? 'IN_PROGRESS' : 'FINISHED' })
      if (u.pathname === '/v1.0/U1/threads_publish') return json({ id: 'P1' })
      if (u.pathname === '/v1.0/P1') return json({ permalink: 'https://www.threads.net/@elo/post/P1' })
      if (u.pathname === '/v1.0/P1/replies') return json({ data: [{ id: 'R1', text: 'Nice', username: 'fan', timestamp: '2026-06-01T00:00:00Z' }] })
      if (u.pathname === '/refresh_access_token') return json({ access_token: 'newtoken', expires_in: 5184000 })
      return json({ error: 'nope' }, 404)
    }) as unknown as typeof fetch
    return { f, calls }
  }

  it('publishes a video as container, wait, publish, and never repeats a container', async () => {
    const { f, calls } = fake()
    const c = new ThreadsClient(() => 'tok', f, undefined, noSleep)
    const state: Record<string, unknown> = {}
    const r = await c.publishVideo({ userId: 'U1', text: 'Hello', videoUrl: 'https://cdn.example.com/v.mp4', state, setState: (p) => Object.assign(state, p) })
    expect(r).toEqual({ id: 'P1', url: 'https://www.threads.net/@elo/post/P1' })
    const create = calls.find((x) => x.method === 'POST' && x.path === '/v1.0/U1/threads')!
    expect(create.params).toMatchObject({ media_type: 'VIDEO', video_url: 'https://cdn.example.com/v.mp4', text: 'Hello', access_token: 'tok' })
    expect(calls.filter((x) => x.path === '/v1.0/C1').length).toBeGreaterThanOrEqual(3)
    // a retry after a crash reuses the remembered container
    await c.publishVideo({ userId: 'U1', text: 'Hello', videoUrl: 'https://cdn.example.com/v.mp4', state, setState: (p) => Object.assign(state, p) })
    expect(calls.filter((x) => x.method === 'POST' && x.path === '/v1.0/U1/threads')).toHaveLength(1)
  })

  it('lists and posts replies, hides a reply, and refreshes the token', async () => {
    const { f, calls } = fake()
    const c = new ThreadsClient(() => 'tok', f, undefined, noSleep)
    expect(await c.listReplies('P1')).toEqual([{ id: 'R1', text: 'Nice', username: 'fan', at: '2026-06-01T00:00:00Z' }])
    expect(await c.reply('U1', 'R1', 'Thanks')).toBe('P1')
    expect(calls.find((x) => x.params.reply_to_id === 'R1')!.params).toMatchObject({ media_type: 'TEXT', text: 'Thanks' })
    expect(await c.refresh()).toEqual({ token: 'newtoken', expiresInSeconds: 5184000 })
    expect(calls.find((x) => x.path === '/refresh_access_token')!.params).toMatchObject({ grant_type: 'th_refresh_token' })
  })

  it('classifies a 429 as transient and a 401 as permanent', async () => {
    const mk = (status: number) => new ThreadsClient(() => 'tok', (async () => new Response('x', { status })) as unknown as typeof fetch)
    await expect(mk(429).me()).rejects.toMatchObject({ kind: 'transient' })
    await expect(mk(401).me()).rejects.toMatchObject({ kind: 'permanent' })
  })
})

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
  function build(e: ReturnType<typeof makeStudioEnv>, threads: ThreadsClient, bluesky: BlueskyClient, host: PublicHost) {
    const alerts: unknown[] = []
    let uid: string | null = null
    const pub = new SocialPublisher({
      db: e.db,
      cfg: e.studio.cfg,
      threads,
      bluesky,
      host,
      userId: { get: () => uid, set: (v) => (uid = v) },
      alert: (i) => alerts.push(i),
      log: () => {},
      brandName: () => 'Trash Panda',
      now: () => e.clock.ms,
    })
    return { pub, alerts }
  }
  const row = (e: ReturnType<typeof makeStudioEnv>, platform: 'threads' | 'bluesky', video: string) => ({ episodeId: null, brandId: 1, platform, text: 'Hi', videoPath: video, title: 'A clip', scheduledAtUtc: new Date(e.clock.ms).toISOString(), mock: false })

  it('retries a busy platform after 2, 10 and 30 minutes, then fails once with the failure alert', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 12) })
    const busy = (async () => new Response('slow down', { status: 503 })) as unknown as typeof fetch
    const bs = new BlueskyClient({ handle: () => 'a.bsky.social', password: () => 'p' }, busy, undefined, noSleep)
    const { pub, alerts } = build(e, new ThreadsClient(() => 't', busy), bs, new PublicHost(e.studio.cfg, e.secrets, busy))
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

  it('Threads without a public host fails at once with a plain reason', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 12) })
    const ok = (async () => json({ id: 'U1', username: 'elo' })) as unknown as typeof fetch
    const { pub, alerts } = build(e, new ThreadsClient(() => 't', ok), new BlueskyClient({ handle: () => null, password: () => null }), new PublicHost(e.studio.cfg, e.secrets, ok))
    const r = pub.add(row(e, 'threads', '/x.mp4'))
    await pub.tick()
    expect(pub.get(r.id)!.status).toBe('failed')
    expect(pub.get(r.id)!.error).toMatch(/public address/)
    expect(alerts).toHaveLength(1)
    void SocialError
  })

  it('posts a Threads video through the public host and removes the file afterwards', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 12) })
    const log: string[] = []
    const f = (async (url: string, init?: RequestInit) => {
      const u = new URL(url)
      log.push(`${init?.method ?? 'GET'} ${u.host}${u.pathname}`)
      if (u.host.includes('r2.cloudflarestorage')) return new Response('', { status: 200 })
      if (u.pathname === '/v1.0/me') return json({ id: 'U1', username: 'elo' })
      if (u.pathname === '/v1.0/U1/threads') return json({ id: 'C1' })
      if (u.pathname === '/v1.0/C1') return json({ status: 'FINISHED' })
      if (u.pathname === '/v1.0/U1/threads_publish') return json({ id: 'P1' })
      return json({ permalink: 'https://www.threads.net/@elo/post/P1' })
    }) as unknown as typeof fetch
    e.studio.cfg.set({ publicHost: { endpoint: 'https://a.r2.cloudflarestorage.com', bucket: 'b', publicBase: 'https://pub.example.com', region: 'auto' } })
    await e.studio.setKey('r2id', 'k')
    await e.studio.setKey('r2secret', 's')
    const file = join(e.dir, 't.mp4')
    await makePlaceholderVideo({ out: file, seconds: 2, width: 270, height: 480 })
    const { pub } = build(e, new ThreadsClient(() => 't', f, undefined, noSleep), new BlueskyClient({ handle: () => null, password: () => null }), new PublicHost(e.studio.cfg, e.secrets, f))
    const r = pub.add(row(e, 'threads', file))
    await pub.tick()
    expect(pub.get(r.id)).toMatchObject({ status: 'posted', externalId: 'P1', externalUrl: 'https://www.threads.net/@elo/post/P1' })
    expect(log.filter((l) => l.startsWith('PUT')).length).toBe(1)
    expect(log.filter((l) => l.startsWith('DELETE')).length).toBe(1)
    expect(log.indexOf(log.find((l) => l.startsWith('PUT'))!)).toBeLessThan(log.findIndex((l) => l.includes('/U1/threads') && l.startsWith('POST')))
  })
})

describe('Threads token and monthly guideline refresh', () => {
  it('refreshes the Threads token when it is inside 7 days of expiry, and warns if it cannot', async () => {
    const f = (async (url: string) => {
      if (String(url).includes('refresh_access_token')) return json({ access_token: 'fresh', expires_in: 5184000 })
      return json({})
    }) as unknown as typeof fetch
    const e = makeStudioEnv({ fetchImpl: f, startMs: Date.UTC(2026, 5, 3, 12) })
    const s = e.studio
    await s.setKey('threads', 'old')
    await s.setConfig({ mockMode: false })
    // not close to expiry: nothing happens
    ;(s as unknown as { setAccountOf: (k: string, v: string) => void }).setAccountOf('threadsExpiry', new Date(e.clock.ms + 30 * 86_400_000).toISOString())
    await s.checkThreadsToken()
    expect(e.secrets.get('threads.token')).toBe('old')
    // inside 7 days: refreshed
    ;(s as unknown as { setAccountOf: (k: string, v: string) => void }).setAccountOf('threadsExpiry', new Date(e.clock.ms + 3 * 86_400_000).toISOString())
    await s.checkThreadsToken()
    expect(e.secrets.get('threads.token')).toBe('fresh')
    expect(e.alerts).toEqual([])
  })

  it('warns with an alert when the refresh fails', async () => {
    const f = (async () => new Response('no', { status: 400 })) as unknown as typeof fetch
    const e = makeStudioEnv({ fetchImpl: f, startMs: Date.UTC(2026, 5, 3, 12) })
    const s = e.studio
    await s.setKey('threads', 'old')
    await s.setConfig({ mockMode: false })
    ;(s as unknown as { setAccountOf: (k: string, v: string) => void }).setAccountOf('threadsExpiry', new Date(e.clock.ms + 2 * 86_400_000).toISOString())
    await s.checkThreadsToken()
    await s.checkThreadsToken()
    expect(e.alerts.filter(([h]) => h === 'Threads sign in runs out soon.')).toHaveLength(1)
  })

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
