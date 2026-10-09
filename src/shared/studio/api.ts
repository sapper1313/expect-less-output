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

export type KeyId = 'xai' | 'anthropic' | 'threads' | 'bluesky'

export interface KeyStatus {
  id: KeyId
  label: string
  has: boolean
  masked: string
  /** Not secret. Bluesky handle, Threads account name. */
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
}

export interface StudioApi {
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
  dryRunDay(): Promise<string[]>
  cheapTest(): Promise<TestResult & { dollars: number; mock: boolean }>

  localChecklist(): Promise<ChecklistView[]>
  localSelfTest(): Promise<{ vision: TestResult & { seconds: number }; embed: TestResult & { seconds: number }; whisper: TestResult & { seconds: number } }>
  localPull(): Promise<string[]>
  localPullProgress(): Promise<Array<{ model: string; pct: number; status: string }>>
  localRecommend(ramGb: number | null, hasGpu: boolean | null): Promise<{ tier: string; vision: Array<{ name: string; note: string }>; embed: Array<{ name: string; note: string }>; warning: string | null }>
  localSetupSteps(): Promise<{ windows: string[]; linux: string[]; warning: string }>
}
