import type { Db } from '../db'
import type { ChannelOverrides, PlatformSlot, Settings } from '@shared/types'
import type { SlotDef, SlotKind } from '@shared/slots'

export interface SlotKindRow {
  kind: SlotKind
  enabled: boolean
  /** ISO weekdays (1 Monday to 7 Sunday) this kind posts on. Null means the channel's usual days. */
  days: number[] | null
  /** Platforms this kind posts to. A platform that is false is skipped. Null means the old Studio ticks. */
  platforms: Record<string, boolean> | null
}

/** The kinds a channel makes (Shorts, Long form, or both). A channel with no rows yet uses every time it has. */
export function slotKinds(db: Db, brandId: number): SlotKindRow[] {
  return (
    db
      .prepare(
        'SELECT kind, enabled, days, platforms FROM brand_slot_kinds WHERE brand_id = ? ORDER BY kind DESC',
      )
      .all(brandId) as Array<{ kind: SlotKind; enabled: number; days: string | null; platforms: string | null }>
  ).map((r) => {
    let days: number[] | null = null
    try {
      const d = r.days ? (JSON.parse(r.days) as unknown) : null
      if (Array.isArray(d))
        days = d.filter((x): x is number => Number.isInteger(x) && x >= 1 && x <= 7)
    } catch {
      days = null
    }
    let platforms: Record<string, boolean> | null = null
    try {
      const x = r.platforms ? (JSON.parse(r.platforms) as unknown) : null
      if (x && typeof x === 'object' && !Array.isArray(x)) platforms = x as Record<string, boolean>
    } catch {
      platforms = null
    }
    return { kind: r.kind, enabled: !!r.enabled, days: days?.length ? days : null, platforms }
  })
}

/** Which kind's times a video uses. Only one kind ticked means every video uses it. */
export function kindToUse(rows: SlotKindRow[], want: SlotKind | undefined): SlotKind | null {
  const on = rows.filter((r) => r.enabled).map((r) => r.kind)
  if (on.length === 0) return null // nothing ticked yet: use every time the channel has
  if (want && on.includes(want)) return want
  return on.length === 1 ? on[0]! : (want ?? null)
}

/** The posting times a video of this kind should use, and the days that kind posts on (null means the usual days). */
export function slotsForKind(
  db: Db,
  brandId: number,
  want?: SlotKind,
): { slots: SlotDef[]; days: number[] | null } {
  const rows = slotKinds(db, brandId)
  const use = kindToUse(rows, want)
  const all = db.prepare('SELECT * FROM brand_slots WHERE brand_id = ?').all(brandId) as any[]
  const picked = use ? all.filter((r) => r.kind === use) : all
  const slots = (picked.length ? picked : all).map<SlotDef>((r) => ({
    dayType: r.day_type,
    timeLocal: r.time_local,
    enabled: !!r.enabled,
  }))
  return { slots, days: use ? (rows.find((r) => r.kind === use)?.days ?? null) : null }
}

/** All of a channel's per-platform posting times. Empty when the channel has not been set up per platform yet. */
export function platformSlotRows(db: Db, brandId: number): PlatformSlot[] {
  return (
    db
      .prepare(
        'SELECT platform, kind, day_type, time_local, enabled FROM brand_platform_slots WHERE brand_id = ? ORDER BY platform, kind, day_type DESC, time_local',
      )
      .all(brandId) as any[]
  ).map((r) => ({
    platform: r.platform,
    kind: r.kind,
    dayType: r.day_type,
    timeLocal: r.time_local,
    enabled: !!r.enabled,
  }))
}

/**
 * The times one platform uses for a video of this kind, and the days that kind posts on.
 * Returns null when the channel has no per-platform times at all (an older channel): the caller then uses the channel's
 * one list for every platform, as before.
 */
export function platformSlotsFor(
  db: Db,
  brandId: number,
  platform: string,
  want?: SlotKind,
): { slots: SlotDef[]; days: number[] | null } | null {
  const rows = platformSlotRows(db, brandId)
  if (rows.length === 0) return null
  const kinds = slotKinds(db, brandId)
  const use = kindToUse(kinds, want)
  const picked = rows.filter((r) => r.platform === platform && (!use || r.kind === use))
  return {
    slots: picked.map<SlotDef>((r) => ({ dayType: r.dayType, timeLocal: r.timeLocal, enabled: r.enabled })),
    days: use ? (kinds.find((k) => k.kind === use)?.days ?? null) : null,
  }
}

