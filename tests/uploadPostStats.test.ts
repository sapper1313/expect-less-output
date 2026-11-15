import { describe, it, expect } from 'vitest'
import { uploadPostFirst } from '../src/main/stats/uploadPostStats'
import type { StatsProvider, StatsTarget } from '../src/main/stats/providers'

const target = (id: number): StatsTarget =>
  ({ targetId: id, platform: 'youtube', accountId: 1, account: { brandId: 3 } as never, externalId: 'v' + id, postedAt: '2026-11-14T00:00:00Z' })

const db = { prepare: () => ({ get: () => ({ settings_json: '{}' }) }) } as never

describe('Upload-Post first for per-post numbers', () => {
  it('uses Upload-Post numbers and leaves ELO out of it', async () => {
    let own = 0
    const inner: StatsProvider = { platform: 'youtube', fetch: async () => (own++, new Map()) }
    const p = uploadPostFirst(inner, 'youtube', {
      db,
      client: { postAnalytics: async () => ({ metrics: { views: 12, likes: 3 }, postId: null, postUrl: null, error: null }) },
      apiKey: () => 'k',
      profileFor: () => 'prof',
      active: () => true,
    })
    const r = await p.fetch([target(1)])
    expect(r.get(1)).toMatchObject({ ok: true, numbers: { views: 12, likes: 3 } })
    expect(own).toBe(0)
  })

  it('reads from ELO when Upload-Post errors or has no numbers', async () => {
    const inner: StatsProvider = {
      platform: 'youtube',
      fetch: async (ts) => new Map(ts.map((t) => [t.targetId, { ok: true as const, numbers: { views: 99, likes: null, comments: null, shares: null } }])),
    }
    const failing = uploadPostFirst(inner, 'youtube', {
      db,
      client: { postAnalytics: async () => { throw new Error('Username not associated with any profile') } },
      apiKey: () => 'k',
      profileFor: () => 'prof',
      active: () => true,
    })
    expect((await failing.fetch([target(2)])).get(2)).toMatchObject({ ok: true, numbers: { views: 99 } })
    const notTicked = uploadPostFirst(inner, 'youtube', {
      db,
      client: { postAnalytics: async () => { throw new Error('should not be called') } },
      apiKey: () => 'k',
      profileFor: () => 'prof',
      active: () => false,
    })
    expect((await notTicked.fetch([target(3)])).get(3)).toMatchObject({ ok: true, numbers: { views: 99 } })
  })
})
