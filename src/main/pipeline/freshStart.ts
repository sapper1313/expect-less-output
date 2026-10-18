import { createHash } from 'crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { basename, join } from 'path'
import Database from 'better-sqlite3'
import type { Db } from '../db'
import type { PostService } from '../services/posts'
import type { SettingsService } from '../services/settings'
import type { AuditEvents } from './auditEvents'
import type { UpcomingService } from './upcoming'

export interface FreshStartPreview {
  episodes: number
  /** Episodes kept because they are tied to a post that went out. */
  episodesKept: number
  ideas: number
  tasks: number
  upcoming: number
  unpostedPosts: number
  postedKept: number
  runningTasks: number
  bundleDir: string
}

export interface FreshStartResult extends FreshStartPreview {
  verified: boolean
  checks: string[]
  revision: number
  updatedAt: string
  switchedOff: string[]
}

export interface FreshStartDeps {
  db: Db
  posts: PostService
  settings: SettingsService
  audit: AuditEvents
  upcoming: UpcomingService
  /** Folder that holds the backup bundles, for example ~/ELO/Backups. */
  backupRoot: string
  now?: () => number
}

/** Tables that hold work for one episode. Rows for a removed episode go with it. History tables are not in this list. */
const EPISODE_TABLES = [
  'video_jobs',
  'thumb_variants',
  'thumb_tests',
  'social_posts',
  'comment_items',
  'episode_chapters',
  'episode_captions',
]

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

/**
 * Clears every script, idea, task and Upcoming entry so the bots can start fresh. It first makes a backup bundle and checks
 * it, and only then removes anything. Posted history, analytics, the spend ledger, the audit log and the drop log stay.
 */
export class FreshStart {
  constructor(private d: FreshStartDeps) {}

  private stamp() {
    return new Date(this.d.now ? this.d.now() : Date.now())
      .toISOString()
      .slice(0, 16)
      .replace(/[:T]/g, '-')
  }

  private count(sql: string, ...a: unknown[]): number {
    return (this.d.db.prepare(sql).get(...a) as { n: number }).n
  }

  /** Posted posts keep their episode. Anything else is removed. */
  private removableEpisodes(): Array<{ id: string; package_path: string | null }> {
    return this.d.db
      .prepare(
        `SELECT id, package_path FROM episodes WHERE post_id IS NULL
         OR post_id NOT IN (SELECT id FROM posts WHERE status = 'posted')`,
      )
      .all() as Array<{ id: string; package_path: string | null }>
  }

  preview(): FreshStartPreview {
    const gone = this.removableEpisodes().length
    return {
      episodes: gone,
      episodesKept: this.count('SELECT COUNT(*) AS n FROM episodes') - gone,
      ideas: this.count('SELECT COUNT(*) AS n FROM ideas'),
      tasks: this.count("SELECT COUNT(*) AS n FROM agent_tasks WHERE status != 'running'"),
      upcoming: this.d.upcoming.view().rows.length,
      unpostedPosts: this.count(
        "SELECT COUNT(*) AS n FROM posts WHERE status IN ('draft','scheduled','missed')",
      ),
      postedKept: this.count("SELECT COUNT(*) AS n FROM posts WHERE status = 'posted'"),
      runningTasks: this.count("SELECT COUNT(*) AS n FROM agent_tasks WHERE status = 'running'"),
      bundleDir: join(this.d.backupRoot, `fresh-start-${this.stamp()}`),
    }
  }

