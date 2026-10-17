import { homedir } from 'os'
import type { Db } from '../db'
import { initBrandRows, ensureSlugs } from '../db/seed'
import {
  DEFAULT_STUDIO_CONFIG,
  checkedCap,
  chooseModel,
  deepMerge,
  defaultBrandConfig,
  normalizeBrandConfig,
} from '@shared/studio/config'
import { changeEveryN, projectMonthlyCost, todayEastern } from '@shared/studio/cadence'
import { typicalEpisodeEstimate } from '@shared/studio/pricing'
import type {
  BrandFormat,
  ModelTier,
  StudioBrandConfig,
  StudioConfig,
  StudioPlatform,
} from '@shared/studio/types'

const KEY = 'studio.config'

export const HOLLOW_NAME = 'Wonder Hollow Workshop'

/** Brand name prefixes that get studio defaults on first run. After that everything is by id. */
const SEED_FORMATS: Array<{
  prefix: string
  format: BrandFormat
  patch?: Partial<StudioBrandConfig>
}> = [
  { prefix: 'wonder hollow', format: 'long' },
  { prefix: 'the math of it', format: 'short', patch: { mathCheck: true } },
  {
    prefix: 'teach your parents tech',
    format: 'short',
    patch: { mathCheck: true, stepsCheck: true },
  },
]

export function expandHome(p: string): string {
  return p.startsWith('~') ? homedir() + p.slice(1) : p
}

export class StudioConfigService {
  private cache: StudioConfig | null = null

  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  /** Has the studio ever saved its settings? False on the very first run. */
  exists(): boolean {
    return !!this.db.prepare('SELECT 1 FROM settings WHERE key = ?').get(KEY)
  }

  get(): StudioConfig {
    if (this.cache) return this.cache
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(KEY) as
      { value_json: string } | undefined
    let stored: unknown = null
    if (row) {
      try {
        stored = JSON.parse(row.value_json)
      } catch {
        stored = null
      }
    }
    this.cache = deepMerge(DEFAULT_STUDIO_CONFIG, stored)
    return this.cache
  }

  private save(cfg: StudioConfig): StudioConfig {
    this.db
      .prepare(
        'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
      )
      .run(KEY, JSON.stringify(cfg))
    this.cache = cfg
    return cfg
  }

  /** Validates, merges and saves a partial change. Caps accept 0 to 9999. */
  set(patch: Partial<StudioConfig>): StudioConfig {
    const next = deepMerge(this.get(), patch) as StudioConfig
    next.globalCap = checkedCap(next.globalCap)
    next.aiTextCap = checkedCap(next.aiTextCap)
    next.perEpisodeCapDefault = checkedCap(next.perEpisodeCapDefault)
    if (!(next.retentionDays >= 1)) throw new Error('Retention must be at least 1 day.')
    if (!(next.retakeMultiplier >= 1)) throw new Error('The retake multiplier must be 1 or more.')
    if (!(next.paidConcurrency >= 1)) throw new Error('At least 1 paid request at a time.')
    if (!/^\d{1,2}:\d{2}$/.test(next.digestTime)) throw new Error('Use HH:MM for the digest time.')
    return this.save(next)
  }

  /** One of the two model boxes per format. Exactly one stays checked. */
  setFormatModel(format: BrandFormat, tier: ModelTier, checked: boolean): StudioConfig {
    const cfg = this.get()
    return this.save({ ...cfg, formatModel: chooseModel(cfg.formatModel, format, tier, checked) })
  }

  // ---------- brands ----------

