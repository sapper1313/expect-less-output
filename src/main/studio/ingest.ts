import type { Db } from '../db'
import type { PostService } from '../services/posts'
import { addDays, dueDates, easternDate, slotToUtc, todayEastern } from '@shared/studio/cadence'
import type { StudioConfigService } from './configService'
import type { EpisodeLibrary } from './library'
import { probe } from './ffmpeg'
import type { VideoQc } from './qc'

/** What the Inbox watcher calls when a sidecar names an episode. Without episode_id none of this runs. */
export interface IngestHooks {
  /** Runs before the post is created. Returns sidecar fields to fill in (title, caption). Throws a plain Error to refuse. */
  before(episodeId: string, videoPath: string, sidecar: Record<string, unknown>): Promise<Record<string, unknown>>
  /** Runs after the post exists. Attaches it to the episode and schedules it. */
  after(episodeId: string, postId: number, sidecar: Record<string, unknown>): Promise<void>
}

const RATIO = { long: 16 / 9, short: 9 / 16 }

export interface IngestDeps {
  db: Db
  cfg: StudioConfigService
  episodes: EpisodeLibrary
  posts: PostService
  now?: () => number
  /** Light QC (black or frozen picture, sound) for videos that arrive from Muse. */
  qc?: VideoQc
  /** Further steps after a video is attached (Compliance, Thumbnail, Publisher). Added in Phase 4. */
  pipeline?: (episodeId: string, postId: number) => Promise<void>
}

export function makeIngestHooks(d: IngestDeps): IngestHooks {
  return {
    async before(episodeId, videoPath, sidecar) {
      const ep = d.episodes.find(episodeId)
      if (!ep) throw new Error(`No episode "${episodeId}" exists in the Library.`)
      const pkg = d.episodes.getPackage(episodeId)
      d.episodes.setStatus(episodeId, 'Video received', 'Video arrived through the ingest API.')
      d.episodes.setStatus(episodeId, 'Checking video')
      const brand = d.cfg.getBrand(ep.brandId)
      try {
        const info = await probe(videoPath)
        if (!info.durationSeconds || info.durationSeconds < 1) throw new Error('The video does not play (no duration).')
        const ratio = info.width / (info.height || 1)
        const want = RATIO[brand.format]
        if (Math.abs(ratio - want) / want > 0.03)
          throw new Error(`The video is ${info.width}x${info.height}. This brand needs ${brand.format === 'long' ? '16:9' : '9:16'}.`)
        if (!info.hasAudio) throw new Error('The video has no audio track.')
        const target = pkg?.runtime_target_seconds ?? 0
        if (target > 0 && (info.durationSeconds < target * 0.6 || info.durationSeconds > target * 1.4))
          throw new Error(`The video is ${Math.round(info.durationSeconds)} seconds long. About ${target} was expected.`)
        const light = await d.qc?.check({ path: videoPath, episodeId, brandId: ep.brandId, expectSeconds: info.durationSeconds, aspect: brand.format === 'long' ? '16:9' : '9:16', scriptedLines: [], scene: '', mode: 'light' })
        if (light && !light.pass) throw new Error(light.reasons[0])
      } catch (e) {
        d.episodes.setStatus(episodeId, 'Flagged', 'Video check failed.', { flaggedReason: (e as Error).message })
        throw e
      }
      const fill: Record<string, unknown> = {}
      if (sidecar.title === undefined) fill.title = sidecar.title ?? pkg?.youtube.title ?? ep.title
      const description = (sidecar.description as string | undefined) ?? pkg?.youtube.description
      if (sidecar.caption === undefined && description) fill.caption = description
      if (sidecar.platforms === undefined) {
        // Only the four platforms the scheduler posts to. Threads and Bluesky are handled by the Publisher.
        const four = (['youtube', 'facebook', 'instagram', 'tiktok'] as const).filter((p) => brand.platforms[p])
        if (four.length) fill.platforms = four
      }
      if (sidecar.ai_flags === undefined && brand.aiDisclosure)
        fill.ai_flags = { youtube: true, facebook: true, instagram: true, tiktok: true }
      return fill
    },

    async after(episodeId, postId) {
      const ep = d.episodes.get(episodeId)
      if (d.pipeline) {
        // Thumbnail, text, Compliance and scheduling. A problem here never loses the video: the draft post stays.
        d.episodes.setFields(episodeId, { postId })
        try {
          await d.pipeline(episodeId, postId)
        } catch (e) {
          d.episodes.setStatus(episodeId, 'Flagged', 'Publishing could not finish.', { flaggedReason: (e as Error).message, postId })
        }
        return
      }
      const when = nextOpenPostTime(d, ep.brandId)
      const post = await d.posts.get(postId)
      if (post && when) {
        d.posts.update(postId, { scheduledAtUtc: when, status: 'scheduled' })
      }
      d.episodes.setStatus(episodeId, 'Scheduled', when ? `Scheduled for ${when}.` : 'No open slot was found. The post is a draft.', {
        postId,
        scheduledAtUtc: when,
        videoPath: post?.videoPath ?? null,
      })
      d.episodes.setFields(episodeId, { slotDate: ep.slotDate })
    },
  }
}

/** The next posting date for a brand (its cadence), at the brand's first weekday slot time, not already taken. */
export function nextOpenPostTime(d: Pick<IngestDeps, 'db' | 'cfg' | 'now'>, brandId: number): string | null {
  const nowMs = d.now ? d.now() : Date.now()
  const cfg = d.cfg.getBrand(brandId)
  const slot = (
    d.db
      .prepare("SELECT time_local FROM brand_slots WHERE brand_id = ? AND enabled = 1 AND day_type = 'weekday' ORDER BY time_local LIMIT 1")
      .get(brandId) as { time_local: string } | undefined
  )?.time_local ?? '17:00'
  const today = todayEastern(nowMs)
  const taken = new Set(
    (
      d.db
        .prepare("SELECT scheduled_at_utc AS t FROM posts WHERE brand_id = ? AND scheduled_at_utc IS NOT NULL AND status IN ('scheduled','in_progress','partial','posted')")
        .all(brandId) as Array<{ t: string }>
    ).map((r) => easternDate(r.t)),
  )
  for (const date of dueDates(cfg, today, addDays(today, 60))) {
    const utc = slotToUtc(date, slot)
    if (new Date(utc).getTime() <= nowMs + 60_000) continue
    if (taken.has(date)) continue
    return utc
  }
  return null
}
