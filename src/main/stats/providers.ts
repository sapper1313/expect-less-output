import { MetaApiError, type GraphClient } from '../meta/graph'
import { TikTokApiError, type TikTokClient } from '../tiktok/client'
import type { Account, Platform, StatsNumbers } from '@shared/types'
import { isTikTokVideoId } from './ids'

export interface StatsTarget {
  targetId: number
  platform: Platform
  accountId: number | null
  account: Account | null
  externalId: string
  postedAt: string
}

export type StatsOutcome =
  | { ok: true; numbers: StatsNumbers; approximate?: string[]; extra?: Record<string, unknown> }
  /** unavailable: it cannot be read (permission, unknown id). Otherwise a temporary problem, try again later. */
  | { ok: false; reason: string; unavailable: boolean }

export interface StatsProvider {
  readonly platform: Platform
  fetch(targets: StatsTarget[]): Promise<Map<number, StatsOutcome>>
}

const NONE: StatsNumbers = { views: null, likes: null, comments: null, shares: null }
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : null
const sum = (o: unknown): number | null =>
  o && typeof o === 'object'
    ? Object.values(o as Record<string, unknown>).reduce<number>((a, b) => a + (num(b) ?? 0), 0)
    : num(o)

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}
function byAccount(targets: StatsTarget[]): Map<number, StatsTarget[]> {
  const m = new Map<number, StatsTarget[]>()
  for (const t of targets) m.set(t.accountId ?? 0, [...(m.get(t.accountId ?? 0) ?? []), t])
  return m
}

// ---------------- YouTube ----------------

export interface YoutubeStatsSource {
  /** Statistics for up to 50 video ids in one call (1 quota unit). Ids YouTube does not return are left out. */
  videoStatistics(
    accountId: number,
    ids: string[],
  ): Promise<Map<string, { views: number | null; likes: number | null; comments: number | null }>>
}

export class YoutubeStatsProvider implements StatsProvider {
  readonly platform = 'youtube' as const
  constructor(private src: YoutubeStatsSource) {}

  async fetch(targets: StatsTarget[]): Promise<Map<number, StatsOutcome>> {
    const out = new Map<number, StatsOutcome>()
    for (const [accountId, list] of byAccount(targets)) {
      for (const group of chunk(list, 50)) {
        try {
          const stats = await this.src.videoStatistics(
            accountId,
            group.map((t) => t.externalId),
          )
          for (const t of group) {
            const s = stats.get(t.externalId)
            out.set(
              t.targetId,
              s
                ? {
                    ok: true,
                    numbers: { views: s.views, likes: s.likes, comments: s.comments, shares: null },
                    extra: { note: 'YouTube does not report shares.' },
                  }
                : {
                    ok: false,
                    unavailable: true,
                    reason:
                      'YouTube did not return this video. It may have been deleted, or it belongs to another channel.',
                  },
            )
          }
        } catch (e) {
          for (const t of group)
            out.set(t.targetId, { ok: false, unavailable: false, reason: (e as Error).message })
        }
      }
    }
    return out
  }
}

// ---------------- Instagram ----------------

export interface MetaStatsDeps {
  graph: GraphClient
  tokenFor: (account: Account | null) => string
  onAuthFailed?: (reason: string) => void
}

const IG_METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions']
const IG_FALLBACK = ['reach', 'likes', 'comments', 'shares', 'saved']

function metaFailure(e: unknown, permissionHelp: string, deps: MetaStatsDeps): StatsOutcome {
  if (e instanceof MetaApiError) {
    if (e.needsReauth) {
      deps.onAuthFailed?.(e.message)
      return {
        ok: false,
        unavailable: true,
        reason: 'Meta needs you to sign in again. Reconnect Meta on the Connections screen.',
      }
    }
    if (e.code === 10 || (e.code >= 200 && e.code <= 299))
      return { ok: false, unavailable: true, reason: permissionHelp }
    return { ok: false, unavailable: e.kind === 'permanent' && e.code !== 100, reason: e.message }
  }
  return { ok: false, unavailable: false, reason: (e as Error).message }
}

export class InstagramStatsProvider implements StatsProvider {
  readonly platform = 'instagram' as const
  constructor(private d: MetaStatsDeps) {}

