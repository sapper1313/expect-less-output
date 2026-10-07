import type { Db } from '../db'
import { DEFAULT_CAPTION_TEMPLATE, initBrandRows } from '../db/seed'
import type { Account, Brand, BrandDefaults, BrandSlot, HashtagSet, Platform } from '@shared/types'

const mapBrand = (r: any): Brand => ({
  id: r.id,
  name: r.name,
  color: r.color,
  archived: !!r.archived,
})

export class BrandService {
  constructor(
    private db: Db,
    private onBrandFolder: (name: string) => void,
  ) {}

  list(includeArchived = false): Brand[] {
    const rows = this.db
      .prepare(`SELECT * FROM brands ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY id`)
      .all()
    return rows.map(mapBrand)
  }

  get(id: number): Brand {
    const r = this.db.prepare('SELECT * FROM brands WHERE id = ?').get(id)
    if (!r) throw new Error('Brand not found.')
    return mapBrand(r)
  }

  create(name: string, color: string): Brand {
    const clean = name.trim()
    if (!clean) throw new Error('Brand name cannot be empty.')
    const id = this.db.transaction(() => {
      const newId = Number(
        this.db.prepare('INSERT INTO brands (name, color) VALUES (?, ?)').run(clean, color)
          .lastInsertRowid,
      )
      initBrandRows(this.db, newId)
      return newId
    })()
    this.onBrandFolder(clean)
    return this.get(id)
  }

  update(id: number, patch: { name?: string; color?: string }): Brand {
    const cur = this.get(id)
    const name = patch.name?.trim() || cur.name
    this.db
      .prepare('UPDATE brands SET name = ?, color = ? WHERE id = ?')
      .run(name, patch.color ?? cur.color, id)
    this.onBrandFolder(name)
    return this.get(id)
  }

  archive(id: number, archived: boolean): void {
    this.db.prepare('UPDATE brands SET archived = ? WHERE id = ?').run(archived ? 1 : 0, id)
  }

  getSlots(brandId: number): BrandSlot[] {
    return (
      this.db
        .prepare('SELECT * FROM brand_slots WHERE brand_id = ? ORDER BY day_type DESC, time_local')
        .all(brandId) as any[]
    ).map((r) => ({
      id: r.id,
      brandId: r.brand_id,
      dayType: r.day_type,
      timeLocal: r.time_local,
      enabled: !!r.enabled,
    }))
  }

