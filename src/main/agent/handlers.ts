import { z } from 'zod'
import { DateTime } from 'luxon'
import { formatEastern } from '@shared/time'
import type { PostOut } from '@shared/agentSchemas'
import type { Brand, Post } from '@shared/types'
import { PLATFORMS } from '@shared/platformLimits'
import { SLUG_ALIASES, canonicalSlug, channelAllowed, type DropRow } from '@shared/pipeline'
import { channelState } from '../pipeline/state'
import type { Caller } from './bots'
import { agentSetThumbnail } from './thumbnail'
import {
  operatorCancel,
  operatorReplaceMedia,
  operatorRetract,
  operatorUpdate,
} from './bethActions'
import { UpcomingError } from '../pipeline/upcoming'
import type { Actor } from '@shared/upcoming'
import {
  AgentError,
  agentCreatePost,
  agentRetryPost,
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
    post_type: p.postType,
    source_episode_id: p.sourceEpisodeRef,
    related_video: p.relatedVideo
      ? { episode_id: p.relatedVideo.episodeId, url: p.relatedVideo.url, done: p.relatedVideo.done }
      : null,
    origin: p.origin,
    episode_id: p.episodeRef,
    source_bot: p.sourceBot,
    hold_reason: p.holdReason,
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

function clipPlatformsOf(s: AgentServices, brandId: number): string[] {
  const row = s.posts
    .dbForState()
    .prepare('SELECT config_json FROM studio_brands WHERE brand_id = ?')
    .get(brandId) as { config_json: string } | undefined
  const all = ['youtube', 'facebook', 'instagram', 'tiktok']
  try {
    const p = (JSON.parse(row?.config_json ?? '{}') as { clipPlatforms?: Record<string, boolean> })
      .clipPlatforms
    return p ? all.filter((k) => p[k] !== false) : all
  } catch {
    return all
  }
}

function brandOut(s: AgentServices, b: Brand) {
  const d = s.brands.getDefaults(b.id)
  const sets = s.brands.listHashtags(b.id)
  const settings = s.settings.get()
  const accounts = s.brands.listAccounts(b.id)
  const rules = s.posts.channelRules(b.id)
  return {
    state: channelState(s.posts.dbForState(), b.id),
    on_hold: channelState(s.posts.dbForState(), b.id) === 'on-hold',
    post_days: s.posts.postDays(b.id) ?? null,
    clip_post_days: s.posts.clipSchedule(b.id).days,
    clip_time: s.posts.clipSchedule(b.id).time,
    clip_platforms: clipPlatformsOf(s, b.id),
    daily_cap: rules.maxPerDay,
    blackout_dates: [...new Set([...settings.blackoutDates, ...rules.blackoutDates])].sort(),
    aliases: Object.entries(SLUG_ALIASES)
      .filter(([, v]) => v === b.slug)
      .map(([k]) => k),
    id: b.id,
    name: b.name,
    slug: b.slug,
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
  /** Who is calling: the owner's token or one bot's token. */
  caller: Caller
}

function needUpcoming(s: AgentServices) {
  if (!s.upcoming)
    throw new AgentError(400, 'bad_request', 'Upcoming is not available in this build.')
  return s.upcoming
}

function actorOf(caller: Caller): Actor {
  return caller.kind === 'owner'
    ? { name: 'josh' }
    : { name: caller.bot.name, role: caller.bot.role, channels: caller.bot.channels }
}

function upcomingError(e: unknown): unknown {
  if (e instanceof UpcomingError)
    return new AgentError(
      e.status,
      e.status === 403
        ? 'forbidden'
        : e.status === 404
          ? 'not_found'
          : e.status === 409
            ? 'conflict'
            : 'bad_request',
      e.message,
      e.details,
    )
  return e
}

function stripRow(r: Record<string, unknown>) {
  const { channelName, channelColor, paused, postId, readOnly, staleDays, ...entry } = r
  ;(void channelName, channelColor, paused, postId, readOnly, staleDays)
  return entry as never
}

function needDrops(s: AgentServices) {
  if (!s.drops)
    throw new AgentError(400, 'bad_request', 'The drop log is not available in this build.')
  return s.drops
}

/** A bot sees only its own channels. The owner sees everything. */
function botMaySee(caller: Caller, channel: string | null): boolean {
  return caller.kind === 'owner' || (!!channel && channelAllowed(caller.bot.channels, channel))
}

function dropOut(d: DropRow) {
  return {
    drop_id: d.dropId,
    received_at: d.receivedAt,
    source_bot: d.sourceBot,
    file_name: d.fileName,
    file_size: d.fileSize,
    sha256: d.sha256,
    channel: d.channel,
    episode_id: d.episodeId,
    title: d.title,
    sidecar_valid: d.sidecarValid,
    result: d.result,
    reason: d.reason,
    scheduled_slot: d.scheduledSlot,
    post_id: d.postId,
    approved_by: d.approvedBy,
    approved_at: d.approvedAt,
    post_type: d.postType,
    notes: d.notes,
  }
}

/** One handler per route id. A test makes sure every route has one. */
export const HANDLERS: Record<string, (c: Ctx) => unknown | Promise<unknown>> = {
  listBrands: ({ s }) => ({ brands: s.brands.list(true).map((b) => brandOut(s, b)) }),

  nextOpenSlots: ({ s, query }) => {
    let brand: Brand | null = null
    if (query.channel) {
      brand = s.brands.bySlug(query.channel)
      if (!brand)
        throw new AgentError(404, 'not_found', `No channel with the slug ${query.channel}.`)
    } else {
      try {
        brand = s.brands.get(query.brand_id as number)
      } catch {
        throw new AgentError(404, 'not_found', `No brand with id ${query.brand_id}.`)
      }
    }
    const fromUtc = query.from ? toUtc(query.from) : undefined
    let slots = s.posts.nextSlots(brand.id, query.count, fromUtc)
    if (query.days) {
      const end = new Date(
        (fromUtc ? new Date(fromUtc).getTime() : s.now ? s.now() : Date.now()) +
          query.days * 86_400_000,
      ).toISOString()
      slots = slots.filter((x) => x <= end)
    }
    return {
      brand_id: brand.id,
      channel: brand.slug,
      slots: slots.map((at) => ({ at, eastern: formatEastern(at) })),
    }
  },

  getLearnings: ({ s }) => {
    if (!s.growth)
      throw new AgentError(400, 'bad_request', 'Lessons are not available in this build.')
    return { markdown: s.growth.learningsMarkdown(), lessons: s.growth.lessons() }
  },

  seoSuggestions: async ({ s, query }) => {
    if (!s.suggest)
      throw new AgentError(400, 'bad_request', 'Search phrases are not available in this build.')
    return { query: query.q, phrases: await s.suggest(query.q).catch(() => []) }
  },

  getBrief: ({ s }) => {
    if (!s.growth)
      throw new AgentError(400, 'bad_request', 'The brief is not available in this build.')
    return { markdown: s.growth.briefText() }
  },

  retractEpisode: ({ s, params, caller }) => operatorRetract(s, params.episode_id, caller),

  listDrops: ({ s, query, caller }) => {
    const drops = needDrops(s).list({
      channel: query.channel,
      bot: query.bot,
      result: query.result,
      limit: query.limit,
    })
    return { drops: drops.filter((d) => botMaySee(caller, d.channel)).map(dropOut) }
  },

  getDrop: ({ s, params, caller }) => {
    const d = needDrops(s).byDropId(params.id)
    if (!d || !botMaySee(caller, d.channel))
      throw new AgentError(404, 'not_found', `No drop ${params.id}.`)
    return dropOut(d)
  },

  createDrop: async ({ s, body, caller }) => {
    if (!s.pipeline)
      throw new AgentError(400, 'bad_request', 'Drops are not available in this build.')
    const channel =
      typeof body.sidecar.channel === 'string' ? canonicalSlug(body.sidecar.channel) : ''
    if (!channel)
      throw new AgentError(400, 'validation', 'The sidecar needs a channel.', [
        { path: 'sidecar.channel', message: 'Required.' },
      ])
    if (caller.kind === 'bot' && !channelAllowed(caller.bot.channels, channel)) {
      s.audit?.write({
        actor: caller.actor,
        action: 'api.denied',
        target: `drops/${channel}`,
        after: { reason: 'channel not allowed' },
      })
      throw new AgentError(403, 'forbidden', `${caller.actor} may not drop into ${channel}.`)
    }
    const drop = await s.pipeline.receive(
      channel,
      body.sidecar,
      body.file_path ?? null,
      caller.actor,
    )
    return { received: true, drop: drop ? dropOut(drop) : null }
  },

  syncStatus: ({ s }) => {
    const v = s.upcoming?.view()
    const st = s.settings.get()
    return {
      app_version: s.appVersion,
      mechanism: 'agent-api-tailscale/1',
      server_time: DateTime.fromMillis(s.now ? s.now() : Date.now(), {
        zone: 'America/New_York',
      }).toISO() as string,
      upcoming: {
        revision: v?.revision ?? 0,
        updated_at: s.upcoming?.updatedAt() ?? null,
        entries: v?.rows.length ?? 0,
      },
      last_change_id: s.audit?.lastId() ?? 0,
      claude_api_enabled: st.claudeApiEnabled,
      studio_production_enabled: st.studioProductionEnabled,
      agent_may_schedule: st.agentMaySchedule,
      scheduler_paused: st.schedulerPaused,
      open_reconcile_issues: s.reconciler?.open().length ?? 0,
    }
  },

  changes: ({ s, query }) => {
    const rows = s.audit?.since(query.since_id, query.limit) ?? []
    return {
      cursor: rows.length ? rows[rows.length - 1].id : query.since_id,
      events: rows.map((r) => ({
        id: r.id,
        at: DateTime.fromISO(r.at, { zone: 'utc' }).setZone('America/New_York').toISO() as string,
        actor: r.actor,
        action: r.action,
        target: r.target,
        detail: JSON.stringify(r.after ?? '').slice(0, 300),
      })),
    }
  },

  listUpcoming: ({ s, query }) => {
    const v = needUpcoming(s).view()
    const after = query.updated_after ? toUtc(query.updated_after) : null
    return {
      revision: v.revision,
      updated_at: s.upcoming?.updatedAt() ?? null,
      episodes: v.rows
        .filter(
          (r) =>
            (!query.channel || r.channel === canonicalSlug(query.channel)) &&
            (!query.status || r.status === query.status) &&
            (!query.source_bot || r.source_bot === query.source_bot) &&
            (!after || r.updated_at > after),
        )
        .map((r) => stripRow(r)),
    }
  },

  addUpcoming: async ({ s, body, caller }) => {
    try {
      return await needUpcoming(s).add(actorOf(caller), body)
    } catch (e) {
      throw upcomingError(e)
    }
  },

  patchUpcoming: async ({ s, params, body, caller }) => {
    const { entry_revision, ...patch } = body
    try {
      const r = await needUpcoming(s).patch(
        actorOf(caller),
        params.channel,
        params.episode_id,
        patch,
        { entry_revision },
      )
      if (r.conflict)
        throw new AgentError(
          409,
          'conflict',
          'Another edit changed the same field. Both versions are kept in the entry and flagged for the owner.',
          { entry: r.entry },
        )
      return r.entry
    } catch (e) {
      throw upcomingError(e)
    }
  },

  reconcile: ({ s, caller }) => ({
    issues: (s.reconciler?.open() ?? [])
      .map((i) => ({
        kind: i.kind,
        channel: i.brandId ? (s.brands.get(i.brandId).slug ?? null) : null,
        post_id: i.postId,
        detail: i.detail,
        first_seen: i.firstSeen,
        last_seen: i.lastSeen,
      }))
      .filter((i) => botMaySee(caller, i.channel)),
  }),

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

  updatePost: async ({ s, params, body, caller }) =>
    postOut(await operatorUpdate(s, params.id, body, caller)),

  setPostThumbnail: ({ s, params, body, caller }) => agentSetThumbnail(s, params.id, body, caller),

  cancelPost: ({ s, params, caller }) => postOut(operatorCancel(s, params.id, caller)),

  replacePostMedia: ({ s, params, body, caller }) =>
    operatorReplaceMedia(s, params.id, body, caller),

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
