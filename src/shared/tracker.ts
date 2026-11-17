// The production tracker: planned versus finished, per channel and per platform, with flags.
// It only reads. It never schedules, moves or changes a post. The pure builder lives here so it can be tested
// without a database; src/main/pipeline/tracker.ts gathers the data and calls it.
import { DateTime } from 'luxon'
import { ZONE } from './time'
import type { UpcomingStatus } from './upcoming'

/** The steps an episode goes through. Queued and rendering are one step (building). */
export const TRACKER_STAGES = [
  'idea',
  'scripted',
  'building',
  'needs-review',
  'muse-passed',
  'dropped',
] as const
export type TrackerStage = (typeof TRACKER_STAGES)[number]

export const STAGE_LABEL: Record<TrackerStage, string> = {
  idea: 'Idea',
  scripted: 'Scripted',
  building: 'Building',
  'needs-review': 'Needs review',
  'muse-passed': 'Muse passed',
  dropped: 'Dropped',
}

export function stageOf(status: UpcomingStatus | string): TrackerStage {
  if (status === 'queued' || status === 'rendering') return 'building'
  return (TRACKER_STAGES as readonly string[]).includes(status) ? (status as TrackerStage) : 'idea'
}

/** What one platform shows for one episode. */
export type CellState =
  | 'not-ready' // the episode is not finished yet
  | 'ready' // finished (Muse passed) or waiting in the Inbox, not placed on a time yet
  | 'scheduled'
  | 'posting'
  | 'posted'
  | 'failed'
  | 'skipped'
  | 'missing' // the platform should have an entry and the drop has none

export interface PlatformCell {
  platform: string
  state: CellState
  /** The go-out time ELO has for this platform, when there is one. */
  atUtc: string | null
}

export type FlagKind =
  | 'slot_no_episode'
  | 'muse_passed_not_dropped'
  | 'partial_drop'
  | 'muse_passed_no_post'
  | 'late_unfinished'
  | 'no_air_date'

export const FLAG_TITLE: Record<FlagKind, string> = {
  slot_no_episode: 'Slot with no finished episode',
  muse_passed_not_dropped: 'Muse passed, not dropped yet',
  partial_drop: 'Dropped for some platforms only',
  muse_passed_no_post: 'Muse passed, no post by its air date',
  late_unfinished: 'Past its air date and not finished',
  no_air_date: 'Muse passed with no air date',
}

export interface TrackerFlag {
  key: string
  kind: FlagKind
  severity: 'warn' | 'bad'
  brandId: number
  channel: string
  channelName: string
  episodeId?: string
  /** Eastern day this is about, YYYY-MM-DD. */
  day?: string
  platforms?: string[]
  detail: string
}

export interface TrackerEpisode {
  channel: string
  episodeId: string
  title: string
  status: string
  stage: TrackerStage
  /** The planned day (Upcoming air_date) or, with none, the day ELO has the first platform going out. */
  airDate: string | null
  airSource: 'planned' | 'scheduled' | null
  postId: number | null
  postStatus: string | null
  cells: PlatformCell[]
  flags: FlagKind[]
}

export interface TrackerChannel {
  brandId: number
  slug: string
  name: string
  color: string
  state: string
  /** The platforms shown as columns. */
  platforms: string[]
  counts: Record<TrackerStage, number>
  episodes: TrackerEpisode[]
}

export interface TrackerView {
  generatedAt: string
  /** Today, Eastern. */
  today: string
  flagDays: number
  channels: TrackerChannel[]
  flags: TrackerFlag[]
}

// ---------- input ----------

export interface TrackerChannelIn {
  brandId: number
  slug: string
  name: string
  color: string
  state: string
  /** Platforms shown as columns (every platform the channel has an account or times for). */
  shown: string[]
  /** Platforms a drop should have an entry for: connected, not dry run, ticked for the channel. */
  expected: string[]
  /** Videos sitting in the Inbox with no slot. */
  waiting: number
}

export interface TrackerEntryIn {
  channel: string
  episode_id: string
  working_title: string
  status: string
  air_date?: string
}

export interface TrackerPostIn {
  id: number
  brandId: number
  episodeRef: string | null
  status: string
  scheduledAtUtc: string | null
  targets: Array<{ platform: string; status: string; atUtc: string | null }>
  /** The platforms this video should have, from its kind (a Long form video may post to fewer). Defaults to the channel's. */
  expected?: string[]
}

export interface TrackerSlotIn {
  brandId: number
  platform: string
  whenUtc: string
}

export interface TrackerInput {
  nowMs: number
  /** How many days ahead an empty slot is called out. */
  flagDays: number
  channels: TrackerChannelIn[]
  entries: TrackerEntryIn[]
  posts: TrackerPostIn[]
  /** Slots with nothing on them, per platform, from now to the end of the flag window. */
  openSlots: TrackerSlotIn[]
}

export const DEFAULT_FLAG_DAYS = 3
/** A dropped entry stays on the board this many days after its air day. */
const KEEP_DROPPED_DAYS = 3
/** Posts older than this many days are not checked for a missing platform. */
const PARTIAL_LOOKBACK_DAYS = 3

