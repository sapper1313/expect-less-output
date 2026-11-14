import type { BrandStats } from './eloClient'
import { matchSlots, summarize, type MatchedSlot } from './matcher'
import { buildSlots } from './slots'
import type { TopVideo } from './stats'
import type { Brand, Post, PostType, Snapshot, SnapshotChannel } from './types'
import { DateTime } from 'luxon'
import { weekWindow } from './week'

export interface SnapshotInput {
  now: Date
  tz: string
  brands: Brand[]
  posts: Post[]
  brandStats: Map<number, BrandStats>
  topVideos: TopVideo[]
  trend: { week: string; percent: number }[]
  viewsDelta: Map<number, number | null>
  /** Open episode instants reported by ELO per brand, or null when not checked. */
  nextOpenByBrand: Map<number, string[]> | null
  elo: { status: 'ok' | 'stale' | 'unauthorized'; lastGoodAt: string | null }
  /** ELO's global minimum gap in minutes (default 1). Used only by the self-check. */
  minGapMinutes?: number
}

const PALETTE = [
  '#ffb020',
  '#22e5ff',
  '#2dffa8',
  '#8a5cff',
  '#ff8a5c',
  '#5cb8ff',
  '#ffe45c',
  '#b6ff5c',
]
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOUR_MS = 3_600_000
const RESERVING = new Set(['scheduled', 'in_progress', 'partial'])

export function slotsAgree(
  computed: string[],
  eloOpen: string[],
  fromIso: string,
  toIso: string,
): boolean {
  const within = (xs: string[]) => new Set(xs.filter((x) => x >= fromIso && x < toIso))
  const a = within(computed)
  const b = within(eloOpen)
  return a.size === b.size && [...a].every((x) => b.has(x))
}

function upNext(
  matched: MatchedSlot[],
  now: Date,
  hours: number,
  names: Map<number, string>,
  today: string,
): Snapshot['upNext'] {
  const from = now.getTime()
  const to = from + hours * HOUR_MS
  return matched
    .filter(
      (m) => m.state !== 'open' && Date.parse(m.instant) >= from && Date.parse(m.instant) < to,
    )
    .slice(0, 6)
    .map((m) => ({
      whenET: `${m.date === today ? 'Today' : DAY_NAMES[m.weekday]} ${m.timeET}`,
      channel: names.get(m.brandId) ?? 'Unknown',
      type: m.type as PostType,
    }))
}

