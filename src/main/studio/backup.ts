import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join, relative } from 'path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { DateTime } from 'luxon'
import type { Db } from '../db'
import { createBackup } from '../services/backup'
import type { StudioConfigService } from './configService'
import { expandHome } from './configService'
import type { AuditLog } from './agents/framework'

export interface BackupInfo {
  stamp: string
  dbZip: string
  libraryZip: string | null
  bytes: number
  createdUtc: string
}

export interface BackupDeps {
  db: Db
  cfg: StudioConfigService
  audit: AuditLog
  appVersion: string
  postersDir: string
  mediaRoot: () => string
  libraryRoot: () => string
  now?: () => number
}

const KEEP_EXT = ['.json.gz', '.json', '.jpg', '.png', '.mp4']

/**
 * Nightly backup of the database (settings without secrets, series bibles, thumbnail guidelines, ledger, stats), plus the episode
 * Library (packages, previews, shared opening and outro). The last N are kept. Secrets live in the Keychain store and are
 * never part of a backup.
 */
export class StudioBackup {
  constructor(private d: BackupDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  dir(): string {
    return expandHome(this.d.cfg.get().backupDir)
  }

  /** Library files worth keeping: everything except the work folders (clips and finished videos still waiting to post). */
  private libraryFiles(root: string): string[] {
    const out: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === 'work') continue
          walk(p)
        } else if (KEEP_EXT.some((x) => e.name.endsWith(x))) out.push(p)
      }
    }
    if (existsSync(root)) walk(root)
    return out
  }

  async run(): Promise<BackupInfo> {
    const dir = this.dir()
    mkdirSync(dir, { recursive: true })
    const stamp = DateTime.fromMillis(this.now(), { zone: 'America/New_York' }).toFormat('yyyy-LL-dd-HHmmss')
    const dbZip = join(dir, `elo-backup-${stamp}.zip`)
    const r = await createBackup({ db: this.d.db, outPath: dbZip, appVersion: this.d.appVersion, mediaRoot: this.d.mediaRoot(), postersDir: this.d.postersDir })
    const root = this.d.libraryRoot()
    const files: Record<string, Uint8Array> = {}
    for (const f of this.libraryFiles(root)) files[relative(root, f)] = readFileSync(f)
    let libraryZip: string | null = null
    if (Object.keys(files).length) {
      files['LIBRARY_ROOT.txt'] = strToU8(root)
      libraryZip = join(dir, `elo-library-${stamp}.zip`)
      writeFileSync(libraryZip, zipSync(files, { level: 6 }))
    }
    this.prune()
    this.d.audit.write({ agent: 'Backup', action: 'backup', detail: { dbZip, libraryZip, bytes: r.bytes } })
    return { stamp, dbZip, libraryZip, bytes: r.bytes + (libraryZip ? statSync(libraryZip).size : 0), createdUtc: new Date(this.now()).toISOString() }
  }

  list(): BackupInfo[] {
    const dir = this.dir()
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .map((f) => /^elo-backup-(.+)\.zip$/.exec(f))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => {
        const dbZip = join(dir, m[0])
        const lib = join(dir, `elo-library-${m[1]}.zip`)
        const libraryZip = existsSync(lib) ? lib : null
        return { stamp: m[1], dbZip, libraryZip, bytes: statSync(dbZip).size + (libraryZip ? statSync(libraryZip).size : 0), createdUtc: statSync(dbZip).mtime.toISOString() }
      })
      .sort((a, b) => b.stamp.localeCompare(a.stamp))
  }

  /** Keeps the newest N backups (both files of each). */
  prune(): number {
    const keep = Math.max(1, this.d.cfg.get().backupKeep)
    const all = this.list()
    let removed = 0
    for (const b of all.slice(keep)) {
      rmSync(b.dbZip, { force: true })
      if (b.libraryZip) rmSync(b.libraryZip, { force: true })
      removed++
    }
    return removed
  }

  /** Puts the Library files from a backup back where they belong. Existing files are replaced. Returns how many. */
  restoreLibrary(libraryZip: string): number {
    const files = unzipSync(new Uint8Array(readFileSync(libraryZip)))
    const root = this.d.libraryRoot()
    let n = 0
    for (const [name, data] of Object.entries(files)) {
      if (name === 'LIBRARY_ROOT.txt') continue
      if (name.includes('..')) continue
      const dest = join(root, name)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, data)
      n++
    }
    this.d.audit.write({ agent: 'Backup', action: 'restore_library', detail: { libraryZip, files: n } })
    return n
  }

  /** What a backup zip holds, for the "are my bibles in there" question. */
  inspect(dbZip: string): { hasDatabase: boolean; hasSecrets: boolean; manifest: unknown } {
    const f = unzipSync(new Uint8Array(readFileSync(dbZip)))
    return { hasDatabase: 'elo.sqlite' in f, hasSecrets: Object.keys(f).some((k) => /secret/i.test(k)), manifest: 'manifest.json' in f ? JSON.parse(strFromU8(f['manifest.json'])) : null }
  }
}