const etDay = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('yyyy-MM-dd')
const dayLabel = (day: string) => DateTime.fromISO(day, { zone: ZONE }).toFormat('ccc L/d')
const timeLabel = (iso: string) =>
  DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('h:mm a')
const PLATFORM_NAME: Record<string, string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  bluesky: 'Bluesky',
}
const pname = (p: string) => PLATFORM_NAME[p] ?? p

const isLive = (status: string) => status !== 'skipped' && status !== 'canceled'

function cellFor(
  stage: TrackerStage,
  platform: string,
  post: TrackerPostIn | null,
  expected: boolean,
): PlatformCell {
  if (post) {
    const t = post.targets.find((x) => x.platform === platform && isLive(x.status))
    if (t) {
      const state: CellState =
        t.status === 'posted'
          ? 'posted'
          : t.status === 'failed' || t.status === 'needs_action' || t.status === 'missed'
            ? 'failed'
            : ['handed_off', 'uploading', 'processing'].includes(t.status)
              ? 'posting'
              : post.status === 'draft'
                ? 'ready'
                : 'scheduled'
      return { platform, state, atUtc: t.atUtc ?? post.scheduledAtUtc }
    }
    const skipped = post.targets.some((x) => x.platform === platform && !isLive(x.status))
    if (skipped) return { platform, state: 'skipped', atUtc: null }
    return { platform, state: expected ? 'missing' : 'skipped', atUtc: null }
  }
  return { platform, state: stage === 'muse-passed' ? 'ready' : 'not-ready', atUtc: null }
}

