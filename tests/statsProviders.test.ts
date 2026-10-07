import { describe, expect, it } from 'vitest'
import {
  FacebookStatsProvider,
  InstagramStatsProvider,
  TikTokStatsProvider,
  YoutubeStatsProvider,
  type StatsTarget,
} from '../src/main/stats/providers'
import { MetaApiError } from '../src/main/meta/graph'

const target = (n: number, platform: StatsTarget['platform'], externalId: string): StatsTarget => ({
  targetId: n,
  platform,
  accountId: 1,
  account: null,
  externalId,
  postedAt: '2026-06-01T00:00:00Z',
})

describe('YouTube provider', () => {
  it('batches 50 ids per call and flags a missing video', async () => {
    const calls: number[] = []
    const p = new YoutubeStatsProvider({
      async videoStatistics(_a, ids) {
        calls.push(ids.length)
        return new Map(
          ids.filter((i) => i !== 'id-0').map((i) => [i, { views: 9, likes: 2, comments: 1 }]),
        )
      },
    })
    const ts = Array.from({ length: 120 }, (_, i) => target(i + 1, 'youtube', `id-${i}`))
    const r = await p.fetch(ts)
    expect(calls).toEqual([50, 50, 20])
    expect(r.get(2)).toMatchObject({ ok: true, numbers: { views: 9, shares: null } })
    expect(r.get(1)).toMatchObject({ ok: false, unavailable: true })
  })
})

describe('Facebook and Instagram providers', () => {
  const graph = (handler: (path: string, params: Record<string, string>) => unknown) =>
    ({
      get: async (path: string, params: Record<string, string>) => handler(path, params),
    }) as never

  it('Facebook sums reactions and marks shares approximate', async () => {
    const p = new FacebookStatsProvider({
      tokenFor: () => 't',
      graph: graph((path) =>
        path.endsWith('video_insights')
          ? {
              data: [
                { name: 'blue_reels_play_count', values: [{ value: 1000 }] },
                {
                  name: 'post_video_likes_by_reaction_type',
                  values: [{ value: { like: 5, love: 3 } }],
                },
                { name: 'post_video_social_actions', values: [{ value: 10 }] },
              ],
            }
          : { comments: { summary: { total_count: 4 } } },
      ),
    })
    const r = await p.fetch([target(1, 'facebook', '123')])
    expect(r.get(1)).toMatchObject({
      ok: true,
      numbers: { views: 1000, likes: 8, comments: 4, shares: 6 },
      approximate: ['shares'],
    })
  })

  it('Facebook explains a missing permission', async () => {
    const p = new FacebookStatsProvider({
      tokenFor: () => 't',
      graph: graph(() => {
        throw new MetaApiError('(#200) Permission denied', 'permanent', 200, 0)
      }),
    })
    const r = await p.fetch([target(1, 'facebook', '123')])
    expect(r.get(1)).toMatchObject({ ok: false, unavailable: true })
    expect((r.get(1) as { reason: string }).reason).toMatch(/pages_manage_engagement/)
  })

  it('Instagram retries with basic metrics when views are refused', async () => {
    const asked: string[] = []
    const p = new InstagramStatsProvider({
      tokenFor: () => 't',
      graph: graph((_path, params) => {
        asked.push(params.metric)
        if (params.metric.includes('views'))
          throw new MetaApiError('bad metric', 'permanent', 100, 0)
        return {
          data: [
            { name: 'likes', values: [{ value: 7 }] },
            { name: 'shares', values: [{ value: 2 }] },
          ],
        }
      }),
    })
    const r = await p.fetch([target(1, 'instagram', 'm1')])
    expect(asked).toHaveLength(2)
    expect(r.get(1)).toMatchObject({ ok: true, numbers: { views: null, likes: 7, shares: 2 } })
  })
})

describe('Facebook metric fallback', () => {
  it('keeps the metrics Meta accepts when it refuses one', async () => {
    const asked: string[] = []
    const p = new FacebookStatsProvider({
      tokenFor: () => 't',
      graph: {
        get: async (path: string, params: Record<string, string>) => {
          if (!path.endsWith('video_insights')) return {}
          asked.push(params.metric)
          if (params.metric.includes(',') || params.metric === 'post_video_social_actions')
            throw new MetaApiError(
              '(#100) The value must be a valid insights metric',
              'permanent',
              100,
              0,
            )
          return {
            data: [
              {
                name: params.metric,
                values: [{ value: params.metric === 'blue_reels_play_count' ? 77 : { like: 2 } }],
              },
            ],
          }
        },
      } as never,
    })
    const r = await p.fetch([target(1, 'facebook', '123')])
    expect(r.get(1)).toMatchObject({ ok: true, numbers: { views: 77, likes: 2 } })
    expect(asked.length).toBe(4)
  })
})

describe('TikTok provider', () => {
  const client = {
    async queryVideos(_t: string, ids: string[]) {
      return new Map(ids.map((i) => [i, { views: 3, likes: 2, comments: 1, shares: 0 }]))
    },
  } as never
  const mk = (scope: string | null) =>
    new TikTokStatsProvider({ client, accessToken: async () => 'tok', grantedScope: () => scope })

  it('reads real ids and explains publish ids', async () => {
    const r = await mk('user.info.basic,video.list').fetch([
      target(1, 'tiktok', '7234567890123456789'),
      target(2, 'tiktok', 'v_pub_file~v2.123'),
    ])
    expect(r.get(1)).toMatchObject({ ok: true, numbers: { views: 3 } })
    expect(r.get(2)).toMatchObject({ ok: false, unavailable: true })
  })

  it('asks for video.list when it was not granted', async () => {
    const r = await mk('user.info.basic').fetch([target(1, 'tiktok', '7234567890123456789')])
    expect((r.get(1) as { reason: string }).reason).toMatch(/video\.list/)
  })
})
