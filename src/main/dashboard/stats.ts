import type { BrandStats, EloClient, PostStats } from './eloClient'
import type { Post } from './types'

export interface TopVideo {
  rank: number
  postId: number
  title: string
  channel: string
  views: number
  approximate: boolean
}

type StatsClient = Pick<EloClient, 'postStats' | 'brandStats'>
const DAY_MS = 86_400_000

export class StatsService {
  private cache = new Map<number, { at: number; value: PostStats }>()

  constructor(
    private client: StatsClient,
    private now: () => Date,
    private ttlMs: number = 30 * 60_000,
  ) {}

  channelViews(brandId: number): Promise<BrandStats> {
    return this.client.brandStats(brandId, '7d')
  }

  private async postStats(id: number): Promise<PostStats | null> {
    const t = this.now().getTime()
    const hit = this.cache.get(id)
    if (hit && t - hit.at < this.ttlMs) return hit.value
    try {
      const value = await this.client.postStats(id)
      this.cache.set(id, { at: t, value })
      return value
    } catch {
      return hit ? hit.value : null
    }
  }

  async topVideos(posts: Post[], brandNames: Map<number, string>, limit = 5): Promise<TopVideo[]> {
    const cutoff = this.now().getTime() - 7 * DAY_MS
    const candidates = posts.filter(
      (p) => p.status === 'posted' && p.postedAtUtc !== null && Date.parse(p.postedAtUtc) >= cutoff,
    )
    const rows: Omit<TopVideo, 'rank'>[] = []
    for (const p of candidates) {
      const s = await this.postStats(p.id)
      if (!s || s.views === null) continue
      rows.push({
        postId: p.id,
        title: p.title,
        channel: brandNames.get(p.brandId) ?? 'Unknown',
        views: s.views,
        approximate: s.approximate,
      })
    }
    rows.sort((a, b) => b.views - a.views)
    return rows.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r }))
  }
}
