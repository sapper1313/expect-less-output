export type PostType = 'episode' | 'clip'
export type BrandState = 'active' | 'paused' | 'on-hold' | 'archived'
export type SlotState = 'filled' | 'open' | 'attention'

export interface Brand {
  id: number
  name: string
  state: BrandState
  /** ELO weekdays, 1 Monday to 7 Sunday. null means every day. */
  postDays: number[] | null
  /** Posts allowed per Eastern day. 0 means no limit. */
  dailyCap: number
  /** 'HH:MM' Eastern times. */
  episodeTimes: { weekday: string[]; weekend: string[] }
  /** Shorts and Long form: the days each posts on (null means every day) and its own times. Empty when not known. */
  kinds?: { kind: 'short' | 'long'; days: number[] | null; times: { weekday: string[]; weekend: string[] } }[]
  clipDays: number[]
  clipTime: string | null
  /** 'YYYY-MM-DD' Eastern dates. */
  blackoutDates: string[]
}

export interface Post {
  id: number
  brandId: number
  type: PostType
  status: string
  scheduledAtUtc: string
  postedAtUtc: string | null
  title: string
}

export interface Slot {
  brandId: number
  type: PostType
  /** ISO UTC at minute precision, e.g. 2026-10-31T14:00:00.000Z */
  instant: string
  /** 'YYYY-MM-DD' in the display time zone. */
  date: string
  weekday: number
  /** e.g. '10:00 AM' */
  timeET: string
}

export interface SnapshotSlot {
  type: PostType
  state: SlotState
}

export interface SnapshotChannel {
  id: number
  name: string
  state: BrandState
  color: string
  filled: number
  total: number
  percent: number
  views7d: number | null
  viewsDeltaPct: number | null
  days: { date: string; slots: SnapshotSlot[] }[]
}

export interface BestVideo {
  title: string
  channel: string
  views: number
}

export interface WeekMap {
  week: { start: string; end: string; tz: string; today: string; days: string[] }
  channels: SnapshotChannel[]
}

export interface Snapshot {
  generatedAt: string
  status: {
    elo: 'ok' | 'stale' | 'unauthorized'
    lastGoodAt: string | null
    staleMinutes: number
  }
  week: { start: string; end: string; tz: string; today: string; days: string[] }
  totals: {
    slots: number
    filled: number
    open: number
    attention: number
    percent: number
    empty: boolean
  }
  openSlots: {
    brand: string
    type: PostType
    day: string
    date: string
    timeET: string
  }[]
  attentionSlots: {
    brand: string
    type: PostType
    day: string
    date: string
    timeET: string
    status: string
  }[]
  channels: SnapshotChannel[]
  stats: {
    views: number
    likes: number
    comments: number
    shares: number
    /** YouTube watch hours for videos posted in the last 7 days. null when not read yet. */
    watchHours?: number | null
  } | null
  topVideos: {
    rank: number
    title: string
    channel: string
    views: number
    approximate: boolean
  }[]
  /** Open posting slots today and the next 2 days, for channels that are on. */
  open3d?: number
  /** The best video posted in the last 24 and 48 hours. null when none has numbers. */
  best24h?: BestVideo | null
  best48h?: BestVideo | null
  upNext: { whenET: string; channel: string; type: PostType }[]
  trend: { week: string; percent: number }[]
  checks: {
    slotsAgree: boolean
    /** Per channel, open episode slots that differ from ELO's own next-open list (Eastern labels). */
    diffs: { brand: string; onlyMine: string[]; onlyElo: string[] }[]
  }
  revenue: null
}

/** What the Dashboard screen shows. */
export type DashboardSnapshot = Snapshot