  async run(): Promise<FreshStartResult> {
    const pre = this.preview()
    if (pre.runningTasks)
      throw new Error('Something is being written right now. Try again in a minute.')
    const dir = pre.bundleDir
    mkdirSync(dir, { recursive: true })
    const checks: string[] = []

    // 1. Backup: database, Upcoming file, the files that will be removed, the inventory and how to restore.
    await (this.d.db as unknown as { backup(p: string): Promise<unknown> }).backup(
      join(dir, 'elo.sqlite'),
    )
    const upFile = this.d.upcoming.filePath()
    if (existsSync(upFile)) copyFileSync(upFile, join(dir, 'upcoming.json'))
    const filesDir = join(dir, 'episode-files')
    mkdirSync(filesDir, { recursive: true })
    for (const e of this.removableEpisodes())
      if (e.package_path && existsSync(e.package_path))
        copyFileSync(e.package_path, join(filesDir, basename(e.package_path)))
    writeFileSync(
      join(dir, 'inventory.json'),
      JSON.stringify({ at: new Date().toISOString(), ...pre }, null, 2),
    )
    writeFileSync(
      join(dir, 'RESTORE.md'),
      `# Restore the copy made before the fresh start\n\n1. Quit ELO (kill the process, Command+Q only hides it).\n2. Delete elo.sqlite-wal and elo.sqlite-shm next to the live database, then copy elo.sqlite from here over it (\`~/Library/Application Support/Expect Less Output/elo.sqlite\`).\n3. Copy upcoming.json back to Shared/upcoming.json in the Media Root.\n4. Copy the files in episode-files back to where the Studio keeps them (their folder names are in the database).\n5. Open ELO and check Plan > Upcoming and the Studio Library.\n`,
    )
    const sums = [
      'elo.sqlite',
      'RESTORE.md',
      'inventory.json',
      ...(existsSync(join(dir, 'upcoming.json')) ? ['upcoming.json'] : []),
    ]
    writeFileSync(
      join(dir, 'SHA256SUMS'),
      sums.map((f) => `${sha(join(dir, f))}  ${f}`).join('\n') + '\n',
    )

    // 2. Verify it before touching anything.
    const copy = new Database(join(dir, 'elo.sqlite'), { readonly: true })
    try {
      const ok = (copy.pragma('integrity_check', { simple: true }) as string) === 'ok'
      checks.push(`integrity_check ${ok ? 'ok' : 'FAILED'}`)
      const live = (t: string) => this.count(`SELECT COUNT(*) AS n FROM ${t}`)
      let same = true
      for (const t of ['posts', 'episodes', 'ideas', 'agent_tasks', 'brands']) {
        const n = (copy.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
        if (n !== live(t)) same = false
      }
      checks.push(`row counts ${same ? 'match' : 'DO NOT MATCH'}`)
      if (!ok || !same)
        throw new Error(
          `The backup did not pass its checks (${checks.join(', ')}). Nothing was removed.`,
        )
    } finally {
      copy.close()
    }
    for (const line of readFileSync(join(dir, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
      const [h, f] = line.split(/\s{2}/)
      if (sha(join(dir, f)) !== h)
        throw new Error(`The backup file ${f} does not match its checksum. Nothing was removed.`)
    }
    checks.push('checksums ok', `backup size ${statSync(join(dir, 'elo.sqlite')).size} bytes`)

    // 3. Writing stays off, so the slate is not filled again behind your back.
    const switchedOff: string[] = []
    const s = this.d.settings.get()
    if (s.claudeApiEnabled) switchedOff.push('claudeApiEnabled')
    if (s.studioProductionEnabled) switchedOff.push('studioProductionEnabled')
    if (switchedOff.length)
      this.d.settings.set({ claudeApiEnabled: false, studioProductionEnabled: false })

    // 4. Remove.
    const removed = this.removableEpisodes()
    const ids = removed.map((e) => e.id)
    this.d.db.transaction(() => {
      for (const t of EPISODE_TABLES) {
        const del = this.d.db.prepare(`DELETE FROM ${t} WHERE episode_id = ?`)
        for (const id of ids) del.run(id)
      }
      const delEp = this.d.db.prepare('DELETE FROM episodes WHERE id = ?')
      for (const id of ids) delEp.run(id)
      this.d.db.prepare('DELETE FROM ideas').run()
      this.d.db.prepare("DELETE FROM agent_tasks WHERE status != 'running'").run()
    })()
    for (const e of removed)
      if (e.package_path)
        try {
          unlinkSync(e.package_path)
        } catch {
          /* already gone */
        }
    const unposted = this.d.db
      .prepare("SELECT id FROM posts WHERE status IN ('draft','scheduled','missed')")
      .all() as Array<{ id: number }>
    if (unposted.length) this.d.posts.cancel(unposted.map((p) => p.id))
    const up = await this.d.upcoming.resetClean()
    this.d.audit.write({
      actor: 'josh',
      action: 'fresh.start',
      target: dir,
      after: { ...pre, switchedOff, revision: up.revision },
    })
    return {
      ...pre,
      verified: true,
      checks,
      revision: up.revision,
      updatedAt: up.updatedAt,
      switchedOff,
    }
  }
}