export function buildSnapshot(input: SnapshotInput): Snapshot {
  const { now, tz, brands, posts } = input
  const week = weekWindow(now, tz)
  const names = new Map(brands.map((b) => [b.id, b.name]))
  const matchOpts = { tz, dailyCapByBrand: new Map(brands.map((b) => [b.id, b.dailyCap])) }
  const matched = matchSlots(buildSlots(brands, week, tz), posts, matchOpts)
  const totals = summarize(matched)
  const statusByPost = new Map(posts.map((p) => [p.id, p.status]))

  // Up next may reach into the following week (Friday and Saturday evenings).
  const horizon = now.getTime() + 48 * HOUR_MS
  let upcoming = matched
  if (horizon > Date.parse(week.endUtcExclusive)) {
    const nextWeek = weekWindow(new Date(Date.parse(week.endUtcExclusive) + HOUR_MS), tz)
    const extra = matchSlots(
      buildSlots(brands, nextWeek, tz).filter((sl) => Date.parse(sl.instant) < horizon),
      posts,
      matchOpts,
    )
    upcoming = [...matched, ...extra]
  }

  const channels: SnapshotChannel[] = brands
    .filter((b) => b.state !== 'archived')
    .map((b) => {
      const mine = matched.filter((m) => m.brandId === b.id)
      const filled = mine.filter((m) => m.state !== 'open').length
      return {
        id: b.id,
        name: b.name,
        state: b.state,
        color: PALETTE[b.id % PALETTE.length],
        filled,
        total: mine.length,
        percent: mine.length === 0 ? 0 : Math.round((filled / mine.length) * 100),
        views7d: input.brandStats.get(b.id)?.views ?? null,
        viewsDeltaPct: input.viewsDelta.get(b.id) ?? null,
        days: week.days.map((date) => ({
          date,
          slots: mine
            .filter((m) => m.date === date)
            .sort((x, y) => Number(x.type === 'clip') - Number(y.type === 'clip'))
            .map((m) => ({ type: m.type, state: m.state, postId: m.postId, timeET: m.timeET })),
        })),
      }
    })

  const describe = (m: MatchedSlot) => ({
    brand: names.get(m.brandId) ?? 'Unknown',
    type: m.type,
    day: DAY_NAMES[m.weekday],
    date: m.date,
    timeET: m.timeET,
  })

  const active = brands.filter((b) => b.state === 'active')
  const stats =
    input.brandStats.size === 0
      ? null
      : active.reduce(
          (acc, b) => {
            const s = input.brandStats.get(b.id)
            if (s) {
              acc.views += s.views
              acc.likes += s.likes
              acc.comments += s.comments
              acc.shares += s.shares
            }
            return acc
          },
          { views: 0, likes: 0, comments: 0, shares: 0 },
        )

  const gapMs = (input.minGapMinutes ?? 1) * 60_000
  const blockedByGap = (instant: string, brandId: number): boolean =>
    gapMs > 0 &&
    posts.some(
      (p) =>
        p.brandId !== brandId &&
        RESERVING.has(p.status) &&
        Math.abs(Date.parse(p.scheduledAtUtc) - Date.parse(instant)) < gapMs,
    )

  let agree = true
  const diffs: Snapshot['checks']['diffs'] = []
  const label = (iso: string) =>
    DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz).toFormat('ccc LLL d h:mm a')
  if (input.nextOpenByBrand) {
    const from = now.toISOString()
    for (const b of active) {
      const computed = matched
        // ELO's next-open still offers a day whose only post failed or was missed, so attention counts as open here.
        .filter((m) => m.brandId === b.id && m.type === 'episode' && m.state !== 'filled')
        .map((m) => m.instant)
        // ELO's next-open hides a slot when another channel has a reserved post within the minimum gap.
        .filter((instant) => !blockedByGap(instant, b.id))
      const theirs = input.nextOpenByBrand.get(b.id)
      if (theirs && !slotsAgree(computed, theirs, from, week.endUtcExclusive)) {
        agree = false
        const inWindow = (xs: string[]) => xs.filter((x) => x >= from && x < week.endUtcExclusive)
        const mine = new Set(inWindow(computed))
        const elo = new Set(inWindow(theirs))
        diffs.push({
          brand: b.name,
          onlyMine: [...mine]
            .filter((x) => !elo.has(x))
            .sort()
            .map(label),
          onlyElo: [...elo]
            .filter((x) => !mine.has(x))
            .sort()
            .map(label),
        })
      }
    }
  }

  const lastGood = input.elo.lastGoodAt ? Date.parse(input.elo.lastGoodAt) : null
  return {
    generatedAt: now.toISOString(),
    status: {
      elo: input.elo.status,
      lastGoodAt: input.elo.lastGoodAt,
      staleMinutes:
        input.elo.status === 'ok' || lastGood === null
          ? 0
          : Math.max(0, Math.floor((now.getTime() - lastGood) / 60000)),
    },
    week: { start: week.startDate, end: week.endDate, tz, today: week.today, days: week.days },
    totals,
    openSlots: matched.filter((m) => m.state === 'open').map(describe),
    attentionSlots: matched
      .filter((m) => m.state === 'attention')
      .map((m) => ({ ...describe(m), status: statusByPost.get(m.postId as number) ?? 'unknown' })),
    channels,
    stats,
    topVideos: input.topVideos.map((v) => ({
      rank: v.rank,
      title: v.title,
      channel: v.channel,
      views: v.views,
      approximate: v.approximate,
    })),
    upNext: upNext(upcoming, now, 48, names, week.today),
    trend: input.trend.length >= 2 ? input.trend : [],
    checks: { slotsAgree: agree, diffs },
    revenue: null,
  }
}
