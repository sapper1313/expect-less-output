// Shared studio types. No imports from main or renderer so tests and the UI can both use this.

export type StudioPlatform = 'youtube' | 'facebook' | 'instagram' | 'tiktok' | 'bluesky'
export const STUDIO_PLATFORMS: StudioPlatform[] = [
  'youtube',
  'facebook',
  'instagram',
  'tiktok',
  'bluesky',
]

export type BrandFormat = 'short' | 'long'
export type ModelTier = 'lite' | 'standard'
export type Resolution = '480p' | '720p' | '1080p'
export type CadenceMode = 'every_n' | 'weekly'
export type CommentsMode = 'auto' | 'draft' | 'off'

/** A dollar cap. `none` switches enforcement off for that cap. */
export interface Cap {
  value: number
  none: boolean
}

export interface WeeklyWindow {
  /** ISO weekdays, 1 = Monday to 7 = Sunday, on which production may run. */
  days: number[]
  /** The posting weekday (ISO) this window produces for. */
  forPostDay: number
}

export interface StudioBrandConfig {
  format: BrandFormat
  resolution: Resolution
  cadenceMode: CadenceMode
  /** Mode A: every N days. */
  everyN: number
  /** Mode A: the date (Eastern, yyyy-MM-dd) of the first or current anchor post. */
  startDate: string
  paused: boolean
  /** Mode B. */
  postDays: number[]
  /** Short clips have their own days, time and platforms. They never use or move the episode schedule. */
  clipPostDays: number[]
  /** HH:MM Eastern. */
  clipTime: string
  clipPlatforms: Record<StudioPlatform, boolean>
  windows: WeeklyWindow[]
  /** HH:MM Eastern. */
  runTime: string
  platforms: Record<StudioPlatform, boolean>
  aiDisclosure: boolean
  madeForKids: boolean
  runwayDays: number
  monthlyCap: Cap
  perEpisodeCap: Cap
  /** Uses the shared opening and outro when ELO or ingest assembles the video. */
  addOpeningOutroOnIngest: boolean
  useOpeningOutro: boolean
  commentsMode: CommentsMode
  holidayTieIns: boolean
  /** Hollow only. When true the Producer builds the video through the API itself. */
  hollowViaApi: boolean
  /** Which production path this brand uses. */
  path: 'auto' | 'package'
  /** Run the Math Checker on every script. */
  mathCheck: boolean
  /** Check numbered steps for consistency and menus likely to be outdated. */
  stepsCheck: boolean
  /** Captions: a sidecar .srt file (default), burned into the picture, or none. */
  captionMode: 'sidecar' | 'burn' | 'off'
  /** Shorts: show the winning thumbnail for the first moments so the frame YouTube picks is strong. */
  openingFrame: boolean
  /** Most comment replies per day. */
  commentLimit: number
}

export interface Prices {
  /** dollars per generated second, by tier and resolution */
  video: Record<ModelTier, Record<Resolution, number>>
  /** dollars per generated image */
  image: number
  referenceImage: number
  /** Anthropic dollars per million tokens. Edit to match the current price list. */
  anthropicInPerM: number
  anthropicOutPerM: number
  /** Dollars per million tokens for each Claude model. A model missing here uses the two numbers above. Local (ollama:) models are free. */
  anthropicModels: Record<string, { inPerM: number; outPerM: number }>
}

export interface LocalAiConfig {
  ollamaHost: string
  visionModel: string
  embedModel: string
  textModel: string
  /** 'mac' runs Whisper on this Mac, 'remote' uses whisperHost. */
  whisperMode: 'mac' | 'remote'
  whisperHost: string
  whisperCommand: string
  concurrency: number
  useClaudeVision: boolean
  /** measured seconds from the last self test */
  measured: { vision?: number; embed?: number; whisper?: number }
  ramGb: number | null
  hasGpu: boolean | null
}

export interface StudioConfig {
  mockMode: boolean
  paused: boolean
  globalCap: Cap
  aiTextCap: Cap
  perEpisodeCapDefault: Cap
  /** one model per format */
  formatModel: Record<BrandFormat, ModelTier>
  formatResolution: Record<BrandFormat, Resolution>
  modelIds: { lite: string; standard: string; image: string }
  prices: Prices
  retakeMultiplier: number
  retentionDays: number
  directorTickMinutes: number
  paidConcurrency: number
  retryCap: number
  backoffBaseSeconds: number
  roboticPhrases: string[]
  agentModels: Record<string, string>
  /** Language codes to make captions in, for example es and fr. */
  captionLanguages: string[]
  /** Add chapters to the YouTube description of long videos when they are published. */
  autoChapters: boolean
  /** A posted video is a re-post candidate after this many days. */
  repostAfterDays: number
  defaultAgentModel: string
  libraryDir: string
  repetitionThreshold: number
  characterSimilarityThreshold: number
  qcMode: 'off' | 'auto'
  /** Agents the owner switched off. Their tasks wait until they are switched back on. */
  disabledAgents: string[]
  digestEnabled: boolean
  watchdog: { enabled: boolean; runStart: string; runEnd: string; thresholdMinutes: number }
  /** Editable per platform limits. Missing keys use the built in table. */
  platformCaps: Record<string, unknown>
  /** Temporary public host for files a platform must fetch (an Instagram cover picture). */
  publicHost: { endpoint: string; bucket: string; publicBase: string; region: string }
  thumbnailEngine: {
    generateImages: boolean
    candidates: number
    abDelayHours: number
    abMinImpressions: number
    font: string
  }
  qcClipRetryCap: number
  digestTime: string
  backupDir: string
  backupKeep: number
  local: LocalAiConfig
}

