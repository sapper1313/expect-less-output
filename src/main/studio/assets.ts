import { copyFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { basename, extname, join } from 'path'
import type { Db } from '../db'
import { slug } from './library'
import type { StudioConfigService } from './configService'
import { expandHome } from './configService'

export type AssetKind = 'opening' | 'outro' | 'reference_image' | 'voice_reference'

export interface Asset {
  id: number
  brandId: number
  kind: AssetKind
  path: string
  prompt: string | null
  description: string | null
}

/** Reference images, voice references and the shared opening and outro. Files are copied into the studio assets folder. */
export class BrandAssets {
  constructor(
    private db: Db,
    private cfg: StudioConfigService,
    private brandName: (id: number) => string,
    private now: () => number = Date.now,
  ) {}

  dir(brandId: number): string {
    return join(expandHome(this.cfg.get().libraryDir), 'assets', slug(this.brandName(brandId)))
  }

  list(brandId: number, kind?: AssetKind): Asset[] {
    const rows = this.db
      .prepare(`SELECT * FROM brand_assets WHERE brand_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY id`)
      .all(...(kind ? [brandId, kind] : [brandId])) as any[]
    return rows.map((r) => ({ id: r.id, brandId: r.brand_id, kind: r.kind, path: r.path, prompt: r.prompt, description: r.description }))
  }

  /** The current opening or outro, if it exists on disk. */
  slot(brandId: number, kind: 'opening' | 'outro'): Asset | null {
    const a = this.list(brandId, kind).pop() ?? null
    return a && existsSync(a.path) ? a : null
  }

  /** Copies a file in. For opening and outro the old one is replaced. */
  add(brandId: number, kind: AssetKind, source: string, prompt?: string): Asset {
    if (!existsSync(source)) throw new Error(`No file at ${source}.`)
    const dir = this.dir(brandId)
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, `${kind}-${this.now()}${extname(source) || ''}`)
    copyFileSync(source, dest)
    if (kind === 'opening' || kind === 'outro') {
      for (const old of this.list(brandId, kind)) this.remove(old.id)
    }
    const id = Number(
      this.db
        .prepare('INSERT INTO brand_assets (brand_id, kind, path, prompt, created_utc) VALUES (?, ?, ?, ?, ?)')
        .run(brandId, kind, dest, prompt ?? null, new Date(this.now()).toISOString()).lastInsertRowid,
    )
    return this.list(brandId).find((a) => a.id === id) as Asset
  }

  setDescription(id: number, text: string): void {
    this.db.prepare('UPDATE brand_assets SET description = ? WHERE id = ?').run(text, id)
  }

  remove(id: number): void {
    const r = this.db.prepare('SELECT path FROM brand_assets WHERE id = ?').get(id) as { path: string } | undefined
    if (r) rmSync(r.path, { force: true })
    this.db.prepare('DELETE FROM brand_assets WHERE id = ?').run(id)
  }

  name(p: string): string {
    return basename(p)
  }
}
