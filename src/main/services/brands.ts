import type { Db } from '../db'
import { DEFAULT_CAPTION_TEMPLATE, ensureSlugs, initBrandRows } from '../db/seed'
import { canonicalSlug } from '@shared/pipeline'
import { platformSlotRows, primarySlots, slotKinds } from './channelSettings'
import { uploadPostOn } from './uploadPost'
import type { Account, Brand, BrandDefaults, BrandSlot, HashtagSet, Platform, PlatformSlot } from '@shared/types'

const mapBrand = (r: any): Brand => ({
  id: r.id,
  name: r.name,
  color: r.color,
  archived: !!r.archived,
  slug: r.slug ?? null,
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

  /** Finds a channel by its slug (case does not matter). */
  bySlug(slug: string): Brand | null {
    const r = this.db.prepare('SELECT * FROM brands WHERE slug = ?').get(canonicalSlug(slug))
    return r ? mapBrand(r) : null
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
      ensureSlugs(this.db)
      return newId
    })()
    this.onBrandFolder(clean)
    return this.get(id)
  }

  update(id: number, patch: { name?: string; color?: string; slug?: string }): Brand {
    const cur = this.get(id)
    const name = patch.name?.trim() || cur.name
    let slug = cur.slug
    if (patch.slug !== undefined) {
      slug = patch.slug.trim().toLowerCase()
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))
        throw new Error(
          'A slug uses lowercase letters, numbers and single dashes, like clock-out-early.',
        )
      const other = this.bySlug(slug)
      if (other && other.id !== id)
        throw new Error(`The slug ${slug} is already used by ${other.name}.`)
    }
    this.db
      .prepare('UPDATE brands SET name = ?, color = ?, slug = ? WHERE id = ?')
      .run(name, patch.color ?? cur.color, slug, id)
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
      kind: r.kind ?? 'short',
    }))
  }

  /** The channel's posting times, one set for each platform and kind. */
  getPlatformSlots(brandId: number): PlatformSlot[] {
    const rows = platformSlotRows(this.db, brandId)
    if (rows.length) return rows
    // A channel not set up per platform yet: show its one list on every platform its kind posts to.
    const kinds = slotKinds(this.db, brandId)
    const out: PlatformSlot[] = []
    for (const s of this.getSlots(brandId)) {
      const ticks = kinds.find((k) => k.kind === s.kind)?.platforms
      for (const platform of ['youtube', 'instagram', 'facebook', 'tiktok', 'bluesky'] as const)
        if (!ticks || ticks[platform] !== false)
          out.push({ platform, kind: s.kind, dayType: s.dayType, timeLocal: s.timeLocal, enabled: s.enabled })
    }
    return out
  }

  /**
   * Saves the per-platform posting times. The channel's combined list (brand_slots) is rebuilt from them, so the Home
   * week map and the bots keep working.
   */
  setPlatformSlots(brandId: number, slots: PlatformSlot[]): PlatformSlot[] {
    for (const s of slots) {
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(s.timeLocal))
        throw new Error(`"${s.timeLocal}" is not a valid time. Use HH:MM, for example 17:00.`)
      if (s.kind !== 'short' && s.kind !== 'long') throw new Error('Kind must be short or long.')
      if (s.dayType !== 'weekday' && s.dayType !== 'weekend') throw new Error('Day type must be weekday or weekend.')
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM brand_platform_slots WHERE brand_id = ?').run(brandId)
      const ins = this.db.prepare(
        'INSERT OR IGNORE INTO brand_platform_slots (brand_id, platform, kind, day_type, time_local, enabled) VALUES (?, ?, ?, ?, ?, ?)',
      )
      for (const s of slots) ins.run(brandId, s.platform, s.kind, s.dayType, pad(s.timeLocal), s.enabled ? 1 : 0)
      this.rebuildCombined(brandId)
    })()
    return this.getPlatformSlots(brandId)
  }

  /** brand_slots, the channel's combined list, from its per-platform times. */
  private rebuildCombined(brandId: number): void {
    this.db.prepare('DELETE FROM brand_slots WHERE brand_id = ?').run(brandId)
    const ins = this.db.prepare(
      'INSERT INTO brand_slots (brand_id, day_type, time_local, enabled, kind) VALUES (?, ?, ?, 1, ?)',
    )
    for (const s of primarySlots(platformSlotRows(this.db, brandId))) ins.run(brandId, s.dayType, s.timeLocal, s.kind)
  }

  getSlotKinds(brandId: number) {
    return slotKinds(this.db, brandId)
  }

  /** Which kinds the channel makes and the days each posts on. */
  setSlotKinds(brandId: number, kinds: Array<{ kind: 'short' | 'long'; enabled: boolean; days: number[] | null; platforms?: Record<string, boolean> | null }>) {
    this.db.transaction(() => {
      for (const k of kinds) {
        if (k.kind !== 'short' && k.kind !== 'long') throw new Error('Kind must be short or long.')
        const days = k.days?.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) ?? []
        this.db
          .prepare(
            `INSERT INTO brand_slot_kinds (brand_id, kind, enabled, days, platforms) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(brand_id, kind) DO UPDATE SET enabled = excluded.enabled, days = excluded.days,
               platforms = CASE WHEN ? THEN excluded.platforms ELSE brand_slot_kinds.platforms END`,
          )
          .run(
            brandId,
            k.kind,
            k.enabled ? 1 : 0,
            days.length ? JSON.stringify(days) : null,
            k.platforms ? JSON.stringify(k.platforms) : null,
            k.platforms === undefined ? 0 : 1,
          )
      }
    })()
    return this.getSlotKinds(brandId)
  }

  setSlots(
    brandId: number,
    slots: Array<Pick<BrandSlot, 'dayType' | 'timeLocal' | 'enabled'> & { kind?: 'short' | 'long' }>,
  ): BrandSlot[] {
    for (const s of slots) {
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(s.timeLocal)) {
        throw new Error(`"${s.timeLocal}" is not a valid time. Use HH:MM, for example 17:00.`)
      }
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM brand_slots WHERE brand_id = ?').run(brandId)
      const ins = this.db.prepare(
        'INSERT INTO brand_slots (brand_id, day_type, time_local, enabled, kind) VALUES (?, ?, ?, ?, ?)',
      )
      // A time with no kind (an older bot or script) counts for both kinds, as before.
      for (const s of slots)
        for (const kind of s.kind ? [s.kind] : (['short', 'long'] as const))
          ins.run(brandId, s.dayType, pad(s.timeLocal), s.enabled ? 1 : 0, kind)
      // The same times go to every platform the kind posts to, so the per-platform times never disagree with this list.
      this.db.prepare('DELETE FROM brand_platform_slots WHERE brand_id = ?').run(brandId)
      this.db
        .prepare(
          `INSERT OR IGNORE INTO brand_platform_slots (brand_id, platform, kind, day_type, time_local, enabled)
           SELECT s.brand_id, p.platform, s.kind, s.day_type, s.time_local, s.enabled
           FROM brand_slots s
           CROSS JOIN (SELECT 'youtube' AS platform UNION ALL SELECT 'instagram' UNION ALL SELECT 'facebook'
                       UNION ALL SELECT 'tiktok' UNION ALL SELECT 'bluesky') p
           LEFT JOIN brand_slot_kinds k ON k.brand_id = s.brand_id AND k.kind = s.kind
           WHERE s.brand_id = ? AND (k.platforms IS NULL OR COALESCE(json_extract(k.platforms, '$.' || p.platform), 1) != 0)`,
        )
        .run(brandId)
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
      instagramShareToFeed: !!r.instagram_share_to_feed,
      aiFlag: {
        youtube: !!r.ai_flag_youtube,
        tiktok: !!r.ai_flag_tiktok,
        facebook: !!r.ai_flag_facebook,
        bluesky: true,
        x: true,
        linkedin: true,
        pinterest: true,
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
         youtube_made_for_kids = ?, youtube_playlist_id = ?, youtube_append_shorts = ?, instagram_share_to_feed = ?, ai_flag_youtube = ?, ai_flag_tiktok = ?,
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
        d.instagramShareToFeed ? 1 : 0,
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

  /** True when the channel posts to this platform through Upload-Post, so its own login's state does not matter. */
  uploadPostOn(brandId: number, platform: string): boolean {
    return uploadPostOn(this.db, brandId, platform)
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
