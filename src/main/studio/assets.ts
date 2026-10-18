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
  /** The bible character this picture belongs to, or null for a brand wide reference. */
  characterId: string | null
  label: string | null
  /** A retired picture is kept but never sent to the video model. */
  active: boolean
}

/** The video model accepts at most this many reference images in one request. */
export const MAX_REFERENCES = 14

/** Reference images, voice references and the shared opening and outro. Files are copied into the studio assets folder. */
export class BrandAssets {
  constructor(
    private db: Db,
    private cfg: StudioConfigService,
    private brandName: (id: number) => string,
    private now: () => number = Date.now,
    /** Characters that still exist in the brand's bible. Pictures of a removed character are not sent. */
    private characterIds: (brandId: number) => Set<string> = () => new Set(),
  ) {}

  dir(brandId: number): string {
    return join(expandHome(this.cfg.get().libraryDir), 'assets', slug(this.brandName(brandId)))
  }

  list(brandId: number, kind?: AssetKind): Asset[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM brand_assets WHERE brand_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY id`,
      )
      .all(...(kind ? [brandId, kind] : [brandId])) as any[]
    return rows.map((r) => ({
      id: r.id,
      brandId: r.brand_id,
      kind: r.kind,
      path: r.path,
      prompt: r.prompt,
      description: r.description,
      characterId: r.character_id ?? null,
      label: r.label ?? null,
      active: r.active !== 0,
    }))
  }

  /** The current opening or outro, if it exists on disk. */
  slot(brandId: number, kind: 'opening' | 'outro'): Asset | null {
    const a = this.list(brandId, kind).pop() ?? null
    return a && existsSync(a.path) ? a : null
  }

  /**
   * The reference images to send with a clip: pictures that are switched on, for characters that still exist,
   * plus brand wide ones. Characters take turns so one character with many pictures cannot crowd out another.
   */
  references(brandId: number, cap = MAX_REFERENCES): Asset[] {
    const valid = this.characterIds(brandId)
    const usable = this.list(brandId, 'reference_image').filter(
      (a) => a.active && existsSync(a.path) && (a.characterId === null || valid.has(a.characterId)),
    )
    const queues = new Map<string, Asset[]>()
    for (const a of usable.filter((x) => x.characterId !== null))
      queues.set(a.characterId as string, [...(queues.get(a.characterId as string) ?? []), a])
    // Up to 4 places go to the series pictures (the look, the places, the props), so characters cannot crowd them out.
    const seriesAll = usable.filter((x) => x.characterId === null)
    const reserved = Math.min(seriesAll.length, 4, cap)
    const out: Asset[] = []
    const charCap = cap - reserved
    for (let round = 0; out.length < charCap; round++) {
      let any = false
      for (const q of queues.values()) {
        if (q[round] && out.length < charCap) {
          out.push(q[round])
          any = true
        }
      }
      if (!any) break
    }
    for (const a of seriesAll) if (out.length < cap) out.push(a)
    return out
  }

  /** Copies a file in. For opening and outro the old one is replaced. */
  add(
    brandId: number,
    kind: AssetKind,
    source: string,
    prompt?: string,
    opts: { characterId?: string; label?: string } = {},
  ): Asset {
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
        .prepare(
          'INSERT INTO brand_assets (brand_id, kind, path, prompt, created_utc, character_id, label) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          brandId,
          kind,
          dest,
          prompt ?? null,
          new Date(this.now()).toISOString(),
          opts.characterId ?? null,
          opts.label ?? null,
        ).lastInsertRowid,
    )
    return this.list(brandId).find((a) => a.id === id) as Asset
  }

  update(id: number, patch: { label?: string; active?: boolean }): void {
    if (patch.label !== undefined)
      this.db
        .prepare('UPDATE brand_assets SET label = ? WHERE id = ?')
        .run(patch.label.trim() || null, id)
    if (patch.active !== undefined)
      this.db
        .prepare('UPDATE brand_assets SET active = ? WHERE id = ?')
        .run(patch.active ? 1 : 0, id)
  }

  get(id: number): Asset | null {
    const r = this.db.prepare('SELECT brand_id FROM brand_assets WHERE id = ?').get(id) as
      { brand_id: number } | undefined
    return r ? (this.list(r.brand_id).find((a) => a.id === id) ?? null) : null
  }

  setDescription(id: number, text: string): void {
    this.db.prepare('UPDATE brand_assets SET description = ? WHERE id = ?').run(text, id)
  }

  remove(id: number): void {
    const r = this.db.prepare('SELECT path FROM brand_assets WHERE id = ?').get(id) as
      { path: string } | undefined
    if (r) rmSync(r.path, { force: true })
    this.db.prepare('DELETE FROM brand_assets WHERE id = ?').run(id)
  }

  name(p: string): string {
    return basename(p)
  }
}
