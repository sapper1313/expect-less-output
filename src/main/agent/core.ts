import { lstatSync } from 'fs'
import { basename, extname, isAbsolute } from 'path'
import { DateTime } from 'luxon'
import type { ActivityLog } from '../services/activity'
import type { BrandService } from '../services/brands'
import type { PostService } from '../services/posts'
import type { SettingsService } from '../services/settings'
import type { Scheduler } from '../scheduler/scheduler'
import { applyCaptionTemplate, titleFromFilename } from '@shared/text'
import { formatEastern } from '@shared/time'
import { SOFT_WARN_POSTS_PER_BRAND_PER_DAY, type Platform } from '@shared/platformLimits'
import type { CreatePostInput, UpdatePostInput } from '@shared/agentSchemas'
import type {
  Post,
  PostFilter,
  PostTargetInput,
  PostUpdate,
  TikTokPostSettings,
} from '@shared/types'
import { emptyTikTokSettings } from '@shared/tiktok'

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'drafts_only'
  | 'studio_locked'
  | 'not_found'
  | 'validation'
  | 'bad_request'
  | 'conflict'
  | 'method_not_allowed'
  | 'server_error'

export class AgentError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

export const STUDIO_LOCKED_MESSAGE =
  'Agents can read Studio spend and flagged tasks but cannot change anything there right now. The owner can turn on "Agents may change Studio settings" in Settings, Agent API.'

/** Studio changes (spend caps, Bible skills, retries, rebuilds, pauses) are off unless the owner allows them. */
export function requireStudioWrite(s: AgentServices): void {
  if (!s.settings.get().agentMayChangeStudio)
    throw new AgentError(403, 'studio_locked', STUDIO_LOCKED_MESSAGE, {
      setting: 'agentMayChangeStudio',
    })
}

export const DRAFTS_ONLY_MESSAGE =
  'Agents are limited to drafts right now. Create the post with status "draft" and let the owner schedule it, or the owner can turn on "Agents may schedule" in Settings.'

export interface AgentServices {
  settings: SettingsService
  brands: BrandService
  posts: PostService
  scheduler: Scheduler
  log: ActivityLog
  appVersion: string
  /** Health data assembled by the app (accounts, quota, scheduler). */
  health: () => unknown
  /** Stats numbers. Missing in the Inbox watcher, which never reads them. */
  stats?: import('../stats/service').StatsService
  /** The studio Library, read only. Missing in the Inbox watcher. */
  episodes?: () => import('../studio/library').EpisodeLibrary
  /** The Studio actions agents may use. Writes need "Agents may change Studio settings". Missing in the Inbox watcher. */
  studio?: () => Pick<
    import('../studio/studio').Studio,
    | 'spendSummary'
    | 'setConfig'
    | 'setBrand'
    | 'bible'
    | 'importSkill'
    | 'removeSkillWithBackup'
    | 'flagged'
    | 'resolveFlag'
    | 'rebuildEpisode'
  >
  now?: () => number
  /** The drop log. Missing in tests that do not need it. */
  drops?: import('../pipeline/dropLog').DropLog
  /** The reconcile check. Missing in tests that do not need it. */
  reconciler?: import('../pipeline/reconcile').Reconciler
  /** The app-wide audit log. */
  audit?: import('../pipeline/auditEvents').AuditEvents
  /** Per bot tokens. Without it only the owner's token works. */
  bots?: import('./bots').BotStore
  /** Puts a drop into a channel Inbox and returns the decision. */
  pipeline?: {
    receive(
      channelSlug: string,
      sidecar: Record<string, unknown>,
      filePath: string | null,
      actor: string,
    ): Promise<import('@shared/pipeline').DropRow | null>
  }
}

const ALLOWED_VIDEO = ['.mp4', '.mov']