  setSlots(
    brandId: number,
    slots: Array<Pick<BrandSlot, 'dayType' | 'timeLocal' | 'enabled'>>,
  ): BrandSlot[] {
    for (const s of slots) {
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(s.timeLocal)) {
        throw new Error(`"${s.timeLocal}" is not a valid time. Use HH:MM, for example 17:00.`)
      }
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM brand_slots WHERE brand_id = ?').run(brandId)
      const ins = this.db.prepare(
        'INSERT INTO brand_slots (brand_id, day_type, time_local, enabled) VALUES (?, ?, ?, ?)',
      )
      for (const s of slots) ins.run(brandId, s.dayType, pad(s.timeLocal), s.enabled ? 1 : 0)
    })()
    return this.getSlots(brandId)
  }

  getDefaults(brandId: number): BrandDefaults {
    this.db
      .prepare('INSERT OR IGNORE INTO brand_defaults (brand_id, caption_template) VALUES (?, ?)')
      .run(brandId, DEFAULT_CAPTION_TEMPLATE)
    const r = this.db.prepare('SELECT * FROM brand_defaults WHERE brand_id = ?').get(brandId) as any
    return {
      brandId,
      captionTemplate: r.caption_template,
      defaultHashtagSetId: r.default_hashtag_set_id,
      youtubeCategoryId: r.youtube_category_id,
      youtubeMadeForKids: !!r.youtube_made_for_kids,
      youtubePlaylistId: r.youtube_playlist_id,
      youtubeAppendShorts: !!r.youtube_append_shorts,
      aiFlag: {
        youtube: !!r.ai_flag_youtube,
        tiktok: !!r.ai_flag_tiktok,
        facebook: !!r.ai_flag_facebook,
        instagram: !!r.ai_flag_instagram,
      },
      tiktokPrivacyDefault: r.tiktok_privacy_default,
      tiktokAllowComments: !!r.tiktok_allow_comments,
      tiktokAllowDuet: !!r.tiktok_allow_duet,
      tiktokAllowStitch: !!r.tiktok_allow_stitch,
    }
  }

  setDefaults(d: BrandDefaults): BrandDefaults {
    this.db
      .prepare(
        `UPDATE brand_defaults SET caption_template = ?, default_hashtag_set_id = ?, youtube_category_id = ?,
         youtube_made_for_kids = ?, youtube_playlist_id = ?, youtube_append_shorts = ?, ai_flag_youtube = ?, ai_flag_tiktok = ?,
         ai_flag_facebook = ?, ai_flag_instagram = ?, tiktok_privacy_default = ?, tiktok_allow_comments = ?,
         tiktok_allow_duet = ?, tiktok_allow_stitch = ? WHERE brand_id = ?`,
      )
      .run(
        d.captionTemplate,
        d.defaultHashtagSetId,
        d.youtubeCategoryId,
        d.youtubeMadeForKids ? 1 : 0,
        d.youtubePlaylistId,
        d.youtubeAppendShorts ? 1 : 0,
        d.aiFlag.youtube ? 1 : 0,
        d.aiFlag.tiktok ? 1 : 0,
        d.aiFlag.facebook ? 1 : 0,
        d.aiFlag.instagram ? 1 : 0,
        d.tiktokPrivacyDefault,
        d.tiktokAllowComments ? 1 : 0,
        d.tiktokAllowDuet ? 1 : 0,
        d.tiktokAllowStitch ? 1 : 0,
        d.brandId,
      )
    return this.getDefaults(d.brandId)
  }

  listHashtags(brandId?: number | null): HashtagSet[] {
    const rows =
      brandId == null
        ? this.db.prepare('SELECT * FROM hashtag_sets ORDER BY name').all()
        : this.db
            .prepare(
              'SELECT * FROM hashtag_sets WHERE brand_id = ? OR brand_id IS NULL ORDER BY name',
            )
            .all(brandId)
    return (rows as any[]).map((r) => ({
      id: r.id,
      brandId: r.brand_id,
      name: r.name,
      tagsText: r.tags_text,
    }))
  }

  saveHashtags(set: Omit<HashtagSet, 'id'> & { id?: number }): HashtagSet {
    let id = set.id
    if (id) {
      this.db
        .prepare('UPDATE hashtag_sets SET brand_id = ?, name = ?, tags_text = ? WHERE id = ?')
        .run(set.brandId, set.name, set.tagsText, id)
    } else {
      id = Number(
        this.db
          .prepare('INSERT INTO hashtag_sets (brand_id, name, tags_text) VALUES (?, ?, ?)')
          .run(set.brandId, set.name, set.tagsText).lastInsertRowid,
      )
    }
    const r = this.db.prepare('SELECT * FROM hashtag_sets WHERE id = ?').get(id) as any
    return { id: r.id, brandId: r.brand_id, name: r.name, tagsText: r.tags_text }
  }

  removeHashtags(id: number): void {
    this.db.prepare('DELETE FROM hashtag_sets WHERE id = ?').run(id)
  }

  listAccounts(brandId?: number): Account[] {
    const rows = (
      brandId
        ? this.db.prepare('SELECT * FROM accounts WHERE brand_id = ? ORDER BY id').all(brandId)
        : this.db.prepare('SELECT * FROM accounts ORDER BY brand_id, id').all()
    ) as any[]
    return rows.map((r) => ({
      id: r.id,
      brandId: r.brand_id,
      platform: r.platform as Platform,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      externalId: r.external_id,
      status: r.status,
      mode: r.mode,
      lastCheckedAt: r.last_checked_at,
    }))
  }
}

function pad(t: string): string {
  const [h, m] = t.split(':')
  return `${h.padStart(2, '0')}:${m}`
}
