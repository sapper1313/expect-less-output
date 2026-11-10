import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'

const MON = Date.UTC(2026, 9, 19, 14, 0, 0) // Monday 10:00 AM Eastern
// 12:00 noon Eastern on Tue Oct 20 2026 is 16:00 UTC (EDT)
const TUE_NOON = Date.UTC(2026, 9, 20, 16, 0, 0)

function setup() {
  const env = makeEnv(MON)
  env.db.prepare('DELETE FROM brand_slots WHERE brand_id = 1').run()
  env.db
    .prepare(
      "INSERT INTO brand_slots (brand_id, day_type, time_local, enabled) VALUES (1, 'weekday', '12:00', 1)",
    )
    .run()
  return env
}

describe('checkCustomTime (Manual Schedule override warnings)', () => {
  it('has no warnings for a real, open slot', () => {
    const env = setup()
    expect(env.posts.checkCustomTime(1, new Date(TUE_NOON).toISOString())).toEqual([])
  })

  it('warns when the time is not one of the channel posting times', () => {
    const env = setup()
    const w = env.posts.checkCustomTime(1, new Date(TUE_NOON + 37 * 60_000).toISOString())
    expect(w.join(' ')).toMatch(/not one of this channel's posting times/)
  })

  it('warns about a time in the past', () => {
    const env = setup()
    const w = env.posts.checkCustomTime(1, new Date(MON - 3_600_000).toISOString())
    expect(w.join(' ')).toMatch(/in the past/)
  })

  it('warns when the daily limit is already used, and never about another channel being close', async () => {
    const env = setup()
    env.settings.set({ minGapMinutes: 30 } as never)
    await env.makePost({ brandId: 1, whenMs: TUE_NOON })
    const w = env.posts.checkCustomTime(1, new Date(TUE_NOON).toISOString())
    expect(w.join(' ')).toMatch(/already has 1 post/)
    await env.makePost({ brandId: 2, whenMs: TUE_NOON + 10 * 60_000 })
    const w2 = env.posts.checkCustomTime(1, new Date(TUE_NOON).toISOString())
    expect(w2.join(' ')).not.toMatch(/minimum gap/)
  })

  it('never blocks: posts.create accepts a hand picked off-slot time', async () => {
    const env = setup()
    const p = await env.makePost({ brandId: 1, whenMs: TUE_NOON + 37 * 60_000 })
    expect(p.scheduledAtUtc).toBe(new Date(TUE_NOON + 37 * 60_000).toISOString())
  })
})
