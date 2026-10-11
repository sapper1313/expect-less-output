import { existsSync, readdirSync, statSync } from 'fs'
import { basename, join } from 'path'
import { DateTime } from 'luxon'
import type { Db } from '../db'
import type { Library as MediaLibrary } from '../services/library'
import { addDays, dueDates, easternDate, productionDays, slotToUtc } from '@shared/studio/cadence'
import type { CalendarItem, CalendarKind } from '@shared/studio/types'
import { sanitizeFolderName } from '@shared/text'
import type { StudioConfigService } from './configService'
import type { EpisodeLibrary } from './library'

export interface CalendarFilter {
  fromUtc: string
  toUtc: string
  brandId?: number | null
  platform?: string | null
  kind?: CalendarKind | null
}

const POST_KIND: Record<string, CalendarKind | null> = {
  posted: 'posted',
  scheduled: 'scheduled',
  in_progress: 'scheduled',
  partial: 'scheduled',
  failed: 'failed',
  missed: 'failed',
  draft: null,
  canceled: null,
}

const ACTIVE_EPISODE = [
  'Idea',
  'Written',
  'Checking',
  'Ready for production',
  'In production',
  'Awaiting video',
  'Video received',
  'Checking video',
  'Scheduled',
  'Posted',
]

export class CalendarFeed {
  constructor(
    private db: Db,
    private cfg: StudioConfigService,
    private episodes: EpisodeLibrary,
    private media: MediaLibrary,
    private now: () => number = Date.now,
  ) {}

  items(f: CalendarFilter): CalendarItem[] {
    const out: CalendarItem[] = []
    const brands = new Map(
      (
        this.db.prepare('SELECT id, name, color FROM brands').all() as Array<{
          id: number
          name: string
          color: string
        }>
      ).map((b) => [b.id, b]),
    )
    const brandOk = (id: number) => !f.brandId || f.brandId === id
    const cutoff = new Date(this.now() - this.cfg.get().retentionDays * 86_400_000).toISOString()

    // 1. posts the scheduler owns. Posted items older than the retention period are gone from the calendar.
    const posts = this.db
      .prepare(
        `SELECT p.id, p.brand_id, p.title, p.status, p.scheduled_at_utc, p.media_purged_at,
                (SELECT group_concat(platform) FROM post_targets WHERE post_id = p.id) AS platforms,
                (SELECT id FROM episodes WHERE post_id = p.id LIMIT 1) AS episode_id
         FROM posts p WHERE p.scheduled_at_utc >= ? AND p.scheduled_at_utc < ?`,
      )
      .all(f.fromUtc, f.toUtc) as any[]
    const postEpisodes = new Set<string>()
    for (const p of posts) {
      const kind = POST_KIND[p.status]
      if (!kind || !brandOk(p.brand_id)) continue
      if (p.media_purged_at || (kind === 'posted' && p.scheduled_at_utc < cutoff)) continue
      const platforms: string[] = p.platforms ? String(p.platforms).split(',') : []
      if (f.platform && !platforms.includes(f.platform)) continue
      if (p.episode_id) postEpisodes.add(p.episode_id)
      const b = brands.get(p.brand_id)
      out.push({
        id: `post-${p.id}`,
        kind,
        brandId: p.brand_id,
        brandName: b?.name ?? '',
        brandColor: b?.color ?? '#888888',
        title: p.title,
        startUtc: p.scheduled_at_utc,
        allDay: false,
        date: easternDate(p.scheduled_at_utc),
        platforms,
        episodeId: p.episode_id ?? null,
        postId: p.id,
      })
    }

    // 2. episodes that are not yet a post, by their slot date.
    const fromDate = easternDate(f.fromUtc)
    const toDate = easternDate(new Date(DateTime.fromISO(f.toUtc).toMillis() - 1).toISOString())
    const eps = this.db
      .prepare(
        `SELECT * FROM episodes WHERE slot_date IS NOT NULL AND slot_date >= ? AND slot_date <= ?
         AND status NOT IN ('Archived')`,
      )
      .all(fromDate, toDate) as any[]
    const slotsWithEpisode = new Set<string>()
    for (const e of eps) {
      if (ACTIVE_EPISODE.includes(e.status)) slotsWithEpisode.add(`${e.brand_id}|${e.slot_date}`)
      if (postEpisodes.has(e.id) || !brandOk(e.brand_id)) continue
      const kind = episodeKind(e.status)
      if (!kind || kind === 'posted') continue
      const b = brands.get(e.brand_id)
      const platforms = this.platformsOf(e.brand_id)
      if (f.platform && !platforms.includes(f.platform)) continue
      out.push({
        id: `episode-${e.id}`,
        kind,
        brandId: e.brand_id,
        brandName: b?.name ?? '',
        brandColor: b?.color ?? '#888888',
        title: e.title || e.id,
        startUtc: slotToUtc(e.slot_date, '12:00'),
        allDay: true,
        date: e.slot_date,
        platforms,
        episodeId: e.id,
        postId: e.post_id,
      })
    }

    // 3. planned slots with no episode, and production windows for weekly brands.
    for (const b of this.cfg.listBrandConfigs()) {
      if (!brandOk(b.brandId)) continue
      const platforms = Object.entries(b.config.platforms)
        .filter(([, on]) => on)
        .map(([p]) => p)
      if (f.platform && !platforms.includes(f.platform)) continue
      for (const date of dueDates(b.config, fromDate, toDate)) {
        if (!slotsWithEpisode.has(`${b.brandId}|${date}`) && !this.postOnDate(b.brandId, date)) {
          out.push({
            id: `planned-${b.brandId}-${date}`,
            kind: 'planned',
            brandId: b.brandId,
            brandName: b.name,
            brandColor: b.color,
            title: `${b.name} (planned)`,
            startUtc: slotToUtc(date, '12:00'),
            allDay: true,
            date,
            platforms,
            episodeId: null,
            postId: null,
          })
        }
        for (const day of productionDays(b.config, date)) {
          if (day < fromDate || day > toDate) continue
          out.push({
            id: `window-${b.brandId}-${date}-${day}`,
            kind: 'production_window',
            brandId: b.brandId,
            brandName: b.name,
            brandColor: b.color,
            title: `${b.name}: make the ${date} episode`,
            startUtc: slotToUtc(day, '08:00'),
            allDay: true,
            date: day,
            platforms,
            episodeId: null,
            postId: null,
          })
        }
      }
    }

    // 4. videos that were on the channels before the app (platform history).
    const imported = this.db
      .prepare(
        `SELECT i.id, i.brand_id, i.platform, i.title, i.published_at_utc FROM imported_videos i
         WHERE i.published_at_utc >= ? AND i.published_at_utc < ? AND i.published_at_utc >= ?`,
      )
      .all(f.fromUtc, f.toUtc, cutoff) as any[]
    for (const i of imported) {
      if (!brandOk(i.brand_id) || (f.platform && f.platform !== i.platform)) continue
      const b = brands.get(i.brand_id)
      out.push({
        id: `imported-${i.id}`,
        kind: 'posted',
        brandId: i.brand_id,
        brandName: b?.name ?? '',
        brandColor: b?.color ?? '#888888',
        title: i.title,
        startUtc: i.published_at_utc,
        allDay: false,
        date: easternDate(i.published_at_utc),
        platforms: [i.platform],
        episodeId: null,
        postId: null,
      })
    }
    return out
      .filter((i) => !f.kind || i.kind === f.kind)
      .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
  }

