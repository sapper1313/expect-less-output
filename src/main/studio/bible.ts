import type { Db } from '../db'
import { SeriesBible, bibleToMarkdown, seedBible, type SeriesBibleData, type Skill } from '@shared/studio/bible'
import type { StudioConfigService } from './configService'

export interface Idea {
  id: number
  brandId: number
  text: string
  used: boolean
}

/** Series bibles, imported skills and the ideas bank. All of it is data the owner can edit. */
export class BibleService {
  constructor(
    private db: Db,
    private cfg: StudioConfigService,
    private brandName: (id: number) => string,
    private now: () => number = Date.now,
  ) {}

  private iso() {
    return new Date(this.now()).toISOString()
  }

  /** Gives every brand a bible. Existing facts are preloaded, everything else starts as a short premise. */
  ensureSeeded(): void {
    const has = this.db.prepare('SELECT 1 FROM series_bible WHERE brand_id = ?')
    const ins = this.db.prepare('INSERT INTO series_bible (brand_id, bible_json, updated_utc) VALUES (?, ?, ?)')
    for (const b of this.cfg.listBrandConfigs()) {
      if (has.get(b.brandId)) continue
      ins.run(b.brandId, JSON.stringify(seedBible(b.name, b.config.format)), this.iso())
    }
  }

  get(brandId: number): { bible: SeriesBibleData; skills: Skill[] } {
    this.ensureSeeded()
    const row = this.db.prepare('SELECT bible_json FROM series_bible WHERE brand_id = ?').get(brandId) as { bible_json: string } | undefined
    const bible = SeriesBible.parse(row ? JSON.parse(row.bible_json) : {})
    return { bible, skills: this.skills(brandId) }
  }

  set(brandId: number, patch: Partial<SeriesBibleData>): SeriesBibleData {
    const cur = this.get(brandId).bible
    const next = SeriesBible.parse({ ...cur, ...patch })
    this.db
      .prepare('INSERT INTO series_bible (brand_id, bible_json, updated_utc) VALUES (?, ?, ?) ON CONFLICT(brand_id) DO UPDATE SET bible_json = excluded.bible_json, updated_utc = excluded.updated_utc')
      .run(brandId, JSON.stringify(next), this.iso())
    return next
  }

  skills(brandId: number): Skill[] {
    return (this.db.prepare('SELECT id, name, text FROM bible_skills WHERE brand_id = ? ORDER BY id').all(brandId) as Skill[])
  }

  addSkill(brandId: number, name: string, text: string): Skill {
    if (!text.trim()) throw new Error('That file is empty.')
    const id = Number(
      this.db.prepare('INSERT INTO bible_skills (brand_id, name, text, created_utc) VALUES (?, ?, ?, ?)').run(brandId, name.trim() || 'Skill', text, this.iso()).lastInsertRowid,
    )
    return { id, name: name.trim() || 'Skill', text }
  }

  updateSkill(id: number, text: string): void {
    this.db.prepare('UPDATE bible_skills SET text = ? WHERE id = ?').run(text, id)
  }

  removeSkill(id: number): void {
    this.db.prepare('DELETE FROM bible_skills WHERE id = ?').run(id)
  }

  /** The full bible as Markdown. The Writer receives this on every call. */
  markdown(brandId: number): string {
    const { bible, skills } = this.get(brandId)
    return bibleToMarkdown(this.brandName(brandId), bible, skills)
  }

  // ---------- ideas bank ----------

  ideas(brandId: number, includeUsed = false): Idea[] {
    return (
      this.db
        .prepare(`SELECT id, brand_id, text, used FROM ideas WHERE brand_id = ? ${includeUsed ? '' : 'AND used = 0'} ORDER BY id`)
        .all(brandId) as Array<{ id: number; brand_id: number; text: string; used: number }>
    ).map((r) => ({ id: r.id, brandId: r.brand_id, text: r.text, used: !!r.used }))
  }

  addIdeas(brandId: number, texts: string[]): number {
    const ins = this.db.prepare('INSERT INTO ideas (brand_id, text, created_utc) VALUES (?, ?, ?)')
    let n = 0
    for (const t of texts.map((x) => x.trim()).filter(Boolean)) {
      ins.run(brandId, t, this.iso())
      n++
    }
    return n
  }

  removeIdea(id: number): void {
    this.db.prepare('DELETE FROM ideas WHERE id = ?').run(id)
  }

  markIdeaUsed(id: number): void {
    this.db.prepare('UPDATE ideas SET used = 1 WHERE id = ?').run(id)
  }
}
