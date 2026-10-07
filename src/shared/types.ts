import type { Platform, ValidationWarning, VideoMeta } from './platformLimits'

export type { Platform, ValidationWarning, VideoMeta }

export type SchedulingMode = 'slots' | 'manual' | 'both'
export type MissedBehavior = 'post_if_recent' | 'hold'
export type ThemeChoice = 'dark' | 'light' | 'system'

export interface Settings {
  mediaRoot: string
  schedulingMode: SchedulingMode
  handoffHoursYoutube: number
  handoffHoursFacebook: number
  missedBehavior: MissedBehavior
  missedGraceMinutes: number
  launchAtLogin: boolean
  schedulerPaused: boolean
  theme: ThemeChoice
  dryRunFailPlatform: Platform | null
  dryRunFailKind: 'transient' | 'permanent'
  fastBackoff: boolean
  /** Also ask TikTok for the video.publish permission (needs Direct Post turned on in the developer portal). */
  tiktokRequestPublishScope: boolean
}

export interface Brand {
  id: number
  name: string
  color: string
  archived: boolean
}

export interface BrandSlot {
  id: number
  brandId: number
  dayType: 'weekday' | 'weekend'
  timeLocal: string
  enabled: boolean
}

export interface HashtagSet {
  id: number
  brandId: number | null
  name: string
  tagsText: string
}

export interface BrandDefaults {
  brandId: number
  captionTemplate: string
  defaultHashtagSetId: number | null
  youtubeCategoryId: string
  youtubeMadeForKids: boolean
  youtubePlaylistId: string | null
  youtubeAppendShorts: boolean
  instagramShareToFeed: boolean
  aiFlag: Record<Platform, boolean>
  tiktokPrivacyDefault: string | null
  tiktokAllowComments: boolean
  tiktokAllowDuet: boolean
  tiktokAllowStitch: boolean
}

export type TikTokAccountMode = TikTokMode
export type YoutubeMode = 'manual_assist' | 'test_private' | 'auto'

export interface Account {
  id: number
  brandId: number
  platform: Platform
  displayName: string | null
  avatarUrl: string | null
  externalId: string | null
  status: 'connected' | 'needs_reauth' | 'error'
  /** `dry_run`, or for YouTube one of manual_assist, test_private, auto. */
  mode: string
  lastCheckedAt: string | null
}

export interface GoogleCredentialsStatus {
  hasClientId: boolean
  hasClientSecret: boolean
  clientIdMasked: string
  clientSecretMasked: string
}

export interface QuotaBucket {
  used: number
  limit: number
}

export interface QuotaStatus {
  dayPt: string
  uploads: QuotaBucket
  other: QuotaBucket
  warn: boolean
}

export interface YoutubeChannel {
  id: string
  title: string
  avatarUrl: string | null
}

export type ConnectResult =
  | { status: 'connected'; account: Account }
  | { status: 'pick'; sessionId: string; channels: YoutubeChannel[] }

export interface YoutubeOption {
  id: string
  title: string
}

export type PostStatus =
  'draft' | 'scheduled' | 'in_progress' | 'partial' | 'posted' | 'failed' | 'missed' | 'canceled'

export type TargetStatus =
  | 'pending'
  | 'handed_off'
  | 'uploading'
  | 'processing'
  | 'posted'
  | 'needs_action'
  | 'failed'
  | 'skipped'

export interface PostTarget {
  id: number
  postId: number
  platform: Platform
  accountId: number | null
  captionOverride: string | null
  aiFlag: boolean
  status: TargetStatus
  externalId: string | null
  externalUrl: string | null
  attempts: number
  nextAttemptAtUtc: string | null
  lastError: string | null
  handedOffAtUtc: string | null
  postedAtUtc: string | null
  /** Upload progress from 0 to 1 while a video is going up. */
  progress: number | null
  /** A to-do the owner must finish by hand, for example adding an AI label in the app. */
  checklist: string | null
  settings: TargetSettings
}

export interface Post {
  id: number
  brandId: number
  brandName: string
  brandColor: string
  /** Path relative to the Media Root. */
  videoPath: string
  fileName: string
  videoMeta: Partial<VideoMeta>
  posterUrl: string | null
  title: string
  caption: string
  scheduledAtUtc: string | null
  status: PostStatus
  createdAt: string
  updatedAt: string
  targets: PostTarget[]
}

