import { z } from 'zod'
import { DateTime } from 'luxon'
import { formatEastern } from '@shared/time'
import type { PostOut } from '@shared/agentSchemas'
import type { Brand, Post } from '@shared/types'
import { PLATFORMS } from '@shared/platformLimits'
import {
  AgentError,
  agentCancelPost,
  agentCreatePost,
  agentRetryPost,
  agentUpdatePost,
  listFilter,
  toUtc,
  type AgentServices,
} from './core'

type PostJson = z.infer<typeof PostOut>

export function postOut(p: Post, warnings?: string[]): PostJson {
  return {
    id: p.id,
    brand_id: p.brandId,
    brand_name: p.brandName,
    title: p.title,
    caption: p.caption,
    status: p.status,
    scheduled_at: p.scheduledAtUtc,
    scheduled_at_eastern: p.scheduledAtUtc ? formatEastern(p.scheduledAtUtc) : null,
    file_name: p.fileName,
    duration_seconds:
      typeof p.videoMeta.durationSeconds === 'number' ? p.videoMeta.durationSeconds : null,
    targets: p.targets.map((t) => ({
      id: t.id,
      platform: t.platform,
      status: t.status,
      caption_override: t.captionOverride,
      ai_flag: t.aiFlag,
      attempts: t.attempts,
      last_error: t.lastError,
      external_url: t.externalUrl,
      progress: t.progress,
    })),
    ...(warnings && warnings.length ? { warnings } : {}),
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  }
}

function brandOut(s: AgentServices, b: Brand) {
  const d = s.brands.getDefaults(b.id)
  const sets = s.brands.listHashtags(b.id)
  const settings = s.settings.get()
  const accounts = s.brands.listAccounts(b.id)
  return {
    id: b.id,
    name: b.name,
    color: b.color,
    archived: b.archived,
    paused: settings.pausedBrandIds.includes(b.id),
    inbox_enabled: settings.inboxBrandIds.includes(b.id),
    slots: s.brands
      .getSlots(b.id)
      .map((x) => ({ day_type: x.dayType, time_local: x.timeLocal, enabled: x.enabled })),
    defaults: {
      caption_template: d.captionTemplate,
      default_hashtags: sets.find((h) => h.id === d.defaultHashtagSetId)?.tagsText ?? '',
      youtube_category_id: d.youtubeCategoryId,
      youtube_made_for_kids: d.youtubeMadeForKids,
      youtube_append_shorts: d.youtubeAppendShorts,
      instagram_share_to_feed: d.instagramShareToFeed,
      ai_flags: d.aiFlag as Record<string, boolean>,
    },
    hashtag_sets: sets.map((h) => ({ id: h.id, name: h.name, tags: h.tagsText })),
    platforms: PLATFORMS.map((p) => {
      const a = accounts.find((x) => x.platform === p)
      return {
        platform: p,
        connected: !!a && a.mode !== 'dry_run',
        mode: a?.mode ?? 'none',
        account_name: a && a.mode !== 'dry_run' ? a.displayName : null,
        needs_reauth: a?.status === 'needs_reauth',
      }
    }),
  }
}

function numbersOf(
  n: {
    views: number | null
    likes: number | null
    comments: number | null
    shares: number | null
  } | null,
) {
  return {
    views: n?.views ?? null,
    likes: n?.likes ?? null,
    comments: n?.comments ?? null,
    shares: n?.shares ?? null,
  }
}

interface Ctx {
  s: AgentServices
  params: any
  query: any
  body: any
}

