import type { SeriesBibleData, Skill } from './bible'
import type {
  AgentTask,
  AuditEntry,
  CalendarItem,
  CalendarKind,
  EpisodePackage,
  EpisodeRow,
  EpisodeStatus,
  LedgerRow,
  ModelTier,
  BrandFormat,
  SpendSummary,
  StudioBrandConfig,
  StudioConfig,
} from './types'

import type { DirectorActionView } from '../../main/studio/directorChat'
import type { BrandSocialView } from '../../main/studio/social/accounts'
export type { BrandSocialView }

export type KeyId = 'xai' | 'anthropic' | 'r2id' | 'r2secret'

export interface KeyStatus {
  id: KeyId
  label: string
  has: boolean
  masked: string
  /** Not secret. Bluesky handle. */
  account: string
  state: 'connected' | 'not_set' | 'failed' | 'expiring' | 'untested'
  lastTestAt: string | null
  lastMessage: string
}

export interface TestResult {
  ok: boolean
  message: string
}

export interface PurgeReportView {
  dryRun: boolean
  cutoffUtc: string
  count: number
  bytes: number
  items: Array<{ postId: number; title: string; postedAtUtc: string; files: Array<{ path: string; bytes: number; kind: string }> }>
}

export interface ChecklistView {
  id: string
  label: string
  ok: boolean
  detail: string
  fix: string[]
}

export interface EpisodeDetail {
  row: EpisodeRow
  pkg: EpisodePackage | null
  spend: { dollars: number; rows: LedgerRow[] }
  videoUrl: string | null
}

export interface BrandStudioRow {
  brandId: number
  name: string
  color: string
  config: StudioBrandConfig
  nextDue: string | null
  runwayCovered: number
}

export interface StudioOverview {
  mockMode: boolean
  paused: boolean
  openFlags: number
  queued: number
  running: number
  brands: BrandStudioRow[]
  libraryEpisodes: number
  libraryBytes: number
}

export interface IdeaView {
  id: number
  text: string
  used: boolean
}

export interface HolidayView {
  id: number
  date: string
  name: string
  kind: string
  enabled: boolean
  custom: boolean
}

export interface AgentInfo {
  name: string
  role: string
  model: string
  isDefault: boolean
  enabled: boolean
  toggleable: boolean
}

export interface CommentView {
  id: number
  brandId: number
  platform: string
  author: string
  text: string
  category: string
  status: string
  replyText: string | null
  reason: string | null
  createdUtc: string
}

export interface BackupView {
  stamp: string
  dbZip: string
  libraryZip: string | null
  bytes: number
  createdUtc: string
}

export interface InsightsView {
  summary: string
  updatedUtc: string | null
  insights: {
    videos: number
    totalViews: number
    topEpisodes: Array<{ id: string; title: string; hook: string; views: number }>
    topics: Array<{ topic: string; videos: number; avgViews: number }>
    lengths: Array<{ bucket: string; videos: number; avgViews: number }>
    postingHours: Array<{ hourEt: number; videos: number; avgViews: number }>
    thumbnailStyles: Array<{ headline: string; ctr: number }>
  } | null
}

export interface AssetView {
  id: number
  kind: string
  path: string
  name: string
  prompt: string | null
}

export interface ClipJobView {
  id: number
  clipN: number
  take: number
  status: string
  purpose: string
  prompt: string
  generateSeconds: number
  requestId: string | null
  filePath: string | null
  error: string | null
  qc: unknown
}

export interface GuidelineView {
  id: number
  createdUtc: string
  text: string
  note: string
  source: string
}

export interface SocialView {
  id: number
  episodeId: string | null
  platform: string
  status: string
  text: string
  title: string
  scheduledAtUtc: string
  attempts: number
  externalUrl: string | null
  error: string | null
  mock: boolean
}

