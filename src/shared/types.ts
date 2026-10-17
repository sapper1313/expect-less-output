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
  // Alerts (failures only)
  alertIMessageEnabled: boolean
  alertIMessageNumber: string
  alertEmailEnabled: boolean
  alertEmailFrom: string
  alertEmailTo: string
  alertQuietEnabled: boolean
  /** HH:MM Eastern. Alerts by iMessage and email wait until quiet hours end. */
  alertQuietStart: string
  alertQuietEnd: string
  /** Brands whose scheduled posts are held. */
  pausedBrandIds: number[]
  // Agents (local API, watched folders, MCP)
  agentApiEnabled: boolean
  agentApiPort: number
  /** Off means agents can only create drafts. */
  agentMaySchedule: boolean
  /** Off means agents can read Studio spend and flagged episodes but cannot change anything there. */
  agentMayChangeStudio: boolean
  /** Brands with a watched Inbox folder. */
  inboxBrandIds: number[]
  /** Brands whose Inbox videos go to the next open slot instead of waiting as drafts. Needs agentMaySchedule. */
  inboxAutoScheduleBrandIds: number[]
  // Text assist (local AI)
  llmProvider: 'none' | 'openai-compatible' | 'studio-local'
  llmBaseUrl: string
  llmModel: string
  /** Allow a model on another computer on the local network. */
  llmAllowLan: boolean
  /** Also ask TikTok for the video.list permission, so stats can be read. */
  tiktokRequestStatsScope: boolean
  // Pipeline (bots write and render, ELO takes drops, schedules and posts)
  /** Master switch for every call to the Claude API. Off means writing comes from bots. */
  claudeApiEnabled: boolean
  /** Off stops the Director's production planning, Show Writer, Producer and idea refill. */
  studioProductionEnabled: boolean
  /** Off means the Inbox watcher leaves files untouched. */
  pipelineIntakeEnabled: boolean
  /** Reject sidecars with any problem. Off means small problems are noted and the drop still goes through. */
  pipelineStrict: boolean
  /** A sidecar must carry the approval block. */
  pipelineRequireApproval: boolean
  /** Reject a drop whose checksum or channel plus episode is already known. */
  pipelineDuplicateDetection: boolean
  /** Names a sidecar's source_bot may have. */
  pipelineSourceBots: string[]
  /** Which events send a notification: accepted, rejected, scheduled, posted, failed, reconcile, summary. */
  pipelineNotifyKinds: string[]
  /** Minutes between posting tries after a failure. */
  retryMinutes: number[]
  /** Dates (YYYY-MM-DD, Eastern) no channel posts on. */
  blackoutDates: string[]
  /** Smallest gap in minutes between two posts anywhere. 0 is off. */
  minGapMinutes: number
  /** Let the reconcile check fix the clear cases itself. It never deletes. */
  reconcileAutoFix: boolean
  /** Days of queue a channel needs before the low queue alert fires. */
  lowQueueDays: number
  /** Nothing goes to any platform. Posts are marked done in the app only. */
  globalDryRun: boolean
  // Upcoming episodes
  upcomingEnabled: boolean
  /** Off means the file is read by polling only. */
  upcomingLiveWatch: boolean
  upcomingPollSeconds: number
  /** Blank means <Media Root>/Shared/upcoming.json. */
  upcomingFilePath: string
}

export interface Brand {
  id: number
  name: string
  color: string
  archived: boolean
  /** Short stable name bots use, like clock-out-early. */
  slug: string | null
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
  /** The episode id a bot gave this post (pipeline posts). Unique per channel. */
  episodeRef: string | null
  /** inbox for anything that arrived through the Inbox folder, manual otherwise. */
  origin: 'manual' | 'inbox' | 'api'
  /** Why the post is held back from posting. Null means not held. */
  holdReason: string | null
  checksum: string | null
  sourceBot: string | null
  sidecarTitle: string | null
  videoBasename: string | null
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
  requestStatsScope: boolean
}

/** Optional per-target settings. */
export interface TargetSettings {
  /** Instagram cover frame, in milliseconds from the start. */
  thumbOffsetMs?: number
  /** YouTube long form: a custom thumbnail file (1280x720). Never set for Shorts, which cannot take one through the API. */
  thumbnailPath?: string
  /** TikTok cover frame in milliseconds (Direct Post only). */
  coverTimestampMs?: number
  /** Instagram custom cover, a public https address (used instead of the frame). */
  coverUrl?: string
  /** Made from a mock mode placeholder video. The scheduler uses the dry run adapter, so nothing real is ever posted. */
  mock?: boolean
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
  /** Move the source file into the Queue instead of copying it (used by the watched folder). */
  moveSource?: boolean
  brandId: number
  /** Absolute path of the original video. The app copies it into the brand Queue. */
  sourcePath: string
  title: string
  caption: string
  scheduledAtUtc: string | null
  targets: PostTargetInput[]
  status: 'draft' | 'scheduled'
  /** Set for posts that arrive through the Inbox. */
  origin?: 'manual' | 'inbox' | 'api'
  pipeline?: {
    episodeRef: string
    checksum: string
    sidecarTitle: string
    sourceBot: string
    videoBasename: string
    holdReason?: string | null
  }
}

