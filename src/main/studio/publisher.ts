import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { extname, join } from 'path'
import type { Db } from '../db'
import type { Library as MediaLibrary } from '../services/library'
import type { PostService } from '../services/posts'
import { slotToUtc } from '@shared/studio/cadence'
import { DEFAULT_PLATFORM_CAPS, capKeyFor } from '@shared/studio/platformCaps'
import type { StudioConfigService } from './configService'
import type { EpisodeLibrary } from './library'
import type { Platform, PostTargetInput } from '@shared/types'
import { z } from 'zod'
import { AgentDef, FlagNow } from './agents/framework'
import { ctxLine, STYLE_RULES } from './agents/prompts'
import type { LlmGateway } from './agents/llm'
import { PlatformTextsSchema, type Compliance, type PlatformTexts } from './agents/compliance'
import type { BibleService } from './bible'
import type { Thumbnailer } from './thumbnails'
import type { ThumbnailTester } from './thumbTest'
import type { SocialPublisher } from './social/socialPublisher'
import type { PublicHost } from './social/publicHost'
import { assemble } from './assemble'
import { probe, stillVideo } from './ffmpeg'
import { nextOpenPostTime } from './ingest'

export interface PublishDeps {
  db: Db
  cfg: StudioConfigService
  episodes: EpisodeLibrary
  posts: PostService
  media: MediaLibrary
  gateway: LlmGateway
  bible: BibleService
  compliance: Compliance
  thumbnailer: Thumbnailer
  tester: ThumbnailTester
  social: SocialPublisher
  host: PublicHost
  /** Why a brand cannot post to Bluesky yet (no account saved), or null. */
  socialReady: (brandId: number) => string | null
  workDir: (episodeId: string) => string
  /** Chapter lines to add to a YouTube description, or null. Only called when chapters are switched on. */
  chapters?: (episodeId: string) => Promise<string | null>
  now?: () => number
}

const FOUR: Platform[] = ['youtube', 'facebook', 'instagram', 'tiktok']

export interface PublishRun {
  episodeId: string
  /** The finished video from the Producer. Omit when a post already exists (Hollow from Grok Bot). */
  videoPath?: string
  srt?: string
  postId?: number
  /** The video is a mock mode placeholder. Its post goes to the dry run adapter and is never published for real. */
  mock?: boolean
}

export interface PublishResult {
  postId: number | null
  scheduledAtUtc: string | null
  skipped: Array<{ platform: string; reason: string }>
  social: number
}

/**
 * Everything between "the video exists" and "it is scheduled": the thumbnail for every platform, the text for every
 * platform in the brand voice, Compliance, then the scheduler queue (YouTube, Facebook, Instagram, TikTok) and the Bluesky
 * list. A platform that cannot take the video is skipped alone, never the whole post.
 */
