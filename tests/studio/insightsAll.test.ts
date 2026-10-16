import { describe, expect, it } from 'vitest'
import { makeStudioEnv } from './helpers'

describe('Studio Insights count every video with numbers', () => {
  it('includes posts made outside Studio episodes and videos found on the channel', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 9, 15, 12) })
    const b = 1
    // two posts made in the app (no Studio episode), with numbers
    for (const [title, views, hourUtc] of [
      ['Post A', 300, 22],
      ['Post B', 100, 13],
    ] as const) {
      const post = await e.makePost({
        brandId: b,
        whenMs: Date.UTC(2026, 9, 10, hourUtc),
        platforms: ['youtube'],
        title,
      })
      e.db
        .prepare(
          "UPDATE post_targets SET status = 'posted', external_id = 'x' || id WHERE post_id = ?",
        )
        .run(post.id)
      e.db.prepare("UPDATE posts SET status = 'posted' WHERE id = ?").run(post.id)
      const tid = (
        e.db.prepare('SELECT id FROM post_targets WHERE post_id = ?').get(post.id) as { id: number }
      ).id
      e.db
        .prepare(
          "INSERT INTO post_stats (post_target_id, fetched_at_utc, views) VALUES (?, '2026-10-12T00:00:00Z', ?)",
        )
        .run(tid, views)
    }
    // two videos that were already on the channel, and one that has no numbers yet
    const ins = e.db.prepare(
      "INSERT INTO imported_videos (brand_id, platform, external_id, title, published_at_utc, imported_at_utc) VALUES (?, 'youtube', ?, ?, ?, '2026-10-12T00:00:00Z')",
    )
    for (const [ext, title, views] of [
      ['o1', 'Old hit', 900],
      ['o2', 'Old miss', 50],
    ] as const) {
      const id = Number(ins.run(b, ext, title, '2026-09-01T22:00:00Z').lastInsertRowid)
      e.db
        .prepare(
          "INSERT INTO imported_stats (imported_id, fetched_at_utc, views) VALUES (?, '2026-10-12T00:00:00Z', ?)",
        )
        .run(id, views)
    }
    ins.run(b, 'o3', 'No numbers yet', '2026-09-02T22:00:00Z')

    const r = await e.studio.insightsFor(b)
    expect(r.insights!.videos).toBe(4)
    expect(r.insights!.totalViews).toBe(300 + 100 + 900 + 50)
    expect(r.insights!.topEpisodes[0]).toMatchObject({ title: 'Old hit', views: 900 })
    // 22:00 UTC in September and October is 6 PM Eastern, and it did best
    expect(r.insights!.postingHours[0]).toMatchObject({ hourEt: 18 })
    // the numbers are there before any nightly summary was written
    expect(r.summary).toBe('')
  })

  it('has nothing to show for a brand without numbers', async () => {
    const e = makeStudioEnv()
    const r = await e.studio.insightsFor(2)
    expect(r.insights!.videos).toBe(0)
  })
})
