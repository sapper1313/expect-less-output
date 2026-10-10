import { describe, expect, it, vi } from 'vitest'
import { YoutubeRetentionReader } from '../../src/main/studio/youtubeAnalytics'
import { RetentionService } from '../../src/main/studio/watchTime'
import { makeStudioEnv } from './helpers'

vi.setConfig({ testTimeout: 60_000 })

describe('YouTube retention reader', () => {
  it('reads totals and the curve, and tolerates a missing curve', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(String(url))
      if (String(url).includes('elapsedVideoTimeRatio')) return new Response(JSON.stringify({ rows: [[0.05, 0.98], [0.5, 0.6]] }))
      return new Response(JSON.stringify({ rows: [[300, 42, 63.5]] }))
    }) as unknown as typeof fetch
    const r = new YoutubeRetentionReader(async () => 'tok', fetchImpl)
    const d = await r.read(1, 'VID', '2026-10-01', '2026-10-10')
    expect(d).toEqual({ minutesWatched: 300, avgViewSeconds: 42, avgViewPercent: 63.5, curve: [{ t: 0.05, watch: 0.98 }, { t: 0.5, watch: 0.6 }] })
    expect(calls[0]).toContain('video%3D%3DVID')
    const noCurve = new YoutubeRetentionReader(async () => 'tok', (async (url: string) => (String(url).includes('elapsed') ? new Response('', { status: 400 }) : new Response(JSON.stringify({ rows: [[1, 2, 3]] })))) as unknown as typeof fetch)
    expect((await noCurve.read(1, 'V', 'a', 'b')).curve).toEqual([])
    const refused = new YoutubeRetentionReader(async () => 'tok', (async () => new Response('', { status: 403 })) as unknown as typeof fetch)
    await expect(refused.read(1, 'V', 'a', 'b')).rejects.toThrow(/Reconnect YouTube/)
  })
})

describe('retention service', () => {
  it('stores watch time for a posted YouTube video and simulates it for a mock post', async () => {
    const e = makeStudioEnv()
    const brand = (await e.studio.brands())[0].brandId
    const post = await e.makePost({ brandId: brand, whenMs: e.clock.ms - 3600_000, platforms: ['youtube'], title: 'x' })
    await expect(e.studio.refreshRetention(post.id)).rejects.toThrow(/not on YouTube yet/)
    e.db.prepare("UPDATE post_targets SET status = 'posted', external_id = 'V1', posted_at_utc = '2026-10-09T00:00:00Z' WHERE post_id = ?").run(post.id)
    const v = await e.studio.refreshRetention(post.id)
    expect(v.curve.length).toBeGreaterThan(5)
    expect((await e.studio.retentionFor(post.id))?.avgViewSeconds).toBe(38)
    const read = vi.fn(async () => ({ minutesWatched: 5, avgViewSeconds: 6, avgViewPercent: 7, curve: [] }))
    e.db.prepare("UPDATE accounts SET mode = 'live', status = 'connected' WHERE brand_id = ? AND platform = 'youtube'").run(brand)
    const acct = (e.db.prepare("SELECT id FROM accounts WHERE brand_id = ? AND platform = 'youtube'").get(brand) as { id: number }).id
    e.db.prepare('UPDATE post_targets SET account_id = ? WHERE post_id = ?').run(acct, post.id)
    const real = new RetentionService({ db: e.db, read, mock: () => false })
    const got = await real.refresh(post.id)
    expect(read).toHaveBeenCalledWith(acct, 'V1', '2026-10-09', expect.any(String))
    expect(got.minutesWatched).toBe(5)
    expect(await real.refreshRecent()).toBe(1)
  })
})
