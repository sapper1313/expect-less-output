import type { AmazonChannelSettings } from './types'
import type {
  WebsiteConfig,
  WebsiteProfile,
  WebsiteProfilePatch,
  WebsiteResult,
  WebsiteStatus,
} from './website'
import type {
  Account,
  ChannelOverrides,
  ChannelOverridePatch,
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
  PlatformSlot,
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
import type { DashboardSnapshot } from './dashboard'
import type { SendSchedule } from './sendSchedule'
import type { UploadPostState, UploadPostTest } from './uploadPost'
import type { AccountStatsView, AccountSyncResult, CommentFilter, CommentSyncResult, DmChannel, InboxComment } from './engage'
import type { SearchHit } from './search'
import type { EditPatch } from './platformEdit'
import type { StudioApi } from './studio/api'
import type { UpcomingEntryT, UpcomingView } from './upcoming'
import type { TrackerView } from './tracker'
import type {
  GrowthRetract,
  StorageReport,
  ArchivedChannelFiles,
  ArchiveResult,
  ExtraAccountView,
  ExtraCredentialsStatus,
} from './types'
import type { ExtraPlatform } from './platformLimits'
import type {
  AuditRow,
  FillResult,
  OpenSlot,
  FreshStartDone,
  FreshStartInfo,
  BotInfo,
  ChannelRules,
  DropFilter,
  DropRow,
  InboxCounts,
  InboxItem,
  IssueRow,
  ScheduleOutcome,
} from './pipeline'

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
  uploadPost: {
    get(): Promise<UploadPostState>
    setKey(key: string): Promise<UploadPostState>
    removeKey(): Promise<UploadPostState>
    setLink(brandId: number, profile: string, platforms: Record<string, boolean>): Promise<UploadPostState>
    test(): Promise<UploadPostTest>
    /** The Try again button on a first comment that failed or was skipped. */
    retryFirstComment(targetId: number): Promise<void>
    /** Adds a first comment to a post that is already live and sends it now. */
    commentNow(postId: number, text: string): Promise<Post>
    /** Account numbers for every ticked channel and platform, and the TikTok audience. */
    accountStats(): Promise<AccountStatsView>
    /** Reads the numbers from Upload-Post now. */
    refreshAccountStats(): Promise<AccountSyncResult>
  }
  secrets: {
    status(keys: string[]): Promise<SecretStatus[]>
    set(key: string, value: string): Promise<void>
    remove(key: string): Promise<void>
  }
  brands: {
    list(includeArchived?: boolean): Promise<Brand[]>
    create(name: string, color: string): Promise<Brand>
    update(id: number, patch: { name?: string; color?: string; slug?: string }): Promise<Brand>
    archive(id: number, archived: boolean): Promise<void>
    getSlots(brandId: number): Promise<BrandSlot[]>
    /** The channel's posting times for each platform and kind. */
    getPlatformSlots(brandId: number): Promise<PlatformSlot[]>
    setPlatformSlots(brandId: number, slots: PlatformSlot[]): Promise<PlatformSlot[]>
    /** Which kinds (Shorts, Long form) the channel makes, and the days each posts on. */
    getSlotKinds(brandId: number): Promise<Array<{ kind: 'short' | 'long'; enabled: boolean; days: number[] | null; platforms?: Record<string, boolean> | null }>>
    setSlotKinds(
      brandId: number,
      kinds: Array<{ kind: 'short' | 'long'; enabled: boolean; days: number[] | null; platforms?: Record<string, boolean> | null }>,
    ): Promise<Array<{ kind: 'short' | 'long'; enabled: boolean; days: number[] | null; platforms?: Record<string, boolean> | null }>>
    /** The channel's own handoff and missed post settings. A missing value follows the app wide setting. */
    getOverrides(brandId: number): Promise<ChannelOverrides>
    setOverrides(brandId: number, patch: ChannelOverridePatch): Promise<ChannelOverrides>
    setSlots(
      brandId: number,
      slots: Array<Pick<BrandSlot, 'dayType' | 'timeLocal' | 'enabled'> & { kind?: 'short' | 'long' }>,
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
    saveCsv(defaultName: string, text: string): Promise<string | null>
    inspect(path: string): Promise<MediaInspection>
  }
  slots: {
    /** Open times. With a platform: only that platform's own times. Without: any time one of the channel's platforms can use. */
    next(brandId: number, count: number, fromUtc?: string, platform?: Platform, kind?: 'short' | 'long'): Promise<string[]>
    /** One time for every platform of each of the next videos. */
    plan(brandId: number, count: number, kind: 'short' | 'long' | undefined, platforms: Platform[]): Promise<Array<Partial<Record<Platform, string>>>>
    countOnDay(brandId: number, dayIso: string): Promise<number>
    /** Heads ups for a hand picked time (not a slot, daily limit, minimum gap). Empty means it fits. */
    checkTime(brandId: number, whenUtc: string): Promise<string[]>
    /** The slots in a window that have nothing in them, from every channel's settings (or one channel). */
    open(fromUtc: string, toUtc: string, brandId: number | null): Promise<OpenSlot[]>
  }
  posts: {
    list(filter?: PostFilter): Promise<Post[]>
    get(id: number): Promise<Post | null>
    create(input: PostInput): Promise<Post>
    createMany(inputs: PostInput[]): Promise<Post[]>
    update(id: number, patch: PostUpdate): Promise<Post>
    reschedule(ids: number[], scheduledAtUtc: string): Promise<void>
    /** The owner set a clip's Related video by hand in YouTube Studio, so the reminder is cleared (or brought back). */
    setRelatedDone(id: number, done: boolean): Promise<void>
    /** Two scheduled posts trade times. */
    swap(a: number, b: number): Promise<void>
    cancel(ids: number[]): Promise<void>
    remove(ids: number[], alsoDeleteFile: boolean): Promise<void>
    /** Older posts that never went to this platform and still have their video. */
    olderMissingPlatform(brandId: number, platform: Platform): Promise<Array<{ postId: number; title: string; postedAtUtc: string | null; platforms: string[] }>>
    /** Sends already posted videos to one more platform, a few minutes apart. */
    addPlatform(postIds: number[], platform: Platform, schedule?: SendSchedule): Promise<{ added: number; problems: Array<{ postId: number; title: string; reason: string }>; times: string[] }>
    retryTarget(targetId: number): Promise<void>
    /** Fires one platform entry again from the post's saved video and text, even a stuck or legacy one. */
    resubmitTarget(targetId: number): Promise<void>
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
    /** The numbers for every video as spreadsheet rows. */
    exportRows(
      brandId: number | null,
      range: StatsRange,
    ): Promise<Array<Record<string, string | number | null>>>
  }
  agent: {
    status(): Promise<AgentStatus>
    /** Makes a new token and returns it. This is the only time it is shown. */
    generateToken(): Promise<{ token: string }>
    /** The private link to the read only phone page, or the reason there is none yet. */
    phoneLink(): Promise<{ url: string | null; reason: string | null }>
    /** Makes a new phone link. The old one stops working. */
    newPhoneLink(): Promise<{ url: string | null; reason: string | null }>
    mcpConfig(): Promise<McpConfig>
    bots(): Promise<BotInfo[]>
    /** Makes a bot with its own token. The token is shown only in this answer. */
    createBot(
      name: string,
      channels: string[],
      role: 'writer' | 'orchestrator',
    ): Promise<{ bot: BotInfo; token: string }>
    newBotToken(id: number): Promise<{ token: string }>
    updateBot(
      id: number,
      patch: { channels?: string[]; role?: 'writer' | 'orchestrator' },
    ): Promise<BotInfo>
    revokeBot(id: number): Promise<void>
  }
  studio: StudioApi
  upcoming: {
    view(): Promise<UpcomingView>
    /** Entries waiting for your review, for the menu badge. */
    needsReview(): Promise<number>
    /** Planned versus finished per channel and platform, with flags. Read only. */
    tracker(flagDays?: number): Promise<TrackerView>
    add(input: {
      channel: string
      working_title: string
      premise?: string
      notes?: string
      air_date?: string
    }): Promise<UpcomingEntryT>
    patch(
      channel: string,
      episodeId: string,
      patch: Partial<
        Pick<
          UpcomingEntryT,
          | 'working_title'
          | 'premise'
          | 'notes'
          | 'script_path'
          | 'air_date'
          | 'status'
          | 'post_type'
          | 'source_episode_id'
        >
      > & {
        clear_conflict?: boolean
      },
      base?: { entry_revision?: number },
    ): Promise<{ entry: UpcomingEntryT; conflict: boolean }>
    /** Removes an entry you do not want. Restore previous brings it back. */
    remove(channel: string, episodeId: string): Promise<void>
    /** Puts the file back to the copy before the last change. */
    restorePrevious(): Promise<void>
    /** Dismisses the flagged file edits without restoring. */
    dismiss(): Promise<void>
    /** One time: each unused Studio idea becomes an idea entry. Returns how many were moved. */
    moveStudioIdeas(): Promise<number>
    openScript(path: string): Promise<void>
    reload(): Promise<void>
  }
  platforms: {
    /** Every channel with Bluesky, X, LinkedIn and Pinterest: signed in or not. */
    views(): Promise<ExtraAccountView[]>
    credentials(platform: 'x' | 'linkedin' | 'pinterest'): Promise<ExtraCredentialsStatus>
    saveCredentials(
      platform: 'x' | 'linkedin' | 'pinterest',
      clientId: string,
      clientSecret: string,
    ): Promise<ExtraCredentialsStatus>
    /** Opens the platform's sign-in page and waits for the approval. */
    connect(brandId: number, platform: 'x' | 'linkedin' | 'pinterest'): Promise<ExtraAccountView>
    cancel(): Promise<void>
    disconnect(brandId: number, platform: ExtraPlatform): Promise<void>
    boards(brandId: number): Promise<Array<{ id: string; name: string }>>
    setBoard(brandId: number, boardId: string, boardName: string): Promise<ExtraAccountView>
    /** The extra platforms a channel has a working login for. */
    connectedFor(brandId: number): Promise<ExtraPlatform[]>
  }
  ventures: {
    storefronts(): Promise<import('./ventures').StorefrontInfo[]>
    status(id: string): Promise<import('./ventures').ConnectionStatus>
    dashboard(
      id: string,
      preset: import('./ventures').RangePreset,
      custom?: import('./ventures').VentureRange,
    ): Promise<import('./ventures').DashboardSummary>
    listings(id: string, q: import('./ventures').ListingQuery): Promise<import('./ventures').ListingRow[]>
    listing(id: string, listingId: string): Promise<import('./ventures').ListingDetail | null>
    orders(
      id: string,
      preset: import('./ventures').RangePreset,
      custom?: import('./ventures').VentureRange,
    ): Promise<import('./ventures').OrderRow[]>
    reviews(id: string, limit: number): Promise<import('./ventures').ReviewRow[]>
    notifications(id: string): Promise<import('./ventures').VentureNotification[]>
    markRead(id: string, ids: number[]): Promise<void>
    unreadTotal(): Promise<number>
    syncNow(id: string): Promise<void>
    /** Owner only. Not available on the phone page. */
    connectEtsy(): Promise<{ shopName: string }>
    disconnectEtsy(): Promise<void>
    saveEtsyKeys(keystring: string, sharedSecret: string): Promise<void>
    etsyKeysSet(): Promise<boolean>
    /** The mailbox that receives Etsy "new message" emails. Owner only. The password is never returned. */
    saveMailbox(c: { host: string; user: string; password: string; folder: string }): Promise<void>
    mailboxStatus(): Promise<{ configured: boolean; host: string; user: string; folder: string }>
    testMailbox(): Promise<{ ok: boolean; found?: number; error?: string }>
    /** Used for a draft that does not name its own category or shipping profile. Owner only. */
    draftDefaults(): Promise<{ taxonomyId: number | null; shippingProfileId: number | null }>
    saveDraftDefaults(v: { taxonomyId: number | null; shippingProfileId: number | null }): Promise<void>
    pendingDrafts(): Promise<Array<{ id: string; kind: 'create' | 'update'; title: string; error: string | null }>>
  }
  amazon: {
    /** This channel's tracking id and lines, and why lists cannot run for it yet (null when they can). */
    channel(brandId: number): Promise<AmazonChannelSettings & { blocked: string | null; stream: boolean }>
    saveChannel(brandId: number, patch: Partial<AmazonChannelSettings>): Promise<AmazonChannelSettings>
    live(): Promise<boolean>
    /** The master switch. Turning it on catches up every waiting post and returns how many were looked at. */
    setLive(on: boolean): Promise<number>
  }
  website: {
    config(): Promise<WebsiteConfig>
    setConfig(patch: Partial<WebsiteConfig>): Promise<WebsiteConfig>
    /** What ELO sends to the public site for one channel. */
    profile(brandId: number): Promise<WebsiteProfile>
    saveProfile(brandId: number, patch: WebsiteProfilePatch): Promise<WebsiteProfile>
    /** Uses a picked picture as the channel's hero image (sent with the next publish). */
    setHero(brandId: number, path: string): Promise<WebsiteProfile>
    /** The hero image as a data URL, or null when there is none yet. */
    heroPreview(brandId: number): Promise<string | null>
    status(): Promise<WebsiteStatus>
    /** Reads the site's channel list and fills ELO with it. Changes nothing on the site. */
    pull(): Promise<WebsiteResult>
    /** Makes the site match ELO now. */
    publish(): Promise<WebsiteResult>
  }
  growth: {
    /** What viewers watched: the text of learnings.md. */
    learnings(): Promise<string>
    /** The Monday brief as text, built now. */
    brief(): Promise<string>
    /** Builds the brief and sends it now (iMessage, email, Telegram). Returns the file it was saved to. */
    sendBriefNow(): Promise<string>
    /** Search phrases from autocomplete. */
    suggest(query: string): Promise<string[]>
    /** Gives Facebook, Instagram and TikTok their own version of the description. Returns the platforms changed. */
    morphCaptions(postId: number): Promise<string[]>
    /** Takes an episode down as far as the platforms allow. */
    retract(episodeId: string): Promise<GrowthRetract>
    /** Sets the sound of a waiting video to -14 LUFS (the old file is kept in Replaced). */
    normalizeAudio(postId: number): Promise<string>
    /** Where the disk space goes, per channel. */
    storageReport(): Promise<StorageReport>
    /** Archived channels that still have video files, with their size. */
    archivedChannelFiles(): Promise<ArchivedChannelFiles[]>
    /** Permanently deletes the video files of archived channels. */
    deleteArchivedFiles(brandIds: number[]): Promise<{ deleted: number; freedBytes: number }>
    /** Makes smaller H.265 copies of posted videos older than `days`. Removes the big original only when asked. */
    archiveOld(days: number, removeOriginals: boolean): Promise<ArchiveResult>
  }
  pipeline: {
    counts(): Promise<InboxCounts>
    /** Accepted drops with no slot yet. */
    waiting(): Promise<InboxItem[]>
    held(): Promise<InboxItem[]>
    /** Rejected and duplicate drops, newest first. */
    rejected(): Promise<DropRow[]>
    log(filter: DropFilter): Promise<DropRow[]>
    logCsv(filter: DropFilter): Promise<string>
    /** Gives the drop the channel's next open slot. */
    schedule(postId: number): Promise<ScheduleOutcome>
    /** The channel's open slots for this drop, to pick from. */
    openSlots(postId: number, count: number): Promise<string[]>
    pickSlot(postId: number, slotUtc: string): Promise<ScheduleOutcome>
    hold(postId: number, reason: string): Promise<void>
    /** Clears a hold after checking the file again. accept: take the file and title as they are now. */
    release(postId: number, accept: boolean): Promise<ScheduleOutcome>
    reject(postId: number, note: string): Promise<void>
    openFile(postId: number): Promise<void>
    issues(): Promise<IssueRow[]>
    reconcileNow(): Promise<IssueRow[]>
    /** Puts the oldest waiting videos into the open slots of a window, one per slot, for channels that are running. */
    fillAll(fromUtc: string, toUtc: string): Promise<FillResult>
    /** Takes scheduled drops back to waiting (the undo of a fill). The slots are free again. */
    unschedule(postIds: number[]): Promise<number>
    /** Hides one Issues message until its problem goes away and comes back. */
    dismissIssue(id: number): Promise<void>
    /** Hides every open Issues message. Returns how many. */
    dismissAllIssues(): Promise<number>
    audit(filter: { actor?: string; action?: string }): Promise<AuditRow[]>
    auditCsv(filter: { actor?: string; action?: string }): Promise<string>
    /** What a fresh start would remove and keep. Changes nothing. */
    freshStartPreview(): Promise<FreshStartInfo>
    /** Backs everything up, checks the backup, then removes all scripts, ideas, tasks and Upcoming entries. */
    freshStartRun(): Promise<FreshStartDone>
    channelRules(brandId: number): Promise<ChannelRules>
    setChannelRules(brandId: number, patch: Partial<ChannelRules>): Promise<ChannelRules>
  }
  home: {
    summary(): Promise<HomeSummary>
  }
  /** The Dashboard screen. Read only. */
  dashboard: {
    snapshot(): Promise<DashboardSnapshot | null>
    refresh(): Promise<DashboardSnapshot | null>
    /** The week map for this week (0) or a later week (1, 2, ...). */
    week(offset: number): Promise<import('./dashboard').WeekMap | null>
  }
  search: {
    query(q: string): Promise<SearchHit[]>
  }
  telegram: {
    status(): Promise<{ enabled: boolean; hasToken: boolean; paired: number; code: string | null }>
    newCode(): Promise<string>
    unpair(): Promise<void>
    setEnabled(on: boolean): Promise<void>
    test(): Promise<string>
  }
  platform: {
    /** Changes the text of a video that is already live. */
    edit(postId: number, platform: string, patch: EditPatch): Promise<string>
  }
  /** Comments and Instagram messages read through Upload-Post. Nothing is sent without a click. */
  engage: {
    comments(filter: CommentFilter): Promise<InboxComment[]>
    /** Checks the posted videos for new comments right now. */
    refresh(): Promise<CommentSyncResult>
    reply(id: number, text: string): Promise<void>
    setStatus(id: number, status: 'new' | 'done'): Promise<void>
    /** Reply ideas from the local AI. */
    draft(id: number): Promise<string[]>
    newCount(): Promise<number>
    dms(force?: boolean): Promise<DmChannel[]>
    dmSend(brandId: number, recipientId: string, text: string): Promise<void>
    dmDraft(brandId: number, recipientId: string): Promise<string[]>
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