export interface PostUpdate {
  title?: string
  caption?: string
  scheduledAtUtc?: string | null
  targets?: PostTargetInput[]
  status?: 'draft' | 'scheduled'
}

export interface PostFilter {
  /** Matches title, caption or file name. */
  search?: string
  brandId?: number | null
  status?: PostStatus | 'all' | 'upcoming' | 'recent'
  platform?: Platform | null
  fromUtc?: string
  toUtc?: string
  origin?: 'manual' | 'inbox' | 'api'
  /** true: only held posts. false: leave held posts out. */
  held?: boolean
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
  /** Only entries after this UTC time. */
  sinceUtc?: string
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

export type AlertChannel = 'imessage' | 'email' | 'notification'

export interface AlertTestResult {
  ok: boolean
  message: string
}

export interface AlertStatus {
  emailPasswordSet: boolean
  emailPasswordMasked: string
}

export interface HealthRow {
  accountId: number
  brandId: number
  brandName: string
  platform: Platform
  displayName: string | null
  status: 'connected' | 'needs_reauth' | 'error'
  mode: string
  lastCheckedAt: string | null
  /** When the login stops working. Null means it renews itself or no date is known. */
  expiresAt: string | null
  note: string
}

export interface RestoreReport {
  restoredAt: string
  accountsToReconnect: Array<{ brandName: string; platform: Platform; displayName: string | null }>
}

export interface RestorePreview {
  zipPath: string
  appVersion: string
  createdAt: string
  oldMediaRoot: string
  folderCount: number
  accountsToReconnect: Array<{ brandName: string; platform: string; displayName: string | null }>
}

export interface AgentStatus {
  enabled: boolean
  running: boolean
  port: number
  tokenSet: boolean
  tokenMasked: string
  /** True when agents may only create drafts. */
  draftsOnly: boolean
  /** Filled when the server could not start (for example the port is busy). */
  error: string | null
}

export interface McpConfig {
  nodePath: string
  scriptPath: string
  scriptExists: boolean
  apiUrl: string
  desktopConfigPath: string
  /** JSON to merge into claude_desktop_config.json. The token is a placeholder. */
  desktopJson: string
  claudeCodeCommand: string
}

export interface TextAssistStatus {
  provider: 'none' | 'openai-compatible' | 'studio-local'
  available: boolean
  model: string
  baseUrl: string
}

// ---------- stats ----------

export interface StatsNumbers {
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
}

export interface TargetStats {
  targetId: number
  platform: Platform
  /** ok: numbers exist. unavailable: cannot be read, see reason. pending: nothing fetched yet. */
  state: 'ok' | 'unavailable' | 'pending'
  reason: string | null
  latest: (StatsNumbers & { fetchedAt: string; approximate: string[] }) | null
  history: Array<StatsNumbers & { t: string }>
}

export interface PostStats {
  postId: number
  targets: TargetStats[]
  totals: StatsNumbers
}

export type StatsRange = '7d' | '30d' | 'all'

export interface BrandStats {
  brandId: number | null
  range: StatsRange
  posts: number
  platforms: Array<
    StatsNumbers & {
      platform: Platform
      videos: number
      unavailable: number
      reason: string | null
    }
  >
  totals: StatsNumbers
}

/** A video that was on a channel before the app posted anything. */
export interface ImportedVideo {
  id: number
  brandId: number
  brandName: string
  platform: Platform
  title: string
  url: string | null
  thumbnailUrl: string | null
  publishedAt: string | null
  state: 'ok' | 'unavailable' | 'pending'
  reason: string | null
  fetchedAt: string | null
  numbers: StatsNumbers
  approximate: string[]
}

export interface ImportResult {
  found: number
  added: number
  problems: Array<{ brand: string; platform: Platform; message: string }>
}

export interface BestTimeHour {
  hour: number
  count: number
  mean: number
  median: number
}
export interface BestTimes {
  minAgeDays: number
  videos: number
  used: number
  relative: boolean
  enough: boolean
  hours: BestTimeHour[]
  cells: Array<BestTimeHour & { weekday: number }>
  top: BestTimeHour[]
}
export interface SlotSuggestion {
  timeLocal: string
  count: number
  lift: number
}
export interface RecommendedSlots {
  videos: number
  enough: boolean
  weekday: SlotSuggestion[]
  weekend: SlotSuggestion[]
}