/** A real, non-empty .mp4 or .mov file at an absolute path. Symlinks are refused. */
export function validateVideoFile(path: string): void {
  if (!isAbsolute(path))
    throw new AgentError(
      400,
      'bad_request',
      'file_path must be an absolute path, for example /Users/me/Movies/clip.mp4.',
      { field: 'file_path' },
    )
  if (!ALLOWED_VIDEO.includes(extname(path).toLowerCase()))
    throw new AgentError(400, 'bad_request', 'file_path must be an .mp4 or .mov video.', {
      field: 'file_path',
    })
  let st: ReturnType<typeof lstatSync>
  try {
    st = lstatSync(path)
  } catch {
    throw new AgentError(400, 'bad_request', `No file exists at ${path}.`, { field: 'file_path' })
  }
  if (st.isSymbolicLink())
    throw new AgentError(
      400,
      'bad_request',
      'file_path must be the real file, not a shortcut (symlink).',
      { field: 'file_path' },
    )
  if (!st.isFile() || st.size === 0)
    throw new AgentError(400, 'bad_request', 'file_path must be a regular, non-empty video file.', {
      field: 'file_path',
    })
}

const toUtc = (t: string): string =>
  DateTime.fromISO(t, { setZone: true }).toUTC().toISO() as string

function mapTikTok(
  t: NonNullable<CreatePostInput['tiktok']>,
  base?: TikTokPostSettings,
): TikTokPostSettings {
  const s = { ...(base ?? emptyTikTokSettings()) }
  if (t.privacy !== undefined) s.privacy = t.privacy
  if (t.allow_comment !== undefined) s.allowComment = t.allow_comment
  if (t.allow_duet !== undefined) s.allowDuet = t.allow_duet
  if (t.allow_stitch !== undefined) s.allowStitch = t.allow_stitch
  if (t.commercial_content) {
    s.commercialOn = !!(t.commercial_content.your_brand || t.commercial_content.branded_content)
    s.yourBrand = !!t.commercial_content.your_brand
    s.brandedContent = !!t.commercial_content.branded_content
  }
  if (t.consent !== undefined) s.consent = t.consent
  return s
}

/** Turns errors from the shared services (which are written for the UI) into API errors. */
function wrap<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    if (e instanceof AgentError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (/not found/i.test(msg)) throw new AgentError(404, 'not_found', msg)
    throw new AgentError(400, 'bad_request', msg)
  }
}
async function wrapAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof AgentError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (/already going out|cannot be moved|already scheduled inside/i.test(msg))
      throw new AgentError(409, 'conflict', msg)
    if (/not found/i.test(msg)) throw new AgentError(404, 'not_found', msg)
    throw new AgentError(400, 'bad_request', msg)
  }
}

export const draftsOnly = (s: AgentServices): boolean => !s.settings.get().agentMaySchedule

function connectedPlatforms(
  s: AgentServices,
  brandId: number,
): Map<Platform, { needsReauth: boolean; name: string }> {
  const m = new Map<Platform, { needsReauth: boolean; name: string }>()
  for (const a of s.brands.listAccounts(brandId))
    m.set(a.platform, { needsReauth: a.status === 'needs_reauth', name: a.displayName ?? '' })
  return m
}

