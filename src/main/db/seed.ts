import type { Db } from './index'
import { PLATFORMS } from '@shared/platformLimits'

const SEED_BRANDS = [
  { name: 'Trash Panda', color: '#6B7280' },
  { name: 'Clock Out Early', color: '#F59E0B' },
  { name: 'Teach Your Parents Tech', color: '#3B82F6' },
  { name: 'The Math of It', color: '#10B981' },
]

export const DEFAULT_CAPTION_TEMPLATE = '{title}\n\n{hashtags}'

const DEFAULT_SLOTS = [
  { dayType: 'weekday', timeLocal: '08:00' },
  { dayType: 'weekday', timeLocal: '17:00' },
  { dayType: 'weekend', timeLocal: '10:00' },
  { dayType: 'weekend', timeLocal: '18:00' },
]

const slugOf = (name: string) =>
  (/^wonder hollow/i.test(name.trim()) ? 'wonder-hollow' : name)
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'channel'

/** Gives every channel without a slug one made from its name. Never changes a slug that exists. */
export function ensureSlugs(db: Db): void {
  const rows = db
    .prepare('SELECT id, name FROM brands WHERE slug IS NULL ORDER BY id')
    .all() as Array<{
    id: number
    name: string
  }>
  const taken = new Set(
    (
      db.prepare('SELECT slug FROM brands WHERE slug IS NOT NULL').all() as Array<{ slug: string }>
    ).map((r) => r.slug),
  )
  for (const r of rows) {
    const base = slugOf(r.name)
    let cand = base
    for (let i = 2; taken.has(cand); i++) cand = `${base}-${i}`
    taken.add(cand)
    db.prepare('UPDATE brands SET slug = ? WHERE id = ?').run(cand, r.id)
  }
}

/** Seeds brands only when the table is empty. Everything seeded stays editable. */
export function seedIfEmpty(db: Db): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM brands').get() as { n: number }).n
  if (count > 0) return
  db.transaction(() => {
    for (const b of SEED_BRANDS) {
      const id = Number(
        db.prepare('INSERT INTO brands (name, color) VALUES (?, ?)').run(b.name, b.color)
          .lastInsertRowid,
      )
      initBrandRows(db, id)
    }
    ensureSlugs(db)
  })()
}

/** Creates slots, defaults and dry-run accounts for a brand. Safe to call for new brands. */
export function initBrandRows(db: Db, brandId: number): void {
  db.prepare('INSERT OR IGNORE INTO channel_rules (brand_id) VALUES (?)').run(brandId)
  // A new channel watches its Inbox and schedules drops by itself until the owner turns that off.
  for (const key of ['inboxBrandIds', 'inboxAutoScheduleBrandIds']) {
    const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
      { value_json: string } | undefined
    let ids: number[] = []
    try {
      ids = row ? (JSON.parse(row.value_json) as number[]) : []
    } catch {
      ids = []
    }
    if (!ids.includes(brandId))
      db.prepare(
        'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
      ).run(key, JSON.stringify([...ids, brandId]))
  }
  const addSlot = db.prepare(
    'INSERT INTO brand_slots (brand_id, day_type, time_local, enabled) VALUES (?, ?, ?, 1)',
  )
  for (const s of DEFAULT_SLOTS) addSlot.run(brandId, s.dayType, s.timeLocal)
  db.prepare('INSERT OR IGNORE INTO brand_defaults (brand_id, caption_template) VALUES (?, ?)').run(
    brandId,
    DEFAULT_CAPTION_TEMPLATE,
  )
  const addAccount = db.prepare(
    "INSERT OR IGNORE INTO accounts (brand_id, platform, display_name, status, mode) VALUES (?, ?, 'Dry run account', 'connected', 'dry_run')",
  )
  for (const p of PLATFORMS) addAccount.run(brandId, p)
}
