import type { Db } from '../db'
import type { UploadPostClient } from '../uploadpost/client'
import type { StatsOutcome, StatsProvider, StatsTarget } from './providers'

export interface UploadPostStatsDeps {
  db: Db
  client: Pick<UploadPostClient, 'postAnalytics'>
  apiKey: () => string | null
  profileFor: (brandId: number) => string
  /** True when this channel has the platform ticked on the Upload-Post page. */
  active: (brandId: number, platform: string) => boolean
  log?: (message: string) => void
}

const pick = (m: Record<string, number>, ...keys: string[]): number | null => {
  for (const k of keys) if (typeof m[k] === 'number') return m[k]
  return null
}

/**
 * Per-post numbers from Upload-Post first. Anything Upload-Post cannot give (not ticked, no numbers, an error) is read
 * from ELO's own connection instead, so a number is never lost because of one path.
 */
export function uploadPostFirst(inner: StatsProvider | undefined, platform: StatsProvider['platform'], d: UploadPostStatsDeps): StatsProvider {
  return {
    platform,
    async fetch(targets: StatsTarget[]): Promise<Map<number, StatsOutcome>> {
      const out = new Map<number, StatsOutcome>()
      const key = d.apiKey()
      const rest: StatsTarget[] = []
      for (const t of targets) {
        const brandId = t.account?.brandId
        const user = brandId ? d.profileFor(brandId) : ''
        if (!key || !brandId || !user || !d.active(brandId, platform)) {
          rest.push(t)
          continue
        }
        const row = d.db.prepare('SELECT settings_json FROM post_targets WHERE id = ?').get(t.targetId) as { settings_json: string | null } | undefined
        let requestId: string | undefined
        try {
          const s = row?.settings_json ? (JSON.parse(row.settings_json) as Record<string, unknown>) : {}
          if (typeof s.upRequestId === 'string' && s.route !== 'elo') requestId = s.upRequestId
        } catch {
          /* no saved id */
        }
        try {
          const r = await d.client.postAnalytics(key, {
            platform,
            user,
            requestId,
            platformPostId: requestId ? undefined : t.externalId,
          })
          const views = pick(r.metrics, 'views', 'view_count', 'play_count', 'video_views', 'impressions')
          const likes = pick(r.metrics, 'likes', 'like_count', 'reactions')
          const comments = pick(r.metrics, 'comments', 'comment_count', 'comments_count')
          const shares = pick(r.metrics, 'shares', 'share_count', 'reposts')
          if (views === null && likes === null && comments === null && shares === null) {
            rest.push(t)
            continue
          }
          out.set(t.targetId, { ok: true, numbers: { views, likes, comments, shares }, extra: { source: 'upload-post' } })
        } catch (err) {
          d.log?.(`Upload-Post gave no ${platform} numbers for target ${t.targetId}: ${(err as Error).message}. Using ELO's own connection.`)
          rest.push(t)
        }
      }
      if (rest.length && inner) for (const [id, o] of await inner.fetch(rest)) out.set(id, o)
      else for (const t of rest) if (!out.has(t.targetId)) out.set(t.targetId, { ok: false, reason: 'No numbers from Upload-Post and no own connection for this platform.', unavailable: false })
      return out
    },
  }
}
