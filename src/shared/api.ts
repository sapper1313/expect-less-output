import type {
  Account,
  AppEvent,
  AgentStatus,
  AlertChannel,
  AlertStatus,
  AlertTestResult,
  BrandStats,
  AppInfo,
  HealthRow,
  McpConfig,
  BestTimes,
  ImportResult,
  RecommendedSlots,
  ImportedVideo,
  PostStats,
  StatsRange,
  TextAssistStatus,
  RestorePreview,
  RestoreReport,
  Brand,
  BrandDefaults,
  BrandSlot,
  ConnectResult,
  GoogleCredentialsStatus,
  MetaCredentialsStatus,
  MetaStatus,
  QuotaStatus,
  TikTokCreatorInfo,
  TikTokCredentialsStatus,
  TikTokMode,
  YoutubeMode,
  YoutubeOption,
  HashtagSet,
  LogEntry,
  LogFilter,
  MediaInspection,
  Platform,
  Post,
  PostFilter,
  PostInput,
  PostUpdate,
  SchedulerStatus,
  SecretStatus,
  Settings,
} from './types'
import type { HomeSummary } from './home'
import type { SearchHit } from './search'
import type { EditPatch } from './platformEdit'
import type { StudioApi } from './studio/api'

export interface Api {
  app: {
    info(): Promise<AppInfo>
    quit(): Promise<void>
    openMediaRoot(): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    pickMediaRoot(): Promise<string | null>
  }
  secrets: {
    status(keys: string[]): Promise<SecretStatus[]>
    set(key: string, value: string): Promise<void>
    remove(key: string): Promise<void>
  }
  brands: {
    list(includeArchived?: boolean): Promise<Brand[]>
    create(name: string, color: string): Promise<Brand>
    update(id: number, patch: { name?: string; color?: string }): Promise<Brand>
    archive(id: number, archived: boolean): Promise<void>
    getSlots(brandId: number): Promise<BrandSlot[]>
    setSlots(
      brandId: number,
      slots: Array<Pick<BrandSlot, 'dayType' | 'timeLocal' | 'enabled'>>,
    ): Promise<BrandSlot[]>
    getDefaults(brandId: number): Promise<BrandDefaults>
    setDefaults(defaults: BrandDefaults): Promise<BrandDefaults>
  }
  hashtags: {
    list(brandId?: number | null): Promise<HashtagSet[]>
    save(set: Omit<HashtagSet, 'id'> & { id?: number }): Promise<HashtagSet>
    remove(id: number): Promise<void>
  }
  accounts: {
    list(brandId?: number): Promise<Account[]>
  }
  media: {
    pickVideos(multiple: boolean): Promise<string[]>
    pickImages(multiple: boolean): Promise<string[]>
    inspect(path: string): Promise<MediaInspection>
  }
  slots: {
    next(brandId: number, count: number, fromUtc?: string): Promise<string[]>
    countOnDay(brandId: number, dayIso: string): Promise<number>
  }
  posts: {
    list(filter?: PostFilter): Promise<Post[]>
    get(id: number): Promise<Post | null>
    create(input: PostInput): Promise<Post>
    createMany(inputs: PostInput[]): Promise<Post[]>
    update(id: number, patch: PostUpdate): Promise<Post>
    reschedule(ids: number[], scheduledAtUtc: string): Promise<void>
    cancel(ids: number[]): Promise<void>
    remove(ids: number[], alsoDeleteFile: boolean): Promise<void>
    retryTarget(targetId: number): Promise<void>
    markPosted(targetId: number, url?: string): Promise<void>
    duplicate(id: number): Promise<Post>
    dismissChecklist(targetId: number): Promise<void>
    postNow(id: number): Promise<void>
  }
  log: {
    list(filter?: LogFilter): Promise<LogEntry[]>
  }
  scheduler: {
    status(): Promise<SchedulerStatus>
    pause(): Promise<void>
    resume(): Promise<void>
    simulateFailure(platform: Platform | null, kind?: 'transient' | 'permanent'): Promise<void>
  }
  youtube: {
    credentialsStatus(): Promise<GoogleCredentialsStatus>
    saveCredentials(clientId: string, clientSecret: string): Promise<GoogleCredentialsStatus>
    connect(brandId: number): Promise<ConnectResult>
    finishConnect(sessionId: string, channelId: string): Promise<ConnectResult>
    cancelConnect(): Promise<void>
    disconnect(brandId: number): Promise<void>
    setMode(brandId: number, mode: YoutubeMode): Promise<void>
    quota(): Promise<QuotaStatus>
    categories(): Promise<YoutubeOption[]>
    playlists(brandId: number): Promise<YoutubeOption[]>
    checkHealth(): Promise<void>
  }
  tiktok: {
    credentialsStatus(): Promise<TikTokCredentialsStatus>
    saveCredentials(
      clientKey: string,
      clientSecret: string,
      redirectUri: string,
      requestPublishScope: boolean,
      requestStatsScope?: boolean,
    ): Promise<TikTokCredentialsStatus>
    connect(brandId: number): Promise<Account>
    submitCode(code: string): Promise<void>
    cancelConnect(): Promise<void>
    disconnect(brandId: number): Promise<void>
    setMode(brandId: number, mode: TikTokMode, auditApproved?: boolean): Promise<void>
    creatorInfo(brandId: number, refresh?: boolean): Promise<TikTokCreatorInfo>
    checkHealth(): Promise<void>
  }
  meta: {
    credentialsStatus(): Promise<MetaCredentialsStatus>
    saveCredentials(appId: string, appSecret: string): Promise<MetaCredentialsStatus>
    connect(): Promise<MetaStatus>
    cancelConnect(): Promise<void>
    disconnect(): Promise<void>
    status(): Promise<MetaStatus>
    assign(brandId: number, pageId: string | null, igId: string | null): Promise<MetaStatus>
    checkHealth(): Promise<MetaStatus>
  }
  alerts: {
    status(): Promise<AlertStatus>
    saveEmailPassword(password: string): Promise<AlertStatus>
    sendTest(channel: AlertChannel): Promise<AlertTestResult>
  }
  health: {
    list(): Promise<HealthRow[]>
  }
  backup: {
    export(): Promise<{ saved: string; accounts: number } | null>
    pick(): Promise<RestorePreview | null>
    restore(zipPath: string, newMediaRoot: string): Promise<void>
    report(): Promise<RestoreReport | null>
    dismissReport(): Promise<void>
  }
  stats: {
    forPosts(ids: number[]): Promise<Record<number, PostStats>>
    post(id: number): Promise<PostStats>
    /** Reads stats now. Without an id it covers every posted video. */
    refresh(postId?: number): Promise<{ fetched: number; unavailable: number }>
    brandSummary(brandId: number | null, range: StatsRange): Promise<BrandStats>
    /** Finds videos already on the connected channels and reads their numbers. */
    importExisting(brandId: number | null): Promise<ImportResult>
    imported(brandId: number | null, range: StatsRange): Promise<ImportedVideo[]>
    bestTimes(brandId: number | null, platform: Platform | null): Promise<BestTimes>
    recommendedSlots(brandId: number): Promise<RecommendedSlots>
  }
  agent: {
    status(): Promise<AgentStatus>
    /** Makes a new token and returns it. This is the only time it is shown. */
    generateToken(): Promise<{ token: string }>
    mcpConfig(): Promise<McpConfig>
  }
  studio: StudioApi
  home: {
    summary(): Promise<HomeSummary>
  }
  search: {
    query(q: string): Promise<SearchHit[]>
  }
  platform: {
    /** Changes the text of a video that is already live. */
    edit(postId: number, platform: string, patch: EditPatch): Promise<string>
  }
  textAssist: {
    available(): Promise<boolean>
    status(): Promise<TextAssistStatus>
    /** Uses the Ollama machine from the Local AI section in Settings, under AI models and Local AI: picks a text model and turns Suggest on. Returns what it did. */
    autoSetup(): Promise<{ ok: boolean; message: string }>
    suggest(
      kind: 'title' | 'caption' | 'hashtags',
      brandId: number,
      title: string,
      caption: string,
    ): Promise<string[]>
    test(): Promise<{ ok: boolean; message: string }>
  }
}

export type EloBridge = {
  invoke(name: string, ...args: unknown[]): Promise<unknown>
  on(callback: (event: AppEvent) => void): () => void
  pathForFile(file: File): string
}