  private async insights(
    mediaId: string,
    token: string,
    metrics: string[],
  ): Promise<Record<string, number>> {
    const r = await this.d.graph.get<{
      data: Array<{
        name: string
        values?: Array<{ value: unknown }>
        total_value?: { value: unknown }
      }>
    }>(`/${mediaId}/insights`, { metric: metrics.join(',') }, token)
    const out: Record<string, number> = {}
    for (const m of r.data ?? []) {
      const v = num(m.values?.[0]?.value ?? m.total_value?.value)
      if (v !== null) out[m.name] = v
    }
    return out
  }

  async fetch(targets: StatsTarget[]): Promise<Map<number, StatsOutcome>> {
    const out = new Map<number, StatsOutcome>()
    for (const t of targets) {
      try {
        const token = this.d.tokenFor(t.account)
        let m: Record<string, number>
        try {
          m = await this.insights(t.externalId, token, IG_METRICS)
        } catch (e) {
          // Older posts do not support every metric. Ask again for the basic ones.
          if (e instanceof MetaApiError && e.code === 100)
            m = await this.insights(t.externalId, token, IG_FALLBACK)
          else throw e
        }
        out.set(t.targetId, {
          ok: true,
          numbers: {
            views: m.views ?? null,
            likes: m.likes ?? null,
            comments: m.comments ?? null,
            shares: m.shares ?? null,
          },
          extra: {
            reach: m.reach ?? null,
            saved: m.saved ?? null,
            total_interactions: m.total_interactions ?? null,
          },
        })
      } catch (e) {
        out.set(
          t.targetId,
          metaFailure(
            e,
            'Instagram insights need the instagram_manage_insights permission. Reconnect Meta and approve it.',
            this.d,
          ),
        )
      }
    }
    return out
  }
}

// ---------------- Facebook ----------------

const FB_METRICS = [
  'blue_reels_play_count',
  'post_video_likes_by_reaction_type',
  'post_video_social_actions',
  'post_impressions_unique',
]

export class FacebookStatsProvider implements StatsProvider {
  readonly platform = 'facebook' as const
  constructor(private d: MetaStatsDeps) {}

  async fetch(targets: StatsTarget[]): Promise<Map<number, StatsOutcome>> {
    const out = new Map<number, StatsOutcome>()
    for (const t of targets) {
      try {
        const token = this.d.tokenFor(t.account)
        const ins = await this.d.graph.get<{
          data: Array<{ name: string; values?: Array<{ value: unknown }> }>
        }>(
          `/${t.externalId}/video_insights`,
          { metric: FB_METRICS.join(','), period: 'lifetime' },
          token,
        )
        const val = (name: string) => ins.data?.find((m) => m.name === name)?.values?.[0]?.value
        const plays = num(val('blue_reels_play_count'))
        const likes = sum(val('post_video_likes_by_reaction_type'))
        const social = val('post_video_social_actions')
        // The comment count comes straight from the video. Shares are what is left of "comments and shares".
        let comments: number | null = null
        try {
          const v = await this.d.graph.get<{ comments?: { summary?: { total_count?: number } } }>(
            `/${t.externalId}`,
            { fields: 'comments.summary(true).limit(0)' },
            token,
          )
          comments = num(v.comments?.summary?.total_count)
        } catch {
          // comment count is optional
        }
        let shares: number | null = null
        const approximate: string[] = []
        if (social && typeof social === 'object') {
          const o = social as Record<string, unknown>
          const shareKey = Object.keys(o).find((k) => /share/i.test(k))
          const commentKey = Object.keys(o).find((k) => /comment/i.test(k))
          if (shareKey) shares = num(o[shareKey])
          if (comments === null && commentKey) comments = num(o[commentKey])
        } else if (num(social) !== null) {
          shares = Math.max(0, (num(social) as number) - (comments ?? 0))
          approximate.push('shares')
        }
        out.set(t.targetId, {
          ok: true,
          numbers: { views: plays, likes, comments, shares },
          approximate,
          extra: { reach: num(val('post_impressions_unique')), social_actions: social ?? null },
        })
      } catch (e) {
        out.set(
          t.targetId,
          metaFailure(
            e,
            'Facebook Reels stats need the read_insights and pages_manage_engagement permissions. Add pages_manage_engagement in the Meta app (SETUP_B step 3), then click Reconnect Meta.',
            this.d,
          ),
        )
      }
    }
    return out
  }
}

