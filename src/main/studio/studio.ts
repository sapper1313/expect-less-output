import { z } from 'zod'
import { Analytics } from './analytics'
import { CommentsAgent } from './comments/agent'
import { MockCommentSource, type CommentSource, type PostedRef } from './comments/sources'
import { BlueskyCommentSource } from './comments/realSources'
import { buildDigest } from './digest'
import { Watchdog } from './watchdog'
import { StudioBackup } from './backup'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Db } from '../db'
import type { ActivityLog } from '../services/activity'
import type { Library as MediaLibrary } from '../services/library'
import type { PostService } from '../services/posts'
import type { SecretStore } from '../services/secrets'
import { mask } from '../services/secrets'
import { addDays, dueDates, slotToUtc, nextDue, todayEastern } from '@shared/studio/cadence'
import { estimateClips, typicalEpisodeEstimate } from '@shared/studio/pricing'
import { recommendModels, remoteSetupSteps } from '@shared/studio/localModels'
import type {
  BrandStudioRow,
  ChecklistView,
  EpisodeDetail,
  KeyId,
  KeyStatus,
  PurgeReportView,
  StudioApi,
  StudioOverview,
  TestResult,
} from '@shared/studio/api'
import type { EpisodeStatus, StudioBrandConfig } from '@shared/studio/types'
import { StudioConfigService } from './configService'
import { SpendService } from './spend'
import { AgentRunner, AuditLog, TaskStore, FlagNow } from './agents/framework'
import { AnthropicClient, LlmGateway, MockLlm } from './agents/llm'
import { Director } from './agents/director'
import { EpisodeLibrary, slug } from './library'
import { CalendarFeed } from './calendarFeed'
import { Archivist } from './retention'
import { LocalAi } from './localAi'
import { MockVideoClient, XaiClient, type VideoClient } from './xai'
import { makeIngestHooks, type IngestHooks } from './ingest'
import { probe } from './ffmpeg'
import { BibleService } from './bible'
import { Holidays } from './holidays'
import { RepetitionGuard } from './repetition'
import { HollowSafetyChecker, MathChecker, ScriptQc } from './agents/checkers'
import { makeWriterAgent } from './agents/writer'
import { registerMockResponders } from './agents/mockResponders'
import { BrandAssets } from './assets'
import { VideoJobs } from './jobs'
import { VideoQc } from './qc'
import { Publisher, makePublisherAgent } from './publisher'
import { Compliance } from './agents/compliance'
import { Guidelines, Thumbnailer, lineDiff } from './thumbnails'
import { MockAnalytics, ThumbnailTester, type AnalyticsReader } from './thumbTest'
import { SocialPublisher } from './social/socialPublisher'
import { PublicHost, R2_KEY_ID, R2_SECRET } from './social/publicHost'
import { SocialAccounts, type BrandSocialView } from './social/accounts'
import type { AlertItem } from '../alerts/format'
import type { ImageClient } from './xai'
import { makeProducerAgent } from './agents/producer'
import { expandHome } from './configService'
import { OllamaTextClient, RoutingClient } from './agents/ollamaClient'
import { Research, type ResearchYoutube } from './research'
import { RetentionService } from './watchTime'
import { CaptionService } from './captions'
import { ClipCutter } from './clips'
import { RepostQueue } from './repost'
import { chaptersText } from '@shared/studio/captions'
import type { RetentionData } from './youtubeAnalytics'
import { buildModelOptions } from '@shared/studio/modelCatalog'
import { DirectorReply, directorSystem, type DirectorActionView } from './directorChat'

const REBUILDABLE: EpisodeStatus[] = ['Idea', 'Written', 'Checking', 'Ready for production', 'Flagged']

export interface StudioDeps {
  db: Db
  secrets: SecretStore
  posts: PostService
  media: MediaLibrary
  log: ActivityLog
  /** Sends an alert through the existing notification and iMessage path. */
  alert: (headline: string, detail: string) => void
  /** The full alert, for failures that carry the platform, brand and title. Defaults to the plain alert. */
  alertItem?: (item: AlertItem) => void
  emit: () => void
  /** Reads thumbnail results from YouTube Analytics. Mock mode uses simulated numbers. */
  analytics?: AnalyticsReader
  /** First run: start with everything paused, so nothing begins until the owner presses Resume. */
  startPaused?: boolean
  dataDir?: string
  postersDir?: string
  appVersion?: string
  mediaRoot?: () => string
  /** Views for a posted video, for ranking re-posts. */
  postViews?: (postId: number) => number | null
  /** Adds a caption track to a YouTube video. */
  uploadCaption?: (accountId: number, videoId: string, lang: string, name: string, srt: string) => Promise<void>
  /** Reads watch time and retention from YouTube Analytics. */
  retention?: (accountId: number, videoId: string, fromDate: string, toDate: string) => Promise<RetentionData>
  /** YouTube calls for the research tools. */
  youtube?: ResearchYoutube
  youtubeAccountFor?: (brandId: number) => number | null
  youtubeCategoryFor?: (brandId: number) => string
  /** Opens a folder in Finder. */
  openPath?: (path: string) => Promise<void>
  /** The existing stats pass for the four platforms the scheduler posts to. */
  refreshStats?: () => Promise<{ fetched: number; unavailable: number }>
  /** Sends one plain message to the owner (iMessage and email). */
  broadcast?: (text: string) => Promise<void>
  /** Plain lines about logins about to expire (Meta, TikTok, YouTube). */
  expiring?: () => string[]
  /** Folder holding install.sh and elo-watchdog.sh. */
  watchdogDir?: () => string
  /** YouTube, Facebook and Instagram comment sources built from the existing connections. */
  commentSources?: () => Record<string, CommentSource>
  /** Sets a YouTube thumbnail. Mock mode records the choice only. */
  setYoutubeThumbnail?: (accountId: number | null, videoId: string, file: string) => Promise<void>
  now?: () => number
  fetchImpl?: typeof fetch
}

const KEY_NAMES: Record<KeyId, { secret: string; label: string }> = {
  xai: { secret: 'xai.apiKey', label: 'Grok / xAI API key' },
  anthropic: { secret: 'anthropic.apiKey', label: 'Anthropic API key' },
  r2id: { secret: R2_KEY_ID, label: 'Cloudflare R2 access key id' },
  r2secret: { secret: R2_SECRET, label: 'Cloudflare R2 secret access key' },
  telegram: { secret: 'telegram.botToken', label: 'Telegram bot token (phone chat)' },
}
const TESTS_KEY = 'studio.keyTests'
const ACCOUNTS_KEY = 'studio.keyAccounts'

/** The studio as one object: services, timers, and the API the UI and agents call. */
export class Studio implements StudioApi {
  readonly cfg: StudioConfigService
  readonly audit: AuditLog
  readonly tasks: TaskStore
  readonly spend: SpendService
  readonly mockLlm = new MockLlm()
  readonly mockVideo: MockVideoClient
  readonly xai: XaiClient
  readonly anthropic: AnthropicClient
  readonly gateway: LlmGateway
  private readonly routedLlm: RoutingClient
  readonly research: Research
  readonly retention: RetentionService
  readonly captionSvc: CaptionService
  readonly clipCutter: ClipCutter
  readonly reposts: RepostQueue
  readonly runner: AgentRunner
  readonly director: Director
  readonly episodes: EpisodeLibrary
  readonly calendarFeed: CalendarFeed
  readonly archivist: Archivist
  readonly localAi: LocalAi
  readonly ingest: IngestHooks
  readonly bibles: BibleService
  readonly holidayList: Holidays
  readonly repetition: RepetitionGuard
  readonly scriptQc: ScriptQc
  readonly math: MathChecker
  readonly safety: HollowSafetyChecker
  readonly assets: BrandAssets
  readonly jobs: VideoJobs
  readonly qc: VideoQc
  readonly publisher: Publisher
  readonly compliance: Compliance
  readonly guidelines: Guidelines
  readonly thumbnailer: Thumbnailer
  readonly tester: ThumbnailTester
  readonly social: SocialPublisher
  readonly host: PublicHost
  readonly socialAccounts: SocialAccounts
  readonly mockAnalytics = new MockAnalytics()
  readonly analytics: Analytics
  readonly comments: CommentsAgent
  readonly watchdog: Watchdog
  readonly backups: StudioBackup
  readonly mockComments = new Map<string, MockCommentSource>()
  private lastTickMs = 0
  private timers: NodeJS.Timeout[] = []
  private pulls = new Map<string, { pct: number; status: string }>()
  private ticking = false

