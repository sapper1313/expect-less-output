import { describe, expect, it } from 'vitest'
import { toCsv } from '../src/shared/csv'
import { StatsService } from '../src/main/stats/service'
import { makeEnv } from './helpers'

describe('toCsv', () => {
  it('quotes commas, quotes and line breaks, keeps accents, and starts with a byte order mark', () => {
    const text = toCsv(
      ['Title', 'Views'],
      [
        { Title: 'He said "hi", then left', Views: 10 },
        { Title: 'Line one\nLine two', Views: null },
        { Title: 'Café', Views: 0 },
      ],
    )
    expect(text.startsWith('﻿')).toBe(true)
    expect(text).toContain('"He said ""hi"", then left",10')
    expect(text).toContain('"Line one\nLine two",')
    expect(text).toContain('Café,0')
    expect(text.split('\r\n')[0]).toBe('﻿Title,Views')
  })
})

describe('export rows', () => {
  it('lists posted and existing videos with their latest numbers, newest first, for a range', async () => {
    const env = makeEnv(Date.UTC(2026, 9, 15, 12))
    env.db.prepare("UPDATE accounts SET mode = 'live'").run()
    const post = await env.makePost({
      whenMs: Date.UTC(2026, 9, 14, 12),
      platforms: ['youtube'],
      title: 'Posted one',
    })
    env.db
      .prepare(
        "UPDATE post_targets SET status = 'posted', external_id = 'x', posted_at_utc = '2026-10-14T12:00:00Z' WHERE post_id = ?",
      )
      .run(post.id)
    const tid = (
      env.db.prepare('SELECT id FROM post_targets WHERE post_id = ?').get(post.id) as { id: number }
    ).id
    env.db
      .prepare(
        "INSERT INTO post_stats (post_target_id, fetched_at_utc, views, likes) VALUES (?, '2026-10-15T00:00:00Z', 42, 3)",
      )
      .run(tid)
    const v = Number(
      env.db
        .prepare(
          "INSERT INTO imported_videos (brand_id, platform, external_id, title, published_at_utc, imported_at_utc) VALUES (1, 'instagram', 'm1', 'Existing, one', '2026-10-01T12:00:00Z', '2026-10-02T00:00:00Z')",
        )
        .run().lastInsertRowid,
    )
    env.db
      .prepare(
        "INSERT INTO imported_stats (imported_id, fetched_at_utc, views) VALUES (?, '2026-10-15T00:00:00Z', 7)",
      )
      .run(v)
    const stats = new StatsService({
      db: env.db,
      log: env.log,
      providers: {},
      now: () => env.clock.ms,
    })
    const rows = stats.exportRows(null, '30d')
    expect(rows.map((r) => r.Title)).toEqual(['Posted one', 'Existing, one'])
    expect(rows[0]).toMatchObject({
      Platform: 'YouTube',
      Views: 42,
      Likes: 3,
      Source: 'Posted by ELO',
      'Published (Eastern)': '2026-10-14 08:00',
    })
    expect(rows[1]).toMatchObject({ Platform: 'Instagram', Views: 7, Source: 'Existing video' })
    expect(stats.exportRows(null, '7d').map((r) => r.Title)).toEqual(['Posted one'])
    expect(stats.exportRows(2, '30d')).toEqual([])
  })
})
