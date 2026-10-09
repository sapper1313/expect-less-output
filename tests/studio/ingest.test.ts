import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'
import { InboxWatcher } from '../../src/main/agent/inbox'
import type { AgentServices } from '../../src/main/agent/core'
import { makePlaceholderVideo } from '../../src/main/studio/ffmpeg'
import { hollowId, makeStudioEnv, minimalPackage } from './helpers'

const SEC = 1000
let wide: string
let tall: string
beforeAll(async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const d = mkdtempSync(join(tmpdir(), 'elo-vids-'))
  wide = join(d, 'wide.mp4')
  tall = join(d, 'tall.mp4')
  await makePlaceholderVideo({ out: wide, seconds: 12, width: 480, height: 270 })
  await makePlaceholderVideo({ out: tall, seconds: 12, width: 270, height: 480 })
})

function setup(fetchImpl?: typeof fetch) {
  // Monday 2026-06-01 10:00 Eastern
  const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 14) })
  const hid = hollowId(e)
  e.settings.set({ inboxBrandIds: [hid] } as never)
  const services: AgentServices = {
    settings: e.settings,
    brands: e.brands,
    posts: e.posts,
    scheduler: e.scheduler,
    log: e.log,
    appVersion: 't',
    now: () => e.clock.ms,
    health: () => null,
  }
  const rejected: string[][] = []
  const watcher = new InboxWatcher({
    s: services,
    library: e.library,
    studio: e.studio.ingest,
    alert: (h, d) => rejected.push([h, d]),
    now: () => e.clock.ms,
    fetch: fetchImpl,
  })
  const inbox = join(e.root, 'Wonder Hollow Workshop', 'Inbox')
  mkdirSync(join(inbox, 'Rejected'), { recursive: true })
  const settle = async () => {
    await watcher.scan()
    e.clock.ms += 12 * SEC
    await watcher.scan()
    e.clock.ms += 12 * SEC
    return watcher.scan()
  }
  const episode = (status = 'Awaiting video') =>
    e.studio.episodes.create(hid, minimalPackage('Counting Acorns', { runtime_target_seconds: 12 }) as never, { status: status as never, slotDate: '2026-06-02' })
  return { e, hid, watcher, rejected, inbox, settle, episode }
}