  /** Gives every brand a studio row, and creates Wonder Hollow Workshop when it is missing. */
  ensureBrandRows(): void {
    const today = todayEastern(this.now())
    const brands = this.db.prepare('SELECT id, name FROM brands').all() as Array<{
      id: number
      name: string
    }>
    if (!brands.some((b) => b.name.toLowerCase().startsWith('wonder hollow'))) {
      const id = Number(
        this.db
          .prepare('INSERT INTO brands (name, color) VALUES (?, ?)')
          .run(HOLLOW_NAME, '#8B5CF6').lastInsertRowid,
      )
      initBrandRows(this.db, id)
      brands.push({ id, name: HOLLOW_NAME })
    }
    ensureSlugs(this.db)
    const has = this.db.prepare('SELECT 1 FROM studio_brands WHERE brand_id = ?')
    const ins = this.db.prepare('INSERT INTO studio_brands (brand_id, config_json) VALUES (?, ?)')
    for (const b of brands) {
      if (has.get(b.id)) {
        // A row from before the checker flags existed gets the seed choices for its brand once.
        const row = this.db
          .prepare('SELECT config_json FROM studio_brands WHERE brand_id = ?')
          .get(b.id) as { config_json: string }
        const stored = JSON.parse(row.config_json) as Partial<StudioBrandConfig>
        if (stored.mathCheck === undefined) {
          const sd = SEED_FORMATS.find((x) => b.name.toLowerCase().startsWith(x.prefix))
          const patch = {
            mathCheck: false,
            stepsCheck: false,
            ...(stored.format === 'long' ? { mathCheck: true } : {}),
            ...(sd?.patch ?? {}),
          }
          this.db
            .prepare('UPDATE studio_brands SET config_json = ? WHERE brand_id = ?')
            .run(JSON.stringify({ ...stored, ...patch }), b.id)
        }
        continue
      }
      const seed = SEED_FORMATS.find((s) => b.name.toLowerCase().startsWith(s.prefix))
      ins.run(
        b.id,
        JSON.stringify({
          ...defaultBrandConfig(seed?.format ?? 'short', today),
          ...(seed?.patch ?? {}),
        }),
      )
    }
  }

  getBrand(brandId: number): StudioBrandConfig {
    const row = this.db
      .prepare('SELECT config_json FROM studio_brands WHERE brand_id = ?')
      .get(brandId) as { config_json: string } | undefined
    if (!row) {
      this.ensureBrandRows()
      return this.getBrand(brandId)
    }
    return normalizeBrandConfig(JSON.parse(row.config_json), 'short', todayEastern(this.now()))
  }

  listBrandConfigs(): Array<{
    brandId: number
    name: string
    color: string
    config: StudioBrandConfig
  }> {
    this.ensureBrandRows()
    const rows = this.db
      .prepare('SELECT id, name, color FROM brands WHERE archived = 0 ORDER BY id')
      .all() as Array<{ id: number; name: string; color: string }>
    return rows.map((r) => ({
      brandId: r.id,
      name: r.name,
      color: r.color,
      config: this.getBrand(r.id),
    }))
  }

  setBrand(brandId: number, patch: Partial<StudioBrandConfig>): StudioBrandConfig {
    const cur = this.getBrand(brandId)
    const today = todayEastern(this.now())
    let next: StudioBrandConfig = {
      ...cur,
      ...patch,
      platforms: { ...cur.platforms, ...(patch.platforms ?? {}) },
    }
    if (patch.everyN !== undefined && patch.everyN !== cur.everyN)
      next = changeEveryN(
        { ...next, everyN: cur.everyN, startDate: cur.startDate },
        patch.everyN,
        today,
      )
    if (!Number.isInteger(next.everyN) || next.everyN < 1)
      throw new Error('Every N days needs a whole number of 1 or more.')
    if (!(next.runwayDays >= 0)) throw new Error('Runway days cannot be negative.')
    if (!/^\d{1,2}:\d{2}$/.test(next.runTime)) throw new Error('Use HH:MM for the run time.')
    next.monthlyCap = checkedCap(next.monthlyCap)
    next.perEpisodeCap = checkedCap(next.perEpisodeCap)
    if (next.format === 'long') {
      // Long form is YouTube only.
      const p = { ...next.platforms }
      for (const k of Object.keys(p) as StudioPlatform[]) if (k !== 'youtube') p[k] = false
      next.platforms = p
    }
    this.db
      .prepare('UPDATE studio_brands SET config_json = ? WHERE brand_id = ?')
      .run(JSON.stringify(next), brandId)
    return next
  }

  /** Projected monthly cost for the current and a new cadence, shown before saving. */
  cadenceWhatIf(brandId: number, newEveryN: number): { current: number; proposed: number } {
    const cfg = this.get()
    const cur = this.getBrand(brandId)
    const per = typicalEpisodeEstimate(cfg, cur).firstPass
    return {
      current: projectMonthlyCost(cur, per),
      proposed: projectMonthlyCost({ ...cur, cadenceMode: 'every_n', everyN: newEveryN }, per),
    }
  }

  /** Per episode cap: the brand's own value, else the global default. */
  episodeCap(brandId: number) {
    const b = this.getBrand(brandId)
    return b.perEpisodeCap.none ? this.get().perEpisodeCapDefault : b.perEpisodeCap
  }
}
