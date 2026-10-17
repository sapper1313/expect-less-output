import { createHash } from 'crypto'
import { createReadStream, existsSync, statSync } from 'fs'
import { basename } from 'path'
import type { Db } from '../db'
import type { Library } from '../services/library'
import { readSetting } from '../services/settings'

/** SHA-256 of a file, read as a stream so a big video does not fill memory. */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

/** Platforms of a channel that have a real, connected account (not a dry run). */
export function realPlatforms(db: Db, brandId: number): string[] {
  if (readSetting(db, 'globalDryRun')) {
    return (
      db.prepare('SELECT platform FROM accounts WHERE brand_id = ?').all(brandId) as Array<{
        platform: string
      }>
    ).map((r) => r.platform)
  }
  return (
    db
      .prepare(
        "SELECT platform FROM accounts WHERE brand_id = ? AND mode != 'dry_run' AND status = 'connected'",
      )
      .all(brandId) as Array<{ platform: string }>
  ).map((r) => r.platform)
}

interface PipelineRow {
  episode_ref: string | null
  checksum: string | null
  title: string
  sidecar_title: string | null
  video_path: string
  video_basename: string | null
  hold_reason: string | null
}

/**
 * The Oct 13 safeguard. Before a pipeline post is scheduled, and again right before it is sent, the file and the text
 * must still be exactly what was dropped: same name, same checksum, same title, and a name that carries the episode id.
 * Returns the reason to hold the post, or null when everything matches. A post that did not come from a bot is never held.
 */
export async function verifyPipelinePost(
  db: Db,
  library: Library,
  postId: number,
): Promise<string | null> {
  const r = db
    .prepare(
      'SELECT episode_ref, checksum, title, sidecar_title, video_path, video_basename, hold_reason FROM posts WHERE id = ?',
    )
    .get(postId) as PipelineRow | undefined
  if (!r || !r.episode_ref) return null
  if (r.hold_reason) return r.hold_reason
  const abs = library.resolve(r.video_path)
  if (!existsSync(abs)) return `The video file is missing: ${basename(r.video_path)}.`
  const name = basename(abs)
  if (!name.includes(r.episode_ref))
    return `The file name ${name} does not contain the episode id ${r.episode_ref}.`
  if (r.video_basename && name !== r.video_basename)
    return `The file name changed from ${r.video_basename} to ${name}.`
  if (r.sidecar_title !== null && r.title !== r.sidecar_title)
    return `The title "${r.title}" is not the title that came with the drop ("${r.sidecar_title}").`
  if (r.checksum) {
    if (statSync(abs).size === 0) return 'The video file is empty.'
    const now = await sha256File(abs)
    if (now.toLowerCase() !== r.checksum.toLowerCase())
      return `The video file changed after it was dropped (checksum ${now.slice(0, 12)} is not ${r.checksum.slice(0, 12)}).`
  }
  return null
}
