import { existsSync } from 'fs'
import type { Db } from '../db'
import type { Library } from './library'
import type { ActivityLog } from './activity'
import type { MediaService } from './media'
import { getNextOpenSlots, getSlotTimes, pairNearest, type SlotDef, type SlotKind } from '@shared/slots'
import { kindToUse, platformSlotRows, platformSlotsFor, slotKinds, slotsForKind } from './channelSettings'
import { derivePostStatus } from '@shared/scheduling'
import { readSetting } from './settings'
import { PLATFORM_LIMITS, durationProblem } from '@shared/platformLimits'
import type { SendSchedule } from '@shared/sendSchedule'
import { tiktokSettingsProblem } from '@shared/tiktok'
import { DateTime } from 'luxon'
import { staggerOffsets } from '@shared/growth'
import { ZONE } from '@shared/time'
import type {
  Post,
  PostFilter,
  PostInput,
  PostStatus,
  PostTarget,
  PostTargetInput,
  PostUpdate,
  TargetSettings,
  Platform,
  TargetStatus,
} from '@shared/types'

interface PostRow {
  id: number
  brand_id: number
  brand_name: string
  brand_color: string
  video_path: string
  video_meta_json: string
  poster_path: string | null
  title: string
  caption: string
  scheduled_at_utc: string | null
  status: PostStatus
  created_at: string
  updated_at: string
  episode_ref: string | null
  origin: 'manual' | 'inbox' | 'api'
  hold_reason: string | null
  checksum: string | null
  source_bot: string | null
  sidecar_title: string | null
  video_basename: string | null
  post_type: 'episode' | 'clip'
  source_episode_ref: string | null
  channel_link: number
  related_done: number
  first_comment: string | null
}

/** When a platform posts: its own time (or the post's time) plus its small stagger, so platforms on one slot go a few minutes apart. */
export function targetTime(own: string | null, base: string | null, staggerMin: number | null): string | null {
  const at = own ?? base
  if (!at) return null
  return new Date(new Date(at).getTime() + (staggerMin ?? 0) * 60_000).toISOString()
}

/** The post's own time: the earliest of its time and every platform time it was given. */
export function baseTime(post: string | null, targets: Array<{ scheduledAtUtc?: string | null }>): string | null {
  const all = [post, ...targets.map((t) => t.scheduledAtUtc ?? null)].filter((x): x is string => !!x)
  return all.length ? all.reduce((a, b) => (a < b ? a : b)) : null
}

const POST_SELECT = `SELECT p.*, b.name AS brand_name, b.color AS brand_color
  FROM posts p JOIN brands b ON b.id = p.brand_id`

/** Statuses that reserve a slot for a brand. */
const RESERVING = ['scheduled', 'in_progress', 'partial']

export class PostService {
  constructor(
    private db: Db,
    private library: Library,
    private media: MediaService | null,
    private log: ActivityLog,
    private emit: () => void = () => {},
    private now: () => number = Date.now,
  ) {}

  // ---------- reading ----------

  private mapTarget(r: any, base: string | null = null): PostTarget {
    return {
      id: r.id,
      postId: r.post_id,
      platform: r.platform,
      accountId: r.account_id,
      captionOverride: r.caption_override,
      aiFlag: !!r.ai_flag,
      status: r.status,
      externalId: r.external_id,
      externalUrl: r.external_url,
      attempts: r.attempts,
      nextAttemptAtUtc: r.next_attempt_at_utc,
      lastError: r.last_error,
      handedOffAtUtc: r.handed_off_at_utc,
      postedAtUtc: r.posted_at_utc,
      progress: progressOf(r.settings_json),
      checklist: stateOf(r.settings_json).checklist ?? null,
      settings: {
        shorts: stateOf(r.settings_json).shorts,
        thumbOffsetMs: stateOf(r.settings_json).thumbOffsetMs,
        tiktok: stateOf(r.settings_json).tiktok,
        thumbnailPath: stateOf(r.settings_json).thumbnailPath,
        coverTimestampMs: stateOf(r.settings_json).coverTimestampMs,
        coverUrl: stateOf(r.settings_json).coverUrl,
        mock: stateOf(r.settings_json).mock,
        firstComment: stateOf(r.settings_json).firstComment,
      },
      firstComment: null,
      scheduledAtUtc: targetTime(r.target_at_utc, base, r.stagger_offset_min),
    }
  }

  private mapPost(r: PostRow, targets: PostTarget[]): Post {
    return {
      id: r.id,
      brandId: r.brand_id,
      brandName: r.brand_name,
      brandColor: r.brand_color,
      videoPath: r.video_path,
      fileName: r.video_path.split('/').pop() ?? r.video_path,
      videoMeta: safeParse(r.video_meta_json),
      posterUrl: r.poster_path ? `elo-media://poster/${r.poster_path}` : null,
      title: r.title,
      caption: r.caption,
      scheduledAtUtc: r.scheduled_at_utc,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      targets,
      episodeRef: r.episode_ref,
      origin: r.origin,
      holdReason: r.hold_reason,
      checksum: r.checksum,
      sourceBot: r.source_bot,
      sidecarTitle: r.sidecar_title,
      videoBasename: r.video_basename,
      postType: r.post_type ?? 'episode',
      sourceEpisodeRef: r.source_episode_ref,
      relatedVideo: this.relatedFor(r),
      firstComment: r.first_comment ?? null,
    }
  }

  /** The reminder for a clip's YouTube Short: set the Related video by hand, with the link to its episode. */
  private relatedFor(r: PostRow): Post['relatedVideo'] {
    if (r.post_type !== 'clip' || !r.source_episode_ref) return null
    const hasYoutube = this.db
      .prepare("SELECT 1 FROM post_targets WHERE post_id = ? AND platform = 'youtube'")
      .get(r.id)
    if (!hasYoutube) return null
    const live = this.db
      .prepare(
        `SELECT t.external_url AS url FROM posts p JOIN post_targets t ON t.post_id = p.id
         WHERE p.brand_id = ? AND p.episode_ref = ? AND p.post_type = 'episode'
           AND t.platform = 'youtube' AND t.status = 'posted' AND t.external_url IS NOT NULL
         ORDER BY t.id DESC LIMIT 1`,
      )
      .get(r.brand_id, r.source_episode_ref) as { url: string } | undefined
    return { episodeId: r.source_episode_ref, url: live?.url ?? null, done: !!r.related_done }
  }

