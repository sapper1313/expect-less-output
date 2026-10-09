import { copyFileSync, existsSync } from 'fs'
import { dirname, extname, join } from 'path'
import type { Db } from '../db'
import type { Library as MediaLibrary } from '../services/library'
import type { PostService } from '../services/posts'
import { slotToUtc } from '@shared/studio/cadence'
import type { StudioConfigService } from './configService'
import type { EpisodeLibrary } from './library'
import type { Platform } from '@shared/types'

export interface PublishDeps {
  db: Db
  cfg: StudioConfigService
  episodes: EpisodeLibrary
  posts: PostService
  media: MediaLibrary
  now?: () => number
}

const FOUR: Platform[] = ['youtube', 'facebook', 'instagram', 'tiktok']

/**
 * Puts a finished video into the existing scheduler queue at the brand's slot time. The scheduler already knows how to
 * hand it to each platform, retry, move it to the Posted folder and alert on failure.
 */
export class Publisher {
  constructor(private d: PublishDeps) {}

  /** The first open slot on or after the episode's planned date, never in the past. */
  slotFor(brandId: number, slotDate: string | null): string | null {
    const from = Math.max(slotDate ? new Date(slotToUtc(slotDate, '00:00')).getTime() : 0, (this.d.now ? this.d.now() : Date.now()) + 60_000)
    return this.d.posts.nextSlots(brandId, 1, new Date(from).toISOString())[0] ?? null
  }

  async schedule(episodeId: string, finalVideo: string, srt?: string): Promise<{ postId: number; scheduledAtUtc: string | null }> {
    const ep = this.d.episodes.get(episodeId)
    const pkg = this.d.episodes.getPackage(episodeId)
    if (!pkg) throw new Error('The episode has no package.')
    const brand = this.d.cfg.getBrand(ep.brandId)
    const when = this.slotFor(ep.brandId, ep.slotDate)
    const caption = (pkg.extra?.caption as string | undefined) ?? pkg.youtube.description
    const hashtags = ((pkg.extra?.hashtags as string[] | undefined) ?? []).join(' ')
    const targets = FOUR.filter((p) => brand.platforms[p as keyof typeof brand.platforms]).map((platform) => ({ platform, aiFlag: brand.aiDisclosure }))
    const post = await this.d.posts.create({
      brandId: ep.brandId,
      sourcePath: finalVideo,
      title: pkg.youtube.title || pkg.title,
      caption: hashtags ? `${caption}\n\n${hashtags}` : caption,
      scheduledAtUtc: when,
      status: when ? 'scheduled' : 'draft',
      targets,
    })
    if (srt && existsSync(srt)) {
      const queued = this.d.media.resolve(post.videoPath)
      const dest = join(dirname(queued), queued.slice(dirname(queued).length + 1).replace(new RegExp(`${extname(queued)}$`), '') + '.srt')
      copyFileSync(srt, dest)
    }
    this.d.episodes.setStatus(episodeId, 'Scheduled', when ? `Scheduled for ${when}.` : 'No open slot found. Left as a draft.', {
      postId: post.id,
      scheduledAtUtc: when,
      videoPath: this.d.media.resolve(post.videoPath),
    })
    return { postId: post.id, scheduledAtUtc: when }
  }
}
