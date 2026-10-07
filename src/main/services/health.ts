import type { Db } from '../db'
import type { HealthRow, Platform } from '@shared/types'

const MODE_NOTE: Record<string, string> = {
  manual_assist: 'Manual assist',
  test_private: 'Test private',
  auto: 'Auto',
  live: 'Live',
  drafts: 'Drafts',
  direct: 'Direct post',
}

export interface HealthDeps {
  db: Db
  /** When the Meta login runs out, or null. */
  metaExpiresAt: () => string | null
  /** When the saved TikTok login runs out, or null. */
  tiktokExpiresAt: (accountId: number) => string | null
}

/** One row per connected account for the Connections health panel. Dry run placeholders are left out. */
export function healthRows(d: HealthDeps): HealthRow[] {
  const rows = d.db
    .prepare(
      `SELECT a.*, b.name AS brand_name FROM accounts a JOIN brands b ON b.id = a.brand_id
       WHERE a.mode != 'dry_run' AND b.archived = 0 ORDER BY b.id, a.platform`,
    )
    .all() as any[]
  return rows.map((r) => {
    const platform = r.platform as Platform
    let expiresAt: string | null = null
    let note = MODE_NOTE[r.mode] ?? r.mode
    if (platform === 'facebook' || platform === 'instagram') {
      expiresAt = d.metaExpiresAt()
      note += ' (Meta login)'
    } else if (platform === 'tiktok') {
      expiresAt = d.tiktokExpiresAt(r.id)
    } else if (platform === 'youtube') {
      note += ' (renews itself)'
    }
    return {
      accountId: r.id,
      brandId: r.brand_id,
      brandName: r.brand_name,
      platform,
      displayName: r.display_name,
      status: r.status,
      mode: r.mode,
      lastCheckedAt: r.last_checked_at,
      expiresAt,
      note,
    }
  })
}
