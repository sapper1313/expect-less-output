import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { bestWindows } from '../../src/shared/studio/clips'
import { makePlaceholderVideo } from '../../src/main/studio/ffmpeg'
import { RepostQueue } from '../../src/main/studio/repost'
import { hollowId, makeStudioEnv, minimalPackage } from './helpers'

vi.setConfig({ testTimeout: 120_000 })

const scene = (n: number, lines: number) => ({
  n, content_seconds: 10, generate_seconds: 10, setting: 's', characters: [], action: `Scene ${n} happens`, dialogue: Array.from({ length: lines }, (_, i) => ({ speaker: 'B', line: `Line ${n}.${i}` })), objects_in_frame: [], camera: '', transition_in: '', transition_out: '', grok_prompt: 'p', extension_note: '',
})

describe('best windows', () => {
  it('picks busy, separate stretches and avoids the first and last scene', () => {
    const scenes = Array.from({ length: 18 }, (_, i) => scene(i + 1, i === 5 || i === 6 || i === 12 || i === 13 ? 4 : 1))
    const w = bestWindows({ scenes }, 2)
    expect(w).toHaveLength(2)
    expect(w[0].start + w[0].seconds).toBeLessThanOrEqual(w[1].start)
    for (const x of w) {
      expect(x.seconds).toBeGreaterThanOrEqual(20)
      expect(x.seconds).toBeLessThanOrEqual(50)
      expect(x.start).toBeGreaterThanOrEqual(10)
      expect(x.start + x.seconds).toBeLessThanOrEqual(170)
    }
    expect(bestWindows({ scenes: [scene(1, 1), scene(2, 1)] }, 3)).toEqual([])
  })
})

describe('shorts and re-posts', () => {
  it('cuts shorts into draft posts and never sends a mock episode out', async () => {
    const e = makeStudioEnv()
    const root = mkdtempSync(join(tmpdir(), 'elo-clips-'))
    const video = join(root, 'full.mp4')
    await makePlaceholderVideo({ out: video, seconds: 4, width: 640, height: 360, audio: true })
    const b = hollowId(e)
    const ep = e.studio.episodes.create(b, { ...minimalPackage('Long one'), scenes: Array.from({ length: 18 }, (_, i) => scene(i + 1, i % 2 ? 3 : 1)) } as never, { status: 'Ready for production' })
    await expect(e.studio.makeClips(ep.id, 3)).rejects.toThrow(/no video/)
    const cutter = (await import('../../src/main/studio/clips')).ClipCutter
    const created: unknown[] = []
    const c = new cutter({
      db: e.db,
      gateway: e.studio.gateway,
      episodes: e.studio.episodes,
      resolve: () => video,
      createPost: async (i) => { created.push(i); return { id: created.length } as never },
      brandName: () => 'B',
      aiDisclosure: () => true,
      workDir: () => join(root, 'work'),
      cut: async (_in, _s, _len, out) => { mkdirSync(join(out, '..'), { recursive: true }); writeFileSync(out, 'x') },
    })
    e.studio.episodes.setFields(ep.id, { videoPath: 'whatever.mp4' })
    const made = await c.make(ep.id, 3)
    expect(made).toHaveLength(3)
    expect((created[0] as { status: string }).status).toBe('draft')
    expect((created[0] as { targets: Array<{ platform: string }> }).targets[0].platform).toBe('youtube')
    expect(existsSync(join(root, 'work', 'clips'))).toBe(true)
  })

  it('lists old well performing posts, skips mock ones, and schedules a repeat off YouTube by default', async () => {
    const e = makeStudioEnv()
    const root = mkdtempSync(join(tmpdir(), 'elo-repost-'))
    const file = join(root, 'v.mp4')
    writeFileSync(file, 'video')
    const b = (await e.studio.brands())[0].brandId
    const mk = async (title: string, mock = false) => {
      const p = await e.makePost({ brandId: b, whenMs: e.clock.ms - 40 * 86_400_000, platforms: ['youtube', 'facebook'], title })
      e.db.prepare("UPDATE posts SET status = 'posted' WHERE id = ?").run(p.id)
      e.db.prepare("UPDATE post_targets SET status = 'posted', settings_json = ? WHERE post_id = ?").run(mock ? '{"mock":true}' : '{}', p.id)
      return p
    }
    const good = await mk('Good one')
    await mk('Mock one', true)
    const created: Array<{ targets: Array<{ platform: string }>; scheduledAtUtc: string | null }> = []
    const q = new RepostQueue({ db: e.db, resolve: () => file, createPost: async (i) => { created.push(i as never); return { id: 99 } as never }, nextSlot: () => '2026-11-01T16:00:00.000Z', views: () => 500, brandName: () => 'B', minAgeDays: () => 30, now: () => e.clock.ms })
    const list = q.candidates(b)
    expect(list.map((x) => x.title)).toEqual(['Good one'])
    const r = await q.queue(good.id, list[0].platforms.filter((p) => p !== 'youtube'))
    expect(r.newPostId).toBe(99)
    expect(created[0].targets.map((t) => t.platform)).not.toContain('youtube')
    expect(q.candidates(b)).toEqual([])
    await expect(q.queue(good.id, ['youtube'])).resolves.toBeTruthy()
  })

  it('really crops a 16:9 video into a vertical short with ffmpeg', async () => {
    const { probe } = await import('../../src/main/studio/ffmpeg')
    const { ClipCutter } = await import('../../src/main/studio/clips')
    const e = makeStudioEnv()
    const root = mkdtempSync(join(tmpdir(), 'elo-crop-'))
    const video = join(root, 'full.mp4')
    await makePlaceholderVideo({ out: video, seconds: 4, width: 640, height: 360, audio: true })
    const ep = e.studio.episodes.create(hollowId(e), { ...minimalPackage('Crop me'), scenes: Array.from({ length: 12 }, (_, i) => ({ ...scene(i + 1, 2), content_seconds: 5 })) } as never, { status: 'Ready for production' })
    e.studio.episodes.setFields(ep.id, { videoPath: 'x.mp4' })
    let out = ''
    const c = new ClipCutter({ db: e.db, gateway: e.studio.gateway, episodes: e.studio.episodes, resolve: () => video, createPost: async (i) => { out = i.sourcePath; return { id: 1 } as never }, brandName: () => 'B', aiDisclosure: () => false, workDir: () => join(root, 'w') })
    await c.make(ep.id, 1)
    const info = await probe(out)
    expect(info.width).toBe(1080)
    expect(info.height).toBe(1920)
  })
})
