import { describe, expect, it } from 'vitest'
import {
  analyze,
  median,
  pickTop,
  recommendSlots,
  type TimedVideo,
} from '../src/main/stats/bestTimes'
import { StatsService } from '../src/main/stats/service'
import { makeEnv } from './helpers'

const DAY = 86_400_000
// 2026-06-30 12:00 UTC, so every video below is older than a week
const NOW = Date.UTC(2026, 5, 30, 12, 0, 0)

/** A video live at this Eastern hour (June is EDT, UTC-4) on a given June day. */
const vid = (day: number, easternHour: number, views: number, group = '1:youtube'): TimedVideo => ({
  at: new Date(Date.UTC(2026, 5, day, easternHour + 4)).toISOString(),
  views,
  group,
})

describe('best times', () => {
  it('median handles odd, even and empty lists', () => {
    expect(median([])).toBe(0)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('finds the best Eastern hour and ignores videos that are too new', () => {
    const vids: TimedVideo[] = []
    // 5pm Eastern does well, 9am does poorly
    for (let d = 1; d <= 6; d++) vids.push(vid(d, 17, 1000 + d), vid(d, 9, 100 + d))
    vids.push(vid(29, 17, 5)) // posted yesterday, must not count
    const r = analyze(vids, { nowMs: NOW, minAgeDays: 7, relative: false })
    expect(r.videos).toBe(13)
    expect(r.used).toBe(12)
    expect(r.enough).toBe(true)
    expect(r.top[0].hour).toBe(17)
    expect(r.hours[9].median).toBeLessThan(r.hours[17].median)
  })

  it('says not enough with few videos', () => {
    const r = analyze([vid(1, 17, 10), vid(2, 17, 20)], {
      nowMs: NOW,
      minAgeDays: 7,
      relative: false,
    })
    expect(r.enough).toBe(false)
  })

  it('compares groups by how they do against their own typical video', () => {
    const vids: TimedVideo[] = []
    for (let d = 1; d <= 5; d++) {
      vids.push(vid(d, 17, 1_000_000, '1:youtube'), vid(d, 9, 500_000, '1:youtube'))
      vids.push(vid(d, 17, 100, '1:instagram'), vid(d, 9, 50, '1:instagram'))
    }
    const r = analyze(vids, { nowMs: NOW, minAgeDays: 7, relative: true })
    // both platforms agree 5pm is best, and the scale difference does not swamp it
    expect(r.top[0].hour).toBe(17)
    expect(r.hours[17].median).toBeGreaterThan(1)
    expect(r.hours[9].median).toBeLessThan(1)
  })

  it('keeps top hours at least two hours apart and needs two videos', () => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hour === 3 ? 1 : 3,
      mean: 0,
      median: hour === 3 ? 99 : hour === 17 ? 5 : hour === 18 ? 4.9 : hour === 9 ? 3 : 1,
    }))
    expect(pickTop(hours).map((h) => h.hour)).toEqual([17, 9, 0])
  })

  it('recommends weekday and weekend times separately', () => {
    const vids: TimedVideo[] = []
    // June 1 2026 is a Monday. Weekdays: 6pm wins. Weekend (Sat 6, Sun 7, 13, 14): 10am wins.
    for (const d of [1, 2, 3, 4, 5, 8, 9]) vids.push(vid(d, 18, 900), vid(d, 12, 300))
    for (const d of [6, 7, 13, 14]) vids.push(vid(d, 10, 900), vid(d, 20, 100))
    const r = recommendSlots(vids, { nowMs: NOW, minAgeDays: 7 })
    expect(r.enough).toBe(true)
    expect(r.weekday[0].timeLocal).toBe('18:00')
    expect(r.weekend[0].timeLocal).toBe('10:00')
    expect(r.weekday[0].lift).toBeGreaterThan(1)
  })
})

describe('StatsService best times', () => {
  it('uses imported videos with their numbers', async () => {
    const env = makeEnv(NOW)
    const ins = env.db.prepare(
      `INSERT INTO imported_videos (brand_id, platform, external_id, title, published_at_utc, imported_at_utc)
       VALUES (1, 'youtube', ?, '', ?, ?)`,
    )
    const stat = env.db.prepare(
      'INSERT INTO imported_stats (imported_id, fetched_at_utc, views) VALUES (?, ?, ?)',
    )
    for (let d = 1; d <= 12; d++) {
      const at = new Date(NOW - (d + 8) * DAY)
      at.setUTCHours(21, 0, 0, 0) // 5pm Eastern
      const id = ins.run(`v${d}`, at.toISOString(), at.toISOString()).lastInsertRowid
      stat.run(id, at.toISOString(), 1000)
    }
    const stats = new StatsService({ db: env.db, log: env.log, providers: {}, now: () => NOW })
    const r = stats.bestTimes(1, 'youtube')
    expect(r.relative).toBe(false)
    expect(r.used).toBe(12)
    expect(r.top[0].hour).toBe(17)
    expect(stats.recommendedSlots(1).weekday[0]?.timeLocal ?? '17:00').toBe('17:00')
  })
})
