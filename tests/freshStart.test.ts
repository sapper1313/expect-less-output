import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { FreshStart } from '../src/main/pipeline/freshStart'
import { UpcomingService } from '../src/main/pipeline/upcoming'
import { AuditEvents } from '../src/main/pipeline/auditEvents'
import { makeStudioEnv, minimalPackage } from './studio/helpers'

async function rig() {
  const e = makeStudioEnv({ startMs: Date.UTC(2026, 9, 19, 14) })
  const dir = mkdtempSync(join(tmpdir(), 'elo-fs-'))
  e.settings.set({ upcomingFilePath: join(dir, 'Shared', 'upcoming.json') })
  const audit = new AuditEvents(e.db, () => e.clock.ms)
  const up = new UpcomingService({
    db: e.db,
    settings: e.settings,
    brands: e.brands,
    audit,
    notify: () => {},
    mediaRoot: () => dir,
    now: () => e.clock.ms,
  })
  const fs = new FreshStart({
    db: e.db,
    posts: e.posts,
    settings: e.settings,
    audit,
    upcoming: up,
    backupRoot: join(dir, 'Backups'),
    now: () => e.clock.ms,
  })
  return { e, up, fs, dir, audit }
}

describe('fresh start', () => {
  it('backs up and verifies, then clears scripts, ideas, tasks and Upcoming, keeping posted history', async () => {
    const { e, up, fs, audit } = await rig()
    const s = e.studio
    const ep = s.episodes.create(1, minimalPackage('Draft script') as never, {
      status: 'Ready for production',
    })
    const posted = s.episodes.create(1, minimalPackage('Already posted') as never, {
      status: 'Posted',
    })
    const post = await e.makePost({
      whenMs: e.clock.ms - 86_400_000,
      title: 'Out',
      platforms: ['youtube'],
    })
    e.db.prepare("UPDATE posts SET status = 'posted' WHERE id = ?").run(post.id)
    s.episodes.setFields(posted.id, { postId: post.id })
    const waiting = await e.makePost({
      whenMs: e.clock.ms + 86_400_000,
      title: 'Scheduled never posted',
      platforms: ['youtube'],
    })
    await s.addIdeas(1, ['one', 'two'])
    s.tasks.create({ type: 'write_episode', brandId: 1, payload: {} })
    await up.add({ name: 'josh' }, { channel: 'trash-panda', working_title: 'Old idea' })
    const pkg = e.db.prepare('SELECT package_path FROM episodes WHERE id = ?').get(ep.id) as {
      package_path: string
    }
    const pre = fs.preview()
    expect(pre).toMatchObject({
      episodes: 1,
      episodesKept: 1,
      upcoming: 1,
      unpostedPosts: 1,
      postedKept: 1,
    })
    const done = await fs.run()
    expect(done.verified).toBe(true)
    expect(done.checks).toEqual(
      expect.arrayContaining(['integrity_check ok', 'row counts match', 'checksums ok']),
    )
    expect(existsSync(join(done.bundleDir, 'elo.sqlite'))).toBe(true)
    expect(existsSync(join(done.bundleDir, 'RESTORE.md'))).toBe(true)
    expect(readFileSync(join(done.bundleDir, 'SHA256SUMS'), 'utf8')).toContain('elo.sqlite')
    const n = (t: string) =>
      (e.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
    expect(n('ideas')).toBe(0)
    expect(n('agent_tasks')).toBe(0)
    expect(s.episodes.find(ep.id)).toBeFalsy()
    expect(s.episodes.find(posted.id)).toBeTruthy()
    expect(existsSync(pkg.package_path)).toBe(false)
    expect(e.posts.get(post.id)!.status).toBe('posted')
    expect(e.posts.get(waiting.id)!.status).toBe('canceled')
    expect(up.view().rows).toHaveLength(0)
    expect(up.view().revision).toBe(1)
    expect(JSON.parse(readFileSync(up.filePath(), 'utf8'))).toMatchObject({
      revision: 1,
      episodes: [],
    })
    expect(e.settings.get()).toMatchObject({
      claudeApiEnabled: false,
      studioProductionEnabled: false,
    })
    expect(audit.list({ action: 'fresh.start' })).toHaveLength(1)
  })

  it('refuses while something is being written', async () => {
    const { e, fs } = await rig()
    const t = e.studio.tasks.create({ type: 'write_episode', brandId: 1, payload: {} })
    e.studio.tasks.setStatus(t.id, 'running')
    await expect(fs.run()).rejects.toThrow(/being written/)
  })
})
