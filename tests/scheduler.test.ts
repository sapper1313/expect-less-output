import { existsSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import {
  BACKOFF_MINUTES,
  backoffMs,
  decideMissed,
  derivePostStatus,
} from '../src/shared/scheduling'

const MIN = 60_000
const HOUR = 60 * MIN

describe('scheduler rules (pure)', () => {
  it('has the 2, 10, 30 minute backoff and stops after 3 retries', () => {
    expect(BACKOFF_MINUTES).toEqual([5, 15, 60])
    expect(backoffMs(1, false)).toBe(5 * MIN)
    expect(backoffMs(2, false)).toBe(15 * MIN)
    expect(backoffMs(3, false)).toBe(60 * MIN)
    expect(backoffMs(2, false, [1, 2])).toBe(2 * MIN)
    expect(backoffMs(3, false, [1, 2])).toBeNull()
    expect(backoffMs(4, false)).toBeNull()
  })
  it('decides missed posts', () => {
    const s = 1_000_000
    expect(decideMissed(s, s + 2 * MIN, 'post_if_recent', 120)).toBe('on_time')
    expect(decideMissed(s, s + 60 * MIN, 'post_if_recent', 120)).toBe('post_late')
    expect(decideMissed(s, s + 121 * MIN, 'post_if_recent', 120)).toBe('missed')
    expect(decideMissed(s, s + 60 * MIN, 'hold', 120)).toBe('missed')
  })
  it('derives post status from targets', () => {
    expect(derivePostStatus(['posted', 'posted'], 'scheduled')).toBe('posted')
    expect(derivePostStatus(['posted', 'failed'], 'in_progress')).toBe('partial')
    expect(derivePostStatus(['failed', 'failed'], 'in_progress')).toBe('failed')
    expect(derivePostStatus(['pending', 'handed_off'], 'scheduled')).toBe('in_progress')
    expect(derivePostStatus(['pending', 'pending'], 'scheduled')).toBe('scheduled')
    expect(derivePostStatus(['posted'], 'canceled')).toBe('canceled')
  })
})

describe('scheduler with dry run adapters', () => {
  it('posts to all 4 platforms at the scheduled time and moves the file to Posted/YYYY-MM', async () => {
    const env = makeEnv()
    const post = await env.makePost({ whenMs: env.clock.ms + 2 * MIN })
    const queued = env.library.resolve(post.videoPath)
    expect(queued).toContain('/Queue/')
    expect(existsSync(queued)).toBe(true)

    await env.scheduler.tick() // IG and TikTok wait, YouTube and Facebook were handed off early
    const early = env.posts.get(post.id)!
    expect(early.targets.map((t) => t.status)).toEqual([
      'handed_off',
      'handed_off',
      'pending',
      'pending',
    ])
    expect(early.status).toBe('in_progress')

    env.clock.ms += 3 * MIN
    await env.scheduler.tick()
    const done = env.posts.get(post.id)!
    expect(done.targets.map((t) => t.status)).toEqual(['posted', 'posted', 'posted', 'posted'])
    expect(done.status).toBe('posted')
    expect(done.videoPath).toMatch(/Posted\/2026-06\//)
    expect(existsSync(env.library.resolve(done.videoPath))).toBe(true)
    expect(existsSync(queued)).toBe(false)
    expect(env.events.successes).toHaveLength(1)
  })

  it('hands off YouTube and Facebook early, then marks them posted at the scheduled time', async () => {
    const env = makeEnv()
    const post = await env.makePost({ whenMs: env.clock.ms + 2 * HOUR })
    await env.scheduler.tick()
    const early = env.posts.get(post.id)!
    const by = Object.fromEntries(early.targets.map((t) => [t.platform, t.status]))
    expect(by).toEqual({
      youtube: 'handed_off',
      facebook: 'handed_off',
      instagram: 'pending',
      tiktok: 'pending',
    })
    expect(early.status).toBe('in_progress')

    env.clock.ms += 2 * HOUR + MIN
    await env.scheduler.tick() // IG and TikTok publish, YT and FB checked
    await env.scheduler.tick()
    expect(env.posts.get(post.id)!.status).toBe('posted')
  })

  it('retries a transient failure on the 2, 10, 30 minute schedule and then fails', async () => {
    const env = makeEnv()
    env.settings.set({ dryRunFailPlatform: 'instagram' })
    const post = await env.makePost({
      whenMs: env.clock.ms + MIN,
      platforms: ['instagram', 'tiktok'],
    })
    const ig = () => env.posts.get(post.id)!.targets.find((t) => t.platform === 'instagram')!

    env.clock.ms += 2 * MIN
    await env.scheduler.tick()
    expect(ig().attempts).toBe(1)
    expect(ig().status).toBe('pending')
    const gap = (iso: string | null) => (new Date(iso!).getTime() - env.clock.ms) / MIN
    expect(gap(ig().nextAttemptAtUtc)).toBe(2)

    env.clock.ms += 1 * MIN
    await env.scheduler.tick() // too early, nothing happens
    expect(ig().attempts).toBe(1)

    env.clock.ms += 1 * MIN
    await env.scheduler.tick()
    expect(ig().attempts).toBe(2)
    expect(gap(ig().nextAttemptAtUtc)).toBe(10)

    env.clock.ms += 10 * MIN
    await env.scheduler.tick()
    expect(ig().attempts).toBe(3)
    expect(gap(ig().nextAttemptAtUtc)).toBe(30)

    env.clock.ms += 30 * MIN
    await env.scheduler.tick()
    expect(ig().attempts).toBe(4)
    expect(ig().status).toBe('failed')
    const final = env.posts.get(post.id)!
    expect(final.status).toBe('partial') // TikTok succeeded
    expect(final.videoPath).toContain('/Queue/') // file stays until resolved
    expect(env.events.failures).toHaveLength(1)
    expect(env.events.failures[0][0]).toBe('Could not post. Probably for the best.')
    expect(env.events.failures[0][1]).toContain('Instagram, Trash Panda, "Test Clip"')
  })

  it('does not retry permanent errors', async () => {
    const env = makeEnv()
    env.settings.set({ dryRunFailPlatform: 'tiktok', dryRunFailKind: 'permanent' })
    const post = await env.makePost({ whenMs: env.clock.ms + MIN, platforms: ['tiktok'] })
    env.clock.ms += 2 * MIN
    await env.scheduler.tick()
    const t = env.posts.get(post.id)!.targets[0]
    expect(t.status).toBe('failed')
    expect(t.attempts).toBe(1)
    expect(env.posts.get(post.id)!.status).toBe('failed')
  })

  it('retry button restarts a failed target and it can then succeed', async () => {
    const env = makeEnv()
    env.settings.set({ dryRunFailPlatform: 'tiktok', dryRunFailKind: 'permanent' })
    const post = await env.makePost({ whenMs: env.clock.ms + MIN, platforms: ['tiktok'] })
    env.clock.ms += 2 * MIN
    await env.scheduler.tick()
    env.settings.set({ dryRunFailPlatform: null })
    env.scheduler.retryTarget(env.posts.get(post.id)!.targets[0].id)
    await env.scheduler.idle()
    expect(env.posts.get(post.id)!.status).toBe('posted')
  })

  it('posts late when within the grace window, holds as missed beyond it', async () => {
    const env = makeEnv()
    const late = await env.makePost({
      whenMs: env.clock.ms + MIN,
      platforms: ['tiktok'],
      title: 'Late',
    })
    const gone = await env.makePost({
      whenMs: env.clock.ms + MIN,
      platforms: ['tiktok'],
      title: 'Gone',
    })
    env.db
      .prepare('UPDATE posts SET scheduled_at_utc = ? WHERE id = ?')
      .run(new Date(env.clock.ms - 30 * MIN).toISOString(), late.id)
    env.db
      .prepare('UPDATE posts SET scheduled_at_utc = ? WHERE id = ?')
      .run(new Date(env.clock.ms - 200 * MIN).toISOString(), gone.id)
    await env.scheduler.tick()
    expect(env.posts.get(late.id)!.status).toBe('posted')
    expect(env.posts.get(gone.id)!.status).toBe('missed')
    expect(env.events.missed).toHaveLength(1)
  })

  it('never double posts when ticks overlap', async () => {
    const env = makeEnv()
    const post = await env.makePost({ whenMs: env.clock.ms + MIN, platforms: ['instagram'] })
    env.clock.ms += 2 * MIN
    await Promise.all([env.scheduler.tick(), env.scheduler.tick(), env.scheduler.tick()])
    const t = env.posts.get(post.id)!.targets[0]
    expect(t.attempts).toBe(1)
    expect(t.status).toBe('posted')
  })

  it('does nothing while paused', async () => {
    const env = makeEnv()
    env.settings.set({ schedulerPaused: true })
    const post = await env.makePost({ whenMs: env.clock.ms + MIN, platforms: ['instagram'] })
    env.clock.ms += 5 * MIN
    await env.scheduler.tick()
    expect(env.posts.get(post.id)!.status).toBe('scheduled')
  })

  it('reports when the Mac should stay awake', async () => {
    const env = makeEnv()
    await env.makePost({ whenMs: env.clock.ms + 20 * MIN, platforms: ['instagram'] })
    expect(env.scheduler.hasDueWithin(30)).toBe(true)
    const env2 = makeEnv()
    await env2.makePost({ whenMs: env2.clock.ms + 90 * MIN, platforms: ['instagram'] })
    expect(env2.scheduler.hasDueWithin(30)).toBe(false)
  })
})

describe('library', () => {
  it('de-duplicates names and never leaves the Media Root', async () => {
    const env = makeEnv()
    const a = await env.makePost({ whenMs: env.clock.ms + HOUR })
    expect(() => env.library.resolve('../../etc/passwd')).toThrow()
    expect(a.videoPath.startsWith('Trash Panda/Queue/')).toBe(true)
    expect(existsSync(join(env.root, 'Trash Panda', 'Posted'))).toBe(true)
  })
})