export function buildTracker(i: TrackerInput): TrackerView {
  const now = DateTime.fromMillis(i.nowMs, { zone: ZONE })
  const today = now.toFormat('yyyy-MM-dd')
  const horizon = now.plus({ days: i.flagDays }).toFormat('yyyy-MM-dd')
  const keepFrom = now.minus({ days: KEEP_DROPPED_DAYS }).toFormat('yyyy-MM-dd')
  const partialFrom = new Date(i.nowMs - PARTIAL_LOOKBACK_DAYS * 86_400_000).toISOString()
  const flags: TrackerFlag[] = []
  const channels: TrackerChannel[] = []

  for (const c of i.channels) {
    const active = c.state === 'active'
    const mine = i.entries.filter((e) => e.channel === c.slug)
    const posts = i.posts.filter((p) => p.brandId === c.brandId)
    const postOf = (id: string): TrackerPostIn | null =>
      posts
        .filter((p) => p.episodeRef === id && p.status !== 'canceled')
        .sort((a, b) => b.id - a.id)[0] ?? null

    const counts = Object.fromEntries(TRACKER_STAGES.map((s) => [s, 0])) as Record<TrackerStage, number>
    const episodes: TrackerEpisode[] = []
    const flag = (f: Omit<TrackerFlag, 'brandId' | 'channel' | 'channelName'>, ep?: TrackerEpisode) => {
      flags.push({ ...f, brandId: c.brandId, channel: c.slug, channelName: c.name })
      if (ep && !ep.flags.includes(f.kind)) ep.flags.push(f.kind)
    }

    for (const e of mine) {
      const post = postOf(e.episode_id)
      // An episode id that already has a live post is in ELO, whatever the entry still says (an old entry ELO never linked).
      const stage = post ? 'dropped' : stageOf(e.status)
      counts[stage] += 1
      const scheduledFirst = post
        ? (post.targets
            .filter((t) => isLive(t.status) && t.atUtc)
            .map((t) => t.atUtc as string)
            .sort()[0] ??
          post.scheduledAtUtc ??
          null)
        : null
      const airDate = e.air_date ?? (scheduledFirst ? etDay(scheduledFirst) : null)
      const airSource = e.air_date ? 'planned' : scheduledFirst ? 'scheduled' : null
      if (stage === 'dropped' && airDate && airDate < keepFrom) continue
      const ep: TrackerEpisode = {
        channel: c.slug,
        episodeId: e.episode_id,
        title: e.working_title,
        status: e.status,
        stage,
        airDate,
        airSource,
        postId: post?.id ?? null,
        postStatus: post?.status ?? null,
        cells: c.shown.map((p) => cellFor(stage, p, post, (post?.expected ?? c.expected).includes(p))),
        flags: [],
      }
      episodes.push(ep)
      if (!active || stage === 'dropped') continue

      const late = !!airDate && airSource === 'planned' && airDate <= today
      if (stage === 'muse-passed') {
        flag(
          {
            key: `mp:${c.slug}/${e.episode_id}`,
            kind: 'muse_passed_not_dropped',
            severity: late ? 'bad' : 'warn',
            episodeId: e.episode_id,
            day: airDate ?? undefined,
            detail: `${e.working_title} (${e.episode_id}) passed Muse but is not dropped in ELO yet${airDate ? `, air ${dayLabel(airDate)}` : ''}.`,
          },
          ep,
        )
        if (late)
          flag(
            {
              key: `mpnp:${c.slug}/${e.episode_id}`,
              kind: 'muse_passed_no_post',
              severity: 'bad',
              episodeId: e.episode_id,
              day: airDate ?? undefined,
              detail: `${e.working_title} (${e.episode_id}) passed Muse and has no post, and its air date ${dayLabel(airDate as string)} is ${airDate === today ? 'today' : 'past'}.`,
            },
            ep,
          )
        if (!airDate)
          flag(
            {
              key: `nad:${c.slug}/${e.episode_id}`,
              kind: 'no_air_date',
              severity: 'warn',
              episodeId: e.episode_id,
              detail: `${e.working_title} (${e.episode_id}) has no air date, so ELO cannot tell when it is late. Set air_date on its Upcoming entry.`,
            },
            ep,
          )
      } else if (late) {
        flag(
          {
            key: `late:${c.slug}/${e.episode_id}`,
            kind: 'late_unfinished',
            severity: 'bad',
            episodeId: e.episode_id,
            day: airDate ?? undefined,
            detail: `${e.working_title} (${e.episode_id}) was planned for ${dayLabel(airDate as string)} and is still at ${STAGE_LABEL[stage].toLowerCase()}.`,
          },
          ep,
        )
      }
    }

    // A slot with no finished episode. One flag per channel and day, naming the platforms with an empty slot.
    if (active) {
      const open = i.openSlots.filter(
        (s) => s.brandId === c.brandId && (s.platform === '*' || c.expected.includes(s.platform)),
      )
      const byDay = new Map<string, TrackerSlotIn[]>()
      for (const s of open) {
        const d = etDay(s.whenUtc)
        if (d > horizon) continue
        byDay.set(d, [...(byDay.get(d) ?? []), s])
      }
      // Finished episodes that have no air date can each cover the earliest uncovered day.
      let undated = mine.filter(
        (e) => stageOf(e.status) === 'muse-passed' && !e.air_date && !postOf(e.episode_id),
      ).length
      for (const [day, list] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
        const planned = mine.filter((e) => e.air_date === day && stageOf(e.status) !== 'dropped')
        if (planned.some((e) => stageOf(e.status) === 'muse-passed')) continue
        if (!planned.length && undated > 0) {
          undated -= 1
          continue
        }
        const times = list
          .sort((a, b) => a.whenUtc.localeCompare(b.whenUtc))
          .map((s) => `${s.platform === '*' ? 'channel' : pname(s.platform)} ${timeLabel(s.whenUtc)}`)
        const next = planned[0]
        const plan = next
          ? `${next.working_title} (${next.episode_id}) is planned for that day and is at ${STAGE_LABEL[stageOf(next.status)].toLowerCase()}.`
          : 'Nothing is planned for that day.'
        flag({
          key: `slot:${c.slug}/${day}`,
          kind: 'slot_no_episode',
          severity: day <= today ? 'bad' : 'warn',
          day,
          platforms: [...new Set(list.map((s) => s.platform))],
          detail: `${c.name} ${dayLabel(day)}: no finished episode for ${times.join(', ')}. ${plan}${c.waiting ? ` ${c.waiting} video${c.waiting === 1 ? ' is' : 's are'} waiting in the Inbox.` : ''}`,
        })
      }

      // Dropped for some platforms and not others. Looks at every recent or upcoming episode post, with or without an entry.
      for (const p of posts) {
        if (!p.episodeRef || p.status === 'canceled') continue
        if (p.status !== 'draft' && p.scheduledAtUtc && p.scheduledAtUtc < partialFrom) continue
        const have = new Set(p.targets.filter((t) => isLive(t.status)).map((t) => t.platform))
        const missing = (p.expected ?? c.expected).filter((x) => !have.has(x))
        if (!missing.length || !have.size) continue
        const ep = episodes.find((e) => e.episodeId === p.episodeRef)
        flag(
          {
            key: `partial:${p.id}`,
            kind: 'partial_drop',
            severity: 'warn',
            episodeId: p.episodeRef,
            platforms: missing,
            detail: `${p.episodeRef} is dropped for ${[...have].map(pname).join(', ')} but not for ${missing.map(pname).join(', ')}.`,
          },
          ep,
        )
      }
    }

    episodes.sort(
      (a, b) =>
        (a.airDate ?? '9999').localeCompare(b.airDate ?? '9999') ||
        a.episodeId.localeCompare(b.episodeId),
    )
    channels.push({
      brandId: c.brandId,
      slug: c.slug,
      name: c.name,
      color: c.color,
      state: c.state,
      platforms: c.shown,
      counts,
      episodes,
    })
  }

  const rank = { bad: 0, warn: 1 } as const
  flags.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      (a.day ?? '9999').localeCompare(b.day ?? '9999') ||
      a.channelName.localeCompare(b.channelName),
  )
  return {
    generatedAt: new Date(i.nowMs).toISOString(),
    today,
    flagDays: i.flagDays,
    channels,
    flags,
  }
}
