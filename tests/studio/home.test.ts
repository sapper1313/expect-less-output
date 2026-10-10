import { describe, expect, it, vi } from 'vitest'
import { buildHomeSummary } from '../../src/main/homeSummary'
import type { HealthRow, Post } from '../../src/shared/types'
import { makeStudioEnv } from './helpers'

vi.setConfig({ testTimeout: 60_000 })

const row = (over: Partial<HealthRow>): HealthRow => ({ accountId: 1, brandId: 1, brandName: 'B', platform: 'youtube', displayName: 'x', status: 'connected', mode: 'live', lastCheckedAt: null, expiresAt: null, note: '', ...over })

describe('home summary', () => {
  it('counts the pipeline, flags bad connections and reports badges', async () => {
    const e = makeStudioEnv()
    const brands = await e.studio.brands()
    const b = brands[0].brandId
    await e.studio.writeNow(b)
    for (let i = 0; i < 100 && e.studio.tasks.list({ status: ['queued', 'running'] }).length; i++) {
      await e.studio.runner.runUntilIdle()
      await new Promise((r) => setTimeout(r, 20))
    }
    const now = Date.now()
    const s = await buildHomeSummary({
      db: e.db,
      now: () => now,
      posts: () => [] as Post[],
      health: () => [row({ brandId: b, platform: 'facebook', status: 'needs_reauth' }), row({ brandId: b, platform: 'youtube', expiresAt: new Date(now + 3 * 86_400_000).toISOString() })],
      bluesky: async () => [],
      studioBrands: () => e.studio.brands(),
      openFlags: () => 2,
      spend: () => e.studio.spendSummary(),
      mockMode: () => true,
      postStats: () => ({ postId: 0, targets: [], totals: { views: null, likes: null, comments: null, shares: null } }),
    })
    expect(s.stages.map((x) => x.key)).toEqual(['writing', 'ready', 'making', 'scheduled', 'posted', 'flagged'])
    expect(s.stages.find((x) => x.key === 'flagged')?.count).toBe(2)
    expect(s.stages.slice(0, 3).reduce((n, x) => n + x.count, 0)).toBeGreaterThan(0)
    const ch = s.channels.find((c) => c.brandId === b)!
    expect(ch.connections.map((c) => c.state).sort()).toEqual(['bad', 'warn'])
    expect(s.badges).toEqual({ studio: 2, queue: 0, channels: 2 })
    expect(s.needsYou.join(' ')).toMatch(/2 studio items flagged/)
    expect(s.spend.mock).toBe(true)
  })
})

describe('search and episode cost', () => {
  it('finds pages and episodes and reports what an episode cost', async () => {
    const { searchAll } = await import('../../src/main/search')
    const e = makeStudioEnv()
    const b = (await e.studio.brands())[0].brandId
    await e.studio.writeNow(b)
    for (let i = 0; i < 100 && e.studio.tasks.list({ status: ['queued', 'running'] }).length; i++) {
      await e.studio.runner.runUntilIdle()
      await new Promise((r) => setTimeout(r, 20))
    }
    const ep = (await e.studio.episodeList({ brandId: b }))[0]
    expect(searchAll(e.db, 'x')).toEqual([])
    expect(searchAll(e.db, 'spend caps').some((h) => h.kind === 'page' && h.target.settingsTab === 'studio')).toBe(true)
    expect(searchAll(e.db, ep.title.slice(0, 6)).some((h) => h.kind === 'episode' && h.target.episodeId === ep.id)).toBe(true)
    e.db.prepare("INSERT INTO spend_ledger (ts_utc, month_et, brand_id, episode_id, vendor, model, units, unit_kind, unit_price, dollars, outcome, purpose, mock) VALUES ('2026-10-10T00:00:00Z','2026-10',?,?,'xai','m',1,'seconds',0,1.25,'ok','first take',0)").run(b, ep.id)
    const c = await e.studio.episodeCost(ep.id)
    expect(c.total).toBeCloseTo(1.25, 2)
    expect(c.parts[0].label).toBe('Video and images')
  })
})
