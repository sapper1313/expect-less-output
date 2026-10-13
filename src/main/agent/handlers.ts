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
  requireStudioWrite,
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

  studioSpend: async ({ s }) => spendOut(await studioOf(s).spendSummary()),

  setStudioCaps: async ({ s, body }) => {
    requireStudioWrite(s)
    const st = studioOf(s)
    const cap = (v: number | null) => ({ value: v ?? 0, none: v === null })
    for (const b of body.brands ?? []) brandOrNotFound(s, b.brand_id)
    const patch: Record<string, unknown> = {}
    if (body.global_monthly !== undefined) patch.globalCap = cap(body.global_monthly)
    if (body.ai_text_monthly !== undefined) patch.aiTextCap = cap(body.ai_text_monthly)
    if (body.per_episode_default !== undefined)
      patch.perEpisodeCapDefault = cap(body.per_episode_default)
    await studioCall(async () => {
      if (Object.keys(patch).length) await st.setConfig(patch as never)
      for (const b of body.brands ?? []) {
        const bp: Record<string, unknown> = {}
        if (b.monthly !== undefined) bp.monthlyCap = cap(b.monthly)
        if (b.per_episode !== undefined) bp.perEpisodeCap = cap(b.per_episode)
        if (Object.keys(bp).length) await st.setBrand(b.brand_id, bp as never)
      }
    })
    s.log.log('info', `Agent API changed Studio spend caps: ${JSON.stringify(body)}`)
    return spendOut(await st.spendSummary())
  },

  listSkills: async ({ s, params }) => {
    brandOrNotFound(s, params.id)
    return { skills: skillsOut((await studioOf(s).bible(params.id)).skills) }
  },

  addSkill: async ({ s, params, body }) => {
    requireStudioWrite(s)
    brandOrNotFound(s, params.id)
    const skills = await studioCall(() => studioOf(s).importSkill(params.id, body.name, body.text))
    s.log.log('info', `Agent API added the Bible skill "${body.name}" for brand ${params.id}.`)
    return { skills: skillsOut(skills) }
  },

  removeSkill: async ({ s, params }) => {
    requireStudioWrite(s)
    brandOrNotFound(s, params.id)
    const r = await studioCall(() => studioOf(s).removeSkillWithBackup(params.id, params.skill_id))
    s.log.log(
      'info',
      `Agent API removed the Bible skill "${r.removed.name}" from brand ${params.id}. Backup: ${r.backupFile}`,
    )
    return {
      removed: skillsOut([r.removed])[0],
      backup_file: r.backupFile,
      skills: skillsOut(r.skills),
    }
  },

  listFlagged: async ({ s }) => ({
    tasks: (await studioOf(s).flagged()).map(({ task, episode }) => ({
      task_id: task.id,
      type: task.type,
      brand_id: task.brandId,
      episode_id: task.episodeId,
      episode_title: episode?.title ?? null,
      status: task.status,
      attempts: task.attempts,
      error: task.error,
      finished_at: task.finishedUtc,
    })),
  }),

  retryFlagged: async ({ s, params }) => {
    requireStudioWrite(s)
    const st = studioOf(s)
    if (!(await st.flagged()).some((f) => f.task.id === params.task_id))
      throw new AgentError(
        404,
        'not_found',
        `No flagged or stopped task with id ${params.task_id}. See list_flagged_tasks.`,
      )
    await studioCall(() => st.resolveFlag(params.task_id, 'retry'))
    s.log.log('info', `Agent API retried Studio task ${params.task_id}.`)
    return { task_id: params.task_id, ok: true }
  },

  rebuildEpisode: async ({ s, params, body }) => {
    requireStudioWrite(s)
    const r = await studioCall(() => studioOf(s).rebuildEpisode(params.episode_id, body.note ?? ''))
    s.log.log('info', `Agent API rebuilt episode ${params.episode_id} (task ${r.taskId}).`)
    return { task_id: r.taskId, ok: true }
  },

  setStudioBrandPaused: async ({ s, params, body }) => {
    requireStudioWrite(s)
    brandOrNotFound(s, params.id)
    await studioCall(() => studioOf(s).setBrand(params.id, { paused: body.paused }))
    s.log.log(
      'info',
      `Agent API ${body.paused ? 'paused' : 'resumed'} Studio work for brand ${params.id}.`,
    )
    return { brand_id: params.id, paused: body.paused }
  },

  listEpisodes: ({ s, query }) => {
    const lib = s.episodes?.()
    if (!lib) throw new AgentError(500, 'server_error', 'The Library is not available.')
    const rows = lib.list({
      brandId: query.brand_id ?? null,
      status: query.status ?? 'all',
      limit: query.limit,
    })
    return { episodes: rows.map((r) => episodeOut(s, r)) }
  },

  getEpisode: ({ s, params }) => {
    const lib = s.episodes?.()
    if (!lib) throw new AgentError(500, 'server_error', 'The Library is not available.')
    const row = lib.find(params.id)
    if (!row) throw new AgentError(404, 'not_found', `No episode with id ${params.id}.`)
    return {
      episode: episodeOut(s, row),
      package: lib.getPackage(row.id) as unknown as Record<string, unknown> | null,
    }
  },
}

function studioOf(s: AgentServices) {
  const st = s.studio?.()
  if (!st) throw new AgentError(500, 'server_error', 'The Studio is not available.')
  return st
}

function brandOrNotFound(s: AgentServices, id: number): void {
  try {
    s.brands.get(id)
  } catch {
    throw new AgentError(404, 'not_found', `No brand with id ${id}.`)
  }
}

/** Studio methods throw plain messages written for the owner. Pass them on as a clear 400. */
async function studioCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof AgentError) throw e
    throw new AgentError(400, 'bad_request', (e as Error).message)
  }
}

const skillsOut = (skills: Array<{ id: number; name: string; text: string }>) =>
  skills.map((k) => ({ id: k.id, name: k.name, characters: k.text.length }))

function spendOut(sum: import('@shared/studio/types').SpendSummary) {
  return {
    month: sum.month,
    total_dollars: sum.total,
    mock_dollars: sum.mockTotal,
    caps: sum.caps.map((c) => ({
      key: c.key,
      label: c.label,
      limit: c.cap.none ? null : c.cap.value,
      spent: c.spent,
      remaining: c.remaining,
    })),
    by_brand: sum.byBrand.map((b) => ({
      brand_id: b.brandId,
      brand_name: b.brandName,
      dollars: b.dollars,
    })),
    by_vendor: sum.byVendor,
  }
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
