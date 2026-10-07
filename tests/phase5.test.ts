import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { latestSchemaVersion, openDb } from '../src/main/db'
import {
  applyPendingRestore,
  createBackup,
  dismissRestoreReport,
  finishRestore,
  folderManifest,
  readBackup,
  readRestoreReport,
  stageRestore,
} from '../src/main/services/backup'
import { healthRows } from '../src/main/services/health'
import { makeEnv } from './helpers'

const MIN = 60_000
const HOUR = 60 * MIN

describe('per brand pause', () => {
  it('holds a paused brand and posts the others, then resumes through the missed rule', async () => {
    const env = makeEnv()
    const a = await env.makePost({
      brandId: 1,
      whenMs: env.clock.ms + MIN,
      platforms: ['instagram'],
      title: 'A',
    })
    const b = await env.makePost({
      brandId: 2,
      whenMs: env.clock.ms + MIN,
      platforms: ['instagram'],
      title: 'B',
    })
    env.settings.set({ pausedBrandIds: [1] })
    env.clock.ms += 2 * MIN
    await env.scheduler.tick()
    expect(env.posts.get(a.id)!.status).toBe('scheduled')
    expect(env.posts.get(b.id)!.status).toBe('posted')
    // one hour later, resumed: inside the 120 minute grace, so it posts late
    env.settings.set({ pausedBrandIds: [] })
    env.clock.ms += HOUR
    await env.scheduler.tick()
    expect(env.posts.get(a.id)!.status).toBe('posted')
  })

  it('a long pause turns into a missed post with an alert, not a surprise post', async () => {
    const env = makeEnv()
    const a = await env.makePost({
      brandId: 1,
      whenMs: env.clock.ms + MIN,
      platforms: ['instagram'],
    })
    env.settings.set({ pausedBrandIds: [1] })
    env.clock.ms += 5 * HOUR
    await env.scheduler.tick()
    env.settings.set({ pausedBrandIds: [] })
    await env.scheduler.tick()
    expect(env.posts.get(a.id)!.status).toBe('missed')
    expect(env.events.missed).toHaveLength(1)
  })

  it('does not keep the Mac awake or show as next post for a paused brand', async () => {
    const env = makeEnv()
    await env.makePost({ brandId: 1, whenMs: env.clock.ms + 10 * MIN, platforms: ['instagram'] })
    expect(env.scheduler.hasDueWithin(30)).toBe(true)
    expect(env.scheduler.status().nextPost?.brandName).toBe('Trash Panda')
    env.settings.set({ pausedBrandIds: [1] })
    expect(env.scheduler.hasDueWithin(30)).toBe(false)
    expect(env.scheduler.status().nextPost).toBeNull()
  })
})

describe('reconcile on start and wake', () => {
  it('puts a target stuck uploading for over 30 minutes back in the queue and checks processing ones', async () => {
    const env = makeEnv()
    const post = await env.makePost({
      whenMs: env.clock.ms + MIN,
      platforms: ['instagram', 'tiktok'],
    })
    const [ig, tt] = env.posts.get(post.id)!.targets
    env.db
      .prepare(
        "UPDATE post_targets SET status = 'uploading', lock_token = 'x', locked_at_utc = ? WHERE id = ?",
      )
      .run(new Date(env.clock.ms - 45 * MIN).toISOString(), ig.id)
    env.db.prepare("UPDATE post_targets SET status = 'processing' WHERE id = ?").run(tt.id)
    env.db.prepare("UPDATE posts SET status = 'in_progress' WHERE id = ?").run(post.id)
    env.clock.ms += 2 * MIN
    const touched = await env.scheduler.reconcile()
    expect(touched).toBe(2)
    expect(env.posts.get(post.id)!.targets.find((t) => t.platform === 'instagram')!.status).toBe(
      'pending',
    )
    expect(env.posts.get(post.id)!.targets.find((t) => t.platform === 'tiktok')!.status).toBe(
      'posted',
    ) // the dry run adapter says it went live
    const log = env.log.list({ limit: 50 }).map((l) => l.message)
    expect(log.some((m) => m.includes('stuck uploading'))).toBe(true)
  })

  it('leaves a recent upload alone', async () => {
    const env = makeEnv()
    const post = await env.makePost({ whenMs: env.clock.ms + MIN, platforms: ['instagram'] })
    const t = env.posts.get(post.id)!.targets[0]
    env.db
      .prepare(
        "UPDATE post_targets SET status = 'uploading', lock_token = 'x', locked_at_utc = ? WHERE id = ?",
      )
      .run(new Date(env.clock.ms - 5 * MIN).toISOString(), t.id)
    expect(await env.scheduler.reconcile()).toBe(0)
    expect(env.posts.get(post.id)!.targets[0].status).toBe('uploading')
  })
})

