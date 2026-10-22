import { copyFileSync, lstatSync, mkdirSync, openSync, readSync, closeSync } from 'fs'
import { basename, extname, isAbsolute, join } from 'path'
import { uniquePath } from '../services/library'
import { AgentError, draftsOnly, type AgentServices } from './core'
import type { Caller } from './bots'
import { requireOperator } from './bethActions'

const MAX_BYTES = 2 * 1024 * 1024
/** The only bot token allowed to change a thumbnail or a title this way (besides the owner's own token). */

export interface ThumbnailResult {
  post_id: number
  title: string
  saved_image: string | null
  applied: Array<{
    platform: string
    how: 'saved_for_upload' | 'set_on_youtube' | 'title_updated_on_youtube' | 'skipped'
    detail: string
  }>
  notes: string[]
}

/** A real JPG or PNG under 2 MB, at an absolute path, not a shortcut. */
function checkImage(path: string): void {
  const bad = (m: string) => new AgentError(400, 'bad_request', m, { field: 'image_path' })
  if (!isAbsolute(path)) throw bad('image_path must be an absolute path, like /Users/me/thumb.jpg.')
  if (!/\.(jpe?g|png)$/i.test(path)) throw bad('image_path must be a .jpg or .png file.')
  let st
  try {
    st = lstatSync(path)
  } catch {
    throw bad(`No file exists at ${path}.`)
  }
  if (st.isSymbolicLink()) throw bad('image_path must be the real file, not a shortcut (symlink).')
  if (!st.isFile() || st.size === 0)
    throw bad('image_path must be a regular, non-empty image file.')
  if (st.size > MAX_BYTES)
    throw bad(
      `The image is ${(st.size / 1048576).toFixed(1)} MB. YouTube takes thumbnails up to 2 MB.`,
    )
  const head = Buffer.alloc(8)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, head, 0, 8, 0)
  } finally {
    closeSync(fd)
  }
  const png = head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const jpg = head[0] === 0xff && head[1] === 0xd8
  if (!png && !jpg) throw bad('The file is not really a JPG or PNG picture.')
}

/**
 * Sets a custom thumbnail (and/or title) on a post.
 * - Not posted yet: the picture is kept with the post and used when the video is uploaded, and the title is changed.
 * - Already inside YouTube (handed off early) or posted: thumbnails.set replaces the live thumbnail. A title change is
 *   also sent to YouTube for a video that is not public yet. A title is never changed on a video that already posted.
 */
