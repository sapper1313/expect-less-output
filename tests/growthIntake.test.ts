import { writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { pipelineSetup } from './pipelineHelpers'
import { buildVideoMetadata } from '../src/main/google/metadata'

const TP = 'Trash Panda'
const probe = async () => ({ width: 1080, height: 1920, durationSeconds: 30, hasAudio: true })
const ALL: Array<[number, string]> = [
  [1, 'youtube'],
  [1, 'facebook'],
  [1, 'instagram'],
  [1, 'tiktok'],
]
const PLATFORMS = ['youtube', 'facebook', 'instagram', 'tiktok']
const DESC = 'Stop doing this on your Mac. It saves ten minutes a day. Try it now! #mac #tips'

const targets = (t: ReturnType<typeof pipelineSetup>, id: string) => {
  const post = t.env.posts.list().find((p) => p.episodeRef === id)!
  const rows = t.env.db
    .prepare(
      'SELECT platform, caption_override AS c, settings_json AS s FROM post_targets WHERE post_id = ?',
    )
    .all(post.id) as Array<{ platform: string; c: string | null; s: string }>
  return { post, rows: Object.fromEntries(rows.map((r) => [r.platform, r])) }
}

describe('growth fields on a drop', () => {
  it('gives each platform its own caption and keeps the topic, comment and poll', async () => {
    const t = pipelineSetup({ probe, live: ALL })
    const d = t.drop(TP, 'trash-panda', 7, {
      platforms: PLATFORMS,
      description: DESC,
      tags: [],
      topic: 'Mac Tips',
      pinned_comment: 'Which shortcut do you use?',
      community_poll: 'Pick one: A or B',
    })
    expect(await t.settle()).toBe(1)
    const { post, rows } = targets(t, d.id)
    const row = t.env.db
      .prepare('SELECT topic, pinned_comment AS c, community_poll AS p FROM posts WHERE id = ?')
      .get(post.id) as { topic: string; c: string; p: string }
    expect(row).toEqual({
      topic: 'mac_tips',
      c: 'Which shortcut do you use?',
      p: 'Pick one: A or B',
    })
    expect(rows.facebook!.c).toBe(
      'Stop doing this on your Mac. It saves ten minutes a day. Try it now!',
    )
    expect(rows.tiktok!.c).toContain('#mac #tips')
    expect(rows.tiktok!.c).not.toContain('Try it now')
    expect(rows.instagram!.c).toMatch(/\n\n#mac #tips$/)
    expect(rows.youtube!.c).toBeNull()
  })

  it('does not overwrite a caption the bot wrote for a platform', async () => {
    const t = pipelineSetup({ probe, live: ALL })
    const d = t.drop(TP, 'trash-panda', 8, {
      platforms: PLATFORMS,
      description: DESC,
      caption_overrides: { tiktok: 'my own' },
    })
    await t.settle()
    expect(targets(t, d.id).rows.tiktok!.c).toBe('my own')
  })

  it('leaves captions alone when switched off', async () => {
    const t = pipelineSetup({ probe, live: ALL, patch: { captionMorphEnabled: false } })
    const d = t.drop(TP, 'trash-panda', 9, { platforms: PLATFORMS, description: DESC })
    await t.settle()
    expect(targets(t, d.id).rows.facebook!.c).toBeNull()
  })

  it('stores search phrases for YouTube and they reach the tags', async () => {
    const t = pipelineSetup({ probe, live: ALL })
    const d = t.drop(TP, 'trash-panda', 10, {
      platforms: ['youtube'],
      description: 'Tab tips #mac',
      search_phrases: ['best chrome tab shortcut mac', 'mac tab tricks'],
    })
    await t.settle()
    const st = JSON.parse(targets(t, d.id).rows.youtube!.s)
    expect(st.searchTags).toEqual(['best chrome tab shortcut mac', 'mac tab tricks'])
    const meta = buildVideoMetadata({
      title: 'x',
      caption: 'Tab tips #mac',
      categoryId: '22',
      madeForKids: false,
      aiFlag: false,
      appendShorts: false,
      privacy: 'private',
      searchTags: st.searchTags,
    })
    expect(meta.snippet.tags).toEqual(['mac', 'best chrome tab shortcut mac', 'mac tab tricks'])
  })

  it('asks autocomplete when the bot gave no phrases', async () => {
    const t = pipelineSetup({ probe, live: ALL, suggest: async (q) => [`${q} 2026`] })
    const d = t.drop(TP, 'trash-panda', 11, {
      platforms: ['youtube'],
      title: 'Chrome tab shortcut trick',
    })
    await t.settle()
    const st = JSON.parse(targets(t, d.id).rows.youtube!.s)
    expect(st.searchTags[0]).toContain('chrome tab shortcut')
  })

  it('keeps spare thumbnails with the video', async () => {
    const t = pipelineSetup({ probe, live: ALL })
    const inbox = t.inboxOf(TP)
    writeFileSync(join(inbox, 'a.jpg'), 'a')
    writeFileSync(join(inbox, 'b.png'), 'b')
    const d = t.drop(TP, 'trash-panda', 12, {
      platforms: ['youtube'],
      thumbnail_variants: ['a.jpg', 'b.png', 'missing.jpg'],
    })
    await t.settle()
    const { post } = targets(t, d.id)
    const v = JSON.parse(
      (
        t.env.db
          .prepare('SELECT thumb_variants_json AS j FROM posts WHERE id = ?')
          .get(post.id) as { j: string }
      ).j,
    )
    expect(v).toHaveLength(2)
    expect(t.drops.list()[0]!.notes).toMatch(/missing\.jpg/)
  })

  it('writes down the loudness and says so when it is far off', async () => {
    const t = pipelineSetup({
      probe,
      live: ALL,
      loudness: async () => ({ integratedLufs: -26, truePeakDb: -3, rangeLu: 5 }),
    })
    const d = t.drop(TP, 'trash-panda', 13, { platforms: ['youtube'] })
    await t.settle()
    const { post } = targets(t, d.id)
    const j = (
      t.env.db.prepare('SELECT loudness_json AS j FROM posts WHERE id = ?').get(post.id) as {
        j: string
      }
    ).j
    expect(JSON.parse(j).integratedLufs).toBe(-26)
    expect(t.drops.list()[0]!.notes).toMatch(/quiet/)
  })
})