describe('duplicate and search', () => {
  it('duplicates a posted post as a draft with its own copy of the video', async () => {
    const env = makeEnv()
    const post = await env.makePost({
      whenMs: env.clock.ms + MIN,
      platforms: ['instagram', 'tiktok'],
      title: 'Original',
    })
    env.db
      .prepare(
        "UPDATE post_targets SET ai_flag = 1, caption_override = 'IG only' WHERE post_id = ? AND platform = 'instagram'",
      )
      .run(post.id)
    env.clock.ms += 2 * MIN
    await env.scheduler.tick()
    expect(env.posts.get(post.id)!.status).toBe('posted')
    const copy = env.posts.duplicate(post.id)
    expect(copy.id).not.toBe(post.id)
    expect(copy).toMatchObject({ status: 'draft', title: 'Original', scheduledAtUtc: null })
    expect(copy.videoPath).toMatch(/Queue\//)
    expect(existsSync(env.library.resolve(copy.videoPath))).toBe(true)
    expect(existsSync(env.library.resolve(env.posts.get(post.id)!.videoPath))).toBe(true) // the original is untouched
    expect(copy.targets.map((t) => [t.platform, t.status, t.aiFlag, t.captionOverride])).toEqual([
      ['instagram', 'pending', true, 'IG only'],
      ['tiktok', 'pending', false, null],
    ])
    expect(copy.targets.every((t) => t.attempts === 0 && t.externalUrl === null)).toBe(true)
  })

  it('refuses to duplicate when the video file is gone', async () => {
    const env = makeEnv()
    const post = await env.makePost({ whenMs: env.clock.ms + HOUR, platforms: ['instagram'] })
    env.library.deleteFile(post.videoPath)
    expect(() => env.posts.duplicate(post.id)).toThrow(/file for this post is missing/)
  })

  it('searches title, caption and file name, and treats % and _ as plain characters', async () => {
    const env = makeEnv()
    const a = await env.makePost({
      whenMs: env.clock.ms + HOUR,
      platforms: ['instagram'],
      title: 'Fridge Math',
    })
    const b = await env.makePost({
      whenMs: env.clock.ms + 2 * HOUR,
      platforms: ['instagram'],
      title: 'Panda 100% Real',
    })
    env.db.prepare("UPDATE posts SET caption = 'Secret sauce #recipe' WHERE id = ?").run(a.id)
    const ids = (q: string) => env.posts.list({ search: q }).map((p) => p.id)
    expect(ids('fridge')).toEqual([a.id])
    expect(ids('sauce')).toEqual([a.id])
    expect(ids('100%')).toEqual([b.id])
    expect(ids('%')).toEqual([b.id])
    expect(ids('_')).toEqual(
      [a.id, b.id].filter(
        (id) =>
          env.posts.get(id)!.videoPath.includes('_') || env.posts.get(id)!.title.includes('_'),
      ),
    )
    expect(ids('src-')).toHaveLength(2) // file name
    expect(ids('nothing here')).toEqual([])
    expect(env.posts.list({ search: '  ' })).toHaveLength(2)
  })
})

describe('health panel', () => {
  it('lists live accounts only, with the right expiry', () => {
    const env = makeEnv()
    env.db
      .prepare(
        "UPDATE accounts SET mode = 'auto', display_name = 'Chan', last_checked_at = '2026-06-01T00:00:00Z' WHERE brand_id = 1 AND platform = 'youtube'",
      )
      .run()
    env.db
      .prepare(
        "UPDATE accounts SET mode = 'live', status = 'needs_reauth', display_name = 'Page' WHERE brand_id = 1 AND platform = 'facebook'",
      )
      .run()
    env.db
      .prepare(
        "UPDATE accounts SET mode = 'drafts', display_name = 'TT' WHERE brand_id = 2 AND platform = 'tiktok'",
      )
      .run()
    const rows = healthRows({
      db: env.db,
      metaExpiresAt: () => '2026-08-01T00:00:00Z',
      tiktokExpiresAt: (id) => `tt-${id}`,
    })
    expect(rows.map((r) => `${r.brandName}/${r.platform}/${r.status}`)).toEqual([
      'Trash Panda/facebook/needs_reauth',
      'Trash Panda/youtube/connected',
      'Clock Out Early/tiktok/connected',
    ])
    expect(rows[0].expiresAt).toBe('2026-08-01T00:00:00Z')
    expect(rows[1]).toMatchObject({
      expiresAt: null,
      note: 'Auto (renews itself)',
      lastCheckedAt: '2026-06-01T00:00:00Z',
    })
    expect(rows[2].expiresAt).toMatch(/^tt-/)
  })
})

describe('backup and restore', () => {
  async function makeSource() {
    const env = makeEnv()
    // real accounts, a scheduled post, a secret-looking token file that must NOT travel
    env.db
      .prepare(
        "UPDATE accounts SET mode = 'auto', status = 'connected', display_name = 'Trash Panda Channel', token_ref = 'youtube.refresh.1' WHERE brand_id = 1 AND platform = 'youtube'",
      )
      .run()
    env.db
      .prepare(
        "UPDATE accounts SET mode = 'drafts', display_name = 'TikTok TP' WHERE brand_id = 1 AND platform = 'tiktok'",
      )
      .run()
    env.db.exec(
      "INSERT INTO meta_connection (id, user_id, user_name, status, connected_at) VALUES (1, 'U', 'Owner', 'connected', '2026-06-01T00:00:00Z')",
    )
    const post = await env.makePost({
      whenMs: env.clock.ms + 5 * HOUR,
      platforms: ['instagram'],
      title: 'Move Me',
    })
    env.settings.set({ missedGraceMinutes: 77, theme: 'light' })
    const data = mkdtempSync(join(tmpdir(), 'elo-src-data-'))
    writeFileSync(join(data, 'secrets.bin'), '{"tiktok.tokens.1":"SECRET-TOKEN-VALUE"}')
    const posters = join(data, 'posters')
    mkdirSync(posters)
    writeFileSync(join(posters, 'abc.jpg'), 'jpegbytes')
    return { env, post, data, posters }
  }

  it('exports a zip with the database, settings, thumbnails and manifest, but no tokens and no videos', async () => {
    const { env, data, posters } = await makeSource()
    const out = join(data, 'backup.zip')
    const r = await createBackup({
      db: env.db,
      outPath: out,
      appVersion: '0.5.0',
      mediaRoot: env.root,
      postersDir: posters,
    })
    expect(r.accounts).toBe(2) // the YouTube and TikTok accounts that are connected for real
    const { manifest, files } = readBackup(out, latestSchemaVersion())
    expect(Object.keys(files).sort()).toEqual(['elo.sqlite', 'manifest.json', 'posters/abc.jpg'])
    expect(manifest.accountsToReconnect.map((a) => `${a.brandName}/${a.platform}`).sort()).toEqual(
      ['Trash Panda/tiktok', 'Trash Panda/youtube'].sort(),
    )
    expect(manifest.folders.some((f) => f.path === 'Trash Panda/Queue' && f.files === 1)).toBe(true)
    const bytes = readFileSync(out).toString('latin1')
    expect(bytes).not.toContain('SECRET-TOKEN-VALUE')
    expect(files['elo.sqlite'].length).toBeGreaterThan(1000)
    expect(manifest.schemaVersion).toBe(latestSchemaVersion())
  })

  it('restores into a fresh data folder, remaps the Media Root, flags accounts to reconnect, and keeps the safety copy', async () => {
    const { env, post, data, posters } = await makeSource()
    const out = join(data, 'backup.zip')
    await createBackup({
      db: env.db,
      outPath: out,
      appVersion: '0.5.0',
      mediaRoot: env.root,
      postersDir: posters,
    })

    // "New Mac": a brand new data folder with nothing in it
    const fresh = mkdtempSync(join(tmpdir(), 'elo-new-data-'))
    const newRoot = join(mkdtempSync(join(tmpdir(), 'elo-new-media-')), 'Expect Less Output')
    stageRestore({
      zipPath: out,
      dataDir: fresh,
      newMediaRoot: newRoot,
      maxSchema: latestSchemaVersion(),
    })
    expect(existsSync(join(fresh, 'restore-pending', 'elo.sqlite'))).toBe(true)

    // next start
    const applied = applyPendingRestore(fresh)
    expect(applied).toEqual({ mediaRoot: newRoot })
    expect(existsSync(join(fresh, 'restore-pending'))).toBe(false)
    expect(existsSync(join(fresh, 'posters', 'abc.jpg'))).toBe(true)
    expect(existsSync(join(fresh, 'secrets.bin'))).toBe(false) // nothing secret came along
    const db = openDb(join(fresh, 'elo.sqlite'))
    const report = finishRestore(db, newRoot)

    expect(report.accountsToReconnect.map((a) => `${a.brandName}/${a.platform}`).sort()).toEqual([
      'Trash Panda/tiktok',
      'Trash Panda/youtube',
    ])
    expect(
      (db.prepare("SELECT value_json FROM settings WHERE key = 'mediaRoot'").get() as any)
        .value_json,
    ).toBe(JSON.stringify(newRoot))
    expect(
      (db.prepare("SELECT value_json FROM settings WHERE key = 'missedGraceMinutes'").get() as any)
        .value_json,
    ).toBe('77')
    expect(
      (
        db
          .prepare("SELECT status FROM accounts WHERE brand_id = 1 AND platform = 'youtube'")
          .get() as any
      ).status,
    ).toBe('needs_reauth')
    expect((db.prepare('SELECT status FROM meta_connection').get() as any).status).toBe(
      'needs_reauth',
    )
    expect(
      db
        .prepare("SELECT mode, status FROM accounts WHERE brand_id = 2 AND platform = 'youtube'")
        .get() as any,
    ).toEqual({ mode: 'dry_run', status: 'connected' })
    // posts and their relative video paths survived, so they resolve under the new root
    const row = db
      .prepare('SELECT title, video_path, status FROM posts WHERE id = ?')
      .get(post.id) as any
    expect(row).toMatchObject({ title: 'Move Me', status: 'scheduled' })
    expect(row.video_path.startsWith('Trash Panda/Queue/')).toBe(true)
    expect(readRestoreReport(db)?.accountsToReconnect).toHaveLength(2)
    dismissRestoreReport(db)
    expect(readRestoreReport(db)).toBeNull()
    db.close()
  })

  it('restoring over existing data moves the old database to safety-backups first', async () => {
    const { env, data, posters } = await makeSource()
    const out = join(data, 'backup.zip')
    await createBackup({
      db: env.db,
      outPath: out,
      appVersion: '0.5.0',
      mediaRoot: env.root,
      postersDir: posters,
    })
    const target = mkdtempSync(join(tmpdir(), 'elo-existing-'))
    const old = openDb(join(target, 'elo.sqlite'))
    old.prepare("INSERT INTO settings (key, value_json) VALUES ('theme', '\"system\"')").run()
    old.close()
    stageRestore({
      zipPath: out,
      dataDir: target,
      newMediaRoot: '/tmp/anything',
      maxSchema: latestSchemaVersion(),
    })
    applyPendingRestore(target)
    const safe = join(target, 'safety-backups')
    expect(existsSync(safe)).toBe(true)
    const db = new Database(join(target, 'elo.sqlite'), { readonly: true })
    expect(
      (db.prepare("SELECT value_json FROM settings WHERE key = 'theme'").get() as any).value_json,
    ).toBe('"light"')
    db.close()
  })

  it('rejects garbage, a zip from a newer app, and a start with nothing staged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elo-bad-'))
    writeFileSync(join(dir, 'x.zip'), 'not a zip')
    expect(() => readBackup(join(dir, 'x.zip'), 99)).toThrow(/not a backup zip/)
    const { env, data, posters } = await makeSource()
    const out = join(data, 'b.zip')
    await createBackup({
      db: env.db,
      outPath: out,
      appVersion: '9.9.9',
      mediaRoot: env.root,
      postersDir: posters,
    })
    expect(() => readBackup(out, latestSchemaVersion() - 1)).toThrow(/newer version/)
    expect(applyPendingRestore(dir)).toBeNull()
  })

  it('folder manifest lists names and counts only', () => {
    const root = mkdtempSync(join(tmpdir(), 'elo-fm-'))
    mkdirSync(join(root, 'Brand', 'Queue'), { recursive: true })
    mkdirSync(join(root, 'Brand', 'Posted', '2026-06'), { recursive: true })
    writeFileSync(join(root, 'Brand', 'Queue', 'a.mp4'), 'x')
    writeFileSync(join(root, 'Brand', 'Posted', '2026-06', 'b.mp4'), 'x')
    const m = folderManifest(root)
    expect(m).toContainEqual({ path: 'Brand/Queue', files: 1 })
    expect(m).toContainEqual({ path: 'Brand/Posted/2026-06', files: 1 })
    expect(JSON.stringify(m)).not.toContain('a.mp4')
  })
})