export async function agentSetThumbnail(
  s: AgentServices,
  id: number,
  body: { image_path?: string; title?: string },
  caller: Caller,
): Promise<ThumbnailResult> {
  const who = caller.kind === 'owner' ? 'josh' : caller.actor
  const pre = s.posts.get(id)
  if (!pre) throw new AgentError(404, 'not_found', `No post with id ${id}.`)
  requireOperator(s, caller, pre, 'set a thumbnail or title')
  if (!body.image_path && body.title === undefined)
    throw new AgentError(400, 'validation', 'Send image_path, title, or both.')
  const post = s.posts.get(id)
  if (!post) throw new AgentError(404, 'not_found', `No post with id ${id}.`)
  if (post.status === 'canceled') throw new AgentError(409, 'conflict', 'This post is canceled.')
  if (s.brands.get(post.brandId).archived)
    throw new AgentError(409, 'conflict', `${post.brandName} is archived.`)
  if (post.status !== 'draft' && draftsOnly(s))
    throw new AgentError(
      403,
      'drafts_only',
      'Agents are limited to drafts right now, and this post is not a draft. The owner can turn on "Agents may schedule" in Settings.',
    )
  const title = body.title !== undefined ? body.title.trim() : undefined
  if (title !== undefined && (!title || title.length > 100))
    throw new AgentError(400, 'validation', 'A title is 1 to 100 characters.', { field: 'title' })
  if (title !== undefined && post.status === 'posted')
    throw new AgentError(
      409,
      'conflict',
      'This post already went out, so its title cannot be changed here. Only the thumbnail can.',
    )
  const out: ThumbnailResult = {
    post_id: id,
    title: post.title,
    saved_image: null,
    applied: [],
    notes: [],
  }

  // 1. The picture is checked and kept with the post, so it stays available.
  let saved: string | null = null
  if (body.image_path) {
    checkImage(body.image_path)
    if (!s.library)
      throw new AgentError(400, 'bad_request', 'Thumbnails are not available in this build.')
    const dir = join(s.library.brandDir(post.brandName), 'Queue')
    mkdirSync(dir, { recursive: true })
    const stem = post.episodeRef ?? `post-${post.id}`
    saved = uniquePath(dir, `${stem}_thumb${extname(body.image_path).toLowerCase()}`)
    copyFileSync(body.image_path, saved)
    out.saved_image = saved
  }

  // 2. The title, while the post has not gone out.
  if (title !== undefined && title !== post.title) {
    s.posts.update(id, { title })
    out.title = title
  }

  // 3. YouTube. A video already inside YouTube is changed there. Otherwise the picture waits for the upload.
  const yt = post.targets.find((t) => t.platform === 'youtube')
  if (saved || title !== undefined) {
    if (!yt) {
      out.applied.push({
        platform: 'youtube',
        how: 'skipped',
        detail: 'This post has no YouTube target.',
      })
      if (saved) out.notes.push('The picture is saved with the post, but only YouTube uses it.')
    } else if (yt.externalId && ['handed_off', 'processing', 'posted'].includes(yt.status)) {
      if (saved) {
        if (!s.youtubeThumbnail || !yt.accountId)
          throw new AgentError(
            400,
            'bad_request',
            'YouTube thumbnails are not available in this build.',
          )
        try {
          await s.youtubeThumbnail(yt.accountId, yt.externalId, saved)
          out.applied.push({
            platform: 'youtube',
            how: 'set_on_youtube',
            detail: 'thumbnails.set replaced the live thumbnail.',
          })
        } catch (e) {
          s.log.log(
            'warn',
            `Thumbnail for post ${id} was not set on YouTube: ${(e as Error).message}`,
            { postId: id, platform: 'youtube' },
          )
          throw new AgentError(
            502,
            'server_error',
            `YouTube refused the thumbnail: ${(e as Error).message}`,
          )
        }
      }
      if (title !== undefined && yt.status !== 'posted') {
        if (!s.youtubeEdit || !yt.accountId)
          out.notes.push('The new title was not sent to YouTube (not available in this build).')
        else {
          await s.youtubeEdit(yt.accountId, yt.externalId, { title })
          out.applied.push({
            platform: 'youtube',
            how: 'title_updated_on_youtube',
            detail: 'The title was updated on the video inside YouTube.',
          })
        }
      }
    } else if (saved) {
      s.posts.setTargetThumbnail(yt.id, saved)
      out.applied.push({
        platform: 'youtube',
        how: 'saved_for_upload',
        detail: 'The picture is used when the video is uploaded.',
      })
    }
    if (
      saved &&
      (post.postType === 'clip' || (post.videoMeta.height ?? 0) > (post.videoMeta.width ?? 0))
    )
      out.notes.push(
        'This is a tall video (a Short). YouTube often ignores custom thumbnails on Shorts, so it may not show.',
      )
  }
  s.log.log(
    'info',
    `Thumbnail${title !== undefined ? ' and title' : ''} changed for "${out.title}" by ${who}.`,
    { postId: id },
  )
  if (caller.kind === 'bot')
    s.notifyOwner?.(`${who} changed a thumbnail`, `"${out.title}" (${post.brandName}).`)
  s.audit?.write({
    actor: who,
    action: 'post.thumbnail',
    target: `${post.brandName}/${post.episodeRef ?? id}`,
    after: {
      image: saved ? basename(saved) : null,
      title: title ?? null,
      applied: out.applied.map((a) => a.how),
    },
  })
  return out
}
