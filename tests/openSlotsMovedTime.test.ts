import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import type { PlatformSlot } from '../src/shared/types'

const MON = Date.UTC(2026, 10, 9, 14, 0, 0) // Mon Nov 9, 9 AM Eastern
const slot = (platform: PlatformSlot['platform'], time: string): PlatformSlot => ({
  platform, kind: 'short', dayType: 'weekday', timeLocal: time, enabled: true,
})

describe('open slots with a platform time moved', () => {
  it('does not show the slot as empty when each platform already has a video that day', async () => {
    const e = makeEnv(MON)
    e.db.prepare("INSERT OR REPLACE INTO channel_rules (brand_id, max_per_day, blackout_json) VALUES (1, 0, '[]')").run()
    for (const p of ['youtube', 'facebook'])
      e.db.prepare("UPDATE accounts SET mode = 'live', status = 'connected' WHERE brand_id = 1 AND platform = ?").run(p)
    e.brands.setPlatformSlots(1, [slot('youtube', '19:00'), slot('facebook', '17:30')])
    const day = (iso: string) => e.posts.openSlotsInRange(1, iso, new Date(Date.UTC(2026, 10, 12, 5)).toISOString())
      .filter((s) => s.kind === 'episode' && s.whenUtc.startsWith('2026-11-1'))
    const tue = Date.UTC(2026, 10, 10, 16, 0) // Tue 11 AM Eastern, off every slot
    const before = day(new Date(MON).toISOString()).filter((s) => s.whenUtc < '2026-11-11T05')
    expect(before.length).toBeGreaterThan(0)
    await e.makePost({ whenMs: tue, platforms: ['youtube', 'facebook'] })
    const after = day(new Date(MON).toISOString()).filter((s) => s.whenUtc >= '2026-11-10T05' && s.whenUtc < '2026-11-11T05')
    expect(after).toEqual([])
  })

  it('counts a video on any platform as the day\'s video', async () => {
    const e = makeEnv(MON)
    e.db.prepare("INSERT OR REPLACE INTO channel_rules (brand_id, max_per_day, blackout_json) VALUES (1, 0, '[]')").run()
    for (const p of ['youtube', 'facebook'])
      e.db.prepare("UPDATE accounts SET mode = 'live', status = 'connected' WHERE brand_id = 1 AND platform = ?").run(p)
    e.brands.setPlatformSlots(1, [slot('youtube', '19:00'), slot('facebook', '17:30')])
    await e.makePost({ whenMs: Date.UTC(2026, 10, 10, 16, 0), platforms: ['youtube'] })
    const open = e.posts.openSlotsInRange(1, new Date(MON).toISOString(), new Date(Date.UTC(2026, 10, 12, 5)).toISOString())
      .filter((s) => s.whenUtc >= '2026-11-10T05' && s.whenUtc < '2026-11-11T05')
    expect(open).toEqual([])
  })
})