export type EpisodeStatus =
  | 'Idea'
  | 'Written'
  | 'Checking'
  | 'Ready for production'
  | 'In production'
  | 'Awaiting video'
  | 'Video received'
  | 'Checking video'
  | 'Scheduled'
  | 'Posted'
  | 'Flagged'
  | 'Failed'
  | 'Archived'

export const EPISODE_STATUSES: EpisodeStatus[] = [
  'Idea',
  'Written',
  'Checking',
  'Ready for production',
  'In production',
  'Awaiting video',
  'Video received',
  'Checking video',
  'Scheduled',
  'Posted',
  'Flagged',
  'Failed',
  'Archived',
]

export interface CountedObject {
  name: string
  quantity: number
  scenes: number[]
}

export interface DialogueLine {
  speaker: string
  line: string
}

export interface Scene {
  n: number
  content_seconds: number
  generate_seconds: number
  setting: string
  characters: string[]
  action: string
  dialogue: DialogueLine[]
  objects_in_frame: string[]
  camera: string
  transition_in: string
  transition_out: string
  grok_prompt: string
  extension_note: string
}

export interface StatusEvent {
  at: string
  status: EpisodeStatus
  note?: string
}

/** The versioned episode package stored as .json.gz. Hollow uses every field; shorts use a subset. */
export interface EpisodePackage {
  schema_version: 1
  id: string
  brand: string
  brand_id: number
  series: string
  episode_number: number
  title: string
  logline: string
  life_lesson?: string
  math_lesson?: string
  runtime_target_seconds: number
  counted_objects: CountedObject[]
  opening_ref?: string
  outro_ref?: string
  script?: string
  scenes: Scene[]
  youtube: {
    title: string
    description: string
    tags: string[]
    made_for_kids: boolean
    ai_disclosure: boolean
  }
  thumbnail_brief?: string
  qc_report?: unknown
  safety_report?: unknown
  math_report?: unknown
  tags: string[]
  summary: string
  status_history: StatusEvent[]
  spend_note?: string
  extra?: Record<string, unknown>
}

export interface EpisodeRow {
  id: string
  brandId: number
  series: string
  number: number
  title: string
  summary: string
  status: EpisodeStatus
  tags: string
  origin: string
  slotDate: string | null
  scheduledAtUtc: string | null
  postedAtUtc: string | null
  postId: number | null
  packagePath: string | null
  previewPath: string | null
  videoPath: string | null
  thumbPath: string | null
  mediaPurgedAt: string | null
  flaggedReason: string | null
  createdUtc: string
  updatedUtc: string
}

export type TaskStatus =
  'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'flagged'

export interface AgentTask {
  id: number
  type: string
  brandId: number | null
  episodeId: string | null
  parentId: number | null
  status: TaskStatus
  attempts: number
  payload: Record<string, unknown>
  result: unknown
  error: string | null
  notBeforeUtc: string | null
  createdUtc: string
  startedUtc: string | null
  finishedUtc: string | null
}

export interface AuditEntry {
  id: number
  tsUtc: string
  brandId: number | null
  agent: string
  action: string
  taskId: number | null
  episodeId: string | null
  detail: unknown
}

export interface LedgerRow {
  id: number
  tsUtc: string
  brandId: number | null
  episodeId: string | null
  taskId: number | null
  vendor: 'xai' | 'anthropic'
  model: string
  resolution: string | null
  units: number
  unitKind: 'seconds' | 'images' | 'tokens'
  unitPrice: number
  dollars: number
  requestId: string | null
  outcome: string
  purpose: string
  mock: boolean
}

export interface CapUsage {
  key: string
  label: string
  cap: Cap
  spent: number
  /** null when the cap is switched off */
  remaining: number | null
}

export interface SpendSummary {
  month: string
  byBrand: Array<{ brandId: number | null; brandName: string; dollars: number }>
  byVendor: Array<{ vendor: string; dollars: number }>
  total: number
  mockTotal: number
  caps: CapUsage[]
}

export type CalendarKind =
  | 'posted'
  | 'scheduled'
  | 'in_production'
  | 'awaiting_video'
  | 'flagged'
  | 'failed'
  | 'planned'
  | 'production_window'

export interface CalendarItem {
  id: string
  kind: CalendarKind
  brandId: number
  brandName: string
  brandColor: string
  title: string
  startUtc: string
  /** All day items (planned slots, production windows) have a date and no time. */
  allDay: boolean
  date: string
  platforms: string[]
  episodeId: string | null
  postId: number | null
}
