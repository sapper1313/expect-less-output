import type { Platform } from './types'

export type HealthState = 'ok' | 'warn' | 'bad' | 'none'

export interface HomeConnection {
  platform: Platform | 'bluesky'
  label: string
  state: HealthState
  note: string
}

export interface HomeLatest {
  /** The post this came from, or null for a video that was on the channel before the app. */
  postId: number | null
  /** True for a video found on the channel (not posted through the app). */
  existing?: boolean
  title: string
  platforms: string[]
  postedAtUtc: string | null
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
}

export interface HomeChannel {
  brandId: number
  name: string
  color: string
  paused: boolean
  runwayDays: number
  nextDue: string | null
  pipeline: { writing: number; ready: number; making: number; scheduled: number; flagged: number }
  connections: HomeConnection[]
  latest: HomeLatest | null
}

export interface HomePost {
  postId: number
  brandId: number
  brandName: string
  color: string
  title: string
  whenUtc: string | null
  platforms: string[]
  status: string
}

export interface HomeStage {
  key: 'writing' | 'ready' | 'making' | 'scheduled' | 'posted' | 'flagged'
  label: string
  count: number
}

export interface HomeSummary {
  generatedUtc: string
  stages: HomeStage[]
  channels: HomeChannel[]
  upcoming: HomePost[]
  recent: HomePost[]
  spend: {
    month: string
    total: number
    projected: number
    capLabel: string
    capValue: number | null
    percent: number | null
    mock: boolean
  }
  /** Red dot counts for the left menu. */
  badges: { studio: number; queue: number; channels: number }
  /** Plain lines about what needs the owner. */
  needsYou: string[]
  /** First run checklist: what is left to set up. */
  setup: SetupStep[]
}

export interface SetupStep {
  key: 'connect' | 'slots' | 'import' | 'alerts' | 'firstPost'
  label: string
  detail: string
  done: boolean
  go: { screen: string; channelsTab?: string; settingsTab?: string; statsTab?: string }
}

export const EPISODE_STAGE: Record<string, HomeStage['key']> = {
  Idea: 'writing',
  Written: 'writing',
  Checking: 'writing',
  'Ready for production': 'ready',
  'In production': 'making',
  'Awaiting video': 'making',
  'Video received': 'making',
  'Checking video': 'making',
  Scheduled: 'scheduled',
  Posted: 'posted',
  Flagged: 'flagged',
}