  private platformsOf(brandId: number): string[] {
    return Object.entries(this.cfg.getBrand(brandId).platforms)
      .filter(([, on]) => on)
      .map(([p]) => p)
  }

  private postOnDate(brandId: number, date: string): boolean {
    const from = slotToUtc(date, '00:00')
    const to = slotToUtc(addDays(date, 1), '00:00')
    return !!this.db
      .prepare(
        "SELECT 1 FROM posts WHERE brand_id = ? AND scheduled_at_utc >= ? AND scheduled_at_utc < ? AND status NOT IN ('canceled','draft')",
      )
      .get(brandId, from, to)
  }

  /**
   * Imports files already in each brand's Posted folder that no post knows about, as Posted episodes,
   * so the past shows on the calendar. Safe to run again: a file is only imported once.
   */
  backfillPostedFolders(): number {
    let added = 0
    const known = new Set(
      (this.db.prepare('SELECT video_path FROM posts').all() as Array<{ video_path: string }>).map(
        (r) => basename(r.video_path),
      ),
    )
    const seen = new Set(
      (
        this.db.prepare("SELECT tags FROM episodes WHERE origin = 'backfill'").all() as Array<{
          tags: string
        }>
      ).map((r) => r.tags),
    )
    for (const b of this.cfg.listBrandConfigs()) {
      const posted = join(this.media.brandDir(b.name), 'Posted')
      if (!existsSync(posted)) continue
      for (const month of readdirSync(posted)) {
        const dir = join(posted, month)
        if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
        for (const file of readdirSync(dir)) {
          if (!/\.(mp4|mov)$/i.test(file) || known.has(file)) continue
          const key = `backfill:${sanitizeFolderName(b.name)}:${month}:${file}`.replaceAll(' ', '_')
          if (seen.has(key)) continue
          const mtime = statSync(join(dir, file)).mtime
          const date = DateTime.fromJSDate(mtime).setZone('America/New_York').toFormat('yyyy-MM-dd')
          const ep = this.episodes.create(
            b.brandId,
            {
              series: b.name,
              episode_number: 0,
              title: file.replace(/\.[^.]+$/, ''),
              logline: '',
              runtime_target_seconds: 0,
              counted_objects: [],
              scenes: [],
              youtube: {
                title: file.replace(/\.[^.]+$/, ''),
                description: '',
                tags: [],
                made_for_kids: false,
                ai_disclosure: true,
              },
              tags: [key],
              summary: 'Imported from the Posted folder.',
            },
            { status: 'Posted', slotDate: date, origin: 'backfill' },
          )
          this.episodes.setFields(ep.id, { postedAtUtc: mtime.toISOString() })
          added++
        }
      }
    }
    return added
  }
}

function episodeKind(status: string): CalendarKind | null {
  switch (status) {
    case 'In production':
      return 'in_production'
    case 'Awaiting video':
      return 'awaiting_video'
    case 'Flagged':
      return 'flagged'
    case 'Failed':
      return 'failed'
    case 'Posted':
      return 'posted'
    case 'Scheduled':
      return 'scheduled'
    case 'Idea':
    case 'Written':
    case 'Checking':
    case 'Ready for production':
    case 'Video received':
    case 'Checking video':
      return 'planned'
    default:
      return null
  }
}
