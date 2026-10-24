import { describe, expect, it } from 'vitest'
import { durationProblem } from '../src/shared/platformLimits'
import { pipelineSetup } from './pipelineHelpers'

const TP = 'Trash Panda'
const probe =
  (secs = 30) =>
  async () => ({ width: 1080, height: 1920, durationSeconds: secs, hasAudio: true })

function rig(extras: string[], secs = 30) {
  const t = pipelineSetup({
    probe: probe(secs),
    live: [[1, 'youtube']],
    extraPlatforms: () => extras as never,
  })
  // The connected accounts for the extras, as the sign-in would leave them.
  for (const p of extras)
    t.env.db
      .prepare(
        "INSERT INTO accounts (brand_id, platform, status, mode, display_name) VALUES (1, ?, 'connected', 'live', 'x')",
      )
      .run(p)
  return t
}
const platformsOf = (t: ReturnType<typeof pipelineSetup>) =>
  t.env.posts
    .list()[0]!
    .targets.map((x) => x.platform)
    .sort()

describe('drops use the extra platforms a channel has a login for', () => {
  it('adds them next to the platforms in the sidecar, with their own captions', async () => {
    const t = rig(['bluesky', 'x', 'snapchat'])
    t.drop(TP, 'trash-panda', 701, {
      platforms: ['youtube'],
      description: 'Stop doing this. It saves ten minutes a day. Try it now! #mac #tips',
    })
    await t.settle()
    expect(platformsOf(t)).toEqual(['bluesky', 'snapchat', 'x', 'youtube'])
    const rows = Object.fromEntries(
      (
        t.env.db
          .prepare('SELECT platform, caption_override c, account_id a FROM post_targets')
          .all() as Array<{
          platform: string
          c: string | null
          a: number | null
        }>
      ).map((r) => [r.platform, r]),
    )
    expect(rows.x!.c!.length).toBeLessThanOrEqual(280)
    expect(rows.bluesky!.c!.length).toBeLessThanOrEqual(300)
    expect(rows.bluesky!.a).not.toBeNull()
    expect(rows.youtube!.c).toBeNull()
  })

  it('ignores a platform with no login, whatever the sidecar says', async () => {
    const t = rig([])
    t.drop(TP, 'trash-panda', 702, { platforms: ['youtube', 'x', 'bluesky', 'pinterest'] })
    await t.settle()
    expect(platformsOf(t)).toEqual(['youtube'])
  })

  it('knows the length limits of each platform', () => {
    expect(durationProblem('bluesky', 200)).toMatch(/Bluesky takes/)
    expect(durationProblem('x', 200)).toBeNull()
    expect(durationProblem('snapchat', 400)).toMatch(/Snapchat takes/)
    expect(durationProblem('linkedin', 2)).toMatch(/LinkedIn takes/)
  })

  it('posts them in a dry run like the other platforms, each on its own minute', async () => {
    const t = rig(['bluesky', 'x'])
    t.env.settings.set({ staggerEnabled: true, staggerGapMin: 5, staggerGapMax: 5 })
    t.drop(TP, 'trash-panda', 704, { platforms: ['youtube'] })
    await t.settle()
    const post = t.env.posts.list()[0]!
    const offs = Object.fromEntries(
      (
        t.env.db
          .prepare('SELECT platform, stagger_offset_min m FROM post_targets WHERE post_id = ?')
          .all(post.id) as Array<{ platform: string; m: number }>
      ).map((r) => [r.platform, r.m]),
    )
    expect(offs).toMatchObject({ youtube: 0 })
    expect(new Set(Object.values(offs)).size).toBe(3)
  })
})
