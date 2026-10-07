import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { basename, join } from 'path'
import { tmpdir } from 'os'
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import type { Db } from '../db'
import type { RestoreReport } from '@shared/types'

export const BACKUP_FORMAT = 1
const REPORT_KEY = 'restoreReport'

export interface BackupManifest {
  format: number
  appVersion: string
  createdAt: string
  schemaVersion: number
  /** Where the videos lived on the old Mac. Only for information. */
  mediaRoot: string
  /** The folder layout (names and counts only, never the videos). */
  folders: Array<{ path: string; files: number }>
  accountsToReconnect: Array<{ brandName: string; platform: string; displayName: string | null }>
}

const schemaVersion = (db: Db): number =>
  (
    db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as {
      v: number
    }
  ).v

/** Names and file counts for each brand folder (Queue, Posted, month folders). Never reads video contents. */
export function folderManifest(mediaRoot: string): Array<{ path: string; files: number }> {
  const out: Array<{ path: string; files: number }> = []
  const walk = (rel: string, depth: number) => {
    const abs = join(mediaRoot, rel)
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    if (rel)
      out.push({
        path: rel,
        files: entries.filter((e) => e.isFile() && !e.name.startsWith('.')).length,
      })
    if (depth >= 3) return
    for (const e of entries) if (e.isDirectory()) walk(rel ? `${rel}/${e.name}` : e.name, depth + 1)
  }
  walk('', 0)
  return out
}

function accountsToReconnect(db: Db): BackupManifest['accountsToReconnect'] {
  return db
    .prepare(
      `SELECT b.name AS brandName, a.platform, a.display_name AS displayName FROM accounts a JOIN brands b ON b.id = a.brand_id
         WHERE a.mode != 'dry_run' ORDER BY b.id, a.platform`,
    )
    .all() as BackupManifest['accountsToReconnect']
}

/**
 * Writes a zip with the database (a consistent snapshot), the settings inside it, the thumbnails, and a manifest.
 * Tokens and secrets are NOT included. Videos are NOT included.
 */
export async function createBackup(opts: {
  db: Db
  outPath: string
  appVersion: string
  mediaRoot: string
  postersDir: string
}): Promise<{ bytes: number; accounts: number }> {
  const tmp = join(tmpdir(), `elo-backup-${Date.now()}.sqlite`)
  try {
    await opts.db.backup(tmp)
    const files: Record<string, Uint8Array> = { 'elo.sqlite': readFileSync(tmp) }
    if (existsSync(opts.postersDir)) {
      for (const f of readdirSync(opts.postersDir)) {
        const p = join(opts.postersDir, f)
        if (statSync(p).isFile() && f.endsWith('.jpg')) files[`posters/${f}`] = readFileSync(p)
      }
    }
    const accounts = accountsToReconnect(opts.db)
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      appVersion: opts.appVersion,
      createdAt: new Date().toISOString(),
      schemaVersion: schemaVersion(opts.db),
      mediaRoot: opts.mediaRoot,
      folders: folderManifest(opts.mediaRoot),
      accountsToReconnect: accounts,
    }
    files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
    const zip = zipSync(files, { level: 6 })
    writeFileSync(opts.outPath, zip)
    return { bytes: zip.length, accounts: accounts.length }
  } finally {
    rmSync(tmp, { force: true })
  }
}

/** Reads and checks a backup zip. Throws a plain message when it is not usable. */
export function readBackup(
  zipPath: string,
  maxSchema: number,
): { manifest: BackupManifest; files: Record<string, Uint8Array> } {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(readFileSync(zipPath)))
  } catch {
    throw new Error('That file is not a backup zip made by Expect Less Output.')
  }
  if (!files['manifest.json'] || !files['elo.sqlite'])
    throw new Error(
      'That zip is missing its database or manifest. It is not an Expect Less Output backup.',
    )
  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as BackupManifest
  if (manifest.format !== BACKUP_FORMAT)
    throw new Error('This backup was made by a newer version of the app. Update the app first.')
  if (manifest.schemaVersion > maxSchema)
    throw new Error(
      'This backup comes from a newer version of Expect Less Output. Install the newer version, then restore.',
    )
  return { manifest, files }
}