/** Create a post for an agent. The same function serves the HTTP API and the watched folder. */
export async function agentCreatePost(
  s: AgentServices,
  body: CreatePostInput,
  opts: { source: 'api' | 'inbox'; moveSource?: boolean },
): Promise<Post & { warnings: string[] }> {
  if (draftsOnly(s) && (body.status === 'scheduled' || body.next_slot)) {
    throw new AgentError(403, 'drafts_only', DRAFTS_ONLY_MESSAGE, {
      requested: body.status === 'scheduled' ? 'status: scheduled' : 'next_slot: true',
    })
  }
  const brand = wrap(() => s.brands.get(body.brand_id))
  if (brand.archived) throw new AgentError(400, 'bad_request', `${brand.name} is archived.`)
  validateVideoFile(body.file_path)

  const accounts = connectedPlatforms(s, brand.id)
  const platforms: Platform[] = body.platforms ?? [...accounts.keys()]
  if (platforms.length === 0)
    throw new AgentError(400, 'bad_request', `${brand.name} has no platforms to post to.`)
  for (const p of platforms) {
    const a = accounts.get(p)
    if (!a)
      throw new AgentError(400, 'bad_request', `${p} is not set up for ${brand.name}.`, {
        field: 'platforms',
      })
    if (a.needsReauth)
      throw new AgentError(
        400,
        'bad_request',
        `${p} for ${brand.name} needs the owner to sign in again.`,
        { field: 'platforms' },
      )
  }

  const defaults = s.brands.getDefaults(brand.id)
  const title = (body.title?.trim() || titleFromFilename(basename(body.file_path))).trim()
  const set = s.brands.listHashtags(brand.id).find((h) => h.id === defaults.defaultHashtagSetId)
  const caption =
    body.caption ??
    applyCaptionTemplate(defaults.captionTemplate, {
      title,
      hashtags: set?.tagsText ?? '',
      brand: brand.name,
    })

  let scheduledAtUtc: string | null = null
  if (body.next_slot) {
    const slot = s.posts.nextSlots(brand.id, 1)[0]
    if (!slot)
      throw new AgentError(
        409,
        'conflict',
        `${brand.name} has no open slots. The owner needs to add slot times first.`,
      )
    scheduledAtUtc = slot
  } else if (body.scheduled_at) {
    scheduledAtUtc = toUtc(body.scheduled_at)
  }
  const nowMs = s.now ? s.now() : Date.now()
  if (
    body.status === 'scheduled' &&
    scheduledAtUtc &&
    new Date(scheduledAtUtc).getTime() < nowMs - 60_000
  ) {
    throw new AgentError(400, 'bad_request', 'scheduled_at is in the past.', {
      field: 'scheduled_at',
    })
  }

  const targets: PostTargetInput[] = platforms.map((p) => ({
    platform: p,
    aiFlag: body.ai_flags?.[p] ?? defaults.aiFlag[p],
    captionOverride: body.caption_overrides?.[p] ?? null,
    settings: {
      ...(p === 'instagram' && body.thumb_offset_ms !== undefined
        ? { thumbOffsetMs: body.thumb_offset_ms }
        : {}),
      ...(p === 'tiktok' && body.tiktok ? { tiktok: mapTikTok(body.tiktok) } : {}),
    },
  }))

  const warnings: string[] = []
  if (
    scheduledAtUtc &&
    s.posts.countOnDay(brand.id, scheduledAtUtc) >= SOFT_WARN_POSTS_PER_BRAND_PER_DAY
  ) {
    warnings.push(
      `${brand.name} already has ${SOFT_WARN_POSTS_PER_BRAND_PER_DAY} or more posts that day.`,
    )
  }

  const post = await wrapAsync(() =>
    s.posts.create({
      brandId: brand.id,
      sourcePath: body.file_path,
      moveSource: opts.moveSource,
      title,
      caption,
      scheduledAtUtc,
      status: body.status,
      targets,
    }),
  )
  s.log.log(
    'info',
    `Agent (${opts.source}): created ${post.status} post "${post.title}" for ${brand.name}${scheduledAtUtc ? ` at ${formatEastern(scheduledAtUtc)}` : ''}.`,
    { postId: post.id },
  )
  return { ...post, warnings }
}

