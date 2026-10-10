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
