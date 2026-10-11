import { mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { Db } from '../db'
import { SEED_GUIDELINES } from '@shared/studio/thumbnailGuidelines'
import {
  bestFrameMs,
  composeThumbnail,
  extractFrame,
  findFont,
  fitJpeg,
  grayStats,
  probe,
  scaleImage,
} from './ffmpeg'
import type { StudioConfigService } from './configService'
import { expandHome } from './configService'
import type { EpisodeLibrary } from './library'
import type { SpendService } from './spend'
import type { LocalAi } from './localAi'
import type { LlmGateway } from './agents/llm'
import type { ImageClient } from './xai'
import type { AuditLog } from './agents/framework'
import { ctxLine } from './agents/prompts'

// ---------------------------------------------------------------- guidelines (versioned)

export interface GuidelineVersion {
  id: number
  createdUtc: string
  text: string
  note: string
  source: string
}

/** thumbnail_guidelines.md with full history and a Revert. */
export class Guidelines {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  private ensure() {
    const n = (
      this.db.prepare('SELECT COUNT(*) AS n FROM guideline_versions').get() as { n: number }
    ).n
    if (!n) this.save(SEED_GUIDELINES, 'Seeded with the starting best practices.', 'seed')
  }

  current(): GuidelineVersion {
    this.ensure()
    return this.map(
      this.db.prepare('SELECT * FROM guideline_versions ORDER BY id DESC LIMIT 1').get(),
    )
  }

  history(): GuidelineVersion[] {
    this.ensure()
    return (
      this.db
        .prepare('SELECT * FROM guideline_versions ORDER BY id DESC LIMIT 100')
        .all() as unknown[]
    ).map((r) => this.map(r))
  }

  save(text: string, note: string, source = 'owner'): GuidelineVersion {
    const id = Number(
      this.db
        .prepare(
          'INSERT INTO guideline_versions (created_utc, text, note, source) VALUES (?, ?, ?, ?)',
        )
        .run(new Date(this.now()).toISOString(), text, note, source).lastInsertRowid,
    )
    return this.map(this.db.prepare('SELECT * FROM guideline_versions WHERE id = ?').get(id))
  }

  /** Makes an older version current again by saving it as a new version. History is never rewritten. */
  revert(id: number): GuidelineVersion {
    const old = this.db.prepare('SELECT * FROM guideline_versions WHERE id = ?').get(id) as
      { text: string } | undefined
    if (!old) throw new Error('That version does not exist.')
    return this.save(old.text, `Reverted to version ${id}.`, 'revert')
  }

  private map(r: any): GuidelineVersion {
    return { id: r.id, createdUtc: r.created_utc, text: r.text, note: r.note, source: r.source }
  }
}

/** A line diff, for the log. */
export function lineDiff(a: string, b: string): { added: string[]; removed: string[] } {
  const A = new Set(a.split('\n'))
  const B = new Set(b.split('\n'))
  return {
    added: [...B].filter((l) => l.trim() && !A.has(l)),
    removed: [...A].filter((l) => l.trim() && !B.has(l)),
  }
}

// ---------------------------------------------------------------- thumbnail agent

export interface Candidate {
  id: string
  file: string
  headline: string
  score: number
  notes: string[]
  textDrawn: boolean
  background: 'generated' | 'video_frame'
}

export interface ThumbnailSet {
  guidelinesVersion: number
  candidates: Candidate[]
  winner: string
  /** 16:9 for long form, 1080x1920 for Shorts and Reels covers. */
  winnerFile: string
  previewFile: string
  /** Best frame of the video, for TikTok and Instagram frame selection. */
  bestFrameMs: number
  youtubeLongFile: string | null
  coverFile: string | null
  centerCropOk: boolean
}

const Concepts = z.object({
  concepts: z
    .array(
      z.object({
        headline: z.string().min(1),
        image_prompt: z.string().default(''),
        use_video_frame: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(5),
})

const CHECK_PROMPT =
  'Rate this thumbnail from 0 to 10 for: text readable at a tiny size, one clear subject, strong contrast, friendly and honest. Answer with one line: SCORE: <number>.'

export interface ThumbDeps {
  db: Db
  cfg: StudioConfigService
  episodes: EpisodeLibrary
  spend: SpendService
  localAi: LocalAi
  gateway: LlmGateway
  guidelines: Guidelines
  audit: AuditLog
  image: () => ImageClient
  workDir: (episodeId: string) => string
  now?: () => number
}

/** Designs thumbnails and covers for every platform, scores them against the guidelines, and keeps the best. */
export class Thumbnailer {
  /** Tests turn this off to exercise the real scoring path in mock mode. */
  simulateVision: boolean | null = null

  constructor(private d: ThumbDeps) {}

  private words(s: string): number {
    return s.trim().split(/\s+/).filter(Boolean).length
  }

  async make(episodeId: string, videoPath: string): Promise<ThumbnailSet> {
    const cfg = this.d.cfg.get()
    const ep = this.d.episodes.get(episodeId)
    const pkg = this.d.episodes.getPackage(episodeId)
    if (!pkg) throw new Error('The episode has no package.')
    const brand = this.d.cfg.getBrand(ep.brandId)
    const isLong = brand.format === 'long'
    const guide = this.d.guidelines.current()
    const dir = join(this.d.workDir(episodeId), 'thumbs')
    mkdirSync(dir, { recursive: true })
    const info = await probe(videoPath)
    const mock = cfg.mockMode
    const font = findFont(cfg.thumbnailEngine.font)
    const count = Math.max(2, Math.min(3, cfg.thumbnailEngine.candidates))

    // 1. the plan: headlines and picture ideas
    const plan = await this.d.gateway.json(
      {
        agent: 'Thumbnail',
        brandId: ep.brandId,
        episodeId,
        system: `You design thumbnails for "${pkg.series}". Follow the guidelines. Give ${count} different concepts. Each has a headline of 3 to 5 words, an image prompt for the background, and whether to use a frame from the video instead. Never overpromise. Never use an em dash. Answer only with JSON: {"concepts":[{"headline":"","image_prompt":"","use_video_frame":false}]}\n\n${guide.text}`,
        user: `${ctxLine({ task: 'thumbnail_plan', title: pkg.title, hook: pkg.logline, count })}\nTitle: ${pkg.title}\nSummary: ${pkg.summary}\nLesson: ${pkg.life_lesson ?? ''}`,
        maxTokens: 2500,
      },
      Concepts,
    )

    // 2. the pictures
    const size = isLong ? { width: 1280, height: 720 } : { width: 1080, height: 1920 }
    const candidates: Candidate[] = []
    const ids = ['A', 'B', 'C']
    for (let i = 0; i < count; i++) {
      const c = plan.concepts[i % plan.concepts.length]
      const bg = join(dir, `bg-${ids[i]}.jpg`)
      let background: Candidate['background'] = 'video_frame'
      if (cfg.thumbnailEngine.generateImages && !c.use_video_frame && c.image_prompt) {
        const dollars = cfg.prices.image
        this.d.spend.check({ brandId: ep.brandId, episodeId, vendor: 'xai', dollars, mock })
        const r = await this.d
          .image()
          .generate(
            {
              model: cfg.modelIds.image,
              prompt: c.image_prompt,
              aspectRatio: isLong ? '16:9' : '9:16',
            },
            bg,
          )
        this.d.spend.record({
          brandId: ep.brandId,
          episodeId,
          vendor: 'xai',
          model: cfg.modelIds.image,
          units: 1,
          unitKind: 'images',
          unitPrice: dollars,
          dollars,
          requestId: r.requestId,
          purpose: 'thumbnail',
          mock,
        })
        background = 'generated'
      } else {
        await extractFrame(videoPath, info.durationSeconds * (0.25 + 0.25 * i), bg)
      }
      const out = join(dir, `${ids[i]}.jpg`)
      const { textDrawn } = await composeThumbnail({
        background: bg,
        out,
        width: size.width,
        height: size.height,
        headline: c.headline,
        font,
        centerSafe: !isLong,
      })
      if (isLong) await fitJpeg(out, 1.9 * 1024 * 1024)
      candidates.push({
        id: ids[i],
        file: out,
        headline: c.headline,
        score: 0,
        notes: [],
        textDrawn,
        background,
      })
    }

    // 3. score every candidate against the guidelines, then pick
    for (const c of candidates) await this.score(c, episodeId, ep.brandId, isLong)
    candidates.sort((a, b) => b.score - a.score)
    const winner = candidates[0]
    this.d.audit.write({
      agent: 'Thumbnail',
      action: 'chosen',
      brandId: ep.brandId,
      episodeId,
      detail: {
        winner: winner.id,
        scores: candidates.map((c) => [c.id, Number(c.score.toFixed(2))]),
        guidelinesVersion: guide.id,
      },
    })

    // 4. outputs for each platform
    const preview = join(expandHome(cfg.libraryDir), 'previews', `${episodeId}.jpg`)
    await scaleImage(winner.file, preview, 320)
    const bf = await bestFrameMs(videoPath, info.durationSeconds, join(dir, 'frames'))
    const set: ThumbnailSet = {
      guidelinesVersion: guide.id,
      candidates,
      winner: winner.id,
      winnerFile: winner.file,
      previewFile: preview,
      bestFrameMs: bf,
      youtubeLongFile: isLong ? winner.file : null,
      coverFile: isLong ? null : winner.file,
      centerCropOk: isLong ? true : await this.centerCropHolds(winner.file),
    }
    this.d.episodes.setFields(episodeId, { thumbPath: winner.file, previewPath: preview })
    const saved = this.d.episodes.getPackage(episodeId)
    if (saved)
      this.d.episodes.savePackage(episodeId, {
        ...saved,
        extra: {
          ...(saved.extra ?? {}),
          thumbnails: {
            guidelinesVersion: guide.id,
            winner: winner.id,
            candidates: candidates.map((c) => ({
              id: c.id,
              headline: c.headline,
              score: c.score,
              file: c.file,
            })),
            bestFrameMs: bf,
          },
        },
      })
    return set
  }

  private async score(
    c: Candidate,
    episodeId: string,
    brandId: number,
    isLong: boolean,
  ): Promise<void> {
    const g = await grayStats(c.file)
    let code = 0
    const notes: string[] = []
    const w = this.words(c.headline)
    if (w >= 1 && w <= 5) code += 0.3
    else notes.push(`Headline has ${w} words. 5 or fewer is best.`)
    if (c.textDrawn) code += 0.2
    else notes.push('No text could be drawn (no font found).')
    const contrast = Math.min(1, g.std / 55)
    code += 0.3 * contrast
    if (contrast < 0.4) notes.push('Low contrast.')
    const busy = Math.min(1, g.edges / 40)
    code += 0.2 * (1 - busy)
    if (busy > 0.8) notes.push('Very busy picture. One focal point reads better.')
    if (isLong && statSync(c.file).size > 2 * 1024 * 1024) {
      code = 0
      notes.push('Over 2 MB.')
    }
    let vision: number | null = null
    const simulate = this.simulateVision ?? this.d.cfg.get().mockMode
    if (simulate) {
      vision = 0.6 + (c.id.charCodeAt(0) % 3) * 0.1
      notes.push('Mock mode: small size check simulated.')
    } else {
      const small = `${c.file}.small.jpg`
      await scaleImage(c.file, small, 160)
      const fs = await import('fs')
      const r = await this.d.localAi.describeFrames(
        CHECK_PROMPT,
        [fs.readFileSync(small).toString('base64')],
        { brandId, episodeId },
      )
      const m = /score:\s*(\d+(?:\.\d+)?)/i.exec(r.text)
      if (m) vision = Math.min(1, Number(m[1]) / 10)
      else
        notes.push(
          r.via === 'ffmpeg-only'
            ? 'Small size vision check skipped (no vision model reachable).'
            : 'Vision check gave no score.',
        )
      fs.rmSync(small, { force: true })
    }
    c.score = 0.6 * code + 0.4 * (vision ?? code)
    c.notes = notes
  }

  /** A tall cover is shown by Instagram as a centered square on the profile grid. The headline must live inside that square. */
  async centerCropHolds(file: string): Promise<boolean> {
    // The headline is drawn centered by composeThumbnail with centerSafe. Check the center square has detail (contrast) too.
    const { ffmpeg } = await import('./ffmpeg')
    const tmp = `${file}.crop.jpg`
    await ffmpeg(['-i', file, '-vf', 'crop=iw:iw:0:(ih-iw)/2', '-frames:v', '1', tmp])
    const g = await grayStats(tmp)
    const fs = await import('fs')
    fs.rmSync(tmp, { force: true })
    return g.std > 20
  }
}
