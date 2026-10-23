import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import { GrowthService, type GrowthDeps } from '../src/main/growth/service'

const HOUR = 3_600_000

async function setup(over: Partial<GrowthDeps> = {}) {
  const env = makeEnv(Date.UTC(2026, 9, 5, 16, 0, 0)) // Monday 12:00 Eastern
  env.db.prepare("UPDATE accounts SET mode = 'auto' WHERE brand_id = 1 AND platform = 'youtube'").run()
  const acct = (
    env.db.prepare("SELECT id FROM accounts WHERE platform='youtube' AND brand_id = 1").get() as {
      id: number
    }
  ).id
  const post = await env.makePost({ whenMs: env.clock.ms - 60 * HOUR, platforms: ['youtube'] })
  env.db
    .prepare(
      "UPDATE post_targets SET status='posted', external_id='vid1', external_url='https://youtu.be/vid1', account_id=?, posted_at_utc=? WHERE post_id = ?",
    )
    .run(acct, new Date(env.clock.ms - 50 * HOUR).toISOString(), post.id)
  env.db
    .prepare(
      "UPDATE posts SET episode_ref='trash-panda-2026-0101', video_meta_json = ? WHERE id = ?",
    )
    .run(JSON.stringify({ durationSeconds: 30 }), post.id)
  const calls = {
    notes: [] as string[][],
    comments: [] as string[],
    privacy: [] as string[],
    thumbs: [] as string[],
    ideas: [] as string[],
    sent: [] as string[],
  }
  const d: GrowthDeps = {
    db: env.db,
    settings: env.settings,
    log: env.log,
    notify: (h, t) => calls.notes.push([h, t]),
    send: async (t) => void calls.sent.push(t),
    youtube: {
      postComment: async (_a, _v, t) => (calls.comments.push(t), 'c1'),
      listComments: async () => [
        { id: 'q1', text: 'How do you do this on a Mac?', author: 'alex', publishedAt: '' },
        { id: 'q2', text: 'nice', author: 'bo', publishedAt: '' },
      ],
      setPrivacy: async (_a, v, p) => void calls.privacy.push(`${v}:${p}`),
      videoStatus: async () => ({ privacyStatus: 'public' }),
    },
    refreshStats: async () => undefined,
    readRetention: async () => ({
      avgViewPercent: 50,
      curve: [
        { t: 0, watch: 1 },
        { t: 0.3, watch: 0.9 },
        { t: 0.5, watch: 0.6 },
        { t: 1, watch: 0.5 },
      ],
    }),
    readCtr: async () => 0.03,
    setThumbnail: async (_a, v, f) => void calls.thumbs.push(`${v}:${f}`),
    resolve: (rel) => `/root/${rel}`,
    addIdea: async (i) => (calls.ideas.push(i.title), 'trash-panda-2026-0102'),
    upcomingCounts: () => ({ idea: 2, scripted: 1 }),
    bestTimeLines: () => ['Trash Panda: Thursday 8 PM looks stronger than 6 PM.'],
    emptySlotCount: () => 3,
    sharedDir: () => join(env.root, 'Shared'),
    live: () => true,
    now: () => env.clock.ms,
    ...over,
  }
  return { env, g: new GrowthService(d), calls, post, acct }
}

