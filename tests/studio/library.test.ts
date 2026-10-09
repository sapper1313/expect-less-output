import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { makePlaceholderVideo, makePlaceholderImage } from '../../src/main/studio/ffmpeg'
import { hollowId, makeStudioEnv, minimalPackage } from './helpers'

function hollowPackage(n: number) {
  const scenes = Array.from({ length: 18 }, (_, i) => ({
    n: i + 1,
    content_seconds: 10,
    generate_seconds: 15,
    setting: 'The Hollow workshop with warm lamps and a wooden bench, morning light through the window',
    characters: ['Pip', 'Moss', 'Juniper'],
    action: `The crew counts ${n % 9 + 2} acorns together and lines them up on the bench in a neat row`,
    dialogue: [{ speaker: 'Pip', line: 'One, two, three, let us count them all together!' }],
    objects_in_frame: ['acorns'],
    camera: 'slow push in, eye level',
    transition_in: 'cut',
    transition_out: 'match cut on the last acorn',
    grok_prompt: 'Soft 3D animated style, warm light, three friendly woodland characters counting acorns on a wooden bench, gentle camera push in, cheerful voices. '.repeat(2),
    extension_note: 'Extend from the last frame so the next scene starts on the same bench.',
  }))
  return minimalPackage(`Counting Acorns ${n}`, {
    series: 'Wonder Hollow Workshop',
    episode_number: n,
    life_lesson: 'Sharing makes the work lighter.',
    math_lesson: 'Counting to ten.',
    counted_objects: [{ name: 'acorns', quantity: 10, scenes: [3, 4, 5] }],
    scenes,
    tags: ['counting', 'sharing', `batch${n % 5}`],
  })
}

describe('Episode Library', () => {
  it('stores 300 mock episodes in a few megabytes, and search and open still work', () => {
    const e = makeStudioEnv()
    const s = e.studio
    const hid = hollowId(e)
    for (let i = 1; i <= 300; i++) s.episodes.create(hid, hollowPackage(i) as never, { status: i % 2 ? 'Ready for production' : 'Written', slotDate: null })
    expect(s.episodes.count()).toBe(300)
    const bytes = s.episodes.packageBytes()
    console.log(`LIBRARY 300 episodes: ${(bytes / 1024 / 1024).toFixed(2)} MB`)
    expect(bytes).toBeLessThan(5 * 1024 * 1024)
    expect(s.episodes.list({ search: 'Acorns 150' }).map((r) => r.title)).toContain('Counting Acorns 150')
    expect(s.episodes.list({ status: 'Written' })).toHaveLength(150)
    expect(s.episodes.list({ tag: 'batch3' }).length).toBe(60)
    const first = s.episodes.list({ sort: 'oldest' })[0]
    const pkg = s.episodes.getPackage(first.id)!
    expect(pkg.scenes).toHaveLength(18)
    expect(pkg.schema_version).toBe(1)
    expect(first.packagePath).toMatch(/\.json\.gz$/)
  })

  it('keeps a plain .json copy of READY Hollow packages for Muse, and removes it when the episode moves on', async () => {
    const e = makeStudioEnv()
    const s = e.studio
    const hid = hollowId(e)
    const row = s.episodes.create(hid, hollowPackage(1) as never, { status: 'Written' })
    const file = join(s.episodes.readyDir(), `${row.id}.json`)
    expect(existsSync(file)).toBe(false)
    s.episodes.setStatus(row.id, 'Ready for production')
    expect(existsSync(file)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8')).id).toBe(row.id)
    s.episodes.setStatus(row.id, 'Video received')
    expect(existsSync(file)).toBe(false)
    const detail = await s.episode(row.id)
    expect(detail.pkg!.status_history.map((h) => h.status)).toEqual(['Written', 'Ready for production', 'Video received'])
    // shorts never go to the Muse folder
    const short = e.db.prepare("SELECT id FROM brands WHERE name = 'Trash Panda'").get() as { id: number }
    const sr = s.episodes.create(short.id, minimalPackage('A short') as never, { status: 'Ready for production' })
    expect(existsSync(join(s.episodes.readyDir(), `${sr.id}.json`))).toBe(false)
  })

  it('duplicates an episode as a new Idea and exports readable JSON', async () => {
    const e = makeStudioEnv()
    const s = e.studio
    const hid = hollowId(e)
    const a = s.episodes.create(hid, hollowPackage(7) as never, { status: 'Posted' })
    const copy = await s.duplicateEpisode(a.id)
    expect(copy.id).not.toBe(a.id)
    expect(copy.status).toBe('Idea')
    expect(copy.title).toMatch(/copy/)
    expect(JSON.parse(await s.exportEpisode(a.id)).title).toBe('Counting Acorns 7')
    expect(a.id).toMatch(/^wonder-hollow-workshop-\d{4}-0001$/)
  })
})

describe('Calendar feed', () => {
  it('shows posted, queued, in production, awaiting video, flagged, failed and planned items', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 10, 14) })
    const s = e.studio
    const hid = hollowId(e)
    const tp = e.db.prepare("SELECT id FROM brands WHERE name = 'Trash Panda'").get() as { id: number }
    const at = (d: number, h = 21) => Date.UTC(2026, 5, d, h)
    await e.makePost({ brandId: tp.id, whenMs: at(11), title: 'Queued clip', platforms: ['youtube'] })
    const posted = await e.makePost({ brandId: tp.id, whenMs: at(5), title: 'Old posted', platforms: ['youtube'] })
    e.db.prepare("UPDATE posts SET status = 'posted' WHERE id = ?").run(posted.id)
    const failed = await e.makePost({ brandId: tp.id, whenMs: at(6), title: 'Broken', platforms: ['youtube'] })
    e.db.prepare("UPDATE posts SET status = 'failed' WHERE id = ?").run(failed.id)
    const mk = (title: string, status: never, date: string) => s.episodes.create(hid, minimalPackage(title) as never, { status, slotDate: date })
    mk('In prod', 'In production' as never, '2026-06-12')
    mk('Awaiting', 'Awaiting video' as never, '2026-06-16')
    mk('Flag me', 'Flagged' as never, '2026-06-19')
    const items = s.calendarFeed.items({ fromUtc: '2026-06-01T04:00:00Z', toUtc: '2026-07-01T04:00:00Z' })
    const kinds = new Set(items.map((i) => i.kind))
    for (const k of ['posted', 'scheduled', 'failed', 'in_production', 'awaiting_video', 'flagged', 'planned', 'production_window'])
      expect(kinds, k).toContain(k)
    expect(items.find((i) => i.title === 'Queued clip')?.platforms).toEqual(['youtube'])
    // filters
    expect(s.calendarFeed.items({ fromUtc: '2026-06-01T04:00:00Z', toUtc: '2026-07-01T04:00:00Z', brandId: tp.id }).every((i) => i.brandId === tp.id)).toBe(true)
    expect(s.calendarFeed.items({ fromUtc: '2026-06-01T04:00:00Z', toUtc: '2026-07-01T04:00:00Z', kind: 'flagged' })).toHaveLength(1)
    // a slot with an episode is not also shown as planned
    expect(items.filter((i) => i.kind === 'planned' && i.brandId === hid && i.date === '2026-06-12')).toHaveLength(0)
  })

  it('backfills files already in a Posted folder, once', () => {
    const e = makeStudioEnv()
    const s = e.studio
    const dir = join(e.root, 'Trash Panda', 'Posted', '2026-05')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'old-clip.mp4'), 'x')
    expect(s.calendarFeed.backfillPostedFolders()).toBe(1)
    expect(s.calendarFeed.backfillPostedFolders()).toBe(0)
    expect(s.episodes.list({ status: 'Posted' })[0].title).toBe('old-clip')
  })
})

