import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import { StorageService } from '../src/main/growth/storage'

const DAY = 86_400_000

function rig(
  over: { compress?: (a: string, b: string) => Promise<void>; durations?: [number, number] } = {},
) {
  const env = makeEnv(Date.UTC(2026, 9, 5, 16, 0, 0))
  const brand = 'Trash Panda'
  const dir = join(env.root, brand, 'Posted', '2026-08')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'a.mp4')
  writeFileSync(file, Buffer.alloc(10_000, 1))
  const rel = env.library.toRelative(file)
  env.db
    .prepare(
      "INSERT INTO posts (brand_id, video_path, title, caption, status, scheduled_at_utc) VALUES (1, ?, 't', 'c', 'posted', ?)",
    )
    .run(rel, new Date(env.clock.ms - 60 * DAY).toISOString())
  const postId = (
    env.db.prepare('SELECT id FROM posts ORDER BY id DESC LIMIT 1').get() as { id: number }
  ).id
  env.db
    .prepare(
      "INSERT INTO post_targets (post_id, platform, status, posted_at_utc) VALUES (?, 'youtube', 'posted', ?)",
    )
    .run(postId, new Date(env.clock.ms - 60 * DAY).toISOString())
  let n = 0
  const svc = new StorageService({
    db: env.db,
    library: env.library,
    compress: over.compress ?? (async (_a, b) => void writeFileSync(b, Buffer.alloc(2_000, 2))),
    duration: async () => (over.durations ? (over.durations[n++] ?? 0) : 30),
    brandNames: () => [brand],
    now: () => env.clock.ms,
  })
  return { env, svc, file, postId, brand }
}

describe('storage', () => {
  it('reports where the space goes', () => {
    const { svc } = rig()
    const r = svc.report()
    expect(r.rows.find((x) => x.channel === 'Trash Panda')!.posted).toBe(10_000)
    expect(r.totalBytes).toBe(10_000)
    expect(r.freeBytes).toBeGreaterThan(0)
  })

  it('keeps the original unless told to remove it', async () => {
    const { svc, file, env, brand } = rig()
    const r = await svc.archiveOld(30, false)
    expect(r).toMatchObject({ compressed: 1, savedBytes: 8_000, removedOriginals: 0 })
    expect(existsSync(file)).toBe(true)
    expect(existsSync(join(env.root, brand, 'Archive', 'a.mp4'))).toBe(true)
  })

  it('removes the original only when ticked, and the post follows the new file', async () => {
    const { svc, file, env, postId } = rig()
    const r = await svc.archiveOld(30, true)
    expect(r.removedOriginals).toBe(1)
    expect(existsSync(file)).toBe(false)
    const p = env.db.prepare('SELECT video_path AS v FROM posts WHERE id = ?').get(postId) as {
      v: string
    }
    expect(p.v).toContain('/Archive/')
    expect(statSync(env.library.resolve(p.v)).size).toBe(2_000)
  })

  it('leaves recent videos alone and drops a copy with the wrong length', async () => {
    const a = rig()
    expect((await a.svc.archiveOld(90, true)).compressed).toBe(0)
    const b = rig({ durations: [30, 12] })
    const r = await b.svc.archiveOld(30, true)
    expect(r.compressed).toBe(0)
    expect(r.skipped[0]).toContain('different length')
    expect(existsSync(b.file)).toBe(true)
    expect(existsSync(join(b.env.root, b.brand, 'Archive', 'a.mp4'))).toBe(false)
  })
})
