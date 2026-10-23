import { describe, expect, it } from 'vitest'
import { BlueskySync } from '../src/main/growth/blueskySync'
import { SocialPublisher } from '../src/main/studio/social/socialPublisher'
import { pipelineSetup } from './pipelineHelpers'
import { morphCaption } from '../src/shared/growth'

const probe = async () => ({ width: 1080, height: 1920, durationSeconds: 30, hasAudio: true })

function rig(connected: number[] = [1]) {
  const t = pipelineSetup({ probe, live: [[1, 'youtube']] })
  const sent: Array<{ text: string; file: string }> = []
  const social = new SocialPublisher({
    db: t.env.db,
    cfg: {} as never,
    bluesky: () =>
      ({
        uploadLimits: async () => null,
        postVideo: async (a: { text: string; file: string }) => {
          sent.push({ text: a.text, file: a.file })
          return { uri: 'at://x', cid: 'c', url: 'https://bsky.app/x' }
        },
      }) as never,
    alert: () => {},
    log: () => {},
    brandName: () => 'Trash Panda',
    probe: async () => ({ width: 1080, height: 1920 }),
    postVideo: (id) => {
      const r = t.env.db.prepare('SELECT video_path FROM posts WHERE id = ?').get(id) as {
        video_path: string
      }
      return t.env.library.resolve(r.video_path)
    },
    now: () => t.env.clock.ms,
  })
  const sync = new BlueskySync({
    db: t.env.db,
    settings: t.env.settings,
    social,
    notReady: (b) => (connected.includes(b) ? null : 'no login'),
    log: () => {},
    now: () => t.env.clock.ms,
  })
  const rows = () =>
    t.env.db.prepare('SELECT * FROM social_posts ORDER BY id').all() as Array<Record<string, any>>
  return { t, sync, social, sent, rows }
}

describe('Bluesky for pipeline drops', () => {
  it('queues one Bluesky post for a channel with a login, after the other platforms', async () => {
    const r = rig()
    r.t.drop('Trash Panda', 'trash-panda', 601, {
      platforms: ['youtube'],
      description: 'Stop doing this. It saves time. Try it! #mac',
    })
    await r.t.settle()
    expect(r.sync.sync()).toBe(1)
    expect(r.sync.sync()).toBe(0)
    const [row] = r.rows()
    const post = r.t.env.posts.list()[0]!
    expect(row).toMatchObject({ platform: 'bluesky', post_id: post.id, status: 'scheduled' })
    expect(new Date(row!.scheduled_at_utc).getTime()).toBeGreaterThanOrEqual(
      new Date(post.scheduledAtUtc!).getTime(),
    )
    expect(row!.text).toContain('#mac')
  })

  it('ignores a channel with no login', async () => {
    const r = rig([])
    r.t.drop('Trash Panda', 'trash-panda', 602, { platforms: ['youtube'] })
    await r.t.settle()
    expect(r.sync.sync()).toBe(0)
    expect(r.rows()).toHaveLength(0)
  })

  it('follows a new time, and stops when the post leaves the schedule', async () => {
    const r = rig()
    r.t.drop('Trash Panda', 'trash-panda', 603, { platforms: ['youtube'] })
    await r.t.settle()
    r.sync.sync()
    const post = r.t.env.posts.list()[0]!
    const moved = new Date(new Date(post.scheduledAtUtc!).getTime() + 86_400_000).toISOString()
    r.t.env.db.prepare('UPDATE posts SET scheduled_at_utc = ? WHERE id = ?').run(moved, post.id)
    r.sync.sync()
    expect(new Date(r.rows()[0]!.scheduled_at_utc).getTime()).toBeGreaterThanOrEqual(
      new Date(moved).getTime(),
    )
    r.t.env.db.prepare("UPDATE posts SET status = 'canceled' WHERE id = ?").run(post.id)
    r.sync.sync()
    expect(r.rows()[0]!.status).toBe('skipped')
    r.t.env.db.prepare("UPDATE posts SET status = 'scheduled' WHERE id = ?").run(post.id)
    r.sync.sync()
    expect(r.rows()[0]!.status).toBe('scheduled')
  })

  it('sends it when due, from the post file, and never twice', async () => {
    const r = rig()
    r.t.drop('Trash Panda', 'trash-panda', 604, { platforms: ['youtube'] })
    await r.t.settle()
    r.sync.sync()
    const when = new Date(r.rows()[0]!.scheduled_at_utc).getTime()
    r.t.env.clock.ms = when + 1000
    await r.sync.run()
    await r.sync.run()
    expect(r.sent).toHaveLength(1)
    expect(r.sent[0]!.file).toContain('/Queue/')
    expect(r.rows()[0]).toMatchObject({ status: 'posted', external_id: 'at://x' })
  })

  it('skips a video that is too long, and a sidecar may list bluesky without effect', async () => {
    const r = rig()
    r.t.env.settings.set({ pipelineStrict: true })
    r.t.drop('Trash Panda', 'trash-panda', 605, { platforms: ['youtube', 'bluesky'] })
    await r.t.settle()
    const post = r.t.env.posts.list()[0]!
    expect(post.targets.map((x) => x.platform)).toEqual(['youtube'])
    r.t.env.db
      .prepare('UPDATE posts SET video_meta_json = ? WHERE id = ?')
      .run(JSON.stringify({ durationSeconds: 400 }), post.id)
    expect(r.sync.sync()).toBe(0)
  })
})

describe('bluesky caption', () => {
  it('fits 300 characters with up to 3 hashtags', () => {
    const long = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
    const t = morphCaption('bluesky', { description: `${long} #a #b #c #d` })
    expect(t.length).toBeLessThanOrEqual(300)
    expect(t.endsWith('#a #b #c')).toBe(true)
  })
})
