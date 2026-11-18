import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'

const HOUR = 3_600_000

describe('moving the waiting platforms of a partly posted drop', () => {
  async function partly() {
    const e = makeEnv()
    const post = await e.makePost({
      whenMs: e.clock.ms + HOUR,
      platforms: ['facebook', 'youtube'],
      times: { youtube: e.clock.ms + 26 * HOUR },
    })
    e.db.prepare("UPDATE posts SET status = 'in_progress' WHERE id = ?").run(post.id)
    e.db.prepare("UPDATE post_targets SET status = 'posted' WHERE post_id = ? AND platform = 'facebook'").run(post.id)
    return { e, post }
  }

  it('lets a pending platform move to tonight while another has already posted', async () => {
    const { e, post } = await partly()
    const when = new Date(e.clock.ms + 3 * HOUR).toISOString()
    e.posts.update(post.id, {
      targets: [
        { platform: 'facebook', aiFlag: false },
        { platform: 'youtube', aiFlag: false, scheduledAtUtc: when },
      ],
    })
    const got = e.posts.get(post.id)!
    expect(got.targets.find((t) => t.platform === 'youtube')!.scheduledAtUtc).toBe(when)
    expect(got.status).toBe('in_progress')
  })

  it('still refuses to move the whole post or an entry that is already posting', async () => {
    const { e, post } = await partly()
    const when = new Date(e.clock.ms + 3 * HOUR).toISOString()
    expect(() => e.posts.update(post.id, { scheduledAtUtc: when })).toThrow(/already going out/)
    e.db.prepare("UPDATE post_targets SET status = 'processing' WHERE post_id = ? AND platform = 'youtube'").run(post.id)
    expect(() =>
      e.posts.update(post.id, { targets: [{ platform: 'youtube', aiFlag: false, scheduledAtUtc: when }] }),
    ).toThrow()
  })
})