  constructor(readonly d: StudioDeps) {
    const now = d.now ?? Date.now
    this.cfg = new StudioConfigService(d.db, now)
    if (d.startPaused && !this.cfg.exists()) this.cfg.set({ paused: true })
    this.cfg.ensureBrandRows()
    this.applyBrandDefaults()
    const brandName = (id: number) =>
      (d.db.prepare('SELECT name FROM brands WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? `Brand ${id}`
    this.audit = new AuditLog(d.db, now)
    this.tasks = new TaskStore(d.db, now)
    this.spend = new SpendService(d.db, this.cfg, d.alert, now, brandName)
    this.mockVideo = new MockVideoClient(now)
    this.xai = new XaiClient(() => d.secrets.get(KEY_NAMES.xai.secret), d.fetchImpl)
    this.anthropic = new AnthropicClient(() => d.secrets.get(KEY_NAMES.anthropic.secret), d.fetchImpl)
    this.routedLlm = new RoutingClient(this.anthropic, new OllamaTextClient(() => this.cfg.get().local.ollamaHost, d.fetchImpl))
    this.gateway = new LlmGateway({
      db: d.db,
      config: this.cfg,
      spend: this.spend,
      client: () => (this.cfg.get().mockMode ? this.mockLlm : this.routedLlm),
      now,
    })
    this.research = new Research({
      db: d.db,
      gateway: this.gateway,
      youtube: () => d.youtube ?? null,
      accountFor: (id) => d.youtubeAccountFor?.(id) ?? null,
      categoryFor: (id) => d.youtubeCategoryFor?.(id) ?? '',
      mock: () => this.cfg.get().mockMode,
      brandName,
      bibleText: (id) => this.bibles.markdown(id),
      addIdeas: (id, texts) => this.bibles.addIdeas(id, texts),
      fetchImpl: d.fetchImpl,
      now,
    })
    this.retention = new RetentionService({ db: d.db, read: (a, v, f, t) => (d.retention ? d.retention(a, v, f, t) : Promise.reject(new Error('YouTube Analytics is not available.'))), mock: () => this.cfg.get().mockMode, now })
    this.episodes = new EpisodeLibrary(d.db, this.cfg, brandName, now)
    this.clipCutter = new ClipCutter({ db: d.db, gateway: this.gateway, episodes: this.episodes, resolve: (rel) => d.media.resolve(rel), createPost: (i) => d.posts.create(i), brandName, aiDisclosure: (b) => this.cfg.getBrand(b).aiDisclosure, workDir: (id) => this.workDir(id) })
    this.reposts = new RepostQueue({ db: d.db, resolve: (rel) => d.media.resolve(rel), createPost: (i) => d.posts.create(i), nextSlot: (b) => d.posts.nextSlots(b, 1)[0] ?? null, views: (id) => d.postViews?.(id) ?? null, brandName, minAgeDays: () => this.cfg.get().repostAfterDays, now })
    this.captionSvc = new CaptionService({ db: d.db, gateway: this.gateway, episodes: this.episodes, brandName, root: () => this.episodes.root(), now })
    this.calendarFeed = new CalendarFeed(d.db, this.cfg, this.episodes, d.media, now)
    this.archivist = new Archivist({ db: d.db, cfg: this.cfg, media: d.media, episodes: this.episodes, audit: this.audit, now, workDir: (id) => this.workDir(id) })
    this.localAi = new LocalAi({ cfg: this.cfg, audit: this.audit, gateway: this.gateway, fetchImpl: d.fetchImpl, now })
    this.runner = new AgentRunner({
      tasks: this.tasks,
      audit: this.audit,
      config: this.cfg,
      now,
      onFlag: (task, reason) => {
        d.alert('Something needs a look.', `${task.brandId ? brandName(task.brandId) : 'Studio'}: ${task.type} was flagged. ${reason}`.slice(0, 240))
        if (task.episodeId && this.episodes.find(task.episodeId))
          this.episodes.setStatus(task.episodeId, 'Flagged', `${task.type} flagged.`, { flaggedReason: reason })
        d.emit()
      },
    })
    registerMockResponders(this.mockLlm)
    this.bibles = new BibleService(d.db, this.cfg, brandName, now)
    this.bibles.ensureSeeded()
    this.holidayList = new Holidays(d.db, now)
    this.holidayList.ensureSeeded()
    this.repetition = new RepetitionGuard({ db: d.db, cfg: this.cfg, localAi: this.localAi, gateway: this.gateway })
    const off = (name: string) => () => this.cfg.get().disabledAgents.includes(name)
    this.scriptQc = new ScriptQc({ cfg: this.cfg, gateway: this.gateway, off: off('Script QC') })
    this.math = new MathChecker({ gateway: this.gateway, off: off('Math Checker') })
    this.safety = new HollowSafetyChecker({ gateway: this.gateway, off: off('Hollow Safety Checker') })
    this.runner.register(
      makeWriterAgent({
        db: d.db,
        cfg: this.cfg,
        bible: this.bibles,
        library: this.episodes,
        holidays: this.holidayList,
        gateway: this.gateway,
        repetition: this.repetition,
        scriptQc: this.scriptQc,
        math: this.math,
        safety: this.safety,
        brandName,
        hints: (brandId) => this.analytics.hint(brandId),
      }),
    )
    this.assets = new BrandAssets(d.db, this.cfg, brandName, now)
    this.jobs = new VideoJobs(d.db, now)
    this.qc = new VideoQc({ cfg: this.cfg, localAi: this.localAi, audit: this.audit, assets: this.assets })
    this.host = new PublicHost(this.cfg, d.secrets, d.fetchImpl, now)
    this.socialAccounts = new SocialAccounts({ db: d.db, secrets: d.secrets, brandName, brandIds: () => this.cfg.listBrandConfigs().map((b) => b.brandId), fetchImpl: d.fetchImpl, now })
    this.social = new SocialPublisher({
      db: d.db,
      cfg: this.cfg,
      bluesky: (b) => this.socialAccounts.blueskyFor(b),
      alert: (item) => (d.alertItem ? d.alertItem(item) : d.alert(item.headline, item.detail)),
      log: (level, message) => d.log.log(level, message),
      brandName,
      now,
    })
    this.compliance = new Compliance({ db: d.db, cfg: this.cfg, bible: this.bibles })
    this.guidelines = new Guidelines(d.db, now)
    const images = (): ImageClient => (this.cfg.get().mockMode ? this.mockVideo : this.xai)
    this.thumbnailer = new Thumbnailer({ db: d.db, cfg: this.cfg, episodes: this.episodes, spend: this.spend, localAi: this.localAi, gateway: this.gateway, guidelines: this.guidelines, audit: this.audit, image: images, workDir: (id) => this.workDir(id), now })
    this.tester = new ThumbnailTester({
      db: d.db,
      cfg: this.cfg,
      audit: this.audit,
      reader: () => (this.cfg.get().mockMode || !d.analytics ? this.mockAnalytics : d.analytics),
      setter: () => ({ set: async (acc, vid, file) => (this.cfg.get().mockMode || !d.setYoutubeThumbnail ? undefined : d.setYoutubeThumbnail(acc, vid, file)) }),
      onShow: (v) => this.mockAnalytics.setCurrent(v),
      now,
    })
    this.publisher = new Publisher({ db: d.db, cfg: this.cfg, episodes: this.episodes, posts: d.posts, media: d.media, gateway: this.gateway, bible: this.bibles, compliance: this.compliance, thumbnailer: this.thumbnailer, tester: this.tester, social: this.social, host: this.host, socialReady: (b) => this.socialAccounts.notReady(b), workDir: (id) => this.workDir(id), chapters: async (id) => { const c = this.captionSvc.chapters(id).length ? this.captionSvc.chapters(id) : (await this.captionSvc.makeChapters(id)).chapters; return c.length ? chaptersText(c) : null }, now })
    this.runner.register(makePublisherAgent(this.publisher))
    this.runner.register(
      makeProducerAgent({
        db: d.db,
        cfg: this.cfg,
        spend: this.spend,
        episodes: this.episodes,
        jobs: this.jobs,
        qc: this.qc,
        assets: this.assets,
        gateway: this.gateway,
        localAi: this.localAi,
        video: () => (this.cfg.get().mockMode ? this.mockVideo : this.xai),
        workDir: (id) => this.workDir(id),
      }),
    )
    this.analytics = new Analytics({
      db: d.db,
      cfg: this.cfg,
      gateway: this.gateway,
      audit: this.audit,
      bluesky: (b) => this.socialAccounts.blueskyFor(b),
      tester: this.tester,
      refreshStats: d.refreshStats ?? (async () => ({ fetched: 0, unavailable: 0 })),
      brandName,
      now,
    })
    this.comments = new CommentsAgent({ db: d.db, cfg: this.cfg, bible: this.bibles, gateway: this.gateway, audit: this.audit, sources: () => this.commentSources(), refs: (brandId) => this.postedRefs(brandId), brandName, now })
    this.watchdog = new Watchdog(d.dataDir ?? tmpdir(), () => d.watchdogDir?.() ?? '')
    this.backups = new StudioBackup({ db: d.db, cfg: this.cfg, audit: this.audit, appVersion: d.appVersion ?? '0', postersDir: d.postersDir ?? '', mediaRoot: () => d.mediaRoot?.() ?? '', libraryRoot: () => expandHome(this.cfg.get().libraryDir), now })
    this.runner.register({
      name: 'Analytics',
      taskType: 'analytics_daily',
      role: this.analytics.role,
      input: z.object({ day: z.string().optional() }),
      output: z.object({ fetched: z.number(), social: z.number(), brands: z.number() }),
      tools: ['stats', 'bluesky'],
      paid: true,
      run: () => this.analytics.daily((id) => this.episodeDetails(id)),
    })
    this.runner.register({
      name: 'Comments',
      taskType: 'comments_pass',
      role: this.comments.role,
      input: z.object({}).passthrough(),
      output: z.object({ checked: z.number(), replied: z.number(), drafted: z.number(), flagged: z.number(), spam: z.number(), waiting: z.number() }),
      tools: ['youtube', 'facebook', 'instagram', 'bluesky'],
      paid: true,
      run: async (ctx) => {
        if (!ctx.task.brandId) throw new Error('A comment pass needs a brand.')
        return this.comments.pass(ctx.task.brandId)
      },
    })
    this.runner.setDisabled(this.cfg.get().disabledAgents)
    this.director = new Director({ db: d.db, config: this.cfg, tasks: this.tasks, audit: this.audit, alert: d.alert, now, onTick: () => this.heartbeat() })
    this.ingest = makeIngestHooks({ db: d.db, cfg: this.cfg, episodes: this.episodes, posts: d.posts, now, qc: this.qc, assets: this.assets, workDir: (id) => this.workDir(id), pipeline: (episodeId, postId) => this.publisher.run({ episodeId, postId }).then(() => undefined) })
  }

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  /** Where the clips and the final video of an episode live until the Archivist removes them. */
  workDir(episodeId: string): string {
    return join(expandHome(this.cfg.get().libraryDir), 'work', episodeId)
  }

  /** Long form brands get kid and AI settings on their first studio row only. */
  private applyBrandDefaults(): void {
    for (const b of this.cfg.listBrandConfigs()) {
      if (b.config.format === 'long' && b.config.madeForKids) {
        this.d.db.prepare('UPDATE brand_defaults SET youtube_made_for_kids = 1, ai_flag_youtube = 1 WHERE brand_id = ? AND youtube_made_for_kids = 0').run(b.brandId)
      }
    }
  }

  // ---------- lifecycle ----------

  /** Resumes unfinished work after a quit or crash, then starts the timers. */
  start(): void {
    this.writeWatchdogSettings()
    const n = this.tasks.recoverRunning()
    if (n) this.audit.write({ agent: 'Director', action: 'resume', detail: { requeued: n } })
    const every = Math.max(1, this.cfg.get().directorTickMinutes) * 60_000
    this.timers.push(setInterval(() => void this.tick().catch(() => {}), every))
    this.timers.push(setInterval(() => void this.maybePurge().catch(() => {}), 10 * 60_000))
    void this.tick().catch(() => {})
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }

  /** One Director pass, then run whatever is due. */
  async tick(): Promise<{ created: number; notes: string[] }> {
    if (this.ticking) return { created: 0, notes: ['A pass is already running.'] }
    this.ticking = true
    try {
      const r = this.director.tick()
      await this.runner.runUntilIdle()
      await this.social.tick()
      await this.tester.tick()
      await this.refreshGuidelines().catch(() => {})
      await this.maybeDigest().catch(() => {})
      await this.maybeBackup().catch(() => {})
      this.syncEpisodePosts()
      this.d.emit()
      return { created: r.created.length, notes: r.notes }
    } finally {
      this.ticking = false
    }
  }

  /** Moves an episode to Posted or Failed when the scheduler finishes its post. */
  syncEpisodePosts(): void {
    const rows = this.d.db
      .prepare(
        `SELECT e.id, p.status, p.scheduled_at_utc FROM episodes e JOIN posts p ON p.id = e.post_id
         WHERE e.status = 'Scheduled' AND p.status IN ('posted','failed','missed')`,
      )
      .all() as Array<{ id: string; status: string; scheduled_at_utc: string }>
    for (const r of rows) {
      if (r.status === 'posted') this.episodes.setStatus(r.id, 'Posted', undefined, { postedAtUtc: r.scheduled_at_utc })
      else this.episodes.setStatus(r.id, 'Failed', 'The scheduler could not post it.')
    }
  }

  /**
   * Once a month: ask the text agent to compare the thumbnail guidelines with the platforms' own current help pages and propose
   * changes. Small edits are applied automatically with a logged diff. Big ones wait as a proposal. No web, no refresh, and that is logged.
   */
  async refreshGuidelines(force = false): Promise<{ applied: boolean; note: string }> {
    const month = new Date(this.now()).toISOString().slice(0, 7)
    const last = this.readJson<string | null>('studio.lastGuidelineMonth', null)
    if (!force && last === month) return { applied: false, note: 'Already refreshed this month.' }
    this.writeJson('studio.lastGuidelineMonth', month)
    const skip = (note: string) => {
      this.audit.write({ agent: 'Thumbnail', action: 'guideline_refresh_skipped', detail: { note } })
      return { applied: false, note }
    }
    if (this.cfg.get().mockMode) return skip('Mock mode is on, so no web research was done.')
    const sources = ['https://support.google.com/youtube/answer/72431', 'https://support.google.com/youtube/answer/12294177']
    const pages: string[] = []
    for (const u of sources) {
      try {
        const res = await (this.d.fetchImpl ?? fetch)(u, { signal: AbortSignal.timeout(20_000) })
        if (res.ok) pages.push(`SOURCE ${u}\n${(await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000)}`)
      } catch {
        // an unreachable page is simply not used
      }
    }
    if (!pages.length) return skip('The platform help pages could not be reached, so the refresh was skipped.')
    const cur = this.guidelines.current()
    const out = await this.gateway.json(
      {
        agent: 'Thumbnail',
        system: 'You maintain thumbnail guidelines. Compare the current guidelines with the sources. Propose an updated guidelines document that keeps the same headings. Only change what the sources support. Never use an em dash. Answer only with JSON: {"text": "the full updated markdown", "changes": ["short note per change"]}.',
        user: `${'CTX {"task":"guideline_refresh"}'}\nCURRENT:\n${cur.text}\n\n${pages.join('\n\n')}`,
        maxTokens: 4000,
      },
      z.object({ text: z.string().min(20), changes: z.array(z.string()).default([]) }),
    )
    const diff = lineDiff(cur.text, out.text)
    const total = cur.text.split('\n').length
    const small = diff.added.length + diff.removed.length <= Math.max(4, total * 0.2)
    this.audit.write({ agent: 'Thumbnail', action: small ? 'guideline_refresh_applied' : 'guideline_refresh_proposed', detail: { added: diff.added.slice(0, 20), removed: diff.removed.slice(0, 20), changes: out.changes } })
    if (!small) {
      this.writeJson('studio.guidelineProposal', { text: out.text, changes: out.changes, at: new Date(this.now()).toISOString() })
      return { applied: false, note: 'The proposed change is large, so it is waiting for you in Settings, under the Studio tab.' }
    }
    this.guidelines.save(out.text, `Monthly refresh: ${out.changes.join('; ') || 'small edits'}`, 'refresh')
    return { applied: true, note: `Applied ${diff.added.length} added and ${diff.removed.length} removed lines.` }
  }

  /** The Archivist runs once a day at or after 3:00 AM Eastern. */
  async maybePurge(): Promise<void> {
    const today = todayEastern(this.now())
    const hour = Number(new Date(this.now()).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }))
    const last = this.d.db.prepare("SELECT value_json FROM settings WHERE key = 'studio.lastPurge'").get() as { value_json: string } | undefined
    if (hour < 3 || (last && JSON.parse(last.value_json) === today)) return
    this.d.db
      .prepare("INSERT INTO settings (key, value_json) VALUES ('studio.lastPurge', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json")
      .run(JSON.stringify(today))
    this.archivist.purge(false)
    this.calendarFeed.backfillPostedFolders()
    this.d.emit()
  }

