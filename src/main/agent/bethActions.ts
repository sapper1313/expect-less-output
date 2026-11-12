import { lstatSync } from 'fs'
import { basename } from 'path'
import { channelAllowed } from '@shared/pipeline'
import type { Post } from '@shared/types'
import type { CreatePostInput, UpdatePostInput } from '@shared/agentSchemas'
import {
  AgentError,
  agentCancelPost,
  agentCreatePost,
  agentUpdatePost,
  draftsOnly,
  validateVideoFile,
  type AgentServices,
} from './core'
import type { Caller } from './bots'
import { sha256File } from '../pipeline/verify'

/** The bot named beth, and any bot with the orchestrator role, may edit or remove posts and swap their files. */
export const OPERATOR_BOT = 'beth'
export const isOperator = (bot: { name: string; role: string }) =>
  bot.name === OPERATOR_BOT || bot.role === 'orchestrator'

/** A target the platform already has, or is working on, cannot be changed from here. */
const WITH_PLATFORM = ['handed_off', 'processing', 'uploading', 'posted']

const who = (c: Caller) => (c.kind === 'owner' ? 'josh' : c.actor)

/** Owner, or the beth token on a channel it may work on. Anything else is refused and audited. */
export function requireOperator(
  s: AgentServices,
  caller: Caller,
  post: Post,
  action: string,
): void {
  if (caller.kind === 'owner') return
  const deny = (m: string): never => {
    s.audit?.write({
      actor: who(caller),
      action: 'api.denied',
      target: `post ${post.id} ${action}`,
      after: { reason: m },
    })
    throw new AgentError(403, 'forbidden', m)
  }
  if (!isOperator(caller.bot))
    deny(`Only the orchestrator token (beth) or the owner's token may ${action}.`)
  const slug = s.brands.get(post.brandId).slug ?? ''
  if (!channelAllowed(caller.bot.channels, slug))
    deny(`${caller.actor} may not work on ${slug}. Add the channel to its list on the Bots card.`)
}

/** Owner, or an orchestrator bot on a channel it may work on, may create a post. */
export function requireOperatorForBrand(s: AgentServices, caller: Caller, brandId: number, action: string): void {
  if (caller.kind === 'owner') return
  const slug = s.brands.get(brandId).slug ?? ''
  const deny = (m: string): never => {
    s.audit?.write({ actor: who(caller), action: 'api.denied', target: `${slug} ${action}`, after: { reason: m } })
    throw new AgentError(403, 'forbidden', m)
  }
  if (!isOperator(caller.bot)) deny(`Only the orchestrator token (beth) or the owner's token may ${action}.`)
  if (!channelAllowed(caller.bot.channels, slug))
    deny(`${caller.actor} may not work on ${slug}. Add the channel to its list on the Bots card.`)
}

/** Creates a post from a video file, with the same rules as the owner: first open slots by default, or an exact time. */
export async function operatorCreate(
  s: AgentServices,
  body: CreatePostInput,
  caller: Caller,
): Promise<Post & { warnings: string[] }> {
  requireOperatorForBrand(s, caller, body.brand_id, 'create a post')
  const post = await agentCreatePost(s, body, { source: 'api' })
  s.audit?.write({
    actor: who(caller),
    action: 'post.created',
    target: `${post.brandName}/${post.id}`,
    after: { status: post.status, slot: post.scheduledAtUtc },
  })
  tell(
    s,
    caller,
    `${who(caller)} created a post`,
    `"${post.title}" (${post.brandName}) is ${post.status}${post.scheduledAtUtc ? `, set for ${post.scheduledAtUtc}` : ''}.`,
  )
  return post
}

function tell(s: AgentServices, caller: Caller, headline: string, detail: string): void {
  if (caller.kind === 'bot') s.notifyOwner?.(headline, detail)
}

