import { mkdirSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { Db } from '../db'
import type { LlmGateway } from './agents/llm'
import type { EpisodeLibrary } from './library'
import { ffmpeg, probe } from './ffmpeg'
import { bestWindows } from '@shared/studio/clips'
import type { Post, PostInput } from '@shared/types'

export interface ClipDeps {
  db: Db
  gateway: LlmGateway
  episodes: EpisodeLibrary
  /** Absolute path of a video that lives in the Media Root. */
  resolve: (relative: string) => string
  createPost: (input: PostInput) => Promise<Post>
  brandName: (id: number) => string
  aiDisclosure: (brandId: number) => boolean
  workDir: (episodeId: string) => string
  /** Test hook: replaces ffmpeg. */
  cut?: (input: string, start: number, seconds: number, out: string) => Promise<void>
}

const Words = z.object({
  clips: z.array(z.object({ title: z.string(), caption: z.string() })).default([]),
})

export interface MadeClip {
  postId: number
  title: string
  start: number
  seconds: number
}

/** Cuts the best parts of a long video into vertical shorts and leaves each one as a draft post to review. */
export class ClipCutter {
  constructor(private d: ClipDeps) {}

  async make(episodeId: string, count = 3): Promise<MadeClip[]> {
    const ep = this.d.episodes.find(episodeId)
    const pkg = this.d.episodes.getPackage(episodeId)
    if (!ep || !pkg) throw new Error('That episode was not found.')
    if (!ep.videoPath) throw new Error('This episode has no video yet, or the video was removed.')
    const wins = bestWindows(pkg, Math.max(1, Math.min(6, count)))
    if (!wins.length)
      throw new Error('This video does not have enough separate scenes to cut shorts from.')
    const input = this.d.resolve(ep.videoPath)
    const total = pkg.scenes.reduce((n, s) => n + s.content_seconds, 0)
    const real = (await probe(input)).durationSeconds
    // The finished video can run a little long or short against the script. Scale the cut points to match.
    const factor = total > 0 && real / total > 0.8 && real / total < 1.25 ? real / total : 1

    const words = await (async (): Promise<z.infer<typeof Words>['clips']> => {
      try {
        const out = await this.d.gateway.json(
          {
            agent: 'Clip Scout',
            brandId: ep.brandId,
            episodeId,
            system:
              'You write a title (under 60 characters) and a one or two sentence caption for each short clip cut from a longer video. Plain, friendly words, no clickbait, and never use em dashes. Answer only with JSON: {"clips":[{"title":"","caption":""}]} with one entry per clip, in order.',
            user: `Video: ${pkg.title}\n${wins
              .map(
                (w, i) =>
                  `Clip ${i + 1}: ${w.sceneIndexes
                    .map((k) => pkg.scenes[k].action)
                    .join(' ')
                    .slice(0, 260)}`,
              )
              .join('\n')}`,
            maxTokens: 1500,
          },
          Words,
        )
        return out.clips
      } catch {
        return []
      }
    })()

    const dir = join(this.d.workDir(episodeId), 'clips')
    mkdirSync(dir, { recursive: true })
    const mockSource = !!(
      ep.postId &&
      this.d.db
        .prepare(
          'SELECT settings_json FROM post_targets WHERE post_id = ? AND settings_json LIKE \'%"mock":true%\' LIMIT 1',
        )
        .get(ep.postId)
    )
    const made: MadeClip[] = []
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i]
      const out = join(dir, `${episodeId}-short-${i + 1}.mp4`)
      const start = Math.min(Math.max(0, w.start * factor), Math.max(0, real - 5))
      const len = Math.min(w.seconds * factor, real - start)
      await (this.d.cut ?? this.crop)(input, start, len, out)
      const title = (words[i]?.title || `${pkg.title}, part ${i + 1}`).slice(0, 90)
      const caption = words[i]?.caption || pkg.summary
      const post = await this.d.createPost({
        brandId: ep.brandId,
        sourcePath: out,
        moveSource: true,
        title,
        caption,
        scheduledAtUtc: null,
        status: 'draft',
        targets: [
          {
            platform: 'youtube',
            aiFlag: this.d.aiDisclosure(ep.brandId),
            captionOverride: caption,
            settings: mockSource ? { mock: true } : undefined,
          },
        ],
      })
      made.push({ postId: post.id, title, start: Math.round(start), seconds: Math.round(len) })
    }
    return made
  }

  /** The middle of a 16:9 frame becomes a 9:16 short. */
  private crop = async (
    input: string,
    start: number,
    seconds: number,
    out: string,
  ): Promise<void> => {
    await ffmpeg([
      '-ss',
      String(start),
      '-i',
      input,
      '-t',
      String(seconds),
      '-vf',
      'crop=ih*9/16:ih,scale=1080:1920,setsar=1',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '21',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      out,
    ])
  }
}