  // ---------- comments, insights, digest, watchdog, backups ----------

  private commentSources(): Record<string, CommentSource> {
    if (this.cfg.get().mockMode) {
      for (const p of ['youtube', 'facebook', 'instagram', 'bluesky']) if (!this.mockComments.has(p)) this.mockComments.set(p, new MockCommentSource(p))
      return Object.fromEntries(this.mockComments)
    }
    return { ...(this.d.commentSources?.() ?? {}), bluesky: new BlueskyCommentSource((b) => this.socialAccounts.blueskyFor(b)) }
  }

  /** Videos posted in the last 14 days that can have comments. Mock mode includes the dry run ones. */
  private postedRefs(brandId: number): PostedRef[] {
    const mock = this.cfg.get().mockMode
    const cutoff = new Date(this.now() - 14 * 86_400_000).toISOString()
    const four = this.d.db
      .prepare(
        `SELECT p.brand_id, t.platform, t.external_id, t.account_id, e.id AS episode_id
         FROM post_targets t JOIN posts p ON p.id = t.post_id LEFT JOIN episodes e ON e.post_id = p.id LEFT JOIN accounts a ON a.id = t.account_id
         WHERE p.brand_id = ? AND t.status = 'posted' AND t.external_id IS NOT NULL AND t.platform IN ('youtube','facebook','instagram')
           AND COALESCE(t.posted_at_utc, p.scheduled_at_utc) >= ? ${mock ? '' : "AND COALESCE(a.mode, 'dry_run') != 'dry_run'"}`,
      )
      .all(brandId, cutoff) as Array<{ brand_id: number; platform: string; external_id: string; account_id: number | null; episode_id: string | null }>
    const social = this.d.db
      .prepare(`SELECT brand_id, platform, external_id, episode_id, state_json FROM social_posts WHERE brand_id = ? AND status = 'posted' AND external_id IS NOT NULL AND posted_utc >= ? ${mock ? '' : 'AND mock = 0'}`)
      .all(brandId, cutoff) as Array<{ brand_id: number; platform: string; external_id: string; episode_id: string | null; state_json: string }>
    return [
      ...four.map((r) => ({ brandId: r.brand_id, platform: r.platform, externalId: r.external_id, accountId: r.account_id, episodeId: r.episode_id, state: {} })),
      ...social.map((r) => ({ brandId: r.brand_id, platform: r.platform, externalId: r.external_id, accountId: null, episodeId: r.episode_id, state: JSON.parse(r.state_json) as Record<string, string> })),
    ]
  }

