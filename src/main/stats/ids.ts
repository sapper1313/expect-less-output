import type { Platform } from '@shared/platformLimits'

/**
 * Finds the video id inside a link the owner pasted when marking a post as posted.
 * YouTube: youtube.com/shorts/ID, youtube.com/watch?v=ID, youtu.be/ID.  TikTok: tiktok.com/@name/video/NUMBER.
 */
export function parseVideoId(platform: Platform, link: string): string | null {
  let u: URL
  try {
    u = new URL(link.trim())
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase()
  if (platform === 'youtube') {
    if (host === 'youtu.be')
      return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null
    if (host === 'youtube.com' || host === 'music.youtube.com') {
      const m = /^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.pathname)
      if (m) return m[1]
      const v = u.searchParams.get('v')
      return v && /^[\w-]{11}$/.test(v) ? v : null
    }
    return null
  }
  if (platform === 'tiktok') {
    if (!host.endsWith('tiktok.com')) return null
    const m = /\/video\/(\d{10,})/.exec(u.pathname)
    return m ? m[1] : null
  }
  return null
}

/** A real TikTok video id is a long number. A publish id (used for drafts) is not. */
export const isTikTokVideoId = (id: string | null | undefined): id is string =>
  !!id && /^\d{10,}$/.test(id)

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * When to look again. Under 7 days old: every 6 hours. 7 to 30 days: daily. Older: stop.
 * A target that could not be read is retried daily at most, so a missing permission does not cause constant calls.
 */
export function shouldRefresh(opts: {
  ageMs: number
  lastFetchMs: number | null
  nowMs: number
  unavailable: boolean
}): boolean {
  const { ageMs, lastFetchMs, nowMs } = opts
  if (ageMs > 30 * DAY || ageMs < 0) return false
  if (lastFetchMs === null) return true
  const since = nowMs - lastFetchMs
  if (opts.unavailable) return since >= DAY
  return ageMs < 7 * DAY ? since >= 6 * HOUR : since >= DAY
}