describe('ingest with episode_id', () => {
  it('attaches a Muse video to its episode, schedules it for the next Tuesday or Friday, and fills title and caption', async () => {
    const t = setup()
    const ep = t.episode()
    writeFileSync(join(t.inbox, 'acorns.mp4'), readFileSync(wide))
    writeFileSync(join(t.inbox, 'acorns.json'), JSON.stringify({ episode_id: ep.id }))
    await t.settle()
    const row = t.e.studio.episodes.get(ep.id)
    expect(row.status).toBe('Scheduled')
    expect(row.postId).not.toBeNull()
    const post = t.e.posts.get(row.postId!)!
    expect(post.status).toBe('scheduled')
    expect(post.title).toBe('Counting Acorns')
    expect(post.caption).toBe('About Counting Acorns.')
    expect(post.targets.map((x) => x.platform)).toEqual(['youtube'])
    // next Tuesday 2026-06-02 at the first weekday slot (08:00 Eastern = 12:00 UTC)
    expect(post.scheduledAtUtc).toBe('2026-06-02T12:00:00.000Z')
    const history = t.e.studio.episodes.getPackage(ep.id)!.status_history.map((h) => h.status)
    expect(history).toEqual(expect.arrayContaining(['Video received', 'Checking video', 'Scheduled']))
    expect(t.rejected).toEqual([])
    // a second video takes the next slot, not the same one
    const ep2 = t.episode()
    writeFileSync(join(t.inbox, 'two.mp4'), readFileSync(wide))
    writeFileSync(join(t.inbox, 'two.json'), JSON.stringify({ episode_id: ep2.id }))
    await t.settle()
    expect(t.e.posts.get(t.e.studio.episodes.get(ep2.id).postId!)!.scheduledAtUtc).toBe('2026-06-05T12:00:00.000Z')
  })

  it('without episode_id the Inbox behaves exactly as before', async () => {
    const t = setup()
    writeFileSync(join(t.inbox, 'plain.mp4'), readFileSync(wide))
    writeFileSync(join(t.inbox, 'plain.json'), JSON.stringify({ title: 'Plain one' }))
    await t.settle()
    const [post] = t.e.posts.list()
    expect(post).toMatchObject({ title: 'Plain one', status: 'draft' })
    expect(t.e.db.prepare('SELECT COUNT(*) AS n FROM episodes').get()).toEqual({ n: 0 })
  })

  it('flags the episode with a clear reason when the video is the wrong shape, and rejects the file', async () => {
    const t = setup()
    const ep = t.episode()
    writeFileSync(join(t.inbox, 'wrong.mp4'), readFileSync(tall))
    writeFileSync(join(t.inbox, 'wrong.json'), JSON.stringify({ episode_id: ep.id }))
    await t.settle()
    const row = t.e.studio.episodes.get(ep.id)
    expect(row.status).toBe('Flagged')
    expect(row.flaggedReason).toMatch(/needs 16:9/)
    expect(readdirSync(join(t.inbox, 'Rejected')).some((f) => f.includes('wrong'))).toBe(true)
    expect(t.rejected.length).toBe(1)
  })

  it('refuses an unknown episode id', async () => {
    const t = setup()
    writeFileSync(join(t.inbox, 'x.mp4'), readFileSync(wide))
    writeFileSync(join(t.inbox, 'x.json'), JSON.stringify({ episode_id: 'nope-1' }))
    await t.settle()
    expect(t.rejected[0][1]).toMatch(/No episode "nope-1"/)
    expect(t.e.posts.list()).toHaveLength(0)
  })

  it('works with video_url too: downloads, attaches and schedules', async () => {
    const bytes = readFileSync(wide)
    const fetchImpl = (async () => new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } })) as unknown as typeof fetch
    const t = setup(fetchImpl)
    const ep = t.episode()
    writeFileSync(join(t.inbox, 'remote.json'), JSON.stringify({ video_url: 'https://example.com/v.mp4', episode_id: ep.id }))
    await t.settle() // downloads the video
    await t.settle() // then picks it up with its sidecar
    expect(t.e.studio.episodes.get(ep.id).status).toBe('Scheduled')
    expect(existsSync(join(t.inbox, 'remote.mp4'))).toBe(false)
  })
})

describe('Library over the local agent API (read only, for Muse)', () => {
  it('lists READY Hollow episodes and returns a full package, and refuses writes', async () => {
    const { makeAgentEnv } = await import('../agentHelpers')
    const { Studio } = await import('../../src/main/studio/studio')
    const { SecretStore } = await import('../../src/main/services/secrets')
    const { fakeCrypto } = await import('../googleHelpers')
    const a = await makeAgentEnv()
    try {
      const studio = new Studio({
        db: a.env.db,
        secrets: new SecretStore(join(a.env.root, 's2.bin'), fakeCrypto),
        posts: a.env.posts,
        media: a.env.library,
        log: a.env.log,
        alert: () => {},
        emit: () => {},
      })
      studio.cfg.set({ libraryDir: join(a.env.root, 'Lib') })
      a.services.episodes = () => studio.episodes
      const hid = (a.env.db.prepare("SELECT id FROM brands WHERE name LIKE 'Wonder Hollow%'").get() as { id: number }).id
      const ready = studio.episodes.create(hid, minimalPackage('Ready one', { scenes: [{ n: 1, grok_prompt: 'p' }] }) as never, { status: 'Ready for production' })
      studio.episodes.create(hid, minimalPackage('Still writing') as never, { status: 'Written' })
      const list = await a.api('GET', '/v1/episodes?status=Ready%20for%20production')
      expect(list.status).toBe(200)
      expect(list.json.episodes.map((e: { id: string }) => e.id)).toEqual([ready.id])
      const one = await a.api('GET', `/v1/episodes/${ready.id}`)
      expect(one.json.package.scenes[0].grok_prompt).toBe('p')
      expect((await a.api('GET', '/v1/episodes/nope')).status).toBe(404)
      expect((await a.api('POST', '/v1/episodes', {})).status).toBe(405)
      expect((await a.api('GET', '/v1/episodes', undefined, null)).status).toBe(401)
    } finally {
      await a.close()
    }
  })
})
