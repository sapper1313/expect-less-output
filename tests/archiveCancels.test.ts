import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'

const MON = Date.UTC(2026, 10, 9, 14, 0, 0)
const TUE_7PM = Date.UTC(2026, 10, 10, 0, 0, 0)

describe('archiving a channel', () => {
  it('cancels what has not gone out, leaves what did, and stops blocking other channels', async () => {
    const env = makeEnv(MON)
    env.db.prepare('DELETE FROM brand_slots').run()
    env.db.prepare("INSERT INTO brand_slots (brand_id, day_type, time_local, enabled) VALUES (1,'weekday','19:00',1),(2,'weekday','19:00',1)").run()
    env.settings.set({ minGapMinutes: 1 })
    const waiting = await env.makePost({ brandId: 1, whenMs: TUE_7PM })
    const live = await env.makePost({ brandId: 1, whenMs: MON - 86_400_000 })
    env.db.prepare("UPDATE posts SET status = 'posted' WHERE id = ?").run(live.id)
    const before = env.posts.nextSlots(2, 1, new Date(MON).toISOString())
    expect(before[0]).not.toBe(new Date(TUE_7PM).toISOString())
    expect(env.posts.cancelUnposted(1)).toBe(1)
    env.brands.archive(1, true)
    expect(env.posts.get(waiting.id)!.status).toBe('canceled')
    expect(env.posts.get(live.id)!.status).toBe('posted')
    expect(env.posts.nextSlots(2, 1, new Date(MON).toISOString())[0]).toBe(new Date(TUE_7PM).toISOString())
  })
})
