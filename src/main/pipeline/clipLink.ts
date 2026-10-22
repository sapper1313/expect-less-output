import type { Db } from '../db'

export const FULL_EPISODE_LINE = 'Full episode on YouTube:'

/** The show's YouTube channel link, from its connected YouTube account. Null when there is none. */
export function channelUrl(db: Db, brandId: number): string | null {
  const a = db
    .prepare(
      "SELECT external_id FROM accounts WHERE brand_id = ? AND platform = 'youtube' AND mode != 'dry_run' AND status = 'connected' AND external_id IS NOT NULL",
    )
    .get(brandId) as { external_id: string } | undefined
  return a ? `https://www.youtube.com/channel/${a.external_id}` : null
}

/**
 * Puts the lines at the end of a description in a fixed order: the text, then "Full episode on YouTube: <link>", then the
 * channel link. Safe to run again: a line that is already there is not added twice, and the channel link always stays last.
 */
export function withClipLines(
  text: string,
  episodeUrl: string | null,
  channel: string | null,
): string {
  let body = text.trimEnd()
  if (channel && body.endsWith(channel))
    body = body.slice(0, body.length - channel.length).trimEnd()
  if (episodeUrl && !body.includes(FULL_EPISODE_LINE))
    body = `${body}${body ? '\n\n' : ''}${FULL_EPISODE_LINE} ${episodeUrl}`
  if (channel && !body.includes(channel)) body = `${body}${body ? '\n\n' : ''}${channel}`
  return body
}

/**
 * Called right before a clip is sent. Adds "Full episode on YouTube: <link>" once the source episode is live, then the
 * show's channel link (unless the clip turned it off), to the description for every platform. If the episode is not live
 * yet the clip goes out without that line. Returns true when the text changed.
 */
export function addEpisodeLink(db: Db, postId: number): boolean {
  const clip = db
    .prepare(
      "SELECT id, brand_id, caption, source_episode_ref, channel_link FROM posts WHERE id = ? AND post_type = 'clip'",
    )
    .get(postId) as
    | {
        id: number
        brand_id: number
        caption: string
        source_episode_ref: string | null
        channel_link: number
      }
    | undefined
  if (!clip) return false
  const live = clip.source_episode_ref
    ? (db
        .prepare(
          `SELECT t.external_url AS url FROM posts p JOIN post_targets t ON t.post_id = p.id
           WHERE p.brand_id = ? AND p.episode_ref = ? AND p.post_type = 'episode'
             AND t.platform = 'youtube' AND t.status = 'posted' AND t.external_url IS NOT NULL
           ORDER BY t.id DESC LIMIT 1`,
        )
        .get(clip.brand_id, clip.source_episode_ref) as { url: string } | undefined)
    : undefined
  const channel = clip.channel_link ? channelUrl(db, clip.brand_id) : null
  if (!live && !channel) return false
  let changed = false
  db.transaction(() => {
    const next = withClipLines(clip.caption, live?.url ?? null, channel)
    if (next !== clip.caption) {
      db.prepare('UPDATE posts SET caption = ? WHERE id = ?').run(next, clip.id)
      changed = true
    }
    const rows = db
      .prepare(
        "SELECT id, caption_override AS c FROM post_targets WHERE post_id = ? AND caption_override IS NOT NULL AND caption_override != ''",
      )
      .all(clip.id) as Array<{ id: number; c: string }>
    for (const r of rows) {
      const n = withClipLines(r.c, live?.url ?? null, channel)
      if (n !== r.c) {
        db.prepare('UPDATE post_targets SET caption_override = ? WHERE id = ?').run(n, r.id)
        changed = true
      }
    }
  })()
  return changed
}