/**
 * The channel's combined list: for each kind and day type, position 1 is the earliest first time of any platform,
 * position 2 the earliest second time, and so on. A video's first platform time lines up with these, so the Home week
 * map and the bots see one slot per video instead of one per platform.
 */
export function primarySlots(rows: PlatformSlot[]): Array<{ kind: SlotKind; dayType: 'weekday' | 'weekend'; timeLocal: string; enabled: boolean }> {
  const out: Array<{ kind: SlotKind; dayType: 'weekday' | 'weekend'; timeLocal: string; enabled: boolean }> = []
  for (const kind of ['short', 'long'] as const)
    for (const dayType of ['weekday', 'weekend'] as const) {
      const byPlatform = new Map<string, string[]>()
      for (const r of rows)
        if (r.kind === kind && r.dayType === dayType && r.enabled)
          byPlatform.set(r.platform, [...(byPlatform.get(r.platform) ?? []), r.timeLocal.padStart(5, '0')])
      const lists = [...byPlatform.values()].map((l) => l.sort())
      const most = Math.max(0, ...lists.map((l) => l.length))
      for (let i = 0; i < most; i++) {
        const t = lists.filter((l) => l.length > i).map((l) => l[i]!).sort()[0]!
        out.push({ kind, dayType, timeLocal: t, enabled: true })
      }
    }
  return out
}

/** Settings a channel may set for itself. No row means it follows the app wide setting. */
export const BRAND_OVERRIDE_KEYS = [
  'schedulingMode',
  'handoffHoursYoutube',
  'handoffHoursFacebook',
  'missedBehavior',
  'missedGraceMinutes',
] as const
export type BrandOverrideKey = (typeof BRAND_OVERRIDE_KEYS)[number]
export type BrandOverrides = Partial<Pick<Settings, BrandOverrideKey>>

export function brandOverrides(db: Db, brandId: number): BrandOverrides {
  const out: Record<string, unknown> = {}
  for (const r of db
    .prepare('SELECT key, value FROM brand_overrides WHERE brand_id = ?')
    .all(brandId) as Array<{ key: string; value: string }>) {
    if (!(BRAND_OVERRIDE_KEYS as readonly string[]).includes(r.key)) continue
    try {
      out[r.key] = JSON.parse(r.value)
    } catch {
      /* ignore a damaged row */
    }
  }
  return out as BrandOverrides
}

/** The value this channel really uses: its own, or the app wide one. */
export function effectiveBrandSettings(
  db: Db,
  brandId: number,
  settings: Settings,
): BrandOverrides & Pick<Settings, BrandOverrideKey> {
  return { ...pick(settings), ...brandOverrides(db, brandId) } as Pick<Settings, BrandOverrideKey>
}

function pick(s: Settings): Pick<Settings, BrandOverrideKey> {
  return {
    schedulingMode: s.schedulingMode,
    handoffHoursYoutube: s.handoffHoursYoutube,
    handoffHoursFacebook: s.handoffHoursFacebook,
    missedBehavior: s.missedBehavior,
    missedGraceMinutes: s.missedGraceMinutes,
  }
}

/** Sets a channel's own value. null puts the channel back on the app wide setting. */
export function setBrandOverrides(
  db: Db,
  brandId: number,
  patch: { [K in BrandOverrideKey]?: Settings[K] | null },
): void {
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(BRAND_OVERRIDE_KEYS as readonly string[]).includes(k))
        throw new Error(`${k} is not a setting a channel can have for itself.`)
      if (v === null || v === undefined)
        db.prepare('DELETE FROM brand_overrides WHERE brand_id = ? AND key = ?').run(brandId, k)
      else
        db.prepare(
          'INSERT INTO brand_overrides (brand_id, key, value) VALUES (?, ?, ?) ON CONFLICT(brand_id, key) DO UPDATE SET value = excluded.value',
        ).run(brandId, k, JSON.stringify(v))
    }
  })()
}

export function channelOverrides(db: Db, brandId: number, settings: Settings): ChannelOverrides {
  return {
    values: effectiveBrandSettings(db, brandId, settings),
    own: Object.keys(brandOverrides(db, brandId)),
  }
}
