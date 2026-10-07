import { describe, expect, it } from 'vitest'
import {
  FacebookLister,
  ImportService,
  InstagramLister,
  YoutubeLister,
  shouldRefreshImported,
  type VideoLister,
} from '../src/main/stats/imported'
import { StatsService } from '../src/main/stats/service'
import type { StatsProvider } from '../src/main/stats/providers'
import type { Account } from '../src/shared/types'
import { makeEnv } from './helpers'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const acct = (platform: Account['platform'], externalId: string | null = 'ext1'): Account => ({
  id: 1,
  brandId: 1,
  platform,
  displayName: 'x',
  avatarUrl: null,
  externalId,
  status: 'connected',
  mode: 'live',
  lastCheckedAt: null,
})

describe('listers', () => {
  it('YouTube maps uploads to videos with links', async () => {
    const l = new YoutubeLister({
      async listUploads(_a, channel) {
        expect(channel).toBe('UCabc')
        return [
          { id: 'v1', title: 'Hello', publishedAt: '2026-05-01T00:00:00Z', thumbnailUrl: 't' },
        ]
      },
    })
    const r = await l.list(acct('youtube', 'UCabc'))
    expect(r[0]).toMatchObject({
      externalId: 'v1',
      url: 'https://www.youtube.com/watch?v=v1',
      title: 'Hello',
    })
  })

  it('Instagram keeps only videos and uses the first caption line as the title', async () => {
    const graph = {
      getAll: async () => [
        {
          id: '1',
          media_type: 'VIDEO',
          caption: 'Line one\nmore',
          timestamp: '2026-05-01T10:00:00+0000',
        },
        { id: '2', media_type: 'IMAGE', caption: 'photo' },
      ],
    }
    const l = new InstagramLister({ graph: graph as never, tokenFor: () => 't' })
    const r = await l.list(acct('instagram'))
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ externalId: '1', title: 'Line one' })
  })

  it('Facebook turns a relative link into a full one', async () => {
    const graph = {
      getAll: async () => [
        {
          id: '9',
          description: 'Reel',
          permalink_url: '/reel/9',
          created_time: '2026-05-01T10:00:00+0000',
        },
      ],
    }
    const l = new FacebookLister({ graph: graph as never, tokenFor: () => 't' })
    expect((await l.list(acct('facebook')))[0].url).toBe('https://www.facebook.com/reel/9')
  })
})

describe('imported refresh schedule', () => {
  const at = (ageMs: number, sinceMs: number | null) =>
    shouldRefreshImported({
      ageMs,
      nowMs: 1000 * DAY,
      lastFetchMs: sinceMs === null ? null : 1000 * DAY - sinceMs,
    })
  it('reads once, then daily for 90 days, then never', () => {
    expect(at(200 * DAY, null)).toBe(true)
    expect(at(10 * DAY, 2 * HOUR)).toBe(false)
    expect(at(10 * DAY, DAY)).toBe(true)
    expect(at(95 * DAY, DAY)).toBe(false)
  })
})

function setup() {
  const env = makeEnv()
  env.db
    .prepare(
      "UPDATE accounts SET mode = 'live', external_id = 'chan' WHERE platform IN ('youtube','instagram') AND brand_id = 1",
    )
    .run()
  const calls: number[][] = []
  const provider: StatsProvider = {
    platform: 'youtube',
    async fetch(targets) {
      calls.push(targets.map((t) => t.targetId))
      return new Map(
        targets.map((t) => [
          t.targetId,
          { ok: true as const, numbers: { views: 10, likes: 1, comments: 0, shares: null } },
        ]),
      )
    },
  }
  const listed = [
    {
      externalId: 'old1',
      title: 'Old one',
      url: null,
      thumbnailUrl: null,
      publishedAt: new Date(env.clock.ms - 3 * DAY).toISOString(),
    },
    {
      externalId: 'old2',
      title: 'Older',
      url: null,
      thumbnailUrl: null,
      publishedAt: new Date(env.clock.ms - 200 * DAY).toISOString(),
    },
    {
      externalId: 'mine',
      title: 'Posted by app',
      url: null,
      thumbnailUrl: null,
      publishedAt: null,
    },
  ]
  const lister: VideoLister = { list: async () => listed }
  const imported = new ImportService({
    db: env.db,
    log: env.log,
    now: () => env.clock.ms,
    providers: { youtube: provider, instagram: provider },
    listers: { youtube: lister },
  })
  return { env, imported, calls }
}

describe('ImportService', () => {
  it('imports once, skips videos the app posted, and reads their numbers', async () => {
    const s = setup()
    const post = await s.env.makePost({ whenMs: s.env.clock.ms - DAY, platforms: ['youtube'] })
    s.env.db.prepare("UPDATE post_targets SET external_id = 'mine' WHERE post_id = ?").run(post.id)
    const r = await s.imported.importExisting(1)
    expect(r.added).toBe(2)
    expect(r.problems.some((p) => p.platform === 'instagram')).toBe(true) // no lister for that one
    const again = await s.imported.importExisting(1)
    expect(again.added).toBe(0)
    const list = s.imported.list(1, 'all')
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ title: 'Old one', state: 'ok', numbers: { views: 10 } })
    expect(s.imported.list(1, '7d')).toHaveLength(1)
  })

  it('refreshes daily for 90 days and adds to brand totals', async () => {
    const s = setup()
    await s.imported.importExisting(1)
    const calls0 = s.calls.length
    s.env.clock.ms += 2 * HOUR
    await s.imported.refresh()
    expect(s.calls.length).toBe(calls0)
    s.env.clock.ms += DAY
    await s.imported.refresh()
    expect(s.calls.length).toBe(calls0 + 1)
    expect(s.calls[s.calls.length - 1]).not.toContain(2) // the 200 day old one stays frozen

    const stats = new StatsService({
      db: s.env.db,
      log: s.env.log,
      providers: {},
      imported: s.imported,
      now: () => s.env.clock.ms,
    })
    const all = stats.brandSummary(1, 'all')
    expect(all.platforms.find((p) => p.platform === 'youtube')).toMatchObject({
      videos: 3,
      views: 30,
    })
    expect(stats.brandSummary(1, '7d').posts).toBe(1)
  })
})
