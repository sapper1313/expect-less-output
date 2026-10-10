import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { gunzipSync, gzipSync } from 'zlib'
import type { Db } from '../db'
import type { EpisodePackage, EpisodeRow, EpisodeStatus } from '@shared/studio/types'
import { EPISODE_STATUSES } from '@shared/studio/types'
import { expandHome, type StudioConfigService } from './configService'

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function mapRow(r: any): EpisodeRow {
  return {
    id: r.id,
    brandId: r.brand_id,
    series: r.series,
    number: r.number,
    title: r.title,
    summary: r.summary,
    status: r.status,
    tags: r.tags,
    origin: r.origin,
    slotDate: r.slot_date,
    scheduledAtUtc: r.scheduled_at_utc,
    postedAtUtc: r.posted_at_utc,
    postId: r.post_id,
    packagePath: r.package_path,
    previewPath: r.preview_path,
    videoPath: r.video_path,
    thumbPath: r.thumb_path,
    mediaPurgedAt: r.media_purged_at,
    flaggedReason: r.flagged_reason,
    createdUtc: r.created_utc,
    updatedUtc: r.updated_utc,
  }
}

export interface EpisodeFilter {
  brandId?: number | null
  status?: EpisodeStatus | 'all'
  search?: string
  tag?: string
  sort?: 'newest' | 'oldest' | 'title'
  limit?: number
}

/** Statuses from which a video is allowed to start. Used by the Grok Bot readable "ready" folder. */
export const READY_STATUSES: EpisodeStatus[] = ['Ready for production', 'In production', 'Awaiting video']

export class EpisodeLibrary {
  constructor(
    private db: Db,
    private cfg: StudioConfigService,
    private brandName: (id: number) => string,
    private now: () => number = Date.now,
  ) {}

  root(): string {
    return expandHome(this.cfg.get().libraryDir)
  }

  readyDir(): string {
    return join(this.root(), 'hollow', 'ready')
  }

  private iso() {
    return new Date(this.now()).toISOString()
  }

  nextId(brandId: number): string {
    const year = new Date(this.now()).getUTCFullYear()
    const prefix = `${slug(this.brandName(brandId))}-${year}-`
    const last = this.db
      .prepare('SELECT id FROM episodes WHERE id LIKE ? ORDER BY id DESC LIMIT 1')
      .get(prefix + '%') as { id: string } | undefined
    const n = last ? parseInt(last.id.slice(prefix.length), 10) + 1 : 1
    return `${prefix}${String(n).padStart(4, '0')}`
  }

  private packagePath(brandId: number, id: string): string {
    const year = id.split('-').slice(-2)[0] || String(new Date(this.now()).getUTCFullYear())
    return join(this.root(), slug(this.brandName(brandId)), year, `${id}.json.gz`)
  }

