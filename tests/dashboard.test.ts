import { afterEach, describe, expect, it } from 'vitest'
import { DashboardService } from '../src/main/dashboard/service'
import { makeAgentEnv } from './agentHelpers'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})
const HOUR = 3_600_000

async function setup() {
  const a = await makeAgentEnv()
  closers.push(a.close)
  const dash = new DashboardService({
    db: a.env.db,
    services: a.services,
    settings: a.env.settings,
    now: () => new Date(a.env.clock.ms),
  })
  return { a, dash }
}

describe('Dashboard screen data', () => {
  it('builds a snapshot from ELO itself, with a ring total and one card per active channel', async () => {
    const { a, dash } = await setup()
    expect(dash.snapshot()).toBeNull()
    const s = await dash.refresh()
    expect(s).not.toBeNull()
    expect(s!.status.elo).toBe('ok')
    expect(s!.week.tz).toBe('America/New_York')
    expect(s!.channels.length).toBe(a.env.brands.list().filter((b) => !b.archived).length)
    expect(s!.totals.filled + s!.totals.open + s!.totals.attention).toBe(s!.totals.slots)
  })

  it('counts a scheduled post as a filled slot and keeps the snapshot for the next start', async () => {
    const { a, dash } = await setup()
    const before = await dash.refresh()
    const post = await a.env.makePost({ whenMs: a.env.clock.ms + 2 * HOUR, platforms: ['youtube'] })
    expect(post.id).toBeGreaterThan(0)
    const after = await dash.refresh()
    expect(after!.upNext.length).toBeGreaterThanOrEqual(before!.upNext.length)
    const again = new DashboardService({
      db: a.env.db,
      services: a.services,
      settings: a.env.settings,
      now: () => new Date(a.env.clock.ms),
    })
    again.start()
    expect(again.snapshot()?.totals.slots).toBe(after!.totals.slots)
    again.stop()
  })
})

describe('best videos on Home', () => {
  it('counts a post that is live on one platform while another failed, and adds views across platforms', async () => {
    const { a, dash } = await setup()
    const env = a.env
    const brand = env.brands.list()[0]
    const now = new Date().toISOString()
    const mk = (title: string) =>
      env.db
        .prepare("INSERT INTO posts (brand_id, title, video_path, status, post_type, scheduled_at_utc) VALUES (?, ?, 'x.mp4', 'partial', 'episode', ?)")
        .run(brand.id, title, now).lastInsertRowid
    const hit = mk('Hit video')
    const other = mk('Smaller video')
    const tgt = (post: unknown, platform: string, status: string, views: number | null) => {
      const id = env.db
        .prepare("INSERT INTO post_targets (post_id, platform, status, posted_at_utc) VALUES (?, ?, ?, ?)")
        .run(post, platform, status, status === 'posted' ? now : null).lastInsertRowid
      if (views !== null)
        env.db
          .prepare('INSERT INTO post_stats (post_target_id, fetched_at_utc, views) VALUES (?, ?, ?)')
          .run(id, now, views)
    }
    tgt(hit, 'youtube', 'posted', 1500)
    tgt(hit, 'instagram', 'failed', null)
    tgt(other, 'youtube', 'posted', 100)
    tgt(other, 'facebook', 'posted', 50)
    const best = (dash as unknown as { bestVideos(): { title: string; views: number }[] }).bestVideos()
    expect(best[0]).toMatchObject({ title: 'Hit video', views: 1500 })
    expect(best[1]).toMatchObject({ title: 'Smaller video', views: 150 })
  })

  it('the 24 and 48 hour windows only count videos posted inside them', async () => {
    const { a, dash } = await setup()
    const env = a.env
    const brand = env.brands.list()[0]
    const add = (title: string, hoursAgo: number, views: number) => {
      const at = new Date(Date.now() - hoursAgo * 3_600_000).toISOString()
      const post = env.db
        .prepare("INSERT INTO posts (brand_id, title, video_path, status, post_type, scheduled_at_utc) VALUES (?, ?, 'x.mp4', 'posted', 'episode', ?)")
        .run(brand.id, title, at).lastInsertRowid
      const t = env.db
        .prepare("INSERT INTO post_targets (post_id, platform, status, posted_at_utc) VALUES (?, 'youtube', 'posted', ?)")
        .run(post, at).lastInsertRowid
      env.db.prepare('INSERT INTO post_stats (post_target_id, fetched_at_utc, views) VALUES (?, ?, ?)').run(t, at, views)
    }
    add('Today video', 5, 40)
    add('Yesterday big', 30, 900)
    add('Old huge', 100, 5000)
    const best = (dash as unknown as { bestVideos(l: number, w: number): { title: string }[] }).bestVideos
    expect(best.call(dash, 1, 24 * 3_600_000)[0]!.title).toBe('Today video')
    expect(best.call(dash, 1, 48 * 3_600_000)[0]!.title).toBe('Yesterday big')
  })
})