/** One handler per route id. A test makes sure every route has one. */
export const HANDLERS: Record<string, (c: Ctx) => unknown | Promise<unknown>> = {
  listBrands: ({ s }) => ({ brands: s.brands.list(true).map((b) => brandOut(s, b)) }),

  nextOpenSlots: ({ s, query }) => {
    try {
      s.brands.get(query.brand_id)
    } catch {
      throw new AgentError(404, 'not_found', `No brand with id ${query.brand_id}.`)
    }
    const slots = s.posts.nextSlots(
      query.brand_id,
      query.count,
      query.from ? toUtc(query.from) : undefined,
    )
    return {
      brand_id: query.brand_id,
      slots: slots.map((at) => ({ at, eastern: formatEastern(at) })),
    }
  },

  createPost: async ({ s, body }) => {
    const post = await agentCreatePost(s, body, { source: 'api' })
    return postOut(post, post.warnings)
  },

  listPosts: ({ s, query }) => ({
    posts: s.posts
      .list(listFilter(query))
      .slice(0, query.limit)
      .map((p) => postOut(p)),
  }),

  getPost: ({ s, params }) => {
    const p = s.posts.get(params.id)
    if (!p) throw new AgentError(404, 'not_found', `No post with id ${params.id}.`)
    return postOut(p)
  },

  updatePost: async ({ s, params, body }) => postOut(await agentUpdatePost(s, params.id, body)),

  cancelPost: ({ s, params }) => postOut(agentCancelPost(s, params.id)),

  retryPost: ({ s, params }) => {
    const r = agentRetryPost(s, params.id)
    return { post: postOut(r.post), retried_targets: r.retried }
  },

  calendar: ({ s, query }) => {
    const from = query.from ? toUtc(query.from) : DateTime.utc().minus({ days: 7 }).toISO()!
    const to = query.to ? toUtc(query.to) : DateTime.utc().plus({ days: 60 }).toISO()!
    const posts = s.posts
      .list({ brandId: query.brand_id ?? null, fromUtc: from, toUtc: to })
      .filter((p) => p.scheduledAtUtc && p.status !== 'canceled')
    return {
      events: posts.map((p) => ({
        id: p.id,
        title: p.title,
        brand_id: p.brandId,
        brand_name: p.brandName,
        start: p.scheduledAtUtc as string,
        status: p.status,
        platforms: p.targets.map((t) => ({ platform: t.platform, status: t.status })),
      })),
    }
  },

  activity: ({ s, query }) => ({
    entries: s.log
      .list({ sinceUtc: query.since ? toUtc(query.since) : undefined, limit: query.limit })
      .map((e) => ({
        id: e.id,
        at: e.tsUtc,
        level: e.level,
        message: e.message,
        post_id: e.postId,
        platform: e.platform,
      })),
  }),

  health: ({ s }) => s.health(),

  postStats: ({ s, params }) => {
    const p = s.posts.get(params.id)
    if (!p) throw new AgentError(404, 'not_found', `No post with id ${params.id}.`)
    if (!s.stats) throw new AgentError(500, 'server_error', 'Stats are not available.')
    const st = s.stats.postStats(p.id)
    return {
      post_id: p.id,
      targets: st.targets.map((t) => ({
        platform: t.platform,
        state: t.state,
        reason: t.reason,
        fetched_at: t.latest?.fetchedAt ?? null,
        approximate: t.latest?.approximate ?? [],
        numbers: numbersOf(t.latest),
      })),
      totals: numbersOf(st.totals),
    }
  },

  brandStats: ({ s, params, query }) => {
    try {
      s.brands.get(params.id)
    } catch {
      throw new AgentError(404, 'not_found', `No brand with id ${params.id}.`)
    }
    if (!s.stats) throw new AgentError(500, 'server_error', 'Stats are not available.')
    const b = s.stats.brandSummary(params.id, query.range)
    return {
      brand_id: params.id,
      range: b.range,
      posts: b.posts,
      platforms: b.platforms.map((p) => ({
        ...numbersOf(p),
        platform: p.platform,
        videos: p.videos,
        unavailable: p.unavailable,
        reason: p.reason,
      })),
      totals: numbersOf(b.totals),
    }
  },

  listEpisodes: ({ s, query }) => {
    const lib = s.episodes?.()
    if (!lib) throw new AgentError(500, 'server_error', 'The Library is not available.')
    const rows = lib.list({ brandId: query.brand_id ?? null, status: query.status ?? 'all', limit: query.limit })
    return { episodes: rows.map((r) => episodeOut(s, r)) }
  },

  getEpisode: ({ s, params }) => {
    const lib = s.episodes?.()
    if (!lib) throw new AgentError(500, 'server_error', 'The Library is not available.')
    const row = lib.find(params.id)
    if (!row) throw new AgentError(404, 'not_found', `No episode with id ${params.id}.`)
    return { episode: episodeOut(s, row), package: lib.getPackage(row.id) as unknown as Record<string, unknown> | null }
  },
}

function episodeOut(s: AgentServices, r: import('@shared/studio/types').EpisodeRow) {
  let brandName = ''
  try {
    brandName = s.brands.get(r.brandId).name
  } catch {
    // brand removed
  }
  return {
    id: r.id,
    brand_id: r.brandId,
    brand_name: brandName,
    series: r.series,
    episode_number: r.number,
    title: r.title,
    summary: r.summary,
    status: r.status,
    slot_date: r.slotDate,
    updated_at: r.updatedUtc,
  }
}