/** Cancels a post that has not gone out, so a fixed video can be dropped in its place. Files are kept. */
export function operatorCancel(s: AgentServices, id: number, caller: Caller): Post {
  const post = s.posts.get(id)
  if (!post) throw new AgentError(404, 'not_found', `No post with id ${id}.`)
  requireOperator(s, caller, post, 'remove a post')
  if (caller.kind === 'bot') {
    const inside = post.targets.find((t) => WITH_PLATFORM.includes(t.status))
    if (inside)
      throw new AgentError(
        409,
        'conflict',
        `The ${inside.platform} target is already ${inside.status.replace('_', ' ')}. The platform has the video, so only the owner can take it down.`,
      )
  }
  const out = agentCancelPost(s, id)
  // The drop log keeps the history, with a note, and the same episode id can be dropped again.
  const drop = s.drops?.forPost(id)
  if (drop)
    s.drops?.update(drop.dropId, {
      notes: [drop.notes, `Removed by ${who(caller)}.`].filter(Boolean).join(' '),
    })
  s.audit?.write({
    actor: who(caller),
    action: 'post.removed',
    target: `${post.brandName}/${post.episodeRef ?? id}`,
    before: { status: post.status, slot: post.scheduledAtUtc },
  })
  tell(
    s,
    caller,
    `${who(caller)} removed a post`,
    `"${post.title}" (${post.brandName}) was taken out of the schedule${post.scheduledAtUtc ? ` (it was set for ${post.scheduledAtUtc})` : ''}. The files are kept.`,
  )
  return out
}

/** Edits title, description, platforms, times and the schedule status (draft or scheduled). Owner or an orchestrator bot. */
export async function operatorUpdate(
  s: AgentServices,
  id: number,
  body: UpdatePostInput,
  caller: Caller,
): Promise<Post> {
  const post = s.posts.get(id)
  if (!post) throw new AgentError(404, 'not_found', `No post with id ${id}.`)
  requireOperator(s, caller, post, 'edit a post')
  const out = await agentUpdatePost(s, id, body)
  s.audit?.write({
    actor: who(caller),
    action: 'post.edited',
    target: `${post.brandName}/${post.episodeRef ?? id}`,
    after: { fields: Object.keys(body) },
  })
  tell(
    s,
    caller,
    `${who(caller)} edited a post`,
    `"${post.title}" (${post.brandName}): changed ${Object.keys(body).join(', ')}.`,
  )
  return out
}

export interface ReplaceMediaResult {
  post_id: number
  status: string
  scheduled_at: string | null
  title: string
  caption: string
  file_name: string
  sha256: string
  old_sha256: string | null
  old_file_moved_to: string
  duration_seconds: number | null
}

/**
 * Swaps the video (and optionally the title and description) of a post that no platform has yet. The post keeps its
 * slot. The old file is moved to <Channel>/Replaced, never deleted.
 */
