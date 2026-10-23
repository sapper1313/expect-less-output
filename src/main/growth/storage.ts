import { existsSync, mkdirSync, readdirSync, statSync, statfsSync } from 'fs'
import { basename, join } from 'path'
import type { Db } from '../db'
import type { Library } from '../services/library'
import { uniquePath } from '../services/library'

export interface StorageRow {
  channel: string
  queue: number
  posted: number
  replaced: number
  archive: number
  other: number
}

export interface StorageReport {
  rows: StorageRow[]
  totalBytes: number
  freeBytes: number | null
}

export interface ArchiveResult {
  compressed: number
  savedBytes: number
  removedOriginals: number
  skipped: string[]
}

export interface StorageDeps {
  db: Db
  library: Library
  /** Writes a smaller copy of a video. */
  compress: (inPath: string, outPath: string) => Promise<void>
  /** The length of a video in seconds. */
  duration: (path: string) => Promise<number>
  brandNames: () => string[]
  now?: () => number
}

function folderBytes(dir: string): number {
  if (!existsSync(dir)) return 0
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) n += folderBytes(p)
    else if (e.isFile()) n += statSync(p).size
  }
  return n
}

/**
 * Where the disk space goes, and an opt-in way to shrink old posted videos to H.265. A smaller copy is made first and
 * checked (same length). The big original is only removed when the owner ticked the box for it.
 */
export class StorageService {
  constructor(private d: StorageDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  report(): StorageReport {
    const rows: StorageRow[] = []
    for (const name of this.d.brandNames()) {
      const dir = this.d.library.brandDir(name)
      const part = (sub: string) => folderBytes(join(dir, sub))
      const queue = part('Queue')
      const posted = part('Posted')
      const replaced = part('Replaced')
      const archive = part('Archive')
      const all = folderBytes(dir)
      rows.push({
        channel: name,
        queue,
        posted,
        replaced,
        archive,
        other: Math.max(0, all - queue - posted - replaced - archive),
      })
    }
    let free: number | null = null
    try {
      const f = statfsSync(this.d.library.root)
      free = f.bavail * f.bsize
    } catch {
      free = null
    }
    return {
      rows,
      totalBytes: rows.reduce(
        (a, r) => a + r.queue + r.posted + r.replaced + r.archive + r.other,
        0,
      ),
      freeBytes: free,
    }
  }

  /** Posted videos older than `days` that can be shrunk. */
  private candidates(days: number): Array<{ id: number; rel: string; brand: string }> {
    const cutoff = new Date(this.now() - days * 86_400_000).toISOString()
    return this.d.db
      .prepare(
        `SELECT p.id, p.video_path AS rel, b.name AS brand FROM posts p JOIN brands b ON b.id = p.brand_id
         WHERE p.status = 'posted' AND p.media_purged_at IS NULL AND p.video_path LIKE '%/Posted/%'
           AND NOT EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = p.id AND t.status != 'posted')
           AND (SELECT MAX(t.posted_at_utc) FROM post_targets t WHERE t.post_id = p.id) < ?
         ORDER BY p.id`,
      )
      .all(cutoff) as Array<{ id: number; rel: string; brand: string }>
  }

  async archiveOld(days: number, removeOriginals: boolean, limit = 10): Promise<ArchiveResult> {
    const out: ArchiveResult = { compressed: 0, savedBytes: 0, removedOriginals: 0, skipped: [] }
    for (const c of this.candidates(days).slice(0, limit)) {
      const src = this.d.library.resolve(c.rel)
      if (!existsSync(src)) continue
      const dir = join(this.d.library.brandDir(c.brand), 'Archive')
      mkdirSync(dir, { recursive: true })
      const dest = uniquePath(dir, basename(src))
      try {
        await this.d.compress(src, dest)
        const [a, b] = await Promise.all([this.d.duration(src), this.d.duration(dest)])
        if (Math.abs(a - b) > 0.6) throw new Error('the smaller copy has a different length')
        const before = statSync(src).size
        const after = statSync(dest).size
        if (after >= before) {
          this.d.library.removeIfInside(this.d.library.toRelative(dest))
          out.skipped.push(`${basename(src)}: already small`)
          continue
        }
        out.compressed++
        out.savedBytes += before - after
        if (removeOriginals) {
          this.d.db
            .prepare('UPDATE posts SET video_path = ? WHERE id = ?')
            .run(this.d.library.toRelative(dest), c.id)
          this.d.library.deleteFile(c.rel)
          out.removedOriginals++
        }
      } catch (e) {
        this.d.library.removeIfInside(this.d.library.toRelative(dest))
        out.skipped.push(`${basename(src)}: ${(e as Error).message}`)
      }
    }
    return out
  }
}