describe('Retention', () => {
  it('dry run lists what would go; a real purge removes media but keeps packages and stats rows', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 7, 20, 12) })
    const s = e.studio
    const tp = e.db.prepare("SELECT id FROM brands WHERE name = 'Trash Panda'").get() as { id: number }
    const old = await e.makePost({ brandId: tp.id, whenMs: Date.UTC(2026, 5, 1, 21), title: 'Old', platforms: ['youtube'], bytes: 2000 })
    const fresh = await e.makePost({ brandId: tp.id, whenMs: Date.UTC(2026, 7, 10, 21), title: 'Fresh', platforms: ['youtube'], bytes: 2000 })
    e.db.prepare("UPDATE posts SET status = 'posted'").run()
    const targetId = (e.db.prepare('SELECT id FROM post_targets WHERE post_id = ?').get(old.id) as { id: number }).id
    e.db.prepare('INSERT INTO post_stats (post_target_id, fetched_at_utc, views, likes, comments, shares) VALUES (?, ?, 1234, 56, 7, 8)').run(targetId, '2026-06-02T00:00:00Z')
    const thumb = join(e.dir, 'thumb-full.jpg')
    await makePlaceholderImage(thumb, 1280, 720)
    const ep = s.episodes.create(tp.id, minimalPackage('Old ep') as never, { status: 'Posted' })
    s.episodes.setFields(ep.id, { postId: old.id, thumbPath: thumb })

    const videoOld = e.library.resolve(e.posts.get(old.id)!.videoPath)
    const dry = await s.purge(true)
    expect(dry.dryRun).toBe(true)
    expect(dry.items.map((i) => i.title)).toEqual(['Old'])
    expect(dry.items[0].files.map((f) => f.kind).sort()).toEqual(['thumbnail', 'video'])
    expect(existsSync(videoOld)).toBe(true)

    const real = await s.purge(false)
    expect(real.count).toBe(1)
    expect(existsSync(videoOld)).toBe(false)
    expect(existsSync(thumb)).toBe(false)
    expect(existsSync(e.library.resolve(e.posts.get(fresh.id)!.videoPath))).toBe(true)
    // package and stats stay
    expect(s.episodes.getPackage(ep.id)!.title).toBe('Old ep')
    expect(s.episodes.get(ep.id).status).toBe('Archived')
    expect(e.db.prepare('SELECT COUNT(*) AS n FROM post_stats').get()).toEqual({ n: 1 })
    expect(e.db.prepare('SELECT views, likes FROM stats_archive').get()).toEqual({ views: 1234, likes: 56 })
    // removed from the calendar
    const items = s.calendarFeed.items({ fromUtc: '2026-05-25T00:00:00Z', toUtc: '2026-09-01T00:00:00Z' })
    expect(items.map((i) => i.title)).not.toContain('Old')
    expect(items.map((i) => i.title)).toContain('Fresh')
    // logged, and a second run does nothing
    expect(s.audit.list({ agent: 'Archivist' }).some((a) => a.action === 'purge')).toBe(true)
    expect((await s.purge(false)).count).toBe(0)
    void makePlaceholderVideo
  })
})