export class Publisher {
  constructor(private d: PublishDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  /** The first open slot on or after the episode's planned date, never in the past. */
  slotFor(brandId: number, slotDate: string | null): string | null {
    const brand = this.d.cfg.getBrand(brandId)
    if (brand.cadenceMode === 'weekly')
      return nextOpenPostTime({ db: this.d.db, cfg: this.d.cfg, now: this.d.now }, brandId)
    const from = Math.max(
      slotDate ? new Date(slotToUtc(slotDate, '00:00')).getTime() : 0,
      this.now() + 60_000,
    )
    return this.d.posts.nextSlots(brandId, 1, new Date(from).toISOString())[0] ?? null
  }

  private limitsText(platforms: string[], isShort: boolean): string {
    return platforms
      .map((p) => {
        const key = capKeyFor(p, isShort)
        const c = key
          ? {
              ...DEFAULT_PLATFORM_CAPS[key],
              ...((this.d.cfg.get().platformCaps[key] as object) ?? {}),
            }
          : null
        return c
          ? `${c.label}: text up to ${c.textMax} characters${c.titleMax ? `, title up to ${c.titleMax}` : ''}. ${c.hashtagNote}`
          : p
      })
      .join('\n')
  }

  /** Writes the text for every platform. Compliance reads it; anything it rejects goes back for a rewrite. */
  private async texts(
    episodeId: string,
    brandId: number,
    brandName: string,
    platforms: string[],
    isShort: boolean,
    info: Parameters<Compliance['run']>[0]['video'],
    tiktokMode: string | null,
  ) {
    const pkg = this.d.episodes.getPackage(episodeId)!
    const cap = this.d.cfg.get().retryCap
    const bibleMd = this.d.bible.markdown(brandId)
    const feedback: string[] = []
    let last: ReturnType<Compliance['run']> | null = null
    for (let attempt = 0; attempt < cap; attempt++) {
      const out = await this.d.gateway.json(
        {
          agent: 'Publisher',
          brandId,
          episodeId,
          system: `You write the title, caption or post text for each platform for "${brandName}", in the voice of the series bible. Short, human, specific. ${STYLE_RULES}\nOnly include the platforms asked for. Answer only with JSON using these keys: youtube {title, description, tags[]}, instagram {caption}, facebook {caption}, tiktok {caption}, bluesky {text}.\nLimits:\n${this.limitsText(platforms, isShort)}\n\n${bibleMd}`,
          user: [
            ctxLine({
              task: 'publish_text',
              brand: brandName,
              title: pkg.youtube.title || pkg.title,
              summary: pkg.summary,
              description: pkg.youtube.description,
              hashtags: (pkg.extra?.hashtags as string[]) ?? pkg.youtube.tags,
              caption: (pkg.extra?.caption as string) ?? '',
              platforms,
              attempt,
            }),
            `Episode: ${pkg.title}\nSummary: ${pkg.summary}\nHook: ${(pkg.extra?.hook as string) ?? pkg.logline}\nTags: ${pkg.youtube.tags.join(', ')}`,
            feedback.length
              ? `Fix these problems from the last try:\n${feedback.map((f) => `- ${f}`).join('\n')}`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
          maxTokens: 2500,
        },
        PlatformTextsSchema,
      )
      const only = Object.fromEntries(
        Object.entries(out).filter(([k]) => platforms.includes(k)),
      ) as PlatformTexts
      const report = this.d.compliance.run({
        episodeId,
        brandId,
        isShort,
        platforms,
        texts: only,
        video: info,
        tiktokMode,
      })
      last = report
      if (report.pass) return report
      feedback.length = 0
      feedback.push(...report.violations)
    }
    throw new FlagNow(
      `Compliance could not clear the text after ${cap} tries. ${last?.violations.slice(0, 3).join(' ') ?? ''}`,
    )
  }

  async run(r: PublishRun): Promise<PublishResult> {
    const ep = this.d.episodes.get(r.episodeId)
    const pkg = this.d.episodes.getPackage(r.episodeId)
    if (!pkg) throw new FlagNow('The episode has no package.')
    const cfg = this.d.cfg.get()
    const brand = this.d.cfg.getBrand(ep.brandId)
    const brandName = (
      this.d.db.prepare('SELECT name FROM brands WHERE id = ?').get(ep.brandId) as { name: string }
    ).name
    const isShort = brand.format === 'short'
    const mock = cfg.mockMode
    const mockVideo = r.mock === true
    this.d.episodes.setStatus(r.episodeId, 'Checking video', 'Thumbnail, text and compliance.')

    // where the video is right now
    const existing = r.postId ? this.d.posts.get(r.postId) : null
    let video = r.videoPath ?? (existing ? this.d.media.resolve(existing.videoPath) : null)
    if (!video || !existsSync(video)) throw new FlagNow('The finished video file is missing.')

    // 1. thumbnails for every platform
    const thumbs = await this.d.thumbnailer.make(r.episodeId, video)
    // Shorts: YouTube cannot take a custom thumbnail by API, so the opening frame of the video is the thumbnail.
    if (isShort && brand.openingFrame && brand.platforms.youtube && !existing && thumbs.coverFile) {
      const info = await probe(video)
      const dir = mkdtempSync(join(tmpdir(), 'elo-open-'))
      try {
        const still = join(dir, 'still.mp4')
        await stillVideo(thumbs.coverFile, 0.25, info.width, info.height, still)
        const out = join(this.d.workDir(r.episodeId), 'final-open.mp4')
        await assemble({
          segments: [{ path: still }, { path: video }],
          out,
          width: info.width,
          height: info.height,
          crossfade: 0,
          lufs: -14,
        })
        video = out
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    // 2. text and compliance
    const vinfo = await probe(video)
    const video2 = {
      durationSeconds: vinfo.durationSeconds,
      width: vinfo.width,
      height: vinfo.height,
      sizeBytes: statSync(video).size,
    }
    const wanted = (Object.keys(brand.platforms) as Array<keyof typeof brand.platforms>).filter(
      (p) => brand.platforms[p],
    )
    const tiktokAcc = this.d.db
      .prepare("SELECT mode FROM accounts WHERE brand_id = ? AND platform = 'tiktok'")
      .get(ep.brandId) as { mode: string } | undefined
    const report = await this.texts(
      r.episodeId,
      ep.brandId,
      brandName,
      wanted,
      isShort,
      video2,
      tiktokAcc?.mode ?? null,
    )
    const ok = (p: string) => report.platforms[p]?.ok && !report.platforms[p]?.skipped
    const skipped = Object.entries(report.platforms)
      .filter(([, v]) => v.skipped)
      .map(([platform, v]) => ({ platform, reason: v.reason ?? '' }))

    // 3. real world gaps that skip one platform
    const notReady = !mock && ok('bluesky') ? this.d.socialReady(ep.brandId) : null
    if (notReady) {
      skipped.push({ platform: 'bluesky', reason: notReady })
      report.platforms.bluesky = {
        ...report.platforms.bluesky,
        ok: false,
        skipped: true,
        reason: notReady,
      }
    }

    // 4. per platform covers
    const settingsFor = async (p: Platform): Promise<PostTargetInput['settings']> => {
      if (p === 'youtube' && !isShort && thumbs.youtubeLongFile)
        return { thumbnailPath: thumbs.youtubeLongFile }
      if (p === 'instagram') {
        if (thumbs.coverFile && this.d.host.configured() && !mock) {
          const up = await this.d.host.upload(thumbs.coverFile, `covers/${r.episodeId}.jpg`)
          return { coverUrl: up.url }
        }
        return { thumbOffsetMs: thumbs.bestFrameMs }
      }
      if (p === 'tiktok') return { coverTimestampMs: thumbs.bestFrameMs }
      return undefined
    }
    const targets: PostTargetInput[] = []
    for (const p of FOUR) {
      if (!ok(p)) continue
      const t = report.texts[p]
      let text =
        p === 'youtube'
          ? report.texts.youtube?.description
          : (t as { caption?: string } | undefined)?.caption
      if (p === 'youtube' && text && this.d.cfg.get().autoChapters && this.d.chapters) {
        const lines = await this.d.chapters(r.episodeId).catch(() => null)
        if (lines && !/^0:00 /m.test(text)) text = `${text}\n\n${lines}`
      }
      const cover = await settingsFor(p)
      targets.push({
        platform: p,
        aiFlag: brand.aiDisclosure,
        captionOverride: text ?? null,
        settings: mockVideo ? { ...(cover ?? {}), mock: true } : cover,
      })
    }

    // 5. schedule
    const when = this.slotFor(ep.brandId, ep.slotDate)
    const title = report.texts.youtube?.title ?? pkg.youtube.title ?? pkg.title
    const caption =
      report.texts.youtube?.description ??
      targets.find((t) => t.captionOverride)?.captionOverride ??
      pkg.youtube.description
    let postId: number | null = null
    let videoAbs = video
    if (targets.length) {
      if (existing && r.postId) {
        this.d.posts.update(r.postId, {
          title,
          caption,
          scheduledAtUtc: when,
          status: when ? 'scheduled' : 'draft',
          targets,
        })
        postId = r.postId
      } else {
        const post = await this.d.posts.create({
          brandId: ep.brandId,
          sourcePath: video,
          title,
          caption,
          scheduledAtUtc: when,
          status: when ? 'scheduled' : 'draft',
          targets,
        })
        postId = post.id
      }
      const queued = this.d.media.resolve(
        (this.d.posts.get(postId) as { videoPath: string }).videoPath,
      )
      videoAbs = queued
      if (r.srt && existsSync(r.srt))
        copyFileSync(r.srt, queued.slice(0, queued.length - extname(queued).length) + '.srt')
    }
    // Bluesky
    let social = 0
    for (const p of ['bluesky'] as const) {
      if (!ok(p) || !when) continue
      const text = (report.texts[p] as { text: string }).text
      this.d.social.add({
        episodeId: r.episodeId,
        brandId: ep.brandId,
        platform: p,
        text,
        videoPath: videoAbs,
        title,
        scheduledAtUtc: when,
        mock: mock || mockVideo,
      })
      social++
    }
    for (const s of skipped)
      this.d.db
        .prepare(
          'INSERT INTO audit_log (ts_utc, brand_id, agent, action, episode_id, detail_json) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          new Date(this.now()).toISOString(),
          ep.brandId,
          'Compliance',
          'platform_skipped',
          r.episodeId,
          JSON.stringify(s),
        )

    // 6. record and finish
    const saved = this.d.episodes.getPackage(r.episodeId)
    if (saved)
      this.d.episodes.savePackage(r.episodeId, {
        ...saved,
        extra: {
          ...(saved.extra ?? {}),
          compliance: { platforms: report.platforms, log: report.log, kids: report.kids },
          publish: { skipped, social },
        },
      })
    this.d.episodes.setStatus(
      r.episodeId,
      'Scheduled',
      when ? `Scheduled for ${when}.` : 'No open slot found. Left as a draft.',
      { postId, scheduledAtUtc: when, videoPath: videoAbs },
    )
    if (!isShort && ok('youtube') && thumbs.candidates.length >= 2)
      this.d.tester.register(r.episodeId, ep.brandId, postId, thumbs.candidates.slice(0, 2))
    return { postId, scheduledAtUtc: when, skipped, social }
  }
}

const Input = z.object({
  episodeId: z.string(),
  videoPath: z.string().optional(),
  srt: z.string().optional(),
  postId: z.number().optional(),
  mock: z.boolean().optional(),
})
const Output = z.object({
  postId: z.number().nullable(),
  scheduledAtUtc: z.string().nullable(),
  skipped: z.array(z.object({ platform: z.string(), reason: z.string() })),
  social: z.number(),
})

export function makePublisherAgent(
  p: Publisher,
): AgentDef<z.infer<typeof Input>, z.infer<typeof Output>> {
  return {
    name: 'Publisher',
    taskType: 'publish_episode',
    role: 'Writes the title and text for every platform, attaches the thumbnail or cover, runs Compliance, and schedules the video everywhere it is allowed.',
    input: Input,
    output: Output,
    tools: ['thumbnail', 'compliance', 'scheduler', 'bluesky'],
    paid: true,
    async run(_ctx, input) {
      return p.run(input)
    },
  }
}
