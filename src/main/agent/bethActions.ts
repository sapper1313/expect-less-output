import { lstatSync } from 'fs'
import { basename } from 'path'
import { channelAllowed } from '@shared/pipeline'
import type { Post } from '@shared/types'
import type { UpdatePostInput } from '@shared/agentSchemas'
import {
  AgentError,
  agentCancelPost,
  agentUpdatePost,
  draftsOnly,
  validateVideoFile,
  type AgentServices,
} from './core'
import type { Caller } from './bots'
import { sha256File } from '../pipeline/verify'

/** The one bot token that may edit or remove posts and swap their files (besides the owner's own token). */
export const OPERATOR_BOT = 'beth'

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
  if (caller.bot.name !== OPERATOR_BOT)
    deny(`Only the ${OPERATOR_BOT} token (or the owner's token) may ${action}.`)
  const slug = s.brands.get(post.brandId).slug ?? ''
  if (!channelAllowed(caller.bot.channels, slug))
    deny(`${caller.actor} may not work on ${slug}. Add the channel to its list on the Bots card.`)
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

/** Edits title, description and platforms. Times and scheduling stay with the owner. */
export async function operatorUpdate(
  s: AgentServices,
  id: number,
  body: UpdatePostInput,
  caller: Caller,
): Promise<Post> {
  const post = s.posts.get(id)
  if (!post) throw new AgentError(404, 'not_found', `No post with id ${id}.`)
  requireOperator(s, caller, post, 'edit a post')
  if (caller.kind === 'bot' && (body.scheduled_at !== undefined || body.status !== undefined)) {
    s.audit?.write({
      actor: who(caller),
      action: 'api.denied',
      target: `post ${id} edit`,
      after: { reason: 'bots never set or change a posting time' },
    })
    throw new AgentError(
      403,
      'forbidden',
      'A bot never sets or changes a posting time or the schedule status. That is set in the ELO app.',
    )
  }
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
  if (!['draft', 'scheduled'].includes(post.status))
    throw new AgentError(
      409,
      'conflict',
      `This post is ${post.status.replace('_', ' ')}. Only a draft or a scheduled post can be changed here.`,
    )
  if (post.status !== 'draft' && caller.kind === 'bot' && draftsOnly(s))
    throw new AgentError(
      403,
      'drafts_only',
      'Agents are limited to drafts right now, and this post is not a draft. The owner can turn on "Agents may schedule" in Settings.',
    )
  const inside = post.targets.find((t) => WITH_PLATFORM.includes(t.status))
  if (inside)
    throw new AgentError(
      409,
      'conflict',
      `The ${inside.platform} target already has the video (${inside.status.replace('_', ' ')}). It cannot be replaced from here.`,
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