export interface ThumbTestView {
  episodeId: string
  state: string
  note: string | null
  variants: Array<{ variant: string; headline: string; score: number; ctr: number | null; impressions: number | null; winner: boolean; file: string }>
}

export interface StudioApi {
  commentList(filter?: { brandId?: number | null; status?: string }): Promise<CommentView[]>
  runComments(brandId: number): Promise<{ checked: number; replied: number; drafted: number; flagged: number; spam: number; waiting: number }>
  approveComment(id: number, text?: string): Promise<void>
  discardComment(id: number): Promise<void>
  draftComment(id: number, text: string): Promise<void>
  insightsFor(brandId: number): Promise<InsightsView>
  refreshInsights(): Promise<{ fetched: number; social: number; brands: number }>
  digestPreview(): Promise<string>
  sendDigest(): Promise<void>
  watchdogInfo(): Promise<{ installed: boolean; installCommand: string; uninstallCommand: string; heartbeatAgeMinutes: number | null; plist: string }>
  saveWatchdog(w: { enabled: boolean; runStart: string; runEnd: string; thresholdMinutes: number }): Promise<void>
  backupList(): Promise<BackupView[]>
  backupNow(): Promise<BackupView>
  restoreLibrary(libraryZip: string): Promise<number>
  setAgentEnabled(name: string, enabled: boolean): Promise<AgentInfo[]>
  guidelineInfo(): Promise<{ current: GuidelineView; history: GuidelineView[]; proposal: { text: string; changes: string[]; at: string } | null }>
  saveGuidelines(text: string, note: string): Promise<GuidelineView>
  revertGuidelines(id: number): Promise<GuidelineView>
  approveGuidelineProposal(): Promise<GuidelineView | null>
  refreshGuidelines(): Promise<{ applied: boolean; note: string }>
  socialPosts(episodeId?: string): Promise<SocialView[]>
  retrySocial(id: number): Promise<void>
  thumbTests(): Promise<ThumbTestView[]>
  runThumbTests(): Promise<void>
  platformCaps(): Promise<Record<string, unknown>>
  publicHostStatus(): Promise<{ configured: boolean }>
  socialAccountList(): Promise<BrandSocialView[]>
  saveBluesky(brandId: number, handle: string, password: string): Promise<void>
  removeBluesky(brandId: number): Promise<void>
  testBluesky(brandId: number): Promise<TestResult>

  assetList(brandId: number): Promise<AssetView[]>
  addAsset(brandId: number, kind: 'opening' | 'outro' | 'reference_image' | 'voice_reference', path: string): Promise<AssetView[]>
  removeAsset(brandId: number, id: number): Promise<AssetView[]>
  /** Makes the shared opening or outro once from a prompt. It is reused on every episode at no further cost. */
  generateSlot(brandId: number, kind: 'opening' | 'outro', prompt: string): Promise<{ dollars: number; mock: boolean }>
  clipLog(episodeId: string): Promise<ClipJobView[]>
  resolveClip(episodeId: string, clipN: number, action: 'approve' | 'regenerate' | 'edit' | 'discard', prompt?: string): Promise<void>
  produceNow(episodeId: string): Promise<{ taskId: number }>

  bible(brandId: number): Promise<{ bible: SeriesBibleData; skills: Skill[]; markdown: string }>
  setBible(brandId: number, patch: Partial<SeriesBibleData>): Promise<SeriesBibleData>
  importSkill(brandId: number, name: string, text: string): Promise<Skill[]>
  updateSkill(brandId: number, id: number, text: string): Promise<Skill[]>
  removeSkill(brandId: number, id: number): Promise<Skill[]>
  exportBible(brandId: number): Promise<string>
  ideas(brandId: number): Promise<IdeaView[]>
  addIdeas(brandId: number, texts: string[]): Promise<IdeaView[]>
  removeIdea(brandId: number, id: number): Promise<IdeaView[]>
  holidays(fromIso?: string, toIso?: string): Promise<HolidayView[]>
  addHoliday(date: string, name: string, kind?: string): Promise<HolidayView[]>
  setHolidayEnabled(id: number, enabled: boolean): Promise<void>
  removeHoliday(id: number): Promise<void>
  agents(): Promise<AgentInfo[]>
  setAgentModel(name: string, model: string): Promise<AgentInfo[]>
  writeNow(brandId: number, slotDate?: string): Promise<{ taskId: number }>