// ---------------- TikTok ----------------

export interface TikTokStatsDeps {
  client: TikTokClient
  accessToken: (accountId: number, force?: boolean) => Promise<string>
  /** The scopes TikTok granted when this account connected, or null when unknown. */
  grantedScope: (accountId: number) => string | null
}

export class TikTokStatsProvider implements StatsProvider {
  readonly platform = 'tiktok' as const
  constructor(private d: TikTokStatsDeps) {}

  async fetch(targets: StatsTarget[]): Promise<Map<number, StatsOutcome>> {
    const out = new Map<number, StatsOutcome>()
    for (const [accountId, list] of byAccount(targets)) {
      const usable: StatsTarget[] = []
      for (const t of list) {
        if (!isTikTokVideoId(t.externalId)) {
          out.set(t.targetId, {
            ok: false,
            unavailable: true,
            reason:
              'TikTok does not tell the app the video id for drafts. Paste the video link when you mark the post as posted.',
          })
        } else usable.push(t)
      }
      if (usable.length === 0) continue
      const scope = this.d.grantedScope(accountId)
      if (scope !== null && !scope.split(',').includes('video.list')) {
        for (const t of usable)
          out.set(t.targetId, {
            ok: false,
            unavailable: true,
            reason:
              'Stats need the video.list permission. Add it in the TikTok developer portal, tick "Also ask for video.list" on Connections, then Reconnect TikTok.',
          })
        continue
      }
      for (const group of chunk(usable, 20)) {
        try {
          let token = await this.d.accessToken(accountId)
          let r: Map<string, StatsNumbers>
          try {
            r = await this.d.client.queryVideos(
              token,
              group.map((t) => t.externalId),
            )
          } catch (e) {
            if (e instanceof TikTokApiError && e.needsRefresh) {
              token = await this.d.accessToken(accountId, true)
              r = await this.d.client.queryVideos(
                token,
                group.map((t) => t.externalId),
              )
            } else throw e
          }
          for (const t of group) {
            const s = r.get(t.externalId)
            out.set(
              t.targetId,
              s
                ? { ok: true, numbers: s }
                : {
                    ok: false,
                    unavailable: true,
                    reason:
                      'TikTok did not return this video. It may have been deleted or is not on this account.',
                  },
            )
          }
        } catch (e) {
          const unavailable =
            e instanceof TikTokApiError &&
            (e.code === 'scope_not_authorized' || e.code === 'scope_permission_missed')
          for (const t of group) {
            out.set(t.targetId, {
              ok: false,
              unavailable,
              reason: unavailable
                ? 'Stats need the video.list permission. Add it in the TikTok developer portal, tick "Also ask for video.list" on Connections, then Reconnect TikTok.'
                : (e as Error).message,
            })
          }
        }
      }
    }
    return out
  }
}

export { NONE as EMPTY_STATS }

/** Stats for one target, for an adapter's fetchStats. Throws a plain message when they cannot be read. */
export async function fetchOneStats(
  provider: StatsProvider | undefined,
  platform: Platform,
  ctx: {
    targetId: number
    externalId: string | null
    account: Account | null
    scheduledAtUtc: string
  },
): Promise<Record<string, number>> {
  if (!provider) throw new Error('Stats are not set up for this platform.')
  if (!ctx.externalId) throw new Error('The app does not know the video id for this post.')
  const r = (
    await provider.fetch([
      {
        targetId: ctx.targetId,
        platform,
        accountId: ctx.account?.id ?? null,
        account: ctx.account,
        externalId: ctx.externalId,
        postedAt: ctx.scheduledAtUtc,
      },
    ])
  ).get(ctx.targetId)
  if (!r || !r.ok) throw new Error(r && !r.ok ? r.reason : 'No answer.')
  return Object.fromEntries(Object.entries(r.numbers).filter(([, v]) => v !== null)) as Record<
    string,
    number
  >
}
