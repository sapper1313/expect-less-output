import { DateTime } from 'luxon'
import type { Db } from '../db'
import type { BrandService } from '../services/brands'
import type { PostService } from '../services/posts'
import type { UpcomingService } from './upcoming'
import { platformSlotRows, platformSlotsFor, slotKinds } from '../services/channelSettings'
import { readSetting } from '../services/settings'
import { getSlotTimes, pairNearest, slotKindFor, type SlotKind } from '@shared/slots'
import { ZONE } from '@shared/time'
import {
  buildTracker,
  DEFAULT_FLAG_DAYS,
  type TrackerChannelIn,
  type TrackerPostIn,
  type TrackerSlotIn,
  type TrackerView,
} from '@shared/tracker'
import { channelState } from './state'
import { realPlatforms } from './verify'

export interface TrackerDeps {
  db: Db
  brands: BrandService
  posts: PostService
  upcoming: UpcomingService
  now?: () => number
}

const ORDER = ['youtube', 'facebook', 'instagram', 'tiktok', 'bluesky']

/**
 * Reads the Upcoming list, the posts and each platform's slot times and lines them up. Read only: nothing here writes
 * to a post, a slot or the Upcoming file.
 */
export class TrackerService {
  constructor(private d: TrackerDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  /** The platforms a drop should have an entry for: connected, not dry run, and ticked for an enabled kind. */
  private expected(brandId: number, kind?: SlotKind): string[] {
    const real = realPlatforms(this.d.db, brandId)
    const all = slotKinds(this.d.db, brandId).filter((k) => k.enabled)
    // A video of a known kind follows that kind's ticks when the channel has one; otherwise any enabled kind will do.
    const kinds = kind && all.some((k) => k.kind === kind) ? all.filter((k) => k.kind === kind) : all
    const all2 = platformSlotRows(this.d.db, brandId)
    const rows = kind && all2.some((r) => r.kind === kind) ? all2.filter((r) => r.kind === kind) : all2
    return real.filter((p) => {
      if (kinds.length && kinds.every((k) => k.platforms && k.platforms[p] === false)) return false
      if (rows.length && !rows.some((r) => r.platform === p && r.enabled)) return false
      return true
    })
  }

  private shown(brandId: number): string[] {
    const accounts = (
      this.d.db.prepare('SELECT DISTINCT platform FROM accounts WHERE brand_id = ?').all(brandId) as Array<{
        platform: string
      }>
    ).map((r) => r.platform)
    const timed = platformSlotRows(this.d.db, brandId).map((r) => r.platform as string)
    const all = [...new Set([...accounts, ...timed])]
    return all.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b) || a.localeCompare(b))
  }

  /**
   * Empty slots per platform from now to the end of the flag window. A platform's slot is filled by a post entry on that
   * platform near it (the scheduler's own 90 minute match), and an entry that sits off every slot fills one on its day.
   */
  private openSlots(brandId: number, platforms: string[], toUtc: string): TrackerSlotIn[] {
    const nowIso = new Date(this.now()).toISOString()
    const wideFrom = new Date(this.now() - 86_400_000).toISOString()
    const wideTo = new Date(new Date(toUtc).getTime() + 86_400_000).toISOString()
    const rules = this.d.posts.channelRules(brandId)
    const blackoutDates = [...new Set([...readSetting(this.d.db, 'blackoutDates'), ...rules.blackoutDates])]
    const out: TrackerSlotIn[] = []
    const dayOf = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('yyyy-MM-dd')

    if (platformSlotRows(this.d.db, brandId).length === 0) {
      for (const s of this.d.posts.openSlotsInRange(brandId, nowIso, toUtc))
        if (s.kind === 'episode') out.push({ brandId, platform: '*', whenUtc: s.whenUtc })
      return out
    }

    for (const platform of platforms) {
      const ps = platformSlotsFor(this.d.db, brandId, platform)
      if (!ps) continue
      const slots = getSlotTimes({
        slots: ps.slots,
        from: wideFrom,
        to: wideTo,
        weekdays: ps.days ?? this.d.posts.postDays(brandId),
        blackoutDates,
        maxPerDay: rules.maxPerDay,
      })
      const times = (
        this.d.db
          .prepare(
            `SELECT COALESCE(t.target_at_utc, p.scheduled_at_utc) AS t
             FROM post_targets t JOIN posts p ON p.id = t.post_id
             WHERE p.brand_id = ? AND t.platform = ? AND p.post_type = 'episode'
               AND p.status NOT IN ('canceled','draft') AND t.status NOT IN ('skipped','canceled')
               AND COALESCE(t.target_at_utc, p.scheduled_at_utc) IS NOT NULL`,
          )
          .all(brandId, platform) as Array<{ t: string }>
      ).map((r) => r.t)
      const near = pairNearest(slots, times)
      const usedTimes = new Set(near.filter((x) => x !== -1))
      const surplus = new Map<string, number>()
      times.forEach((t, idx) => {
        if (!usedTimes.has(idx)) surplus.set(dayOf(t), (surplus.get(dayOf(t)) ?? 0) + 1)
      })
      slots.forEach((s, idx) => {
        if (near[idx] !== -1 || s < nowIso || s >= toUtc) return
        const d = dayOf(s)
        const left = surplus.get(d) ?? 0
        if (left > 0) {
          surplus.set(d, left - 1)
          return
        }
        out.push({ brandId, platform, whenUtc: s })
      })
    }
    return out
  }

  view(flagDays = DEFAULT_FLAG_DAYS): TrackerView {
    const nowMs = this.now()
    const now = DateTime.fromMillis(nowMs, { zone: ZONE })
    const toUtc = now.plus({ days: flagDays }).endOf('day').toUTC().toISO() as string
    const channels: TrackerChannelIn[] = []
    const openSlots: TrackerSlotIn[] = []
    for (const b of this.d.brands.list(false)) {
      if (!b.slug) continue
      const state = channelState(this.d.db, b.id)
      if (state === 'archived') continue
      const expected = this.expected(b.id)
      const waiting = (
        this.d.db
          .prepare(
            `SELECT COUNT(*) AS n FROM posts WHERE brand_id = ? AND origin = 'inbox' AND status = 'draft'
             AND hold_reason IS NULL AND post_type = 'episode' AND media_purged_at IS NULL`,
          )
          .get(b.id) as { n: number }
      ).n
      channels.push({
        brandId: b.id,
        slug: b.slug,
        name: b.name,
        color: b.color,
        state,
        shown: this.shown(b.id),
        expected,
        waiting,
      })
      if (state === 'active') openSlots.push(...this.openSlots(b.id, expected, toUtc))
    }

    const entries = this.d.upcoming
      .view()
      .rows.filter((r) => r.post_type !== 'clip')
      .map((r) => ({
        channel: r.channel,
        episode_id: r.episode_id,
        working_title: r.working_title,
        status: r.status,
        ...(r.air_date ? { air_date: r.air_date } : {}),
      }))

    // Entries not yet dropped are matched to their post however old it is (an old entry ELO never linked).
    const open = entries.filter((e) => e.status !== 'dropped').map((e) => e.episode_id)
    const cutoff = new Date(nowMs - 14 * 86_400_000).toISOString()
    const rows = this.d.db
      .prepare(
        `SELECT id, brand_id, episode_ref, status, scheduled_at_utc, video_meta_json FROM posts
         WHERE post_type = 'episode' AND episode_ref IS NOT NULL AND status != 'canceled'
           AND (scheduled_at_utc IS NULL OR scheduled_at_utc >= ? OR status IN ('draft','scheduled','in_progress','partial')
                OR episode_ref IN (${open.map(() => '?').join(',') || 'NULL'}))`,
      )
      .all(cutoff, ...open) as Array<{
      id: number
      brand_id: number
      episode_ref: string
      status: string
      scheduled_at_utc: string | null
      video_meta_json: string | null
    }>
    const targets = this.d.db
      .prepare(
        `SELECT post_id, platform, status, target_at_utc FROM post_targets WHERE post_id IN (${rows.map(() => '?').join(',') || 'NULL'})`,
      )
      .all(...rows.map((r) => r.id)) as Array<{
      post_id: number
      platform: string
      status: string
      target_at_utc: string | null
    }>
    const kindOf = (json: string | null): SlotKind | undefined => {
      try {
        return json ? slotKindFor(JSON.parse(json)) : undefined
      } catch {
        return undefined
      }
    }
    const posts: TrackerPostIn[] = rows.map((r) => ({
      expected: this.expected(r.brand_id, kindOf(r.video_meta_json)),
      id: r.id,
      brandId: r.brand_id,
      episodeRef: r.episode_ref,
      status: r.status,
      scheduledAtUtc: r.scheduled_at_utc,
      targets: targets
        .filter((t) => t.post_id === r.id)
        .map((t) => ({ platform: t.platform, status: t.status, atUtc: t.target_at_utc })),
    }))

    return buildTracker({ nowMs, flagDays, channels, entries, posts, openSlots })
  }
}
