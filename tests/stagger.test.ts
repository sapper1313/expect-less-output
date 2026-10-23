import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'

const MIN = 60_000

describe('staggered posting', () => {
  it('gives each platform a later minute and holds it until then', async () => {
    const env = makeEnv()
    env.settings.set({ staggerEnabled: true, staggerGapMin: 5, staggerGapMax: 5 })
    const post = await env.makePost({ whenMs: env.clock.ms + 10 * MIN })
    const offsets = env.db
      .prepare('SELECT platform, stagger_offset_min AS m FROM post_targets WHERE post_id = ? ORDER BY m')
      .all(post.id) as Array<{ platform: string; m: number }>
    expect(offsets.map((o) => o.m)).toEqual([0, 5, 10, 15])
    expect(offsets[0]!.platform).toBe('youtube')

    env.clock.ms += 11 * MIN // 1 minute past the slot: only YouTube is due
    await env.scheduler.tick()
    const st = Object.fromEntries(env.posts.get(post.id)!.targets.map((t) => [t.platform, t.status]))
    expect(st.youtube).not.toBe('pending')
    expect(st.instagram).toBe('pending')
    expect(st.tiktok).toBe('pending')

    env.clock.ms += 20 * MIN
    await env.scheduler.tick()
    await env.scheduler.tick()
    const done = env.posts.get(post.id)!.targets.map((t) => t.status)
    expect(done.every((s) => s === 'posted')).toBe(true)
  })

  it('leaves everything on the slot when switched off', async () => {
    const env = makeEnv()
    const post = await env.makePost({ whenMs: env.clock.ms + 10 * MIN })
    const m = env.db
      .prepare('SELECT MAX(stagger_offset_min) AS m FROM post_targets WHERE post_id = ?')
      .get(post.id) as { m: number }
    expect(m.m).toBe(0)
  })
})