export async function agentUpdatePost(
  s: AgentServices,
  id: number,
  body: UpdatePostInput,
): Promise<Post> {
  const post = s.posts.get(id)
  if (!post) throw new AgentError(404, 'not_found', `No post with id ${id}.`)
  if (post.status === 'posted' || post.status === 'in_progress')
    throw new AgentError(
      409,
      'conflict',
      `This post is ${post.status.replace('_', ' ')} and cannot be changed.`,
    )
  if (draftsOnly(s)) {
    if (body.status === 'scheduled')
      throw new AgentError(403, 'drafts_only', DRAFTS_ONLY_MESSAGE, {
        requested: 'status: scheduled',
      })
    if (post.status !== 'draft')
      throw new AgentError(
        403,
        'drafts_only',
        'Agents are limited to drafts right now, and this post is not a draft. The owner can turn on "Agents may schedule" in Settings.',
        { post_status: post.status },
      )
  }
  const patch: PostUpdate = {}
  if (body.title !== undefined) patch.title = body.title
  if (body.caption !== undefined) patch.caption = body.caption
  if (body.scheduled_at !== undefined)
    patch.scheduledAtUtc = body.scheduled_at === null ? null : toUtc(body.scheduled_at)
  if (body.status) patch.status = body.status
  if (patch.status === 'scheduled') {
    const when = patch.scheduledAtUtc !== undefined ? patch.scheduledAtUtc : post.scheduledAtUtc
    if (!when)
      throw new AgentError(
        400,
        'bad_request',
        'A scheduled post needs a time. Send scheduled_at too.',
        { field: 'scheduled_at' },
      )
  }
  if (
    body.platforms ||
    body.caption_overrides ||
    body.ai_flags ||
    body.tiktok ||
    body.thumb_offset_ms !== undefined
  ) {
    const accounts = connectedPlatforms(s, post.brandId)
    const existing = new Map(post.targets.map((t) => [t.platform, t]))
    const platforms: Platform[] =
      body.platforms ?? post.targets.filter((t) => t.status !== 'skipped').map((t) => t.platform)
    const defaults = s.brands.getDefaults(post.brandId)
    patch.targets = platforms.map((p) => {
      if (!accounts.has(p))
        throw new AgentError(400, 'bad_request', `${p} is not set up for ${post.brandName}.`, {
          field: 'platforms',
        })
      const e = existing.get(p)
      return {
        platform: p,
        aiFlag: body.ai_flags?.[p] ?? e?.aiFlag ?? defaults.aiFlag[p],
        captionOverride: body.caption_overrides?.[p] ?? e?.captionOverride ?? null,
        settings: {
          thumbOffsetMs:
            p === 'instagram' && body.thumb_offset_ms !== undefined
              ? body.thumb_offset_ms
              : e?.settings.thumbOffsetMs,
          tiktok:
            p === 'tiktok' && body.tiktok
              ? mapTikTok(body.tiktok, e?.settings.tiktok)
              : e?.settings.tiktok,
        },
      }
    })
  }
  const updated = await wrapAsync(async () => s.posts.update(id, patch))
  s.log.log(
    'info',
    `Agent (api): changed post "${updated.title}" (${Object.keys(body).join(', ')}).`,
    { postId: id },
  )
  return updated
}

export function agentCancelPost(s: AgentServices, id: number): Post {
  const post = s.posts.get(id)
  if (!post) throw new AgentError(404, 'not_found', `No post with id ${id}.`)
  if (post.status === 'canceled')
    throw new AgentError(409, 'conflict', 'This post is already canceled.')
  if (post.status === 'posted')
    throw new AgentError(409, 'conflict', 'This post already went out and cannot be canceled.')
  s.posts.cancel([id])
  s.log.log('info', `Agent (api): canceled post "${post.title}".`, { postId: id })
  return s.posts.get(id) as Post
}

export function agentRetryPost(s: AgentServices, id: number): { post: Post; retried: number[] } {
  const post = s.posts.get(id)
  if (!post) throw new AgentError(404, 'not_found', `No post with id ${id}.`)
  const failed = post.targets.filter((t) => t.status === 'failed')
  if (failed.length === 0)
    throw new AgentError(
      409,
      'conflict',
      'No platform of this post has failed, so there is nothing to retry.',
    )
  for (const t of failed) s.scheduler.retryTarget(t.id)
  s.log.log('info', `Agent (api): retried ${failed.length} platform(s) of "${post.title}".`, {
    postId: id,
  })
  return { post: s.posts.get(id) as Post, retried: failed.map((t) => t.id) }
}

export function listFilter(q: {
  brand_id?: number
  status?: string
  from?: string
  to?: string
  search?: string
  origin?: string
  held?: string
}): PostFilter {
  return {
    origin: q.origin as PostFilter['origin'],
    held: q.held === undefined ? undefined : q.held === 'true',
    brandId: q.brand_id ?? null,
    status: (q.status as PostFilter['status']) ?? 'all',
    fromUtc: q.from ? toUtc(q.from) : undefined,
    toUtc: q.to ? toUtc(q.to) : undefined,
    search: q.search,
  }
}

export { toUtc }