/**
 * Step one of a restore: check the zip and park its contents in <data>/restore-pending.
 * The swap happens on the next start (applyPendingRestore), because the database is open right now.
 */
export function stageRestore(opts: {
  zipPath: string
  dataDir: string
  newMediaRoot: string
  maxSchema: number
}): BackupManifest {
  const { manifest, files } = readBackup(opts.zipPath, opts.maxSchema)
  const dir = join(opts.dataDir, 'restore-pending')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'posters'), { recursive: true })
  writeFileSync(join(dir, 'elo.sqlite'), files['elo.sqlite'])
  for (const [name, data] of Object.entries(files)) {
    if (name.startsWith('posters/') && !name.includes('..') && name.endsWith('.jpg'))
      writeFileSync(join(dir, 'posters', basename(name)), data)
  }
  writeFileSync(
    join(dir, 'restore.json'),
    JSON.stringify({ mediaRoot: opts.newMediaRoot, manifest }),
  )
  return manifest
}

/** Called at start, before the database is opened. Returns the new Media Root when a restore was applied. */
export function applyPendingRestore(dataDir: string): { mediaRoot: string } | null {
  const dir = join(dataDir, 'restore-pending')
  const staged = join(dir, 'elo.sqlite')
  if (!existsSync(staged)) return null
  const info = JSON.parse(readFileSync(join(dir, 'restore.json'), 'utf8')) as { mediaRoot: string }
  const current = join(dataDir, 'elo.sqlite')
  if (existsSync(current)) {
    // Keep what was here, just in case.
    const safe = join(
      dataDir,
      'safety-backups',
      `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    )
    mkdirSync(safe, { recursive: true })
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(current + suffix))
        renameSync(current + suffix, join(safe, `elo.sqlite${suffix}`))
    }
  }
  renameSync(staged, current)
  const posters = join(dataDir, 'posters')
  mkdirSync(posters, { recursive: true })
  const stagedPosters = join(dir, 'posters')
  if (existsSync(stagedPosters))
    for (const f of readdirSync(stagedPosters))
      copyFileSync(join(stagedPosters, f), join(posters, f))
  rmSync(dir, { recursive: true, force: true })
  return { mediaRoot: info.mediaRoot }
}

/**
 * Called after the restored database is open. Points it at the new Media Root, marks every connected account as
 * needing a fresh login (tokens are never in a backup), and saves a report for the app to show.
 */
export function finishRestore(db: Db, mediaRoot: string): RestoreReport {
  const accounts = accountsToReconnect(db).map((a) => ({
    brandName: a.brandName,
    platform: a.platform as RestoreReport['accountsToReconnect'][number]['platform'],
    displayName: a.displayName,
  }))
  db.transaction(() => {
    db.prepare(
      'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
    ).run('mediaRoot', JSON.stringify(mediaRoot))
    db.prepare(
      "UPDATE accounts SET status = 'needs_reauth', token_expires_at = NULL WHERE mode != 'dry_run'",
    ).run()
    try {
      db.prepare("UPDATE meta_connection SET status = 'needs_reauth'").run()
    } catch {
      // older backups have no Meta table
    }
    // Anything that was mid-flight on the old Mac starts again cleanly.
    db.prepare(
      "UPDATE post_targets SET status = 'pending', lock_token = NULL, locked_at_utc = NULL WHERE status = 'uploading'",
    ).run()
  })()
  const report: RestoreReport = {
    restoredAt: new Date().toISOString(),
    accountsToReconnect: accounts,
  }
  db.prepare(
    'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
  ).run(REPORT_KEY, JSON.stringify(report))
  return report
}

export function readRestoreReport(db: Db): RestoreReport | null {
  const r = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(REPORT_KEY) as
    { value_json: string } | undefined
  return r ? (JSON.parse(r.value_json) as RestoreReport) : null
}

export function dismissRestoreReport(db: Db): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(REPORT_KEY)
}