  /** Hook line and length of an episode, read from its package, for the analytics. */
  private episodeDetails(id: string): { hook: string; seconds: number } {
    const pkg = this.episodes.getPackage(id)
    return { hook: String((pkg?.extra?.hook as string | undefined) ?? pkg?.logline ?? ''), seconds: pkg?.runtime_target_seconds ?? 0 }
  }

  async commentList(filter: { brandId?: number | null; status?: string } = {}) {
    return this.comments.list({ brandId: filter.brandId, status: filter.status as never }).map((c) => ({ id: c.id, brandId: c.brandId, platform: c.platform, author: c.author, text: c.text, category: c.category, status: c.status, replyText: c.replyText, reason: c.reason, createdUtc: c.createdUtc }))
  }
  async runComments(brandId: number) {
    const r = await this.comments.pass(brandId)
    this.d.emit()
    return r
  }
  async approveComment(id: number, text?: string) {
    await this.comments.approveDraft(id, text)
    this.d.emit()
  }
  async discardComment(id: number) {
    this.comments.discard(id)
    this.d.emit()
  }
  async draftComment(id: number, text: string) {
    this.comments.draftFor(id, text)
    this.d.emit()
  }

  async insightsFor(brandId: number) {
    const st = this.analytics.stored(brandId)
    return { summary: st.summary, updatedUtc: st.updatedUtc, insights: st.insights }
  }
  async refreshInsights() {
    await this.retention.refreshRecent()
    const r = await this.analytics.daily((id) => this.episodeDetails(id))
    this.d.emit()
    return r
  }

  private expiringLines(): string[] {
    const lines = [...(this.d.expiring?.() ?? [])]
    return lines
  }
  async digestPreview() {
    return buildDigest({ db: this.d.db, cfg: this.cfg, spend: this.spend, expiring: () => this.expiringLines(), now: () => this.now() })
  }
  async sendDigest() {
    if (!this.d.broadcast) throw new Error('Messages are not available here.')
    await this.d.broadcast(await this.digestPreview())
  }

