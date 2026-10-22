import type { Db } from '../db'

export const FULL_EPISODE_LINE = 'Full episode on YouTube:'

/**
 * A clip that names its source episode gets "Full episode on YouTube: <link>" added to its description, once that episode
 * is live on YouTube. Called right before a clip is sent. If the episode is not live yet, the clip goes out without the
 * line and nothing is changed. Returns true when the line was added.
 */
export function addEpisodeLink(db: Db, postId: number): boolean {
  const clip = db
    .prepare(
      "SELECT id, brand_id, caption, source_episode_ref FROM posts WHERE id = ? AND post_type = 'clip' AND source_episode_ref IS NOT NULL",
    )
    .get(postId) as
    { id: number; brand_id: number; caption: string; source_episode_ref: string } | undefined
  if (!clip || clip.caption.includes(FULL_EPISODE_LINE)) return false
  const live = db
    .prepare(
      `SELECT t.external_url AS url FROM posts p JOIN post_targets t ON t.post_id = p.id
       WHERE p.brand_id = ? AND p.episode_ref = ? AND p.post_type = 'episode'
         AND t.platform = 'youtube' AND t.status = 'posted' AND t.external_url IS NOT NULL
       ORDER BY t.id DESC LIMIT 1`,
    )
    .get(clip.brand_id, clip.source_episode_ref) as { url: string } | undefined
  if (!live) return false
  const line = `${FULL_EPISODE_LINE} ${live.url}`
  const add = (text: string) => `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${line}`
  db.transaction(() => {
    db.prepare('UPDATE posts SET caption = ? WHERE id = ?').run(add(clip.caption), clip.id)
    const rows = db
      .prepare(
        "SELECT id, caption_override AS c FROM post_targets WHERE post_id = ? AND caption_override IS NOT NULL AND caption_override != ''",
      )
      .all(clip.id) as Array<{ id: number; c: string }>
    for (const r of rows)
      if (!r.c.includes(FULL_EPISODE_LINE))
        db.prepare('UPDATE post_targets SET caption_override = ? WHERE id = ?').run(add(r.c), r.id)
  })()
  return true
}