  /**
   * Swaps the video of a post that has not gone out, keeping its slot. The new file goes in the Queue (named after the
   * episode id), the old one is moved to <Brand>/Replaced (never deleted), and the checksum, length and poster follow.
   * A new title also becomes the title the bot-drop safety check compares with. A new description replaces the caption.
   */
  async replaceMedia(
    id: number,
    o: { sourcePath: string; checksum: string; title?: string; description?: string },
  ): Promise<{ oldRel: string; oldChecksum: string | null; newRel: string; fileName: string }> {
    const row = this.db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as PostRow | undefined
    if (!row) throw new Error('Post not found.')
    const brand = this.brandName(row.brand_id)
    let meta = row.video_meta_json
    let poster = row.poster_path
    if (this.media) {
      const m = await this.media.probe(o.sourcePath)
      meta = JSON.stringify(m)
      poster = await this.media.poster(o.sourcePath, m.durationSeconds)
    }
    const stem =
      row.episode_ref ?? (row.video_path.split('/').pop() ?? 'video').replace(/\.[^.]+$/, '')
    const ext = (o.sourcePath.match(/\.[^.]+$/)?.[0] ?? '.mp4').toLowerCase()
    const newRel = this.library.importToQueueAs(brand, o.sourcePath, `${stem}${ext}`)
    const fileName = newRel.split('/').pop() as string
    try {
      this.db.transaction(() => {
        const title = o.title ?? row.title
        this.db
          .prepare(
            `UPDATE posts SET video_path = ?, video_meta_json = ?, poster_path = ?, checksum = ?, video_basename = ?,
             title = ?, sidecar_title = CASE WHEN episode_ref IS NOT NULL THEN ? ELSE sidecar_title END,
             caption = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            newRel,
            meta,
            poster,
            o.checksum,
            row.episode_ref ? fileName : row.video_basename,
            title,
            title,
            o.description ?? row.caption,
            new Date().toISOString(),
            id,
          )
        // Platforms that have not got the video yet start fresh: drop old upload sessions and containers.
        const stale = this.db
          .prepare(
            "SELECT id, settings_json FROM post_targets WHERE post_id = ? AND status IN ('pending','failed','needs_action')",
          )
          .all(id) as { id: number; settings_json: string | null }[]
        for (const t of stale) {
          let keep: Record<string, unknown> = {}
          try {
            const cur = JSON.parse(t.settings_json || '{}') as Record<string, unknown>
            if (cur.checklist !== undefined) keep = { checklist: cur.checklist }
          } catch {
            // unreadable state is dropped
          }
          this.db
            .prepare('UPDATE post_targets SET settings_json = ? WHERE id = ?')
            .run(JSON.stringify(keep), t.id)
        }
        if (o.description !== undefined)
          this.db
            .prepare(
              "UPDATE post_targets SET caption_override = ? WHERE post_id = ? AND caption_override IS NOT NULL AND caption_override != ''",
            )
            .run(o.description, id)
      })()
    } catch (e) {
      this.library.removeIfInside(newRel)
      throw e
    }
    let oldRel = row.video_path
    try {
      oldRel = this.library.moveToReplaced(row.video_path, brand)
    } catch {
      // The old file stays where it was. The post already points at the new one.
    }
    this.log.log('info', `Media replaced for "${o.title ?? row.title}".`, { postId: id })
    this.emit()
    return { oldRel, oldChecksum: row.checksum, newRel, fileName }
  }

  /** Keeps a thumbnail picture on a target, used when the video is uploaded. */
  setTargetThumbnail(targetId: number, path: string): void {
    const row = this.db
      .prepare('SELECT settings_json FROM post_targets WHERE id = ?')
      .get(targetId) as { settings_json: string | null } | undefined
    let st: Record<string, unknown> = {}
    try {
      st = JSON.parse(row?.settings_json ?? '{}') as Record<string, unknown>
    } catch {
      st = {}
    }
    this.db
      .prepare('UPDATE post_targets SET settings_json = ? WHERE id = ?')
      .run(JSON.stringify({ ...st, thumbnailPath: path }), targetId)
    this.emit()
  }

  /** The owner set the Related video in YouTube Studio, so the reminder goes away. */
  setRelatedDone(id: number, done: boolean): void {
    this.db.prepare('UPDATE posts SET related_done = ? WHERE id = ?').run(done ? 1 : 0, id)
    this.emit()
  }

  private attachTargets(rows: PostRow[]): Post[] {
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    const targets = this.db
      .prepare(
        `SELECT * FROM post_targets WHERE post_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
      )
      .all(...ids) as any[]
    const byPost = new Map<number, PostTarget[]>()
    const jobs = new Map(
      (
        this.db
          .prepare(
            `SELECT * FROM first_comment_jobs WHERE post_id IN (${ids.map(() => '?').join(',')})`,
          )
          .all(...ids) as any[]
      ).map((j) => [j.target_id as number, j]),
    )
    for (const t of targets) {
      const list = byPost.get(t.post_id) ?? []
      const mapped = this.mapTarget(t, rows.find((r) => r.id === t.post_id)?.scheduled_at_utc ?? null)
      const j = jobs.get(t.id)
      if (j)
        mapped.firstComment = {
          text: j.text,
          status: j.status,
          error: j.last_error,
          doneAtUtc: j.done_at_utc,
        }
      list.push(mapped)
      byPost.set(t.post_id, list)
    }
    return rows.map((r) => this.mapPost(r, byPost.get(r.id) ?? []))
  }

  get(id: number): Post | null {
    const row = this.db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(id) as PostRow | undefined
    return row ? this.attachTargets([row])[0] : null
  }

  list(filter: PostFilter = {}): Post[] {
    // Posts whose video was removed by retention leave the active queue. The row stays for its stats.
    const where: string[] = ['p.media_purged_at IS NULL']
    const args: unknown[] = []
    if (filter.search?.trim()) {
      const like = `%${filter.search.trim().replace(/[\\%_]/g, (c) => '\\' + c)}%`
      where.push(
        "(p.title LIKE ? ESCAPE '\\' OR p.caption LIKE ? ESCAPE '\\' OR p.video_path LIKE ? ESCAPE '\\')",
      )
      args.push(like, like, like)
    }
    if (filter.brandId) {
      where.push('p.brand_id = ?')
      args.push(filter.brandId)
    }
    if (!filter.brandId && !filter.includeArchived) where.push('b.archived = 0')
    if (filter.postType) {
      where.push('p.post_type = ?')
      args.push(filter.postType)
    }
    if (filter.origin) {
      where.push('p.origin = ?')
      args.push(filter.origin)
    }
    if (filter.pastDue === true) {
      where.push("p.status = 'scheduled' AND p.scheduled_at_utc < ?")
      args.push(new Date(this.now()).toISOString())
    }
    if (filter.held === true) where.push('p.hold_reason IS NOT NULL')
    if (filter.held === false) where.push('p.hold_reason IS NULL')
    const st = filter.status
    if (st && st !== 'all') {
      if (st === 'upcoming')
        where.push("p.status IN ('scheduled','in_progress','partial','missed','draft')")
      else if (st === 'recent') where.push("p.status IN ('posted','failed','canceled')")
      else if (st === 'live')
        where.push("EXISTS (SELECT 1 FROM post_targets lt WHERE lt.post_id = p.id AND lt.status = 'posted')")
      else {
        where.push('p.status = ?')
        args.push(st)
      }
    }
    if (filter.platform) {
      where.push('EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = p.id AND t.platform = ?)')
      args.push(filter.platform)
    }
    if (filter.fromUtc) {
      where.push('p.scheduled_at_utc >= ?')
      args.push(filter.fromUtc)
    }
    if (filter.toUtc) {
      where.push('p.scheduled_at_utc < ?')
      args.push(filter.toUtc)
    }
    const sql = `${POST_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE WHEN p.scheduled_at_utc IS NULL THEN 1 ELSE 0 END, p.scheduled_at_utc, p.id`
    return this.attachTargets(this.db.prepare(sql).all(...args) as PostRow[])
  }

  // ---------- slots ----------

  /** Times a platform already uses for this channel: its own times, or the post's time for older posts. */
  private platformTimes(brandId: number, platform: string, postStatuses: readonly string[]): string[] {
    return (
      this.db
        .prepare(
          `SELECT COALESCE(t.target_at_utc, p.scheduled_at_utc) AS t
           FROM post_targets t JOIN posts p ON p.id = t.post_id
           WHERE p.brand_id = ? AND t.platform = ? AND p.post_type = 'episode' AND p.scheduled_at_utc IS NOT NULL
             AND (p.status IN (${postStatuses.map(() => '?').join(',')}) OR t.status = 'posted') AND t.status != 'skipped'`,
        )
        .all(brandId, platform, ...postStatuses) as Array<{ t: string }>
    ).map((r) => r.t)
  }

  /** The platforms a channel posts to for a kind (ticked on Setup Channels) that have posting times of their own. */
  private slotPlatforms(brandId: number, kind?: SlotKind): string[] | null {
    const rows = platformSlotRows(this.db, brandId)
    if (rows.length === 0) return null
    const kinds = slotKinds(this.db, brandId)
    const use = kindToUse(kinds, kind)
    const ticks = use ? kinds.find((k) => k.kind === use)?.platforms : null
    return [...new Set(rows.filter((r) => r.enabled && (!use || r.kind === use)).map((r) => r.platform as string))].filter(
      (p) => ticks?.[p] !== false,
    )
  }

  /**
   * The next open times for ONE platform of a channel. Each platform has its own weekday and weekend times, and a time
   * another platform uses does not count against it. `kind` is the kind of the video (Shorts or Long form).
   */
  nextSlotsFor(
    brandId: number,
    platform: Platform,
    count: number,
    fromUtc?: string,
    extraTaken: string[] = [],
    kind?: SlotKind,
  ): string[] {
    const ps = platformSlotsFor(this.db, brandId, platform, kind)
    if (!ps) return this.legacyNextSlots(brandId, count, fromUtc, extraTaken, kind)
    const rules = this.channelRules(brandId)
    return getNextOpenSlots({
      slots: ps.slots,
      taken: [...this.platformTimes(brandId, platform, RESERVING), ...extraTaken],
      count,
      from: fromUtc ?? new Date(this.now()).toISOString(),
      weekdays: ps.days ?? this.postDays(brandId),
      blackoutDates: [...new Set([...readSetting(this.db, 'blackoutDates'), ...rules.blackoutDates])],
      maxPerDay: rules.maxPerDay,
      alsoCounted: this.platformTimes(brandId, platform, ['posted']),
    })
  }

  /**
   * The next open times for a channel when no platform is named: any time that at least one of its platforms can use,
   * soonest first. Used by lists that just need "a time" (the Bulk screen, Home, bots).
   */
  nextSlots(brandId: number, count: number, fromUtc?: string, extraTaken: string[] = [], kind?: SlotKind): string[] {
    const platforms = this.slotPlatforms(brandId, kind)
    if (platforms === null) return this.legacyNextSlots(brandId, count, fromUtc, extraTaken, kind)
    const all = new Set<string>()
    for (const p of platforms)
      for (const s of this.nextSlotsFor(brandId, p as Platform, count, fromUtc, extraTaken, kind)) all.add(s)
    return [...all].sort().slice(0, count)
  }

  /**
   * One time for every platform of each of the next `count` videos. Every platform takes its own next open time, so
   * two platforms of one video can sit at different times, and a platform whose time is taken moves only itself.
   * A platform with no times of its own follows the channel's combined list.
   */
  slotPlans(
    brandId: number,
    count: number,
    kind: SlotKind | undefined,
    platforms: Platform[],
    fromUtc?: string,
  ): Array<Partial<Record<Platform, string>>> {
    let combined: string[] | null = null
    const lists = new Map<Platform, string[]>()
    for (const p of platforms) {
      const own = platformSlotsFor(this.db, brandId, p, kind)
      if (own && own.slots.some((x) => x.enabled)) lists.set(p, this.nextSlotsFor(brandId, p, count, fromUtc, [], kind))
      else lists.set(p, (combined ??= this.nextSlots(brandId, count, fromUtc, [], kind)))
    }
    const out: Array<Partial<Record<Platform, string>>> = []
    for (let i = 0; i < count; i++) {
      const plan: Partial<Record<Platform, string>> = {}
      for (const p of platforms) {
        const t = lists.get(p)?.[i]
        if (t) plan[p] = t
      }
      if (Object.keys(plan).length === 0) break
      out.push(plan)
    }
    return out
  }

  /** The channel's one list of times, for a channel that has no per-platform times. */
  private legacyNextSlots(brandId: number, count: number, fromUtc?: string, extraTaken: string[] = [], kind?: SlotKind): string[] {
    const { slots, days: kindDays } = slotsForKind(this.db, brandId, kind)
    const taken = (
      this.db
        .prepare(
          `SELECT scheduled_at_utc AS t FROM posts WHERE brand_id = ? AND scheduled_at_utc IS NOT NULL
           AND post_type = 'episode' AND status IN (${RESERVING.map(() => '?').join(',')})`,
        )
        .all(brandId, ...RESERVING) as Array<{ t: string }>
    ).map((r) => r.t)
    const rules = this.channelRules(brandId)
    const sent = (
      this.db
        .prepare(
          "SELECT scheduled_at_utc AS t FROM posts WHERE brand_id = ? AND scheduled_at_utc IS NOT NULL AND post_type = 'episode' AND status = 'posted'",
        )
        .all(brandId) as Array<{ t: string }>
    ).map((r) => r.t)
    return getNextOpenSlots({
      slots,
      taken: [...taken, ...extraTaken],
      count,
      from: fromUtc ?? new Date(this.now()).toISOString(),
      weekdays: kindDays ?? this.postDays(brandId),
      blackoutDates: [...new Set([...readSetting(this.db, 'blackoutDates'), ...rules.blackoutDates])],
      maxPerDay: rules.maxPerDay,
      alsoCounted: sent,
    })
  }

  /**
   * The slots of a channel inside a window that have nothing in them, for the Calendar. Episode slots come from the
   * channel's slot times and days, clip slots from its clip days and time. A slot with a post in it is left out (the post
   * is shown instead), and so is a slot the daily limit has already used up. Only slots that are still ahead are listed.
   */
  openSlotsInRange(
    brandId: number,
    fromUtc: string,
    toUtc: string,
  ): Array<{ whenUtc: string; kind: 'episode' | 'clip'; blockedBy?: string }> {
    const now = new Date(this.now()).toISOString()
    const from = fromUtc > now ? fromUtc : now
    if (from >= toUtc) return []
    const rules = this.channelRules(brandId)
    const blackoutDates = [
      ...new Set([...readSetting(this.db, 'blackoutDates'), ...rules.blackoutDates]),
    ]
    // Only the kinds the channel makes have slots. A kind that is switched off (Long form on a Shorts channel) never
    // gets a post, so its times are not empty slots, they do not exist. No kind ticked at all means every time counts.
    const kindRows = slotKinds(this.db, brandId)
    const onKinds = kindRows.filter((k) => k.enabled)
    const slotRows = this.db.prepare('SELECT * FROM brand_slots WHERE brand_id = ?').all(brandId) as any[]
    // Like the scheduler: a kind with no times of its own uses the channel's whole list.
    const slotsOf = (kind?: string) =>
      (kind && slotRows.some((r) => r.kind === kind) ? slotRows.filter((r) => r.kind === kind) : slotRows)
        .map<SlotDef>((r) => ({ dayType: r.day_type, timeLocal: r.time_local, enabled: !!r.enabled }))
    const used = (type: 'episode' | 'clip') =>
      (
        this.db
          .prepare(
            `SELECT scheduled_at_utc AS t FROM posts WHERE brand_id = ? AND post_type = ? AND scheduled_at_utc IS NOT NULL
             AND scheduled_at_utc >= ? AND scheduled_at_utc < ? AND status NOT IN ('canceled','draft')`,
          )
          .all(
            brandId,
            type,
            `${fromUtc.slice(0, 10)}T00:00:00.000Z`,
            `${toUtc.slice(0, 10)}T23:59:59.999Z`,
          ) as Array<{
          t: string
        }>
      ).map((r) => r.t)
    // Posts are placed per platform, so a queued post sits at each platform's own time, and its post time is only its
    // earliest one. A slot a platform target sits on is filled, the same test the scheduler uses to skip a taken time.
    const targetMinutes = new Set(
      (
        this.db
          .prepare(
            `SELECT COALESCE(t.target_at_utc, p.scheduled_at_utc) AS t
             FROM post_targets t JOIN posts p ON p.id = t.post_id
             WHERE p.brand_id = ? AND p.post_type = 'episode' AND p.status NOT IN ('canceled','draft')
               AND t.status NOT IN ('skipped','canceled') AND COALESCE(t.target_at_utc, p.scheduled_at_utc) IS NOT NULL`,
          )
          .all(brandId) as Array<{ t: string }>
      ).map((r) => r.t.slice(0, 16)),
    )
    const out: Array<{ whenUtc: string; kind: 'episode' | 'clip'; blockedBy?: string }> = []
    const gapMs = 0
    const blockerOf = (_iso: string): string | undefined => undefined
    const dayOf = (iso: string) =>
      DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('yyyy-MM-dd')
    const collect = (kind: 'episode' | 'clip', all: string[], cap: number) => {
      const taken = used(kind)
      const takenMinutes = new Set(taken.map((t) => t.slice(0, 16)))
      const perDay = new Map<string, number>()
      for (const t of taken) perDay.set(dayOf(t), (perDay.get(dayOf(t)) ?? 0) + 1)
      // A post close to a slot fills it, even when it sits a few minutes off (its earliest platform time).
      const near = pairNearest(all, taken)
      const filledNear = new Set(all.filter((_, i) => near[i] !== -1))
      const onTarget = (s: string) => kind === 'episode' && targetMinutes.has(s.slice(0, 16))
      // Slots already filled by a platform target count toward the daily limit first.
      for (const s of all) if (onTarget(s) && !takenMinutes.has(s.slice(0, 16)) && !filledNear.has(s)) perDay.set(dayOf(s), (perDay.get(dayOf(s)) ?? 0) + 1)
      for (const s of all) {
        if (s < from || takenMinutes.has(s.slice(0, 16)) || filledNear.has(s) || onTarget(s)) continue
        const d = dayOf(s)
        const n = perDay.get(d) ?? 0
        if (cap > 0 && n >= cap) continue
        perDay.set(d, n + 1)
        const by = kind === 'episode' && gapMs ? blockerOf(s) : undefined
        out.push(by ? { whenUtc: s, kind, blockedBy: by } : { whenUtc: s, kind })
      }
    }
    // Look a day wider on both sides so a slot near midnight is judged against the right day.
    const wideFrom = new Date(new Date(fromUtc).getTime() - 86_400_000).toISOString()
    const wideTo = new Date(new Date(toUtc).getTime() + 86_400_000).toISOString()
    const episodeTimes = new Set<string>()
    for (const k of onKinds.length ? onKinds : [null]) {
      for (const t of getSlotTimes({
        slots: slotsOf(k?.kind),
        from: wideFrom,
        to: wideTo,
        weekdays: k?.days ?? this.postDays(brandId),
        blackoutDates,
        maxPerDay: rules.maxPerDay,
      }))
        if (t < toUtc) episodeTimes.add(t)
    }
    collect('episode', [...episodeTimes].sort(), rules.maxPerDay)
    const clip = this.clipSchedule(brandId)
    if (clip.days.length)
      collect(
        'clip',
        getSlotTimes({
          slots: [
            { dayType: 'weekday', timeLocal: clip.time, enabled: true },
            { dayType: 'weekend', timeLocal: clip.time, enabled: true },
          ],
          from: wideFrom,
          to: wideTo,
          weekdays: clip.days,
          blackoutDates,
          maxPerDay: 1,
        }).filter((s) => s < toUtc),
        1,
      )
    return out.sort((a, b) => a.whenUtc.localeCompare(b.whenUtc))
  }

  /** A channel's clip days (1 = Monday to 7 = Sunday) and time, from its Studio settings. Empty days means no clip slots. */
  clipSchedule(brandId: number): { days: number[]; time: string } {
    const row = this.db
      .prepare('SELECT config_json FROM studio_brands WHERE brand_id = ?')
      .get(brandId) as { config_json: string } | undefined
    try {
      const c = JSON.parse(row?.config_json ?? '{}') as {
        clipPostDays?: unknown
        clipTime?: unknown
      }
      const days = Array.isArray(c.clipPostDays)
        ? c.clipPostDays.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7)
        : []
      const time =
        typeof c.clipTime === 'string' && /^\d{1,2}:\d{2}$/.test(c.clipTime) ? c.clipTime : '12:00'
      return { days, time }
    } catch {
      return { days: [], time: '12:00' }
    }
  }

  /**
   * The next open clip slots. Clips have their own days and time of day (Studio settings per channel) and one clip a day.
   * They honor blackout dates, but never use or move an episode slot, and episodes never count a clip.
   */
  nextClipSlots(brandId: number, count: number, fromUtc?: string): string[] {
    const { days, time } = this.clipSchedule(brandId)
    if (!days.length) return []
    const taken = (
      this.db
        .prepare(
          `SELECT scheduled_at_utc AS t FROM posts WHERE brand_id = ? AND scheduled_at_utc IS NOT NULL
           AND post_type = 'clip' AND status IN (${RESERVING.map(() => '?').join(',')})`,
        )
        .all(brandId, ...RESERVING) as Array<{ t: string }>
    ).map((r) => r.t)
    const sent = (
      this.db
        .prepare(
          "SELECT scheduled_at_utc AS t FROM posts WHERE brand_id = ? AND scheduled_at_utc IS NOT NULL AND post_type = 'clip' AND status = 'posted'",
        )
        .all(brandId) as Array<{ t: string }>
    ).map((r) => r.t)
    const rules = this.channelRules(brandId)
    return getNextOpenSlots({
      slots: [
        { dayType: 'weekday', timeLocal: time, enabled: true },
        { dayType: 'weekend', timeLocal: time, enabled: true },
      ],
      taken,
      count,
      from: fromUtc ?? new Date(this.now()).toISOString(),
      weekdays: days,
      blackoutDates: [
        ...new Set([...readSetting(this.db, 'blackoutDates'), ...rules.blackoutDates]),
      ],
      maxPerDay: 1,
      alsoCounted: sent,
    })
  }

  /** The database, for the channel state helper. */
  dbForState(): Db {
    return this.db
  }

  /** The limits that belong to one channel. A channel with no row has the defaults. */
  channelRules(brandId: number): {
    maxPerDay: number
    blackoutDates: string[]
    lowQueueDays: number | null
  } {
    const r = this.db.prepare('SELECT * FROM channel_rules WHERE brand_id = ?').get(brandId) as
      { max_per_day: number; blackout_json: string; low_queue_days: number | null } | undefined
    let blackoutDates: string[] = []
    try {
      blackoutDates = r ? (JSON.parse(r.blackout_json) as string[]) : []
    } catch {
      blackoutDates = []
    }
    return {
      maxPerDay: r?.max_per_day ?? 1,
      blackoutDates,
      lowQueueDays: r?.low_queue_days ?? null,
    }
  }

  /**
   * The weekdays a channel may post on, from its Shorts and Long form days in Setup Channels.
   * Every way of picking the next slot goes through nextSlots, so none of them can land on another day.
   * No days set (or a ticked kind with no days) means every day.
   */
  postDays(brandId: number): number[] | undefined {
    const rows = this.db
      .prepare('SELECT days FROM brand_slot_kinds WHERE brand_id = ? AND enabled = 1')
      .all(brandId) as Array<{ days: string | null }>
    if (rows.length === 0) return undefined
    const all = new Set<number>()
    for (const r of rows) {
      if (!r.days) return undefined
      try {
        for (const d of JSON.parse(r.days) as unknown[])
          if (typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 7) all.add(d)
      } catch {
        return undefined
      }
    }
    return all.size ? [...all].sort() : undefined
  }

  countOnDay(brandId: number, dayIso: string): number {
    const day = DateTime.fromISO(dayIso, { zone: 'utc' }).setZone(ZONE).startOf('day')
    const from = day.toUTC().toISO()!
    const to = day.plus({ days: 1 }).toUTC().toISO()!
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM posts WHERE brand_id = ? AND scheduled_at_utc >= ? AND scheduled_at_utc < ?
           AND post_type = 'episode' AND status NOT IN ('canceled','draft')`,
        )
        .get(brandId, from, to) as { n: number }
    ).n
  }

  /**
   * Plain-language heads ups for a time Josh picked by hand. Never blocks: the screen shows these and lets him go on.
   * Looks at: not a posting time for the channel, a time already gone, the channel's daily limit, and the minimum gap
   * to any other post (any channel).
   */
  checkCustomTime(brandId: number, whenUtc: string): string[] {
    const whenMs = new Date(whenUtc).getTime()
    if (!Number.isFinite(whenMs)) return []
    const out: string[] = []
    if (whenMs < this.now()) out.push('That time is already in the past.')
    const key = (iso: string) => new Date(iso).toISOString().slice(0, 16)
    const times = this.channelPostingTimes(brandId, 2000, whenMs - 2 * 86_400_000)
    if (!times.some((t) => key(t) === key(whenUtc))) {
      out.push('That is not one of this channel\'s posting times.')
    }
    const rules = this.channelRules(brandId)
    if (rules.maxPerDay > 0) {
      const day = DateTime.fromMillis(whenMs, { zone: ZONE }).startOf('day')
      const n = (
        this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM posts WHERE brand_id = ? AND scheduled_at_utc >= ? AND scheduled_at_utc < ?
             AND post_type = 'episode' AND status NOT IN ('canceled','draft')`,
          )
          .get(brandId, day.toUTC().toISO(), day.plus({ days: 1 }).toUTC().toISO()) as { n: number }
      ).n
      if (n >= rules.maxPerDay) {
        out.push(
          `This channel already has ${n} post${n === 1 ? '' : 's'} that day. Its daily limit is ${rules.maxPerDay}.`,
        )
      }
    }
    return out
  }

  // ---------- writing ----------

  private brandName(brandId: number): string {
    const b = this.db.prepare('SELECT name FROM brands WHERE id = ?').get(brandId) as
      { name: string } | undefined
    if (!b) throw new Error('Brand not found.')
    return b.name
  }

  private accountFor(brandId: number, platform: Platform): number | null {
    const a = this.db
      .prepare('SELECT id FROM accounts WHERE brand_id = ? AND platform = ?')
      .get(brandId, platform) as { id: number } | undefined
    return a?.id ?? null
  }

  private insertTargets(postId: number, brandId: number, targets: PostTargetInput[]): void {
    const ins = this.db.prepare(
      `INSERT INTO post_targets (post_id, platform, account_id, caption_override, ai_flag, settings_json, stagger_offset_min, target_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    // Platforms on the same slot go a few minutes apart. Platforms with their own times do not need it.
    const stagger: Partial<Record<Platform, number>> = {}
    if (readSetting(this.db, 'staggerEnabled')) {
      const groups = new Map<string, Platform[]>()
      for (const t of targets) groups.set(t.scheduledAtUtc ?? '', [...(groups.get(t.scheduledAtUtc ?? '') ?? []), t.platform])
      for (const list of groups.values())
        Object.assign(stagger, staggerOffsets(list, postId, readSetting(this.db, 'staggerGapMin'), readSetting(this.db, 'staggerGapMax')))
    }
    const seen = new Set<Platform>()
    for (const t of targets) {
      if (seen.has(t.platform)) continue
      seen.add(t.platform)
      ins.run(
        postId,
        t.platform,
        this.accountFor(brandId, t.platform),
        t.captionOverride?.trim() ? t.captionOverride : null,
        t.aiFlag ? 1 : 0,
        JSON.stringify(cleanSettings(t.settings)),
        stagger[t.platform] ?? 0,
        t.scheduledAtUtc ?? null,
      )
    }
  }

  /** A TikTok Direct Post must carry the creator's own choices. Drafts mode does not need them. */
  private checkTikTok(
    brandId: number,
    durationSeconds: number | undefined,
    targets: PostTargetInput[],
  ): void {
    for (const t of targets) {
      if (t.platform !== 'tiktok') continue
      const acct = this.db
        .prepare('SELECT mode FROM accounts WHERE brand_id = ? AND platform = ?')
        .get(brandId, 'tiktok') as { mode: string } | undefined
      if (!acct || acct.mode !== 'direct') continue
      const problem = tiktokSettingsProblem(t.settings?.tiktok, null, durationSeconds ?? 0)
      if (problem) throw new Error(`TikTok: ${problem}`)
    }
  }

  /** Facebook and Instagram have hard length limits. Block a real account early with a clear message. */
  private checkDurations(
    brandId: number,
    durationSeconds: number | undefined,
    targets: PostTargetInput[],
  ): void {
    if (!durationSeconds) return
    for (const t of targets) {
      if (t.platform !== 'facebook' && t.platform !== 'instagram') continue
      const acct = this.db
        .prepare('SELECT mode FROM accounts WHERE brand_id = ? AND platform = ?')
        .get(brandId, t.platform) as { mode: string } | undefined
      if (!acct || acct.mode === 'dry_run') continue // dry runs only warn
      const problem = durationProblem(t.platform, durationSeconds)
      if (problem) throw new Error(problem)
    }
  }

  private validateInput(input: PostInput): void {
    if (input.targets.length === 0 && input.status === 'scheduled') {
      throw new Error('Pick at least one platform before scheduling.')
    }
    if (input.status === 'scheduled' && !input.scheduledAtUtc && !input.targets.some((t) => t.scheduledAtUtc)) {
      throw new Error('Pick a date and time before scheduling.')
    }
  }

  async createMany(inputs: PostInput[]): Promise<Post[]> {
    inputs.forEach((i) => this.validateInput(i))
    // Copy files first (cannot be part of a DB transaction), then insert everything at once.
    const prepared: Array<{ input: PostInput; rel: string; meta: string; poster: string | null }> =
      []
    try {
      for (const input of inputs) {
        const brand = this.brandName(input.brandId)
        let meta = '{}'
        let poster: string | null = null
        if (this.media) {
          const m = await this.media.probe(input.sourcePath)
          meta = JSON.stringify(m)
          this.checkDurations(input.brandId, m.durationSeconds, input.targets)
          poster = await this.media.poster(input.sourcePath, m.durationSeconds)
        }
        if (input.status === 'scheduled') {
          this.checkTikTok(
            input.brandId,
            (JSON.parse(meta) as { durationSeconds?: number }).durationSeconds,
            input.targets,
          )
        }
        const rel = this.library.importToQueue(brand, input.sourcePath, !!input.moveSource)
        prepared.push({ input, rel, meta, poster })
      }
      const ids = this.db.transaction(() => {
        const out: number[] = []
        const ins = this.db.prepare(
          `INSERT INTO posts (brand_id, video_path, video_meta_json, poster_path, title, caption, scheduled_at_utc, status,
             origin, episode_ref, checksum, sidecar_title, source_bot, video_basename, hold_reason, post_type, source_episode_ref, channel_link, first_comment)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        for (const p of prepared) {
          const id = Number(
            ins.run(
              p.input.brandId,
              p.rel,
              p.meta,
              p.poster,
              p.input.title,
              p.input.caption,
              baseTime(p.input.scheduledAtUtc, p.input.targets),
              p.input.status,
              p.input.origin ?? 'manual',
              p.input.pipeline?.episodeRef ?? null,
              p.input.pipeline?.checksum ?? null,
              p.input.pipeline?.sidecarTitle ?? null,
              p.input.pipeline?.sourceBot ?? null,
              p.input.pipeline ? (p.rel.split('/').pop() ?? null) : null,
              p.input.pipeline?.holdReason ?? null,
              p.input.pipeline?.postType ?? 'episode',
              p.input.pipeline?.sourceEpisodeRef ?? null,
              p.input.pipeline?.channelLink ? 1 : 0,
              p.input.firstComment?.trim() ? p.input.firstComment.trim() : null,
            ).lastInsertRowid,
          )
          this.insertTargets(id, p.input.brandId, p.input.targets)
          out.push(id)
        }
        return out
      })()
      ids.forEach((id, i) =>
        this.log.log(
          'info',
          `Post created: "${prepared[i].input.title}" (${prepared[i].input.status}).`,
          {
            postId: id,
          },
        ),
      )
      this.emit()
      return ids.map((id) => this.get(id) as Post)
    } catch (err) {
      for (const p of prepared) {
        // A copy we made is removed. A file we moved goes back where it came from, so nothing is ever lost.
        if (p.input.moveSource) this.library.moveBack(p.rel, p.input.sourcePath)
        else this.library.removeIfInside(p.rel)
      }
      throw err
    }
  }

  /** Holds a post back from posting (null releases it). A held post stays where it is and the scheduler skips it. */
  setHold(id: number, reason: string | null): void {
    this.db
      .prepare(
        "UPDATE posts SET hold_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
      )
      .run(reason, id)
    this.emit()
  }

  async create(input: PostInput): Promise<Post> {
    return (await this.createMany([input]))[0]
  }

  /** Targets already handed to a real platform (not a dry run). The platform now holds the schedule. */
  private realHandedOff(postId: number): Array<{ platform: string }> {
    return this.db
      .prepare(
        `SELECT t.platform FROM post_targets t JOIN accounts a ON a.id = t.account_id
         WHERE t.post_id = ? AND t.status IN ('handed_off','processing') AND a.mode != 'dry_run'`,
      )
      .all(postId) as Array<{ platform: string }>
  }

  update(id: number, patch: PostUpdate): Post {
    const cur = this.get(id)
    if (!cur) throw new Error('Post not found.')
    // A platform whose time the patch really changes (a save that sends the same time back changes nothing).
    const retimed = (patch.targets ?? []).filter((t) => {
      const e = cur.targets.find((x) => x.platform === t.platform)
      return !!e && t.scheduledAtUtc !== undefined && (t.scheduledAtUtc ?? null) !== e.scheduledAtUtc && e.status !== 'posted'
    })
    const handed = this.realHandedOff(id).map((h) => h.platform)
    if (
      (patch.scheduledAtUtc && patch.scheduledAtUtc !== cur.scheduledAtUtc && handed.length) ||
      retimed.some((t) => handed.includes(t.platform))
    ) {
      throw new Error(
        'This post is already scheduled inside YouTube. Cancel it and delete the scheduled video in YouTube Studio first, then schedule it again.',
      )
    }
    if (['posted', 'in_progress'].includes(cur.status)) {
      throw new Error('This post is already going out. Wait for it to finish first.')
    }
    this.db.transaction(() => {
      const title = patch.title ?? cur.title
      const caption = patch.caption ?? cur.caption
      let when = patch.scheduledAtUtc !== undefined ? patch.scheduledAtUtc : cur.scheduledAtUtc
      // A draft that is given platform times has no post time yet: it starts at the earliest of them.
      if (!when && retimed.some((t) => t.scheduledAtUtc))
        when = retimed.map((t) => t.scheduledAtUtc as string).filter(Boolean).reduce((a, b) => (a < b ? a : b))
      // Saving the editor sends the time back unchanged. Only a different time counts as a reschedule.
      const baseMoved = !!patch.scheduledAtUtc && patch.scheduledAtUtc !== cur.scheduledAtUtc
      // Taking a post off the schedule (no time at all) clears every platform time too.
      const cleared = patch.scheduledAtUtc === null && cur.scheduledAtUtc !== null
      const moved = baseMoved || retimed.length > 0
      let status: PostStatus = cur.status
      if (patch.status) status = patch.status
      else if (['missed', 'failed', 'partial', 'canceled'].includes(cur.status) && moved)
        status = 'scheduled'
      if (status === 'scheduled' && !when)
        throw new Error('Pick a date and time before scheduling.')
      const first =
        patch.firstComment !== undefined ? patch.firstComment?.trim() || null : cur.firstComment
      this.db
        .prepare(
          'UPDATE posts SET title = ?, caption = ?, scheduled_at_utc = ?, status = ?, first_comment = ?, updated_at = ? WHERE id = ?',
        )
        .run(title, caption, when, status, first, new Date().toISOString(), id)
      // The owner or an agent changed the title on purpose, so the text kept with a bot's drop moves with it.
      if (cur.episodeRef && patch.title !== undefined)
        this.db.prepare('UPDATE posts SET sidecar_title = ? WHERE id = ?').run(title, id)
      if (patch.targets) {
        const keep = new Set(patch.targets.map((t) => t.platform))
        for (const t of cur.targets) {
          if (!keep.has(t.platform) && t.status !== 'posted')
            this.db.prepare('DELETE FROM post_targets WHERE id = ?').run(t.id)
        }
        const existing = new Map(cur.targets.map((t) => [t.platform, t]))
        for (const t of patch.targets) {
          const e = existing.get(t.platform)
          if (e) {
            if (e.status !== 'posted')
              this.db
                .prepare(
                  'UPDATE post_targets SET caption_override = ?, ai_flag = ?, settings_json = ? WHERE id = ?',
                )
                .run(
                  t.captionOverride?.trim() ? t.captionOverride : null,
                  t.aiFlag ? 1 : 0,
                  JSON.stringify({
                    ...stateOf(this.rawSettings(e.id)),
                    ...cleanSettings(t.settings),
                  }),
                  e.id,
                )
          } else {
            this.insertTargets(id, cur.brandId, [t])
          }
        }
      }
      // Moving the whole post puts every platform that was not given its own new time back on the post's time.
      if (baseMoved || cleared)
        this.db
          .prepare("UPDATE post_targets SET target_at_utc = NULL WHERE post_id = ? AND status != 'posted'")
          .run(id)
      for (const t of retimed)
        this.db
          .prepare('UPDATE post_targets SET target_at_utc = ?, stagger_offset_min = 0 WHERE post_id = ? AND platform = ?')
          .run(t.scheduledAtUtc ?? null, id, t.platform)
      if (!cleared) this.normalizeTimes(id, when)
      // A reschedule of a missed or failed post starts it fresh.
      // A target waiting for you to finish it in an app (a TikTok draft) is left alone, so it is never sent twice.
      if (moved && ['missed', 'failed', 'partial', 'canceled'].includes(cur.status)) {
        this.db
          .prepare(
            `UPDATE post_targets SET status = 'pending', attempts = 0, next_attempt_at_utc = NULL, last_error = NULL,
             lock_token = NULL, locked_at_utc = NULL WHERE post_id = ? AND status IN ('failed','pending')`,
          )
          .run(id)
      }

    })()
    this.log.log('info', 'Post edited.', { postId: id })
    this.emit()
    return this.get(id) as Post
  }

  /**
   * Keeps the post's time and its platform times in step. When any platform has its own time, every platform that
   * is still to go out gets one (the post's time plus its stagger), and the post's time becomes the earliest of them.
   */
  private normalizeTimes(postId: number, base: string | null): void {
    const rows = this.db
      .prepare('SELECT id, status, target_at_utc, stagger_offset_min FROM post_targets WHERE post_id = ?')
      .all(postId) as Array<{ id: number; status: string; target_at_utc: string | null; stagger_offset_min: number }>
    const live = rows.filter((r) => r.status !== 'skipped')
    if (!live.some((r) => r.target_at_utc)) return
    const set = this.db.prepare('UPDATE post_targets SET target_at_utc = ? WHERE id = ?')
    for (const r of live) if (!r.target_at_utc && r.status !== 'posted' && base) set.run(base, r.id)
    const times = (this.db.prepare('SELECT status, target_at_utc FROM post_targets WHERE post_id = ? AND status != ?').all(postId, 'skipped') as Array<{ status: string; target_at_utc: string | null }>)
    const open = times.filter((t) => t.status !== 'posted' && t.target_at_utc).map((t) => t.target_at_utc as string)
    const pool = open.length ? open : times.map((t) => t.target_at_utc).filter((x): x is string => !!x)
    if (pool.length)
      this.db
        .prepare('UPDATE posts SET scheduled_at_utc = ? WHERE id = ?')
        .run(pool.reduce((a, b) => (a < b ? a : b)), postId)
  }

  /**
   * Schedules a post with a time for each platform. The post's own time becomes the earliest of them. A platform with no
   * time in the plan follows the post's time.
   */
  schedulePlan(id: number, plan: Partial<Record<Platform, string>>): void {
    const cur = this.get(id)
    if (!cur) throw new Error('Post not found.')
    const times = Object.values(plan).filter((x): x is string => !!x)
    if (times.length === 0) throw new Error('Pick a date and time before scheduling.')
    const base = times.reduce((a, b) => (a < b ? a : b))
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE posts SET scheduled_at_utc = ?, status = 'scheduled', updated_at = ? WHERE id = ?")
        .run(base, new Date().toISOString(), id)
      const set = this.db.prepare('UPDATE post_targets SET target_at_utc = ?, stagger_offset_min = ? WHERE id = ?')
      const groups = new Map<string, Platform[]>()
      for (const t of cur.targets) groups.set(plan[t.platform] ?? '', [...(groups.get(plan[t.platform] ?? '') ?? []), t.platform])
      const stagger: Partial<Record<Platform, number>> = {}
      if (readSetting(this.db, 'staggerEnabled'))
        for (const list of groups.values())
          Object.assign(stagger, staggerOffsets(list, id, readSetting(this.db, 'staggerGapMin'), readSetting(this.db, 'staggerGapMax')))
      for (const t of cur.targets) set.run(plan[t.platform] ?? null, stagger[t.platform] ?? 0, t.id)
      this.normalizeTimes(id, base)
    })()
    this.log.log('info', 'Post scheduled.', { postId: id })
    this.emit()
  }

  private hasOwnTime(targetId: number): boolean {
    return !!(this.db.prepare('SELECT target_at_utc AS t FROM post_targets WHERE id = ?').get(targetId) as { t: string | null } | undefined)?.t
  }

  /** Two scheduled posts trade times. Both must still be waiting to go out. */
  swapTimes(a: number, b: number): void {
    const pa = this.get(a)
    const pb = this.get(b)
    if (!pa || !pb) throw new Error('Post not found.')
    if (a === b) throw new Error('Pick two different posts.')
    for (const p of [pa, pb])
      if (p.status !== 'scheduled' || !p.scheduledAtUtc)
        throw new Error(`"${p.title}" is not scheduled, so its time cannot be swapped.`)
    if (this.realHandedOff(a).length || this.realHandedOff(b).length)
      throw new Error(
        'One of these posts is already scheduled inside YouTube. Cancel it there first, then swap.',
      )
    this.db.transaction(() => {
      const upd = this.db.prepare(
        'UPDATE posts SET scheduled_at_utc = ?, updated_at = ? WHERE id = ?',
      )
      const stamp = new Date().toISOString()
      upd.run(pb.scheduledAtUtc, stamp, a)
      upd.run(pa.scheduledAtUtc, stamp, b)
      // Platform times keep their distance from the post's time, so they move with it.
      const delta = new Date(pb.scheduledAtUtc!).getTime() - new Date(pa.scheduledAtUtc!).getTime()
      const shift = this.db.prepare('UPDATE post_targets SET target_at_utc = ? WHERE id = ?')
      for (const [post, d] of [[pa, delta], [pb, -delta]] as const)
        for (const t of post.targets)
          if (t.status !== 'posted' && t.scheduledAtUtc && this.hasOwnTime(t.id))
            shift.run(new Date(new Date(t.scheduledAtUtc).getTime() + d).toISOString(), t.id)
    })()
    this.log.log('info', `Swapped the times of "${pa.title}" and "${pb.title}".`)
    this.emit()
  }

  reschedule(ids: number[], scheduledAtUtc: string): void {
    for (const id of ids) this.update(id, { scheduledAtUtc })
    this.log.log('info', `Rescheduled ${ids.length} post(s) to ${scheduledAtUtc}.`)
  }

  cancel(ids: number[]): void {
    this.db.transaction(() => {
      for (const id of ids) {
        this.db
          .prepare(
            "UPDATE posts SET status = 'canceled', updated_at = ? WHERE id = ? AND status NOT IN ('posted')",
          )
          .run(new Date().toISOString(), id)
        this.db
          .prepare(
            "UPDATE post_targets SET status = 'skipped' WHERE post_id = ? AND status IN ('pending','needs_action','failed')",
          )
          .run(id)
        this.log.log('info', 'Post canceled.', { postId: id })
        if (this.realHandedOff(id).length) {
          this.log.log(
            'warn',
            'This post was already scheduled inside YouTube. Delete the scheduled video in YouTube Studio so it does not publish.',
            { postId: id },
          )
        }
      }
    })()
    this.emit()
  }

  /**
   * Cancels everything a channel has not posted yet (scheduled, in progress, partly posted, held, draft or missed).
   * Used when the channel is archived. What already went live stays as it is. Returns how many posts were canceled.
   */
  cancelUnposted(brandId: number): number {
    const ids = (
      this.db
        .prepare(
          "SELECT id FROM posts WHERE brand_id = ? AND status IN ('scheduled','in_progress','partial','draft','missed')",
        )
        .all(brandId) as Array<{ id: number }>
    ).map((r) => r.id)
    if (ids.length) this.cancel(ids)
    return ids.length
  }

  remove(ids: number[], alsoDeleteFile: boolean): void {
    for (const id of ids) {
      const post = this.get(id)
      if (!post) continue
      this.db.prepare('DELETE FROM posts WHERE id = ?').run(id)
      if (alsoDeleteFile) {
        try {
          this.library.deleteFile(post.videoPath)
        } catch (err) {
          this.log.log('warn', `Could not delete the video file: ${(err as Error).message}`, {
            postId: id,
          })
        }
      }
      this.log.log(
        'info',
        `Post deleted${alsoDeleteFile ? ' with its file' : ' (file kept)'}: "${post.title}".`,
      )
    }
    this.emit()
  }

  private rawSettings(targetId: number): string | null {
    return (
      (
        this.db.prepare('SELECT settings_json FROM post_targets WHERE id = ?').get(targetId) as
          { settings_json: string | null } | undefined
      )?.settings_json ?? null
    )
  }

  dismissChecklist(targetId: number): void {
    const next = { ...stateOf(this.rawSettings(targetId)) }
    delete next.checklist
    this.db
      .prepare('UPDATE post_targets SET settings_json = ? WHERE id = ?')
      .run(JSON.stringify(next), targetId)
    this.emit()
  }

  /** Makes a new draft from an existing post, with its own copy of the video, for reposting. */
  duplicate(id: number): Post {
    const src = this.get(id)
    if (!src) throw new Error('Post not found.')
    const abs = this.library.resolve(src.videoPath)
    if (!existsSync(abs))
      throw new Error('The video file for this post is missing, so it cannot be duplicated.')
    const rel = this.library.importToQueue(src.brandName, abs)
    const newId = this.db.transaction(() => {
      const nid = Number(
        this.db
          .prepare(
            `INSERT INTO posts (brand_id, video_path, video_meta_json, poster_path, title, caption, scheduled_at_utc, status)
             VALUES (?, ?, ?, ?, ?, ?, NULL, 'draft')`,
          )
          .run(
            src.brandId,
            rel,
            JSON.stringify(src.videoMeta),
            src.posterUrl ? src.posterUrl.split('/').pop() : null,
            src.title,
            src.caption,
          ).lastInsertRowid,
      )
      this.insertTargets(
        nid,
        src.brandId,
        src.targets.map((t) => ({
          platform: t.platform,
          aiFlag: t.aiFlag,
          captionOverride: t.captionOverride,
          settings: {
            thumbOffsetMs: t.settings.thumbOffsetMs,
            tiktok: t.settings.tiktok,
            thumbnailPath: t.settings.thumbnailPath,
            coverTimestampMs: t.settings.coverTimestampMs,
            coverUrl: t.settings.coverUrl,
            mock: t.settings.mock,
          },
        })),
      )
      return nid
    })()
    this.log.log('info', `Duplicated "${src.title}" as a new draft.`, { postId: newId })
    this.emit()
    return this.get(newId) as Post
  }

  // ---------- status helpers used by the scheduler ----------

  recomputeStatus(postId: number): PostStatus {
    const row = this.db.prepare('SELECT status FROM posts WHERE id = ?').get(postId) as
      { status: PostStatus } | undefined
    if (!row) return 'draft'
    const targets = (
      this.db.prepare('SELECT status FROM post_targets WHERE post_id = ?').all(postId) as Array<{
        status: TargetStatus
      }>
    ).map((t) => t.status)
    const next = derivePostStatus(targets, row.status)
    if (next !== row.status) {
      this.db
        .prepare('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?')
        .run(next, new Date().toISOString(), postId)
    }
    return next
  }

  /**
   * Older posts that were posted but never went to one platform (for example, TikTok was not connected yet), and whose
   * video file is still there. Newest last.
   */
  olderMissingPlatform(brandId: number, platform: Platform): Array<{ postId: number; title: string; postedAtUtc: string | null; platforms: string[] }> {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.title, p.video_path, p.scheduled_at_utc FROM posts p
         WHERE p.brand_id = ? AND p.status IN ('posted','partial','in_progress') AND p.media_purged_at IS NULL
           AND EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = p.id AND t.status = 'posted')
           AND NOT EXISTS (SELECT 1 FROM post_targets t WHERE t.post_id = p.id AND t.platform = ? AND t.status != 'skipped')
         ORDER BY p.scheduled_at_utc, p.id`,
      )
      .all(brandId, platform) as Array<{ id: number; title: string; video_path: string; scheduled_at_utc: string | null }>
    return rows
      .filter((r) => existsSync(this.library.resolve(r.video_path)))
      .map((r) => ({
        postId: r.id,
        title: r.title,
        postedAtUtc: r.scheduled_at_utc,
        platforms: (this.db.prepare("SELECT platform FROM post_targets WHERE post_id = ? AND status = 'posted'").all(r.id) as Array<{ platform: string }>).map((x) => x.platform),
      }))
  }

  /** The channel's own posting times from a moment on, whether or not a post sits in them. */
  channelPostingTimes(brandId: number, count: number, fromMs: number): string[] {
    const rules = this.channelRules(brandId)
const perPlatform = platformSlotRows(this.db, brandId)
    const slots = (perPlatform.length
      ? perPlatform.map((r) => ({ dayType: r.dayType, timeLocal: r.timeLocal, enabled: r.enabled }))
      : (this.db.prepare('SELECT * FROM brand_slots WHERE brand_id = ?').all(brandId) as any[]).map((r) => ({ dayType: r.day_type, timeLocal: r.time_local, enabled: !!r.enabled }))
    ).map<SlotDef>((x) => x)
    const blackoutDates = [...new Set([...readSetting(this.db, 'blackoutDates'), ...rules.blackoutDates])]
    const from = new Date(fromMs).toISOString()
    return getSlotTimes({ slots, from, to: new Date(fromMs + 300 * 86_400_000).toISOString(), weekdays: this.postDays(brandId), blackoutDates, maxPerDay: 0 })
      .filter((t) => t >= from)
      .slice(0, count)
  }

  /**
   * Sends already posted videos to one more platform, one every few minutes. The post keeps its old date. A platform
   * entry that was skipped before is reused. Refuses a platform that has no real account connected.
   */
  addPlatform(
    postIds: number[],
    platform: Platform,
    opts: { spacingSeconds?: number; allowDryRun?: boolean; schedule?: SendSchedule } = {},
  ): { added: number; problems: Array<{ postId: number; title: string; reason: string }>; times: string[] } {
    const sched: SendSchedule = opts.schedule ?? { mode: 'now', spacingSeconds: opts.spacingSeconds ?? 120 }
    const brandOfFirst = (this.db.prepare('SELECT brand_id FROM posts WHERE id = ?').get(postIds[0] ?? -1) as { brand_id: number } | undefined)?.brand_id
    const nowMs = this.now()
    const times: string[] = []
    let channelTimes: string[] = []
    if (sched.mode === 'channel' && brandOfFirst) channelTimes = this.channelPostingTimes(brandOfFirst, postIds.length, nowMs + 60_000)
    const timeFor = (n: number): string | null => {
      if (sched.mode === 'channel') return channelTimes[n] ?? null
      if (sched.mode === 'start') return new Date(Math.max(nowMs, new Date(sched.startAtUtc).getTime()) + n * Math.max(1, sched.everyMinutes) * 60_000).toISOString()
      return new Date(nowMs + n * Math.max(1, sched.spacingSeconds) * 1000).toISOString()
    }
    const problems: Array<{ postId: number; title: string; reason: string }> = []
    let added = 0
    for (const id of postIds) {
      const row = this.db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as (PostRow & { media_purged_at: string | null }) | undefined
      if (!row) continue
      const fail = (reason: string) => problems.push({ postId: id, title: row.title, reason })
      const existingFirst = this.db.prepare('SELECT status FROM post_targets WHERE post_id = ? AND platform = ?').get(id, platform) as { status: string } | undefined
      if (existingFirst && existingFirst.status !== 'skipped') {
        fail('This post already has a ' + platform + ' entry.')
        continue
      }
      const wentOut = !!this.db.prepare("SELECT 1 FROM post_targets WHERE post_id = ? AND status = 'posted'").get(id)
      if (!(['posted', 'partial'].includes(row.status) || (row.status === 'in_progress' && wentOut))) {
        fail('Only a post that already went out can be sent to another platform.')
        continue
      }
      if (row.media_purged_at || !existsSync(this.library.resolve(row.video_path))) {
        fail('The video file is gone, so it cannot be sent again.')
        continue
      }
      const acct = this.db.prepare('SELECT id, mode, status FROM accounts WHERE brand_id = ? AND platform = ?').get(row.brand_id, platform) as { id: number; mode: string; status: string } | undefined
      if (!acct || (acct.mode === 'dry_run' && !opts.allowDryRun)) {
        fail(`No real ${platform} account is connected for this channel. Connect one on the Channels screen first.`)
        continue
      }
      if (acct.status !== 'connected') {
        fail(`The ${platform} account needs you to sign in again.`)
        continue
      }
      if (platform === 'tiktok' && acct.mode === 'direct') {
        fail('TikTok Direct Post needs your privacy choices for each video. Use the post editor, or switch the account to Drafts.')
        continue
      }
      const existing = this.db.prepare('SELECT id, status FROM post_targets WHERE post_id = ? AND platform = ?').get(id, platform) as { id: number; status: string } | undefined
      if (existing && existing.status !== 'skipped') {
        fail('This post already has a ' + platform + ' entry.')
        continue
      }
      const meta = safeParse(row.video_meta_json) as { durationSeconds?: number }
      const tooLong = meta.durationSeconds ? durationProblem(platform, meta.durationSeconds) : null
      if (tooLong) {
        fail(tooLong)
        continue
      }
      const ai = (this.db.prepare("SELECT ai_flag FROM post_targets WHERE post_id = ? AND status = 'posted' LIMIT 1").get(id) as { ai_flag: number } | undefined)?.ai_flag ?? 0
      const lim = PLATFORM_LIMITS[platform] as { captionMax?: number; descriptionMax?: number }
      const max = lim.captionMax ?? lim.descriptionMax ?? 2200
      const caption = row.caption.length > max ? row.caption.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : row.caption
      const when = timeFor(added)
      if (!when) {
        fail('The channel has no more posting times to use. Add slot times on the Channels screen.')
        continue
      }
      if (existing) {
        this.db
          .prepare("UPDATE post_targets SET status = 'pending', attempts = 0, last_error = NULL, lock_token = NULL, locked_at_utc = NULL, caption_override = ?, account_id = ?, next_attempt_at_utc = ? WHERE id = ?")
          .run(caption, acct.id, when, existing.id)
      } else {
        this.db
          .prepare("INSERT INTO post_targets (post_id, platform, account_id, caption_override, ai_flag, settings_json, stagger_offset_min, next_attempt_at_utc) VALUES (?, ?, ?, ?, ?, '{}', 0, ?)")
          .run(id, platform, acct.id, caption, ai, when)
      }
      times.push(when)
      this.recomputeStatus(id)
      this.log.log('info', `Sending "${row.title}" to ${platform} now that it is connected.`, { postId: id })
      added++
    }
    if (added) this.emit()
    return { added, problems, times }
  }

  setPostStatus(postId: number, status: PostStatus): void {
    this.db
      .prepare('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), postId)
  }

  setVideoPath(postId: number, rel: string): void {
    this.db
      .prepare('UPDATE posts SET video_path = ?, updated_at = ? WHERE id = ?')
      .run(rel, new Date().toISOString(), postId)
  }
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

function stateOf(settingsJson: string | null): Record<string, any> {
  if (!settingsJson) return {}
  try {
    return JSON.parse(settingsJson) ?? {}
  } catch {
    return {}
  }
}

function progressOf(settingsJson: string | null): number | null {
  if (!settingsJson) return null
  try {
    const v = JSON.parse(settingsJson)?.progress
    return typeof v === 'number' ? v : null
  } catch {
    return null
  }
}

function cleanSettings(s: TargetSettings | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (s && typeof s.thumbOffsetMs === 'number' && s.thumbOffsetMs >= 0)
    out.thumbOffsetMs = Math.round(s.thumbOffsetMs)
  if (s?.tiktok) out.tiktok = s.tiktok
  if (s && typeof s.thumbnailPath === 'string' && s.thumbnailPath)
    out.thumbnailPath = s.thumbnailPath
  if (s && typeof s.coverTimestampMs === 'number' && s.coverTimestampMs >= 0)
    out.coverTimestampMs = Math.round(s.coverTimestampMs)
  if (s && typeof s.coverUrl === 'string' && /^https:\/\//.test(s.coverUrl))
    out.coverUrl = s.coverUrl
  if (s?.shorts === true) out.shorts = true
  if (s && typeof s.firstComment === 'string' && s.firstComment.trim()) out.firstComment = s.firstComment.trim()
  if (s?.mock === true) out.mock = true
  return out
}