  /** Once a day at the set time (7:30 AM Eastern by default). */
  async maybeDigest(): Promise<void> {
    const c = this.cfg.get()
    if (!c.digestEnabled || c.paused || !this.d.broadcast) return
    const et = new Date(this.now()).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })
    const [h, m] = et.split(':').map(Number)
    const [dh, dm] = c.digestTime.split(':').map(Number)
    const today = todayEastern(this.now())
    if ((h % 24) * 60 + m < dh * 60 + (dm || 0) || this.readJson<string | null>('studio.lastDigest', null) === today) return
    this.writeJson('studio.lastDigest', today)
    await this.sendDigest()
    this.audit.write({ agent: 'Digest', action: 'sent' })
  }

  async watchdogInfo() {
    return this.watchdog.info()
  }
  async saveWatchdog(w: { enabled: boolean; runStart: string; runEnd: string; thresholdMinutes: number }) {
    this.cfg.set({ watchdog: w })
    this.writeWatchdogSettings()
    this.d.emit()
  }
  private writeWatchdogSettings() {
    const w = this.cfg.get().watchdog
    const phone = this.readJson<string>('alertIMessageNumber', '')
    const on = this.readJson<boolean>('alertIMessageEnabled', true)
    this.watchdog.writeSettings({ ...w, enabled: w.enabled && on, phone })
  }

  /** Called at the end of every Director pass: the heartbeat, and a notice if the Mac slept through a production time. */
  private heartbeat(): void {
    const now = this.now()
    const prev = this.lastTickMs || this.watchdog.lastBeatMs() || 0
    this.lastTickMs = now
    this.watchdog.beat(now)
    this.writeWatchdogSettings()
    const gap = (now - prev) / 60_000
    if (prev && gap > this.cfg.get().watchdog.thresholdMinutes) this.sleptThrough(prev, now)
  }

  private sleptThrough(prevMs: number, nowMs: number): void {
    for (const b of this.cfg.listBrandConfigs()) {
      const c = b.config
      if (c.paused || !(c.path === 'auto' || (c.format === 'long' && c.hollowViaApi))) continue
      const [rh, rm] = c.runTime.split(':').map(Number)
      for (let day = todayEastern(prevMs); day <= todayEastern(nowMs); day = addDays(day, 1)) {
        const at = new Date(slotToUtc(day, `${rh}:${String(rm || 0).padStart(2, '0')}`)).getTime()
        if (at <= prevMs || at > nowMs) continue
        const ready = this.d.db.prepare("SELECT COUNT(*) AS n FROM episodes WHERE brand_id = ? AND status = 'Ready for production'").get(b.brandId) as { n: number }
        const key = `slept:${b.brandId}:${day}`
        if (!ready.n || this.d.db.prepare("SELECT 1 FROM audit_log WHERE agent = 'Watchdog' AND detail_json LIKE ?").get(`%${key}%`)) continue
        this.audit.write({ agent: 'Watchdog', action: 'slept_through', brandId: b.brandId, detail: { key } })
        this.d.alert('The Mac slept through a production time.', `${b.name}: the ${c.runTime} production window passed while the Mac was asleep or off. It is catching up now.`)
      }
    }
  }

  async backupList() {
    return this.backups.list()
  }
  async backupNow() {
    const r = await this.backups.run()
    this.d.emit()
    return r
  }
  async restoreLibrary(libraryZip: string) {
    const n = this.backups.restoreLibrary(libraryZip)
    this.d.emit()
    return n
  }
  async maybeBackup(): Promise<void> {
    const et = Number(new Date(this.now()).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }))
    const today = todayEastern(this.now())
    if (et < 2 || this.readJson<string | null>('studio.lastBackup', null) === today) return
    this.writeJson('studio.lastBackup', today)
    await this.backups.run()
  }

  // ---------- bible, ideas, holidays, agents ----------

  async bible(brandId: number) {
    const b = this.bibles.get(brandId)
    return { ...b, markdown: this.bibles.markdown(brandId) }
  }
  async setBible(brandId: number, patch: Parameters<StudioApi['setBible']>[1]) {
    const r = this.bibles.set(brandId, patch)
    this.d.emit()
    return r
  }
  async importSkill(brandId: number, name: string, text: string) {
    this.bibles.addSkill(brandId, name, text)
    this.d.emit()
    return this.bibles.skills(brandId)
  }
  async updateSkill(brandId: number, id: number, text: string) {
    this.bibles.updateSkill(id, text)
    return this.bibles.skills(brandId)
  }
  async removeSkill(brandId: number, id: number) {
    this.bibles.removeSkill(id)
    this.d.emit()
    return this.bibles.skills(brandId)
  }
  async exportBible(brandId: number) {
    return this.bibles.markdown(brandId)
  }
  async ideas(brandId: number) {
    return this.bibles.ideas(brandId).map(({ id, text, used }) => ({ id, text, used }))
  }
  async addIdeas(brandId: number, texts: string[]) {
    this.bibles.addIdeas(brandId, texts)
    return this.ideas(brandId)
  }
  async removeIdea(brandId: number, id: number) {
    this.bibles.removeIdea(id)
    return this.ideas(brandId)
  }
  async holidays(fromIso?: string, toIso?: string) {
    return this.holidayList.list(fromIso, toIso)
  }
  async addHoliday(date: string, name: string, kind?: string) {
    this.holidayList.add(date, name, kind)
    return this.holidayList.list()
  }
  async setHolidayEnabled(id: number, enabled: boolean) {
    this.holidayList.setEnabled(id, enabled)
  }
  async removeHoliday(id: number) {
    this.holidayList.remove(id)
  }
  async agents() {
    const c = this.cfg.get()
    const defs: Array<[string, string, boolean]> = [
      ['Director', 'Wakes on a timer, plans every brand, and never writes content.', true],
      ['Show Writer', 'Writes the idea, script and video prompts, one instance per brand.', true],
      [this.scriptQc.name, this.scriptQc.role, true],
      [this.math.name, this.math.role, true],
      [this.safety.name, this.safety.role, true],
      ['Repetition Guard', 'Compares a new idea with every earlier episode.', false],
      ['Producer', 'Makes the video through the xAI Grok Imagine API and assembles it.', true],
      ['Video QC', 'Checks every clip, cheapest check first, and decides pass or retry.', true],
      [this.compliance.name, this.compliance.role, false],
      ['Thumbnail', 'Designs and scores a thumbnail or cover for every platform.', false],
      ['Publisher', 'Writes the text for every platform and schedules everywhere.', true],
      [this.comments.name, this.comments.role, true],
      [this.analytics.name, this.analytics.role, true],
      ['Assistant', 'Answers your questions from your phone (Telegram). Uses your local text model when one is set.', false],
      ['Archivist', 'Removes old videos and keeps packages and stats forever.', false],
    ]
    return defs.map(([name, role, toggleable]) => ({ name, role, model: c.agentModels[name] || c.defaultAgentModel, isDefault: !c.agentModels[name], enabled: !c.disabledAgents.includes(name), toggleable }))
  }
  async setAgentEnabled(name: string, enabled: boolean) {
    const cur = new Set(this.cfg.get().disabledAgents)
    if (enabled) cur.delete(name)
    else cur.add(name)
    this.cfg.set({ disabledAgents: [...cur] })
    this.runner.setDisabled([...cur])
    this.audit.write({ agent: 'Owner', action: enabled ? 'agent_on' : 'agent_off', detail: { name } })
    this.d.emit()
    return this.agents()
  }
  /** One chat answer for the phone assistant, from the owner's local text model when there is one. */
  async makeClips(episodeId: string, count: number) {
    const made = await this.clipCutter.make(episodeId, count)
    this.d.emit()
    return made
  }
  async repostCandidates(brandId?: number | null) {
    return this.reposts.candidates(brandId)
  }
  async queueRepost(postId: number, platforms: string[]) {
    const r = await this.reposts.queue(postId, platforms)
    this.d.emit()
    return r
  }
  async skipRepost(postId: number) {
    this.reposts.skip(postId)
  }
  async makeChapters(episodeId: string) {
    return this.captionSvc.makeChapters(episodeId)
  }
  async chaptersFor(episodeId: string) {
    const c = this.captionSvc.chapters(episodeId)
    return c.length ? chaptersText(c) : null
  }
  async makeCaptions(episodeId: string, languages: string[]) {
    return this.captionSvc.makeCaptions(episodeId, languages)
  }
  async captionList(episodeId: string) {
    return this.captionSvc.captions(episodeId)
  }
  async exportCaptions(episodeId: string) {
    const dir = this.captionSvc.exportFiles(episodeId)
    await this.d.openPath?.(dir)
    return dir
  }
  /** Adds the caption tracks to the live YouTube video. 400 YouTube points per language. */
  async uploadCaptions(episodeId: string) {
    const ep = this.episodes.find(episodeId)
    if (!ep?.postId) throw new Error('This episode has not been posted yet.')
    const t = this.d.db.prepare("SELECT t.external_id, t.account_id, t.settings_json, a.mode FROM post_targets t LEFT JOIN accounts a ON a.id = t.account_id WHERE t.post_id = ? AND t.platform = 'youtube' AND t.status = 'posted'").get(ep.postId) as { external_id: string | null; account_id: number | null; settings_json: string | null; mode: string | null } | undefined
    if (!t?.external_id) throw new Error('This episode is not live on YouTube yet.')
    const tracks = this.captionSvc.captions(episodeId)
    if (!tracks.length) throw new Error('Make the captions first.')
    const fake = (() => { try { return (JSON.parse(t.settings_json ?? '{}') as { mock?: boolean }).mock === true } catch { return false } })()
    if (this.cfg.get().mockMode || fake || t.mode === 'dry_run' || t.account_id === null || !this.d.uploadCaption) return { uploaded: 0, note: 'This is a test or mock video, so nothing was sent to YouTube.' }
    for (const c of tracks) await this.d.uploadCaption(t.account_id, t.external_id, c.lang, c.name, this.captionSvc.srt(episodeId, c.lang) ?? '')
    return { uploaded: tracks.length, note: `Added ${tracks.length} caption track${tracks.length === 1 ? '' : 's'} to the video.` }
  }
  async retentionFor(postId: number) {
    return this.retention.get(postId)
  }
  async refreshRetention(postId: number) {
    return this.retention.refresh(postId)
  }
  async titleLab(brandId: number, topic: string, includeTop: boolean) {
    return this.research.titleLab(brandId, topic, includeTop)
  }
  async competitors(brandId: number) {
    return this.research.competitors(brandId)
  }
  async addCompetitor(brandId: number, input: string) {
    return this.research.addCompetitor(brandId, input)
  }
  async removeCompetitor(brandId: number, id: number) {
    this.research.removeCompetitor(id)
    return this.research.competitors(brandId)
  }
  async refreshCompetitors(brandId: number) {
    return this.research.refreshCompetitors(brandId)
  }
  async trends(brandId: number) {
    return this.research.trends(brandId)
  }
  async refreshTrends(brandId: number) {
    return this.research.refreshTrends(brandId)
  }
  async ideasFromResearch(brandId: number) {
    const ideas = await this.research.ideasFromResearch(brandId)
    this.d.emit()
    return ideas
  }
  async assistantAsk(system: string, user: string): Promise<string> {
    const c = this.cfg.get()
    const model = !c.agentModels['Assistant'] && c.local.textModel ? `ollama:${c.local.textModel}` : undefined
    const r = await this.gateway.call({ agent: 'Assistant', system, user, maxTokens: 800, model })
    return r.text
  }

  async modelOptions() {
    const c = this.cfg.get()
    let names: string[] = []
    let localError: string | null = null
    if (c.local.ollamaHost) {
      try {
        names = await this.localAi.ollama.models()
      } catch (e) {
        localError = `Could not reach Ollama at ${c.local.ollamaHost}.`
        void e
      }
    }
    return {
      options: buildModelOptions(c.prices.anthropicModels, { inPerM: c.prices.anthropicInPerM, outPerM: c.prices.anthropicOutPerM }, names),
      localOnline: !localError && !!c.local.ollamaHost,
      localError,
    }
  }
  async setModelPrice(model: string, inPerM: number, outPerM: number) {
    if (!(inPerM >= 0) || !(outPerM >= 0)) throw new Error('A price cannot be negative.')
    this.cfg.set({ prices: { anthropicModels: { ...this.cfg.get().prices.anthropicModels, [model]: { inPerM, outPerM } } } } as never)
    this.d.emit()
  }
  async setAgentModel(name: string, model: string) {
    this.cfg.set({ agentModels: { ...this.cfg.get().agentModels, [name]: model.trim() } })
    return this.agents()
  }
  /** Asks the Writer for an episode right now, for a date (default: the next free posting date). */
  async writeNow(brandId: number, slotDate?: string) {
    const b = this.cfg.getBrand(brandId)
    const date = slotDate ?? nextDue(b, todayEastern(this.now())) ?? addDays(todayEastern(this.now()), 1)
    const t = this.tasks.create({ type: 'write_episode', brandId, payload: { slotDate: date }, dedupeKey: `write:${brandId}:${date}` })
    void this.runner.runUntilIdle().then(() => this.d.emit())
    return { taskId: t.id }
  }

  // ---------- thumbnails, social, caps ----------

  async guidelineInfo() {
    return {
      current: this.guidelines.current(),
      history: this.guidelines.history(),
      proposal: this.readJson<{ text: string; changes: string[]; at: string } | null>('studio.guidelineProposal', null),
    }
  }
  async saveGuidelines(text: string, note: string) {
    return this.guidelines.save(text, note || 'Edited by the owner.', 'owner')
  }
  async revertGuidelines(id: number) {
    return this.guidelines.revert(id)
  }
  async approveGuidelineProposal() {
    const p = this.readJson<{ text: string; changes: string[] } | null>('studio.guidelineProposal', null)
    if (!p) return null
    this.writeJson('studio.guidelineProposal', null)
    return this.guidelines.save(p.text, `Approved proposal: ${p.changes.join('; ')}`, 'refresh')
  }
  async socialPosts(episodeId?: string) {
    return this.social.list({ episodeId }).map((r) => ({ id: r.id, episodeId: r.episodeId, platform: r.platform, status: r.status, text: r.text, title: r.title, scheduledAtUtc: r.scheduledAtUtc, attempts: r.attempts, externalUrl: r.externalUrl, error: r.error, mock: r.mock }))
  }
  async retrySocial(id: number) {
    this.social.retry(id)
    this.d.emit()
  }
  async thumbTests() {
    const tests = this.d.db.prepare('SELECT * FROM thumb_tests ORDER BY rowid DESC LIMIT 50').all() as Array<{ episode_id: string; state: string; note: string | null }>
    return tests.map((t) => ({
      episodeId: t.episode_id,
      state: t.state,
      note: t.note,
      variants: (this.d.db.prepare('SELECT * FROM thumb_variants WHERE episode_id = ? ORDER BY id').all(t.episode_id) as Array<any>).map((v) => ({ variant: v.variant, headline: v.headline, score: v.score, ctr: v.ctr, impressions: v.impressions, winner: !!v.winner, file: v.file_path })),
    }))
  }
  async runThumbTests() {
    await this.tester.tick()
    this.d.emit()
  }
  async platformCaps() {
    const { DEFAULT_PLATFORM_CAPS } = await import('@shared/studio/platformCaps')
    const over = this.cfg.get().platformCaps
    return Object.fromEntries(Object.entries(DEFAULT_PLATFORM_CAPS).map(([k, v]) => [k, { ...v, ...((over[k] as object) ?? {}) }]))
  }
  async publicHostStatus() {
    return { configured: this.host.configured() }
  }
  // ---------- Bluesky accounts, one per brand ----------

  async socialAccountList(): Promise<BrandSocialView[]> {
    return this.socialAccounts.status()
  }
  async saveBluesky(brandId: number, handle: string, password: string) {
    this.socialAccounts.saveBluesky(brandId, handle, password)
    this.d.emit()
  }
  async removeBluesky(brandId: number) {
    this.socialAccounts.removeBluesky(brandId)
    this.d.emit()
  }
  async testBluesky(brandId: number): Promise<TestResult> {
    if (this.cfg.get().mockMode) return { ok: true, message: 'Mock mode is on, so no network call was made. Turn mock mode off to test for real.' }
    const r = await this.socialAccounts.testBluesky(brandId)
    this.d.emit()
    return r
  }

  // ---------- production ----------

  async assetList(brandId: number) {
    return this.assets.list(brandId).map((a) => ({ id: a.id, kind: a.kind, path: a.path, name: a.path.split('/').pop() ?? a.path, prompt: a.prompt }))
  }
  async addAsset(brandId: number, kind: Parameters<StudioApi['addAsset']>[1], path: string) {
    this.assets.add(brandId, kind, path)
    this.d.emit()
    return this.assetList(brandId)
  }
  async removeAsset(brandId: number, id: number) {
    this.assets.remove(id)
    this.d.emit()
    return this.assetList(brandId)
  }

  /** Generates the shared opening or outro once. Every later episode reuses the file at no cost. */
  async generateSlot(brandId: number, kind: 'opening' | 'outro', prompt: string) {
    const cfg = this.cfg.get()
    const brand = this.cfg.getBrand(brandId)
    const mock = cfg.mockMode
    const tier = cfg.formatModel[brand.format]
    const seconds = 5
    const price = cfg.prices.video[tier][brand.resolution]
    const dollars = seconds * price
    this.spend.check({ brandId, vendor: 'xai', dollars, mock })
    const client = mock ? this.mockVideo : this.xai
    const { requestId } = await client.start({ model: cfg.modelIds[tier], prompt, durationSeconds: seconds, resolution: brand.resolution, aspectRatio: brand.format === 'short' ? '9:16' : '16:9' })
    this.spend.record({ brandId, vendor: 'xai', model: cfg.modelIds[tier], resolution: brand.resolution, units: seconds, unitKind: 'seconds', unitPrice: price, dollars, requestId, purpose: kind === 'opening' ? 'intro' : 'outro', mock })
    for (let i = 0; i < 120; i++) {
      const st = await client.poll(requestId)
      if (st.status === 'done') {
        const dir = mkdtempSync(join(tmpdir(), 'elo-slot-'))
        try {
          const f = join(dir, `${kind}.mp4`)
          await client.download(st.url, f)
          this.assets.add(brandId, kind, f, prompt)
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
        this.d.emit()
        return { dollars, mock }
      }
      if (st.status !== 'pending') throw new Error(st.status === 'failed' ? st.error : 'The request expired. Try again.')
      await new Promise((r) => setTimeout(r, mock ? 20 : 5000))
    }
    throw new Error('Timed out waiting for the clip.')
  }

  async clipLog(episodeId: string) {
    return this.jobs.all(episodeId).map((j) => ({ id: j.id, clipN: j.clipN, take: j.take, status: j.status, purpose: j.purpose, prompt: j.prompt, generateSeconds: j.generateSeconds, requestId: j.requestId, filePath: j.filePath, error: j.error, qc: j.qc }))
  }

  /** Flagged screen actions for one clip. */
  async resolveClip(episodeId: string, clipN: number, action: 'approve' | 'regenerate' | 'edit' | 'discard', prompt?: string) {
    const jobs = this.jobs.all(episodeId).filter((j) => j.clipN === clipN)
    const last = jobs[jobs.length - 1]
    if (!last) throw new Error(`Clip ${clipN} has no jobs.`)
    const ep = this.episodes.get(episodeId)
    const task = this.tasks.list({ type: 'produce_episode' }).find((t) => t.episodeId === episodeId || (t.payload as { episodeId?: string }).episodeId === episodeId)
    if (action === 'discard') {
      this.jobs.update(last.id, { status: 'discarded' })
      this.episodes.setStatus(episodeId, 'Archived', 'Discarded by the owner.')
      if (task) this.tasks.setStatus(task.id, 'failed', { error: 'Discarded by the owner.' })
    } else if (action === 'approve') {
      if (!last.filePath) throw new Error('This clip has no video to approve. Regenerate it instead.')
      this.jobs.update(last.id, { status: 'approved' })
    } else {
      const text = action === 'edit' ? (prompt ?? '').trim() : last.prompt
      if (!text) throw new Error('Type the new prompt first.')
      this.jobs.update(last.id, { status: 'failed', error: last.error ?? 'Replaced by the owner.' })
      this.jobs.plan({ episodeId, brandId: ep.brandId, clipN, take: last.take + 1, prompt: text, model: last.model, resolution: last.resolution, aspect: last.aspect, generateSeconds: last.generateSeconds, keepSeconds: last.keepSeconds, purpose: 'retry' })
    }
    if (task && action !== 'discard') this.tasks.reopen(task.id)
    this.audit.write({ agent: 'Owner', action: `clip_${action}`, brandId: ep.brandId, episodeId, detail: { clip: clipN } })
    this.d.emit()
    if (action !== 'discard') void this.runner.runUntilIdle().then(() => this.d.emit())
  }

  async produceNow(episodeId: string) {
    const ep = this.episodes.get(episodeId)
    const t = this.tasks.create({ type: 'produce_episode', brandId: ep.brandId, episodeId, payload: { episodeId }, dedupeKey: `produce:${episodeId}` })
    void this.runner.runUntilIdle().then(() => this.d.emit())
    return { taskId: t.id }
  }

  // ---------- config ----------

  async getConfig() {
    return this.cfg.get()
  }
  async setConfig(patch: Parameters<StudioApi['setConfig']>[0]) {
    const before = this.cfg.get().local
    const c = this.cfg.set(patch)
    // A new host address or model name means the speeds and the checklist may have changed, so the self test runs again by itself.
    const l = c.local
    if (patch.local && (l.ollamaHost !== before.ollamaHost || l.visionModel !== before.visionModel || l.embedModel !== before.embedModel || l.whisperMode !== before.whisperMode || l.whisperHost !== before.whisperHost || l.whisperCommand !== before.whisperCommand)) {
      this.audit.write({ agent: 'Local AI', action: 'self_test_auto', detail: { host: l.ollamaHost, vision: l.visionModel, embed: l.embedModel } })
      void this.localAi.selfTest().then(() => this.d.emit()).catch(() => {})
    }
    this.d.emit()
    return c
  }
  async setFormatModel(format: Parameters<StudioApi['setFormatModel']>[0], tier: Parameters<StudioApi['setFormatModel']>[1], checked: boolean) {
    const c = this.cfg.setFormatModel(format, tier, checked)
    this.d.emit()
    return c
  }
  async setMockMode(on: boolean) {
    const c = this.cfg.set({ mockMode: on })
    this.audit.write({ agent: 'Director', action: on ? 'mock_on' : 'mock_off' })
    this.d.emit()
    return c
  }
  async pauseAll(paused: boolean) {
    this.cfg.set({ paused })
    this.audit.write({ agent: 'Director', action: paused ? 'pause_all' : 'resume_all' })
    this.d.emit()
  }

  async brands(): Promise<BrandStudioRow[]> {
    const today = todayEastern(this.now())
    return this.cfg.listBrandConfigs().map((b) => {
      const horizon = addDays(today, b.config.runwayDays)
      const dates = dueDates(b.config, today, horizon)
      const covered = dates.filter((d) =>
        this.d.db
          .prepare("SELECT 1 FROM episodes WHERE brand_id = ? AND slot_date = ? AND status NOT IN ('Failed','Archived')")
          .get(b.brandId, d),
      ).length
      return { ...b, nextDue: nextDue(b.config, today), runwayCovered: covered }
    })
  }

  async setBrand(brandId: number, patch: Partial<StudioBrandConfig>) {
    const c = this.cfg.setBrand(brandId, patch)
    this.d.emit()
    return c
  }
  async cadenceWhatIf(brandId: number, n: number) {
    return this.cfg.cadenceWhatIf(brandId, n)
  }
  async estimate(brandId: number) {
    const b = this.cfg.getBrand(brandId)
    return typicalEpisodeEstimate(this.cfg.get(), b)
  }

  async overview(): Promise<StudioOverview> {
    const c = this.cfg.get()
    return {
      mockMode: c.mockMode,
      paused: c.paused,
      openFlags: this.tasks.list({ status: ['flagged', 'stopped'] }).length,
      queued: this.tasks.list({ status: 'queued' }).length,
      running: this.tasks.list({ status: 'running' }).length,
      brands: await this.brands(),
      libraryEpisodes: this.episodes.count(),
      libraryBytes: this.episodes.packageBytes(),
    }
  }

  // ---------- keys ----------

  private readJson<T>(key: string, fallback: T): T {
    const r = this.d.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined
    try {
      return r ? (JSON.parse(r.value_json) as T) : fallback
    } catch {
      return fallback
    }
  }
  private writeJson(key: string, v: unknown) {
    this.d.db
      .prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
      .run(key, JSON.stringify(v))
  }

  async keyStatus(): Promise<KeyStatus[]> {
    const tests = this.readJson<Record<string, { ok: boolean; message: string; at: string }>>(TESTS_KEY, {})
    const accounts = this.readJson<Record<string, string>>(ACCOUNTS_KEY, {})
    return (Object.keys(KEY_NAMES) as KeyId[]).map((id) => {
      const v = this.d.secrets.has(KEY_NAMES[id].secret) ? this.d.secrets.get(KEY_NAMES[id].secret) : null
      const t = tests[id]
      return {
        id,
        label: KEY_NAMES[id].label,
        has: !!v,
        masked: v ? mask(v) : '',
        account: accounts[id] ?? '',
        state: !v ? 'not_set' : !t ? 'untested' : t.ok ? 'connected' : 'failed',
        lastTestAt: t?.at ?? null,
        lastMessage: t?.message ?? '',
      }
    })
  }

  async setKey(id: KeyId, value: string, account?: string) {
    const clean = value.trim()
    if (!clean) throw new Error('Paste the key first.')
    this.d.secrets.set(KEY_NAMES[id].secret, clean)
    if (account !== undefined) this.writeJson(ACCOUNTS_KEY, { ...this.readJson<Record<string, string>>(ACCOUNTS_KEY, {}), [id]: account.trim() })
    const tests = this.readJson<Record<string, unknown>>(TESTS_KEY, {})
    delete tests[id]
    this.writeJson(TESTS_KEY, tests)
    this.audit.write({ agent: 'Settings', action: 'key_saved', detail: { key: id } })
    this.d.emit()
    return this.keyStatus()
  }

  async removeKey(id: KeyId) {
    this.d.secrets.delete(KEY_NAMES[id].secret)
    const tests = this.readJson<Record<string, unknown>>(TESTS_KEY, {})
    delete tests[id]
    this.writeJson(TESTS_KEY, tests)
    this.audit.write({ agent: 'Settings', action: 'key_removed', detail: { key: id } })
    this.d.emit()
    return this.keyStatus()
  }

  /** A cheap, harmless authenticated call. Shows plain success or the plain error. Mock mode makes no network call. */
  async testKey(id: KeyId): Promise<TestResult> {
    if (!this.d.secrets.has(KEY_NAMES[id].secret)) return { ok: false, message: 'No key is saved yet.' }
    let result: TestResult
    if (this.cfg.get().mockMode) {
      result = { ok: true, message: 'Mock mode is on, so no network call was made. Turn mock mode off to test the real key.' }
      return result
    }
    try {
      if (id === 'xai') result = { ok: true, message: await this.xai.test() }
      else if (id === 'anthropic') result = { ok: true, message: await this.anthropic.test() }
      else if (id === 'telegram') result = { ok: true, message: 'Saved. Press Test the bot in Settings, Alerts and backup.' }
      else result = { ok: true, message: 'Saved. The two R2 keys are used when a cover picture is uploaded.' }
    } catch (e) {
      result = { ok: false, message: (e as Error).message }
    }
    const tests = this.readJson<Record<string, unknown>>(TESTS_KEY, {})
    tests[id] = { ...result, at: new Date(this.now()).toISOString() }
    this.writeJson(TESTS_KEY, tests)
    this.d.emit()
    return result
  }

  // ---------- spend ----------

  async episodeCost(episodeId: string) {
    return this.spend.episodeCost(episodeId)
  }
  async spendSummary() {
    return this.spend.summary()
  }
  async spendRecent(limit = 50) {
    return this.spend.recent(limit)
  }
  async spendCsv() {
    return this.spend.exportCsv()
  }

  // ---------- library ----------

  async episodeList(filter: Parameters<StudioApi['episodeList']>[0] = {}) {
    return this.episodes.list(filter)
  }

  async episode(id: string): Promise<EpisodeDetail> {
    const row = this.episodes.get(id)
    return {
      row,
      pkg: this.episodes.getPackage(id),
      spend: this.spend.forEpisode(id),
      videoUrl: row.videoPath && existsSync(row.videoPath) ? row.videoPath : null,
    }
  }
  async setEpisodeStatus(id: string, status: Parameters<StudioApi['setEpisodeStatus']>[1], note?: string) {
    const r = this.episodes.setStatus(id, status, note)
    this.d.emit()
    return r
  }
  async duplicateEpisode(id: string) {
    const r = this.episodes.duplicate(id)
    this.d.emit()
    return r
  }
  async exportEpisode(id: string) {
    return this.episodes.exportJson(id)
  }

  // ---------- calendar and retention ----------

  async calendar(filter: Parameters<StudioApi['calendar']>[0]) {
    return this.calendarFeed.items(filter)
  }
  async backfillPosted() {
    const n = this.calendarFeed.backfillPostedFolders()
    this.d.emit()
    return n
  }
  async purge(dryRun: boolean): Promise<PurgeReportView> {
    const r = this.archivist.purge(dryRun)
    this.d.emit()
    return {
      dryRun: r.dryRun,
      cutoffUtc: r.cutoffUtc,
      count: r.items.length,
      bytes: r.bytes,
      items: r.items.map((i) => ({ postId: i.postId, title: i.title, postedAtUtc: i.postedAtUtc, files: i.files })),
    }
  }

  // ---------- director ----------

  async directorTick() {
    return this.tick()
  }
  async taskList(filter: { status?: string; brandId?: number | null } = {}) {
    return this.tasks.list({ status: filter.status as never, brandId: filter.brandId ?? undefined })
  }
  async auditLog(filter: Parameters<StudioApi['auditLog']>[0] = {}) {
    return this.audit.list(filter)
  }
  async flagged() {
    return this.tasks.list({ status: ['flagged', 'stopped'] }).map((task) => ({
      task,
      episode: task.episodeId ? this.episodes.find(task.episodeId) : null,
    }))
  }
  /** Throws the old script away and writes it again from the current bible. Episodes with a video are never rebuilt. */
  async rebuildEpisode(id: string, note = '') {
    const ep = this.episodes.find(id)
    if (!ep) throw new Error('That episode was not found.')
    if (!REBUILDABLE.includes(ep.status) || ep.videoPath)
      throw new Error('That episode already has a video or is on its way to posting, so it will not be rebuilt. Make a new episode instead.')
    const open = this.tasks.list({ status: ['queued', 'running', 'waiting', 'flagged', 'stopped'] }).filter((t) => t.episodeId === id)
    if (open.some((t) => t.status === 'running')) throw new Error('That episode is being worked on right now. Try again in a minute.')
    for (const t of open) this.tasks.setStatus(t.id, 'failed', { error: 'Replaced by a rebuild.' })
    this.episodes.setStatus(id, 'Idea', 'Rebuilt at the owner\'s request.')
    this.audit.write({ agent: 'Director', action: 'owner_rebuild_episode', brandId: ep.brandId, episodeId: id, detail: { note } })
    const t = this.tasks.create({
      type: 'write_episode',
      brandId: ep.brandId,
      episodeId: id,
      payload: { slotDate: ep.slotDate ?? undefined, episodeId: id, note: note.slice(0, 600) },
      dedupeKey: `rebuild:${id}:${this.now()}`,
    })
    void this.runner.runUntilIdle().then(() => this.d.emit())
    this.d.emit()
    return { taskId: t.id }
  }

  /** Opens the folder holding a brand's episode scripts or finished videos in Finder. */
  async openBrandFolder(brandId: number, kind: 'scripts' | 'videos') {
    if (!this.d.openPath) throw new Error('Opening folders is not available here.')
    const name = this.cfg.listBrandConfigs().find((b) => b.brandId === brandId) ? (await this.brands()).find((b) => b.brandId === brandId)?.name : null
    if (!name) throw new Error('That channel was not found.')
    const dir = kind === 'scripts' ? join(this.episodes.root(), slug(name)) : join(this.d.mediaRoot?.() ?? '', name)
    mkdirSync(dir, { recursive: true })
    await this.d.openPath(dir)
    return dir
  }

  async directorChat(message: string, history: Array<{ who: 'you' | 'director'; text: string }> = []) {
    const text = message.trim().slice(0, 1500)
    if (!text) throw new Error('Type a message first.')
    const ov = await this.overview()
    const flagged = (await this.flagged()).slice(0, 12)
    const recent = this.audit.list({}).slice(0, 10)
    const brandName = (id: number | null) => ov.brands.find((b) => b.brandId === id)?.name ?? 'none'
    const snapshot = [
      `Mock mode: ${ov.mockMode ? 'on' : 'off'}. Whole studio paused: ${ov.paused ? 'yes' : 'no'}. Open flags: ${ov.openFlags}. Queued: ${ov.queued}. Running: ${ov.running}.`,
      'Channels:',
      ...ov.brands.map((b) => `- id ${b.brandId}: ${b.name}, ${b.config.paused ? 'paused' : 'active'}, next due ${b.nextDue ?? 'none'}, runway ${b.runwayCovered} days`),
      'Flagged tasks:',
      ...(flagged.length ? flagged.map(({ task }) => `- ${task.type} for ${brandName(task.brandId)}: ${(task.error ?? '').slice(0, 140)}`) : ['- none']),
      'Episodes that can still be rebuilt (no video yet), newest first:',
      ...ov.brands.flatMap((b) =>
        this.episodes
          .list({ brandId: b.brandId, limit: 40 })
          .filter((e) => REBUILDABLE.includes(e.status) && !e.videoPath)
          .slice(0, 12)
          .map((e) => `- ${e.id}: ${b.name} episode ${e.number}, "${e.title}", ${e.status}${e.slotDate ? ', due ' + e.slotDate : ''}`),
      ),
      'Recent Director log:',
      ...recent.map((a) => `- ${a.agent} ${a.action}`),
    ].join('\n')
    const r = await this.gateway.json(
      { agent: 'Director', system: directorSystem(snapshot), user: [...history.slice(-6).map((m) => `${m.who === 'you' ? 'Owner' : 'Director'}: ${m.text.slice(0, 600)}`), `Owner: ${text}`].join('\n'), maxTokens: 2000 },
      DirectorReply,
    )
    const ids = new Set(ov.brands.map((b) => b.brandId))
    return {
      reply: r.reply,
      actions: r.actions.filter((a) => (['pause_all', 'resume_all', 'retry_flagged'].includes(a.kind) || (a.kind === 'rebuild_episode' ? !!a.episodeId && !!this.episodes.find(a.episodeId) : a.brandId != null && ids.has(a.brandId)))).slice(0, 5),
    }
  }

  async directorApply(action: DirectorActionView) {
    const { kind, brandId, text } = action
    if (kind === 'pause_all' || kind === 'resume_all') {
      await this.pauseAll(kind === 'pause_all')
      return kind === 'pause_all' ? 'Everything is paused.' : 'Everything is running.'
    }
    if (kind === 'retry_flagged') {
      const list = await this.flagged()
      for (const { task } of list) await this.resolveFlag(task.id, 'retry')
      return `Retrying ${list.length} flagged task(s).`
    }
    if (kind === 'rebuild_episode') {
      if (!action.episodeId) throw new Error('There is no episode to rebuild.')
      await this.rebuildEpisode(action.episodeId, text)
      return 'Rebuilding that episode now.'
    }
    if (brandId == null || !this.cfg.listBrandConfigs().some((b) => b.brandId === brandId)) throw new Error('That channel was not found.')
    this.audit.write({ agent: 'Director', action: `owner_${kind}`, brandId })
    if (kind === 'pause_brand' || kind === 'resume_brand') {
      await this.setBrand(brandId, { paused: kind === 'pause_brand' })
      return kind === 'pause_brand' ? 'That channel is paused.' : 'That channel is running.'
    }
    if (kind === 'add_idea') {
      if (!text.trim()) throw new Error('There is no idea text.')
      await this.addIdeas(brandId, [text.trim().slice(0, 300)])
      return 'Idea added to the bank.'
    }
    if (kind === 'rebuild_pending') {
      const todo = this.episodes.list({ brandId, limit: 200 }).filter((e) => REBUILDABLE.includes(e.status) && !e.videoPath)
      let n = 0
      for (const e of todo) {
        try {
          await this.rebuildEpisode(e.id, text)
          n++
        } catch {
          // An episode that is being written right now is skipped.
        }
      }
      return `Rebuilding ${n} episode(s) with the updated bible.`
    }
    await this.writeNow(brandId)
    return 'Writing started.'
  }

  async resolveFlag(taskId: number, action: 'retry' | 'discard' | 'approve') {
    const t = this.tasks.get(taskId)
    if (!t) throw new Error('Task not found.')
    if (action === 'retry') this.tasks.reopen(taskId)
    else if (action === 'discard') {
      this.tasks.setStatus(taskId, 'failed', { error: 'Discarded by the owner.' })
      if (t.episodeId) this.episodes.setStatus(t.episodeId, 'Archived', 'Discarded by the owner.')
    } else {
      this.tasks.setStatus(taskId, 'done', { result: { approvedByOwner: true } })
      if (t.episodeId) this.episodes.setStatus(t.episodeId, 'Ready for production', 'Approved as is by the owner.')
    }
    this.audit.write({ agent: 'Owner', action: `flag_${action}`, taskId, brandId: t.brandId, episodeId: t.episodeId })
    this.d.emit()
  }

  /**
   * Dry run day: walks the next 24 hours and says what the Director would do, hour by hour, with the money it would use.
   * Nothing is created, started or sent.
   */
  async dryRunDay(): Promise<string[]> {
    const lines = this.director.simulate(this.now(), 24)
    lines.push('')
    for (const b of this.cfg.listBrandConfigs()) {
      const est = typicalEpisodeEstimate(this.cfg.get(), b.config)
      lines.push(`${b.name}: next due ${nextDue(b.config, todayEastern(this.now())) ?? 'none'}, about $${est.firstPass.toFixed(2)} per episode (worst case $${est.worstCase.toFixed(2)}).`)
    }
    lines.push(this.cfg.get().paused ? 'Note: everything is paused right now, so nothing would actually run.' : 'Nothing was started. This was only a look ahead.')
    return lines
  }

  /** One real 480p Lite 3 second clip, to see a real cost. In mock mode it makes a mock clip and says so. */
  async cheapTest() {
    const cfg = this.cfg.get()
    const mock = cfg.mockMode
    const dir = mkdtempSync(join(tmpdir(), 'elo-cheap-'))
    const out = join(dir, 'cheap.mp4')
    const est = estimateClips(cfg, 'lite', '480p', [{ generateSeconds: 3 }])
    try {
      this.spend.check({ vendor: 'xai', dollars: est.firstPass, mock })
      const client: VideoClient = mock ? this.mockVideo : this.xai
      const { requestId } = await client.start({
        model: cfg.modelIds.lite,
        prompt: 'A small paper boat floating on calm water, soft light.',
        durationSeconds: 3,
        resolution: '480p',
        aspectRatio: '9:16',
      })
      this.spend.record({
        vendor: 'xai',
        model: cfg.modelIds.lite,
        resolution: '480p',
        units: 3,
        unitKind: 'seconds',
        unitPrice: cfg.prices.video.lite['480p'],
        dollars: est.firstPass,
        requestId,
        purpose: 'cheap test',
        mock,
      })
      for (let i = 0; i < 120; i++) {
        const s = await client.poll(requestId)
        if (s.status === 'done') {
          await client.download(s.url, out)
          const info = await probe(out)
          return { ok: true, message: `Made a ${info.durationSeconds.toFixed(1)} second clip${mock ? ' (mock, nothing was spent)' : ''}.`, dollars: est.firstPass, mock }
        }
        if (s.status === 'failed' || s.status === 'expired') return { ok: false, message: s.status === 'failed' ? s.error : 'The request expired.', dollars: est.firstPass, mock }
        await new Promise((r) => setTimeout(r, mock ? 20 : 5000))
      }
      return { ok: false, message: 'Timed out waiting for the clip.', dollars: est.firstPass, mock }
    } catch (e) {
      return { ok: false, message: (e as Error).message, dollars: 0, mock }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  // ---------- local AI ----------

  async localChecklist(): Promise<ChecklistView[]> {
    return this.localAi.checklist()
  }
  async localSelfTest() {
    return this.localAi.selfTest()
  }
  async localPull() {
    this.pulls.clear()
    const done = await this.localAi.pullRecommended((model, pct, status) => this.pulls.set(model, { pct, status }))
    this.d.emit()
    return done
  }
  async localPullProgress() {
    return [...this.pulls.entries()].map(([model, v]) => ({ model, ...v }))
  }
  async localRecommend(ramGb: number | null, hasGpu: boolean | null) {
    return recommendModels(ramGb, hasGpu)
  }
  async localSetupSteps() {
    return remoteSetupSteps()
  }

  // used by tests and mock tooling
  ensureDirs(): void {
    mkdirSync(this.episodes.root(), { recursive: true })
  }
  fileBytes(p: string): number {
    return statSync(p).size
  }
  flag(message: string): never {
    throw new FlagNow(message)
  }
}
