import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { makeEnv } from './helpers'
import { UpcomingService } from '../src/main/pipeline/upcoming'
import { TrackerService } from '../src/main/pipeline/tracker'
import { AuditEvents } from '../src/main/pipeline/auditEvents'
import type { PlatformSlot } from '../src/shared/types'

// Mon Nov 9 2026, 9 AM Eastern.
const MON = Date.UTC(2026, 10, 9, 14, 0, 0)
const slot = (platform: PlatformSlot['platform'], time: string): PlatformSlot => ({
  platform,
  kind: 'short',
  dayType: 'weekday',
  timeLocal: time,
  enabled: true,
})

function rig() {
  const env = makeEnv(MON)
  env.db.prepare("INSERT OR REPLACE INTO channel_rules (brand_id, max_per_day, blackout_json) VALUES (1, 1, '[]')").run()
  // YouTube and Facebook are real. TikTok stays a dry run, so it is never expected.
  for (const p of ['youtube', 'facebook'])
    env.db.prepare("UPDATE accounts SET mode = 'live', status = 'connected' WHERE brand_id = 1 AND platform = ?").run(p)
  env.brands.setPlatformSlots(1, [slot('youtube', '19:00'), slot('facebook', '17:30'), slot('tiktok', '16:00')])
  env.settings.set({
    upcomingFilePath: join(mkdtempSync(join(tmpdir(), 'elo-tr-')), 'Shared', 'upcoming.json'),
    upcomingLiveWatch: false,
  } as never)
  const up = new UpcomingService({
    db: env.db,
    settings: env.settings,
    brands: env.brands,
    audit: new AuditEvents(env.db, () => env.clock.ms),
    notify: () => undefined,
    mediaRoot: () => env.root,
    now: () => env.clock.ms,
    studioIdeas: () => [],
  })
  const tracker = new TrackerService({ db: env.db, brands: env.brands, posts: env.posts, upcoming: up, now: () => env.clock.ms })
  return { env, up, tracker }
}

describe('TrackerService', () => {
  it('flags an empty slot per real platform only, within the window, and changes nothing', async () => {
    const { env, tracker } = rig()
    const before = env.db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }
    const v = tracker.view(3)
    const slots = v.flags.filter((f) => f.brandId === 1 && f.kind === 'slot_no_episode')
    // Mon, Tue, Wed and Thu are inside the 3 day window (Mon 9 AM start, to the end of Thursday).
    expect(slots.map((f) => f.day)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'])
    for (const f of slots) {
      expect(f.platforms!.sort()).toEqual(['facebook', 'youtube'])
      expect(f.detail).not.toMatch(/TikTok/)
    }
    expect((env.db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n).toBe(before.n)
  })

  it('a planned, finished episode stops its day being flagged as empty', async () => {
    const { up, tracker } = rig()
    await up.add({ name: 'josh' }, {
      channel: 'trash-panda',
      working_title: 'Ready',
      episode_id: 'trash-panda-2026-0001',
      status: 'muse-passed',
      air_date: '2026-11-10',
    })
    const v = tracker.view(3)
    const days = v.flags.filter((f) => f.kind === 'slot_no_episode' && f.brandId === 1).map((f) => f.day)
    expect(days).not.toContain('2026-11-10')
    expect(v.flags.some((f) => f.kind === 'muse_passed_not_dropped' && f.episodeId === 'trash-panda-2026-0001')).toBe(true)
  })

  it('a booked platform entry fills that platform slot only', async () => {
    const { env, tracker } = rig()
    // Tue Nov 10: Facebook at 5:30 PM ET (22:30Z), YouTube at 7:00 PM ET (00:00Z on the 11th).
    await env.makePost({
      brandId: 1,
      whenMs: Date.UTC(2026, 10, 10, 22, 30),
      platforms: ['facebook', 'youtube'],
      times: { youtube: Date.UTC(2026, 10, 11, 0, 0) },
    })
    const v = tracker.view(3)
    const tue = v.flags.find((f) => f.kind === 'slot_no_episode' && f.brandId === 1 && f.day === '2026-11-10')
    expect(tue).toBeUndefined()
  })

  it('a Long form video that posts to fewer platforms is not flagged as partial, a Short is', async () => {
    const { env, tracker } = rig()
    env.db
      .prepare("INSERT OR REPLACE INTO brand_slot_kinds (brand_id, kind, enabled, days, platforms) VALUES (1, 'long', 1, NULL, ?)")
      .run(JSON.stringify({ youtube: true, facebook: false }))
    env.db
      .prepare("UPDATE brand_slot_kinds SET platforms = ? WHERE brand_id = 1 AND kind = 'short'")
      .run(JSON.stringify({ youtube: true, facebook: true }))
    const p = await env.makePost({ brandId: 1, whenMs: Date.UTC(2026, 10, 12, 18, 0), platforms: ['youtube'] })
    env.db.prepare('UPDATE posts SET episode_ref = ?, video_meta_json = ? WHERE id = ?').run(
      'trash-panda-2026-0030',
      JSON.stringify({ width: 1920, height: 1080, durationSeconds: 600 }),
      p.id,
    )
    expect(tracker.view(3).flags.some((f) => f.kind === 'partial_drop')).toBe(false)
    env.db
      .prepare('UPDATE posts SET video_meta_json = ? WHERE id = ?')
      .run(JSON.stringify({ width: 1080, height: 1920, durationSeconds: 40 }), p.id)
    const f = tracker.view(3).flags.find((x) => x.kind === 'partial_drop')
    expect(f?.platforms).toEqual(['facebook'])
  })

  it('an old entry still at needs-review is matched to its old post and counts as dropped', async () => {
    const { env, up, tracker } = rig()
    await up.add({ name: 'josh' }, {
      channel: 'trash-panda',
      working_title: 'Old',
      episode_id: 'trash-panda-2026-0002',
      status: 'needs-review',
    })
    const p = await env.makePost({ brandId: 1, whenMs: Date.UTC(2026, 8, 1, 18, 0), platforms: ['youtube', 'facebook'] })
    env.db.prepare("UPDATE posts SET episode_ref = ?, status = 'posted' WHERE id = ?").run('trash-panda-2026-0002', p.id)
    const c = tracker.view(3).channels.find((x) => x.slug === 'trash-panda')!
    expect(c.counts['needs-review']).toBe(0)
    expect(c.counts['dropped']).toBe(1)
  })
})
