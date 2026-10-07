import { describe, expect, it } from 'vitest'
import { parseVideoId, shouldRefresh } from '../src/main/stats/ids'
import { StatsService } from '../src/main/stats/service'
import type { StatsProvider, StatsTarget } from '../src/main/stats/providers'
import { makeAgentEnv } from './agentHelpers'
import { makeEnv } from './helpers'

const HOUR = 3_600_000
const DAY = 24 * HOUR

describe('video ids from pasted links', () => {
  it('reads YouTube and TikTok links and ignores the rest', () => {
    expect(parseVideoId('youtube', 'https://youtube.com/shorts/abcDEF12345')).toBe('abcDEF12345')
    expect(parseVideoId('youtube', 'https://www.youtube.com/watch?v=abcDEF12345&t=3')).toBe(
      'abcDEF12345',
    )
    expect(parseVideoId('youtube', 'https://youtu.be/abcDEF12345')).toBe('abcDEF12345')
    expect(parseVideoId('youtube', 'https://evil.com/shorts/abcDEF12345')).toBeNull()
    expect(parseVideoId('tiktok', 'https://www.tiktok.com/@me/video/7234567890123456789')).toBe(
      '7234567890123456789',
    )
    expect(parseVideoId('tiktok', 'https://vm.tiktok.com/abc')).toBeNull()
    expect(parseVideoId('instagram', 'https://instagram.com/reel/x')).toBeNull()
    expect(parseVideoId('youtube', 'nonsense')).toBeNull()
  })
})

describe('refresh schedule', () => {
  const base = { nowMs: 100 * DAY, unavailable: false }
  it('is every 6 hours for the first week, daily to 30 days, then stops', () => {
    const at = (ageMs: number, sinceMs: number | null, unavailable = false) =>
      shouldRefresh({
        ...base,
        ageMs,
        unavailable,
        lastFetchMs: sinceMs === null ? null : base.nowMs - sinceMs,
      })
    expect(at(DAY, null)).toBe(true)
    expect(at(DAY, 5 * HOUR)).toBe(false)
    expect(at(DAY, 6 * HOUR)).toBe(true)
    expect(at(10 * DAY, 6 * HOUR)).toBe(false)
    expect(at(10 * DAY, DAY)).toBe(true)
    expect(at(31 * DAY, null)).toBe(false)
    expect(at(DAY, 7 * HOUR, true)).toBe(false)
    expect(at(DAY, DAY, true)).toBe(true)
  })
})

function setup() {
  const env = makeEnv()
  const calls: StatsTarget[][] = []
  let views = 100
  const provider: StatsProvider = {
    platform: 'youtube',
    async fetch(targets) {
      calls.push(targets)
      const m = new Map()
      for (const t of targets)
        m.set(
          t.targetId,
          t.platform === 'instagram'
            ? { ok: false, reason: 'Reconnect Meta for stats', unavailable: true }
            : {
                ok: true,
                numbers: {
                  views,
                  likes: 5,
                  comments: 2,
                  shares: t.platform === 'youtube' ? null : 1,
                },
              },
        )
      return m
    },
  }
  const stats = new StatsService({
    db: env.db,
    log: env.log,
    emit: () => {},
    now: () => env.clock.ms,
    providers: { youtube: provider, facebook: provider, instagram: provider, tiktok: provider },
  })
  const markLive = async (platforms: Array<'youtube' | 'instagram' | 'facebook'>) => {
    const post = await env.makePost({ whenMs: env.clock.ms - DAY, platforms })
    // pretend a real account and a real posting happened
    env.db.prepare("UPDATE accounts SET mode = 'live'").run()
    env.db
      .prepare(
        "UPDATE post_targets SET status = 'posted', external_id = 'abc' || id, posted_at_utc = ? WHERE post_id = ?",
      )
      .run(new Date(env.clock.ms - HOUR).toISOString(), post.id)
    env.db.prepare("UPDATE posts SET status = 'posted' WHERE id = ?").run(post.id)
    return post
  }
  return { env, stats, calls, markLive, setViews: (n: number) => (views = n) }
}