describe('growth service', () => {
  it('posts the first comment once and asks the owner to pin it', async () => {
    const { env, g, calls, post } = await setup()
    env.db
      .prepare("UPDATE posts SET pinned_comment = 'What is your favorite shortcut?' WHERE id = ?")
      .run(post.id)
    expect(await g.pinnedComments()).toBe(1)
    expect(await g.pinnedComments()).toBe(0)
    expect(calls.comments).toEqual(['What is your favorite shortcut?'])
    expect(calls.notes[0]![1]).toContain('Pin')
  })

  it('writes one lesson per video into learnings.md after 48 hours', async () => {
    const { env, g } = await setup()
    expect(await g.learnings()).toBe(1)
    expect(await g.learnings()).toBe(0)
    const file = join(env.root, 'Shared', 'learnings.md')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('lost 30 points')
  })

  it('swaps the thumbnail when the click rate is under the line, once', async () => {
    const { env, g, calls, post } = await setup()
    env.settings.set({ thumbRescueEnabled: true })
    env.db
      .prepare('UPDATE posts SET thumb_variants_json = ? WHERE id = ?')
      .run(JSON.stringify(['a.jpg', 'b.jpg']), post.id)
    expect(await g.thumbRescue()).toBe(1)
    expect(calls.thumbs).toEqual(['vid1:/root/b.jpg'])
    expect(await g.thumbRescue()).toBe(0)
  })

  it('does not touch a video whose click rate is fine', async () => {
    const { env, g, calls, post } = await setup({ readCtr: async () => 0.07 })
    env.db
      .prepare('UPDATE posts SET thumb_variants_json = ? WHERE id = ?')
      .run(JSON.stringify(['a.jpg', 'b.jpg']), post.id)
    expect(await g.thumbRescue()).toBe(0)
    expect(calls.thumbs).toEqual([])
  })

  it('turns a real question into an idea and ignores chatter', async () => {
    const { g, calls } = await setup()
    expect(await g.fanQuestions()).toBe(1)
    expect(calls.ideas[0]).toContain('How do you do this on a Mac')
    expect(await g.fanQuestions()).toBe(0)
  })

  it('reminds about the poll once', async () => {
    const { env, g, calls, post } = await setup()
    env.db
      .prepare("UPDATE posts SET community_poll = 'Where is your fund? A/B/C' WHERE id = ?")
      .run(post.id)
    env.db
      .prepare('UPDATE post_targets SET posted_at_utc = ? WHERE post_id = ?')
      .run(new Date(env.clock.ms - HOUR).toISOString(), post.id)
    expect(await g.pollReminders()).toBe(1)
    expect(await g.pollReminders()).toBe(0)
    expect(calls.notes[0]![1]).toContain('Where is your fund')
  })

  it('does nothing against a dry run', async () => {
    const { g } = await setup({ live: () => false })
    expect(await g.learnings()).toBe(0)
  })

  it('retracts YouTube to private and lists the rest as manual', async () => {
    const { env, g, calls, post } = await setup()
    env.db
      .prepare(
        "INSERT INTO post_targets (post_id, platform, status, external_id, external_url) VALUES (?, 'tiktok', 'posted', 't1', 'https://tiktok.com/x')",
      )
      .run(post.id)
    const r = await g.retract('trash-panda-2026-0101', 'beth')
    expect(calls.privacy).toEqual(['vid1:private'])
    expect(r.results.find((x) => x.platform === 'tiktok')?.outcome).toBe('manual')
    await expect(g.retract('nope', 'beth')).rejects.toThrow()
  })

  it('flags a slow start and a changed YouTube status', async () => {
    const { env, g, calls, post } = await setup({
      youtube: {
        postComment: async () => '',
        listComments: async () => [],
        setPrivacy: async () => undefined,
        videoStatus: async () => ({ privacyStatus: 'private' }),
      },
    })
    env.db
      .prepare('UPDATE post_targets SET posted_at_utc = ? WHERE post_id = ?')
      .run(new Date(env.clock.ms - 2.5 * HOUR).toISOString(), post.id)
    expect(await g.velocity()).toBe(2)
    expect(calls.notes[0]![1]).toContain('private')
    expect(await g.velocity()).toBe(0)
  })

  it('sends the brief on Monday morning once', async () => {
    const { env, g, calls } = await setup()
    env.settings.set({ briefTime: '08:00' })
    expect(await g.briefIfDue()).toBe(true)
    expect(await g.briefIfDue()).toBe(false)
    expect(calls.sent[0]).toContain('Pipeline')
    expect(calls.sent[0]).toContain('Better times')
    expect(existsSync(join(env.root, 'Shared', 'Briefs', 'brief-2026-10-05.md'))).toBe(true)
  })
})