  /** Creates the package file and the index row. */
  create(
    brandId: number,
    pkg: Omit<EpisodePackage, 'id' | 'brand' | 'brand_id' | 'status_history' | 'schema_version'> &
      Partial<Pick<EpisodePackage, 'status_history'>>,
    opts: { status?: EpisodeStatus; slotDate?: string | null; origin?: string; id?: string; keyText?: string } = {},
  ): EpisodeRow {
    const id = opts.id ?? this.nextId(brandId)
    const status = opts.status ?? 'Idea'
    const full: EpisodePackage = {
      ...pkg,
      schema_version: 1,
      id,
      brand: this.brandName(brandId),
      brand_id: brandId,
      status_history: pkg.status_history ?? [{ at: this.iso(), status }],
    }
    const path = this.writePackage(brandId, id, full)
    const now = this.iso()
    this.db
      .prepare(
        `INSERT INTO episodes (id, brand_id, series, number, title, summary, status, tags, origin, slot_date, package_path, created_utc, updated_utc, key_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        brandId,
        full.series,
        full.episode_number,
        full.title,
        full.summary,
        status,
        full.tags.join(' '),
        opts.origin ?? 'studio',
        opts.slotDate ?? null,
        path,
        now,
        now,
        (opts.keyText ?? `${full.title} ${full.summary}`).toLowerCase(),
      )
    this.syncReadyCopy(id)
    return this.get(id)
  }

  private writePackage(brandId: number, id: string, pkg: EpisodePackage): string {
    const path = this.packagePath(brandId, id)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, gzipSync(Buffer.from(JSON.stringify(pkg)), { level: 9 }))
    return path
  }

  get(id: string): EpisodeRow {
    const r = this.db.prepare('SELECT * FROM episodes WHERE id = ?').get(id)
    if (!r) throw new Error(`Episode ${id} not found.`)
    return mapRow(r)
  }

  find(id: string): EpisodeRow | null {
    const r = this.db.prepare('SELECT * FROM episodes WHERE id = ?').get(id)
    return r ? mapRow(r) : null
  }

  getPackage(id: string): EpisodePackage | null {
    const row = this.find(id)
    if (!row?.packagePath || !existsSync(row.packagePath)) return null
    return JSON.parse(gunzipSync(readFileSync(row.packagePath)).toString('utf8')) as EpisodePackage
  }

  /** Replaces the package, keeps the index row in step. Status history is kept unless the caller sends one. */
  savePackage(id: string, pkg: EpisodePackage): EpisodeRow {
    const row = this.get(id)
    const path = this.writePackage(row.brandId, id, { ...pkg, id })
    this.db
      .prepare('UPDATE episodes SET title = ?, summary = ?, series = ?, number = ?, tags = ?, package_path = ?, updated_utc = ? WHERE id = ?')
      .run(pkg.title, pkg.summary, pkg.series, pkg.episode_number, pkg.tags.join(' '), path, this.iso(), id)
    this.syncReadyCopy(id)
    return this.get(id)
  }

  /** Changes the status, records it in the package history, and keeps the Grok Bot ready folder in step. */
  setStatus(
    id: string,
    status: EpisodeStatus,
    note?: string,
    extra: Partial<{
      flaggedReason: string | null
      postId: number | null
      scheduledAtUtc: string | null
      postedAtUtc: string | null
      videoPath: string | null
      thumbPath: string | null
    }> = {},
  ): EpisodeRow {
    if (!EPISODE_STATUSES.includes(status)) throw new Error(`Unknown status ${status}.`)
    const row = this.get(id)
    const pkg = this.getPackage(id)
    if (pkg) {
      pkg.status_history.push({ at: this.iso(), status, note })
      this.writePackage(row.brandId, id, pkg)
    }
    const sets = ['status = ?', 'updated_utc = ?']
    const args: unknown[] = [status, this.iso()]
    const col: Record<string, string> = {
      flaggedReason: 'flagged_reason',
      postId: 'post_id',
      scheduledAtUtc: 'scheduled_at_utc',
      postedAtUtc: 'posted_at_utc',
      videoPath: 'video_path',
      thumbPath: 'thumb_path',
    }
    for (const [k, v] of Object.entries(extra)) {
      sets.push(`${col[k]} = ?`)
      args.push(v ?? null)
    }
    if (status !== 'Flagged' && !('flaggedReason' in extra)) sets.push('flagged_reason = NULL')
    this.db.prepare(`UPDATE episodes SET ${sets.join(', ')} WHERE id = ?`).run(...args, id)
    this.syncReadyCopy(id)
    return this.get(id)
  }

  setFields(id: string, f: Partial<{ postId: number | null; videoPath: string | null; thumbPath: string | null; previewPath: string | null; slotDate: string | null; embeddingJson: string | null; keyText: string; mediaPurgedAt: string | null; scheduledAtUtc: string | null; postedAtUtc: string | null }>): void {
    const col: Record<string, string> = {
      postId: 'post_id',
      videoPath: 'video_path',
      thumbPath: 'thumb_path',
      previewPath: 'preview_path',
      slotDate: 'slot_date',
      embeddingJson: 'embedding_json',
      keyText: 'key_text',
      mediaPurgedAt: 'media_purged_at',
      scheduledAtUtc: 'scheduled_at_utc',
      postedAtUtc: 'posted_at_utc',
    }
    const sets = Object.keys(f).map((k) => `${col[k]} = ?`)
    if (!sets.length) return
    this.db
      .prepare(`UPDATE episodes SET ${sets.join(', ')}, updated_utc = ? WHERE id = ?`)
      .run(...Object.values(f), this.iso(), id)
  }

  list(f: EpisodeFilter = {}): EpisodeRow[] {
    const where: string[] = []
    const args: unknown[] = []
    if (f.brandId) {
      where.push('brand_id = ?')
      args.push(f.brandId)
    }
    if (f.status && f.status !== 'all') {
      where.push('status = ?')
      args.push(f.status)
    }
    if (f.search?.trim()) {
      const like = `%${f.search.trim().replace(/[\\%_]/g, (c) => '\\' + c)}%`
      where.push("(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')")
      args.push(like, like, like, like)
    }
    if (f.tag) {
      where.push("(' ' || tags || ' ') LIKE ?")
      args.push(`% ${f.tag} %`)
    }
    const order = f.sort === 'oldest' ? 'created_utc ASC, id ASC' : f.sort === 'title' ? 'title COLLATE NOCASE' : 'created_utc DESC, id DESC'
    args.push(f.limit ?? 500)
    return (
      this.db
        .prepare(`SELECT * FROM episodes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ?`)
        .all(...args) as any[]
    ).map(mapRow)
  }

  /** Copy of an episode as a new Idea, with the same package content and a fresh id. */
  duplicate(id: string): EpisodeRow {
    const row = this.get(id)
    const pkg = this.getPackage(id)
    if (!pkg) throw new Error('This episode has no package to copy.')
    const rest: Partial<EpisodePackage> = { ...pkg }
    for (const k of ['id', 'brand', 'brand_id', 'status_history', 'schema_version'] as const) delete rest[k]
    return this.create(row.brandId, { ...(rest as Omit<EpisodePackage, 'id' | 'brand' | 'brand_id' | 'status_history' | 'schema_version'>), title: `${pkg.title} (copy)`, episode_number: 0 }, { status: 'Idea' })
  }

  exportJson(id: string): string {
    const pkg = this.getPackage(id)
    if (!pkg) throw new Error('This episode has no package.')
    return JSON.stringify(pkg, null, 2)
  }

  /** Keeps a plain .json copy of READY package episodes where Grok Bot can read it. Removed when the episode moves on. */
  private syncReadyCopy(id: string): void {
    const row = this.find(id)
    if (!row) return
    const file = join(this.readyDir(), `${id}.json`)
    const brand = this.cfg.getBrand(row.brandId)
    const want = brand.path === 'package' && READY_STATUSES.includes(row.status)
    if (want) {
      const pkg = this.getPackage(id)
      if (!pkg) return
      mkdirSync(this.readyDir(), { recursive: true })
      writeFileSync(file, JSON.stringify(pkg, null, 2))
    } else if (existsSync(file)) rmSync(file, { force: true })
  }

  /** Library size on disk (packages only). */
  packageBytes(): number {
    const walk = (dir: string): number => {
      if (!existsSync(dir)) return 0
      let n = 0
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        n += e.isDirectory() ? walk(p) : statSync(p).size
      }
      return n
    }
    return walk(this.root())
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM episodes').get() as { n: number }).n
  }
}