describe('StatsService', () => {
  it('stores numbers, explains platforms that give none and sums the rest', async () => {
    const s = setup()
    const post = await s.markLive(['youtube', 'instagram'])
    const r = await s.stats.refresh({ postId: post.id, force: true })
    expect(r).toEqual({ fetched: 1, unavailable: 1 })
    const st = s.stats.postStats(post.id)
    const yt = st.targets.find((t) => t.platform === 'youtube')!
    const ig = st.targets.find((t) => t.platform === 'instagram')!
    expect(yt.state).toBe('ok')
    expect(yt.latest?.views).toBe(100)
    expect(ig.state).toBe('unavailable')
    expect(ig.reason).toMatch(/Reconnect Meta/)
    expect(st.totals.views).toBe(100)
  })

  it('follows the schedule and builds a history for the chart', async () => {
    const s = setup()
    const post = await s.markLive(['youtube'])
    await s.stats.refreshDue()
    expect(s.calls).toHaveLength(1)
    s.env.clock.ms += 2 * HOUR
    await s.stats.refreshDue()
    expect(s.calls).toHaveLength(1) // not due yet
    s.setViews(250)
    s.env.clock.ms += 5 * HOUR
    await s.stats.refreshDue()
    expect(s.calls).toHaveLength(2)
    const t = s.stats.postStats(post.id).targets[0]
    expect(t.history.map((h) => h.views)).toEqual([100, 250])
    s.env.clock.ms += 40 * DAY
    await s.stats.refreshDue()
    expect(s.calls).toHaveLength(2) // older than 30 days, stopped
  })

  it('leaves dry run posts alone and says so', async () => {
    const s = setup()
    const post = await s.env.makePost({ whenMs: s.env.clock.ms - DAY, platforms: ['youtube'] })
    s.env.db
      .prepare(
        "UPDATE post_targets SET status = 'posted', external_id = 'x', posted_at_utc = ? WHERE post_id = ?",
      )
      .run(new Date(s.env.clock.ms - HOUR).toISOString(), post.id)
    await s.stats.refresh({ force: true })
    expect(s.calls).toHaveLength(0)
    expect(s.stats.postStats(post.id).targets[0].reason).toMatch(/dry run/i)
  })

  it('summarizes a brand for 7 and 30 days', async () => {
    const s = setup()
    await s.markLive(['youtube', 'facebook'])
    await s.stats.refresh({ force: true })
    const b = s.stats.brandSummary(1, '7d')
    expect(b.posts).toBe(1)
    expect(b.platforms.find((p) => p.platform === 'youtube')!.views).toBe(100)
    expect(b.totals.views).toBe(200)
    s.env.clock.ms += 10 * DAY
    expect(s.stats.brandSummary(1, '7d').posts).toBe(0)
    expect(s.stats.brandSummary(1, '30d').posts).toBe(1)
  })
})

describe('stats over the agent API', () => {
  it('returns the numbers and a clear 404', async () => {
    const a = await makeAgentEnv()
    try {
      const post = await a.env.makePost({
        whenMs: a.env.clock.ms + HOUR,
        platforms: ['youtube'],
      })
      const r = await a.api('GET', `/v1/posts/${post.id}/stats`)
      expect(r.status).toBe(200)
      expect(r.json.targets[0].state).toBe('unavailable')
      expect((await a.api('GET', '/v1/posts/9999/stats')).status).toBe(404)
      const b = await a.api('GET', '/v1/brands/1/stats?range=30d')
      expect(b.status).toBe(200)
      expect(b.json.range).toBe('30d')
      expect((await a.api('GET', '/v1/brands/9999/stats')).status).toBe(404)
      expect((await a.api('GET', '/v1/brands/1/stats?range=1y')).status).toBe(400)
    } finally {
      await a.close()
    }
  })
})