export type TikTokMode = 'drafts' | 'direct'

/** What the TikTok posting screen collects for a Direct Post. Nothing is pre-selected. */
export interface TikTokPostSettings {
  privacy: string | null
  allowComment: boolean
  allowDuet: boolean
  allowStitch: boolean
  commercialOn: boolean
  yourBrand: boolean
  brandedContent: boolean
  /** The owner ticked the consent line. Required before a Direct Post is scheduled. */
  consent: boolean
}

export interface TikTokCreatorInfo {
  nickname: string
  username: string
  avatarUrl: string | null
  privacyOptions: string[]
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
  maxDurationSec: number
}

export interface TikTokCredentialsStatus {
  hasClientKey: boolean
  hasClientSecret: boolean
  clientKeyMasked: string
  clientSecretMasked: string
  redirectUri: string
  requestPublishScope: boolean
}

/** Optional per-target settings. */
export interface TargetSettings {
  /** Instagram cover frame, in milliseconds from the start. */
  thumbOffsetMs?: number
  /** TikTok Direct Post choices. */
  tiktok?: TikTokPostSettings
}

export interface PostTargetInput {
  platform: Platform
  captionOverride?: string | null
  aiFlag: boolean
  settings?: TargetSettings
}

export interface PostInput {
  brandId: number
  /** Absolute path of the original video. The app copies it into the brand Queue. */
  sourcePath: string
  title: string
  caption: string
  scheduledAtUtc: string | null
  targets: PostTargetInput[]
  status: 'draft' | 'scheduled'
}

export interface PostUpdate {
  title?: string
  caption?: string
  scheduledAtUtc?: string | null
  targets?: PostTargetInput[]
  status?: 'draft' | 'scheduled'
}

export interface PostFilter {
  brandId?: number | null
  status?: PostStatus | 'all' | 'upcoming' | 'recent'
  platform?: Platform | null
  fromUtc?: string
  toUtc?: string
}

export interface MediaInspection {
  sourcePath: string
  fileName: string
  meta: VideoMeta
  posterUrl: string | null
  warnings: ValidationWarning[]
}

export interface LogEntry {
  id: number
  tsUtc: string
  level: 'info' | 'warn' | 'error'
  postId: number | null
  platform: Platform | null
  message: string
  detail: unknown
}

export interface LogFilter {
  level?: 'info' | 'warn' | 'error' | 'all'
  platform?: Platform | null
  postId?: number | null
  limit?: number
}

export interface SchedulerStatus {
  paused: boolean
  running: boolean
  nextPost: { postId: number; brandName: string; title: string; whenUtc: string } | null
  pendingCount: number
}

export interface AppInfo {
  version: string
  dataDir: string
  dbPath: string
  mediaRoot: string
  encryptionAvailable: boolean
}

export interface SecretStatus {
  key: string
  has: boolean
  masked: string
}

export interface AppEvent {
  type: 'changed' | 'toast'
  scope?: 'posts' | 'brands' | 'settings' | 'log'
  toast?: { kind: 'success' | 'error' | 'info'; headline: string; detail?: string }
}

export interface MetaCredentialsStatus {
  hasAppId: boolean
  hasAppSecret: boolean
  appIdMasked: string
  appSecretMasked: string
}

export interface MetaPage {
  pageId: string
  name: string
  pictureUrl: string | null
  igId: string | null
  igUsername: string | null
  igPictureUrl: string | null
  /** Brand that currently uses this Page, if any. */
  facebookBrandId: number | null
  /** Brand that currently uses the Instagram account, if any. */
  instagramBrandId: number | null
}

export interface MetaSuggestion {
  brandId: number
  pageId: string | null
  igId: string | null
}

export interface MetaStatus {
  connected: boolean
  userName: string | null
  status: 'connected' | 'needs_reauth' | null
  /** When the earliest relevant token stops working. Null means Meta did not give a date. */
  expiresAt: string | null
  daysLeft: number | null
  /** True when 7 days or fewer remain, or it already expired. */
  expiringSoon: boolean
  missingPermissions: string[]
  pages: MetaPage[]
  suggestions: MetaSuggestion[]
}