  overview(): Promise<StudioOverview>
  getConfig(): Promise<StudioConfig>
  setConfig(patch: Partial<StudioConfig>): Promise<StudioConfig>
  setFormatModel(format: BrandFormat, tier: ModelTier, checked: boolean): Promise<StudioConfig>
  setMockMode(on: boolean): Promise<StudioConfig>
  pauseAll(paused: boolean): Promise<void>
  brands(): Promise<BrandStudioRow[]>
  setBrand(brandId: number, patch: Partial<StudioBrandConfig>): Promise<StudioBrandConfig>
  cadenceWhatIf(brandId: number, newEveryN: number): Promise<{ current: number; proposed: number }>
  estimate(brandId: number): Promise<{ firstPass: number; worstCase: number; generatedSeconds: number }>

  keyStatus(): Promise<KeyStatus[]>
  setKey(id: KeyId, value: string, account?: string): Promise<KeyStatus[]>
  removeKey(id: KeyId): Promise<KeyStatus[]>
  testKey(id: KeyId): Promise<TestResult>

  spendSummary(): Promise<SpendSummary>
  spendRecent(limit?: number): Promise<LedgerRow[]>
  spendCsv(): Promise<string>

  episodeList(filter?: { brandId?: number | null; status?: EpisodeStatus | 'all'; search?: string; tag?: string; sort?: 'newest' | 'oldest' | 'title' }): Promise<EpisodeRow[]>
  episode(id: string): Promise<EpisodeDetail>
  setEpisodeStatus(id: string, status: EpisodeStatus, note?: string): Promise<EpisodeRow>
  duplicateEpisode(id: string): Promise<EpisodeRow>
  exportEpisode(id: string): Promise<string>

  calendar(filter: { fromUtc: string; toUtc: string; brandId?: number | null; platform?: string | null; kind?: CalendarKind | null }): Promise<CalendarItem[]>
  backfillPosted(): Promise<number>
  purge(dryRun: boolean): Promise<PurgeReportView>

  directorTick(): Promise<{ created: number; notes: string[] }>
  taskList(filter?: { status?: string; brandId?: number | null }): Promise<AgentTask[]>
  auditLog(filter?: { brandId?: number | null; agent?: string; fromUtc?: string; toUtc?: string }): Promise<AuditEntry[]>
  flagged(): Promise<Array<{ task: AgentTask; episode: EpisodeRow | null }>>
  resolveFlag(taskId: number, action: 'retry' | 'discard' | 'approve'): Promise<void>
  directorChat(message: string): Promise<{ reply: string; actions: DirectorActionView[] }>
  directorApply(action: DirectorActionView): Promise<string>
  dryRunDay(): Promise<string[]>
  cheapTest(): Promise<TestResult & { dollars: number; mock: boolean }>

  localChecklist(): Promise<ChecklistView[]>
  localSelfTest(): Promise<{ vision: TestResult & { seconds: number }; embed: TestResult & { seconds: number }; whisper: TestResult & { seconds: number } }>
  localPull(): Promise<string[]>
  localPullProgress(): Promise<Array<{ model: string; pct: number; status: string }>>
  localRecommend(ramGb: number | null, hasGpu: boolean | null): Promise<{ tier: string; vision: Array<{ name: string; note: string }>; embed: Array<{ name: string; note: string }>; warning: string | null }>
  localSetupSteps(): Promise<{ windows: string[]; linux: string[]; warning: string }>
}
