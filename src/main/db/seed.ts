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
  })()
}

/** Creates slots, defaults and dry-run accounts for a brand. Safe to call for new brands. */
export function initBrandRows(db: Db, brandId: number): void {
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