export async function operatorReplaceMedia(
  s: AgentServices,
  id: number,
  body: { file_path?: string; checksum?: string; title?: string; description?: string },
  caller: Caller,
): Promise<ReplaceMediaResult> {
  const post = s.posts.get(id)
  if (!post) throw new AgentError(404, 'not_found', `No post with id ${id}.`)
  requireOperator(s, caller, post, 'replace the media of a post')
  if (!body.file_path && body.title === undefined && body.description === undefined)
    throw new AgentError(400, 'validation', 'Send file_path, title, description, or a mix.')
  if (!['draft', 'scheduled', 'partial', 'in_progress', 'failed'].includes(post.status))
    throw new AgentError(
      409,
      'conflict',
      `This post is ${post.status.replace('_', ' ')}. Only a draft, a scheduled post, or a post with a platform still waiting or failed can be changed here.`,
    )
  if (post.status !== 'draft' && caller.kind === 'bot' && draftsOnly(s))
    throw new AgentError(
      403,
      'drafts_only',
      'Agents are limited to drafts right now, and this post is not a draft. The owner can turn on "Agents may schedule" in Settings.',
    )
  // A platform that already has the video keeps it. Only one that is sending it right now blocks the swap.
  const inside = post.targets.find((t) => ['processing', 'uploading'].includes(t.status))
  if (inside)
    throw new AgentError(
      409,
      'conflict',
      `The ${inside.platform} target is sending the video right now (${inside.status.replace('_', ' ')}). Try again in a minute.`,
    )
  if (
    post.scheduledAtUtc &&
    new Date(post.scheduledAtUtc).getTime() - (s.now ? s.now() : Date.now()) < 2 * 60_000 &&
    post.status === 'scheduled'
  )
    throw new AgentError(
      409,
      'conflict',
      'This post goes out in under 2 minutes, so it cannot be changed now.',
    )
  const title = body.title !== undefined ? body.title.trim() : undefined
  if (title !== undefined && (!title || title.length > 100))
    throw new AgentError(400, 'validation', 'A title is 1 to 100 characters.', { field: 'title' })
  if (body.description !== undefined && body.description.length > 5000)
    throw new AgentError(400, 'validation', 'A description is up to 5000 characters.', {
      field: 'description',
    })

  let checksum = post.checksum ?? ''
  let oldChecksum = post.checksum
  let moved = post.videoPath
  let fileName = post.fileName
  let duration =
    typeof post.videoMeta.durationSeconds === 'number' ? post.videoMeta.durationSeconds : null
  if (body.file_path) {
    validateVideoFile(body.file_path)
    if (lstatSync(body.file_path).isSymbolicLink())
      throw new AgentError(400, 'bad_request', 'file_path must be the real file.', {
        field: 'file_path',
      })
    checksum = await sha256File(body.file_path)
    if (body.checksum && body.checksum.toLowerCase() !== checksum.toLowerCase())
      throw new AgentError(
        400,
        'validation',
        `The checksum you sent does not match the file (the file is ${checksum}).`,
        { field: 'checksum' },
      )
    if (post.checksum && post.checksum.toLowerCase() === checksum.toLowerCase())
      throw new AgentError(409, 'conflict', 'That is the same video that is already on the post.')
    const dupe = s.posts
      .list({ brandId: post.brandId })
      .find(
        (p) =>
          p.id !== id &&
          p.status !== 'canceled' &&
          p.checksum?.toLowerCase() === checksum.toLowerCase(),
      )
    if (dupe)
      throw new AgentError(
        409,
        'conflict',
        `That video is already on another post ("${dupe.title}").`,
      )
    if (s.intake) {
      const reasons = await s.intake.videoProblems(
        s.brands.get(post.brandId),
        body.file_path,
        post.postType,
      )
      if (reasons.length)
        throw new AgentError(400, 'validation', reasons.map((r) => r.message).join(' '), reasons)
    }
    const r = await s.posts.replaceMedia(id, {
      sourcePath: body.file_path,
      checksum,
      title,
      description: body.description,
    })
    moved = r.oldRel
    oldChecksum = r.oldChecksum
    fileName = r.fileName
  } else {
    // Only the words change.
    if (title !== undefined) s.posts.update(id, { title })
    if (body.description !== undefined) s.posts.update(id, { caption: body.description })
  }
  const after = s.posts.get(id) as Post
  duration =
    typeof after.videoMeta.durationSeconds === 'number' ? after.videoMeta.durationSeconds : duration
  s.log.log('info', `Media/text changed for "${after.title}" by ${who(caller)}.`, { postId: id })
  s.audit?.write({
    actor: who(caller),
    action: 'post.replace_media',
    target: `${post.brandName}/${post.episodeRef ?? id}`,
    before: { sha256: oldChecksum, file: basename(post.videoPath), title: post.title },
    after: {
      sha256: checksum || null,
      file: fileName,
      title: after.title,
      slot: after.scheduledAtUtc,
    },
  })
  tell(
    s,
    caller,
    `${who(caller)} changed a scheduled post`,
    `"${after.title}" (${post.brandName}): ${body.file_path ? 'new video' : 'text'} saved${after.scheduledAtUtc ? `, still set for ${after.scheduledAtUtc}` : ''}.`,
  )
  return {
    post_id: id,
    status: after.status,
    scheduled_at: after.scheduledAtUtc,
    title: after.title,
    caption: after.caption,
    file_name: fileName,
    sha256: checksum,
    old_sha256: oldChecksum,
    old_file_moved_to: moved,
    duration_seconds: duration,
  }
}

/** Takes an episode down as far as the platforms allow. Owner and the orchestrator token only. */
export async function operatorRetract(
  s: AgentServices,
  episodeId: string,
  caller: Caller,
): Promise<{
  episode_id: string
  post_ids: number[]
  results: import('../growth/service').RetractOutcome[]
}> {
  if (!s.growth) throw new AgentError(400, 'bad_request', 'Retract is not available in this build.')
  const post = s.posts.list({ includeArchived: true }).find((p) => p.episodeRef === episodeId && p.status !== 'canceled')
  if (!post) throw new AgentError(404, 'not_found', `No post for episode ${episodeId}.`)
  requireOperator(s, caller, post, 'retract an episode')
  let r
  try {
    r = await s.growth.retract(episodeId, who(caller))
  } catch (e) {
    throw new AgentError(409, 'conflict', (e as Error).message)
  }
  s.audit?.write({
    actor: who(caller),
    action: 'episode.retracted',
    target: `${post.brandName}/${episodeId}`,
    after: { results: r.results },
  })
  // The owner is always told, whoever pressed it.
  s.notifyOwner?.(
    `${who(caller)} retracted ${episodeId}`,
    r.results
      .map((x) => `${x.platform}: ${x.outcome}. ${x.detail}${x.url ? ` ${x.url}` : ''}`)
      .join('\n') || 'Nothing was live yet.',
  )
  return { episode_id: episodeId, post_ids: r.postIds, results: r.results }
}
