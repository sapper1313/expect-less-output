import { homedir } from 'os'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  safeStorage,
  shell,
  Menu,
} from 'electron'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, normalize, sep } from 'path'
import { pathToFileURL } from 'url'
import { preferIpv4 } from './network'
import { DropLog } from './pipeline/dropLog'
import { AuditEvents } from './pipeline/auditEvents'
import { PipelineIntake } from './pipeline/intake'
import { BotStore } from './agent/bots'
import { InboxService } from './pipeline/inboxService'
import { Reconciler } from './pipeline/reconcile'
import { FreshStart } from './pipeline/freshStart'
import { GapWarner, openSlotsFor } from './pipeline/gaps'
import { channelState } from './pipeline/state'
import { UpcomingService } from './pipeline/upcoming'
import { addEpisodeLink } from './pipeline/clipLink'
import { verifyPipelinePost } from './pipeline/verify'
import { probe as probeVideo } from './studio/ffmpeg'
import type { AlertKind } from './alerts/format'
import { latestSchemaVersion, openDb } from './db'
import { AlertService } from './alerts/service'
import { AgentRuntime } from './agent/runtime'
import { DashboardService } from './dashboard/service'
import { InboxWatcher } from './agent/inbox'
import { Studio } from './studio/studio'
import { YoutubeAnalyticsReader, YoutubeRetentionReader } from './studio/youtubeAnalytics'
import { MetaCommentSource, YoutubeCommentSource } from './studio/comments/realSources'
import { healthRows } from './services/health'
import { buildHealth } from './agent/health'
import { StatsService } from './stats/service'
import { TelegramReports } from './studio/telegramReports'
import { FacebookLister, ImportService, InstagramLister, YoutubeLister } from './stats/imported'
import {
  FacebookStatsProvider,
  InstagramStatsProvider,
  TikTokStatsProvider,
  YoutubeStatsProvider,
} from './stats/providers'
import { applyPendingRestore, finishRestore } from './services/backup'
import { ensureSlugs, seedIfEmpty } from './db/seed'
import { buildApi, type Host } from './api'
import { PlatformEditor } from './studio/platformEdit'
import { EMPTY_STATE as EMPTY_TG_STATE, TelegramAssistant } from './studio/telegram'
import { homeSnapshotText, latestLines } from './homeSnapshot'
import { ActivityLog } from './services/activity'
import { BrandService } from './services/brands'
import { Library } from './services/library'
import { MediaService } from './services/media'
import { PostService } from './services/posts'
import { SecretStore } from './services/secrets'
import { SettingsService } from './services/settings'
import { Scheduler } from './scheduler/scheduler'
import { DryRunAdapter } from './adapters/dryRun'
import { pickAdapter } from './adapters/choose'
import { YoutubeAdapter } from './adapters/youtube'
import { FacebookAdapter } from './adapters/facebook'
import { InstagramAdapter } from './adapters/instagram'
import { metaUrls } from './meta/config'
import { GraphClient } from './meta/graph'
import { MetaService } from './meta/metaService'
import { TikTokAdapter } from './adapters/tiktok'
import { UploadPostTikTokAdapter } from './adapters/uploadPostTikTok'
import { UploadPostInstagramAdapter } from './adapters/uploadPostInstagram'
import { UploadPostVideoAdapter, type UploadFields } from './adapters/uploadPostVideo'
import { PrimaryBackupAdapter } from './adapters/primaryBackup'
import { uploadPostFirst } from './stats/uploadPostStats'
import { OwnEngage } from './services/ownEngage'
import { UploadPostClient } from './uploadpost/client'
import { UploadPostService } from './services/uploadPost'
import { FirstCommentService } from './services/firstComments'
import { EngageService } from './services/engage'
import { AccountStatsService } from './services/accountStats'
import { tiktokUrls } from './tiktok/config'
import { TikTokClient } from './tiktok/client'
import { TikTokService } from './tiktok/service'
import { googleUrls, STUDIO_URL } from './google/config'
import { QuotaTracker } from './google/quota'
import { TokenManager } from './google/tokens'
import { YoutubeClient } from './google/youtubeClient'
import { YoutubeService } from './google/youtubeService'
import { makeLocalShow, makeNotifier } from './notifier'
import { confirmQuit, createTray, resourcesDir } from './tray'
import { ALL_PLATFORMS } from '@shared/platformLimits'
import { PlatformService } from './platforms/service'
import { XAdapter, XClient, xUrls } from './platforms/x'
import { LinkedInAdapter, LinkedInClient, linkedinUrls } from './platforms/linkedin'
import { PinterestAdapter, PinterestClient, pinterestUrls } from './platforms/pinterest'
import { BlueskyAdapter } from './platforms/bluesky'
import { GrowthService } from './growth/service'
import { fetchSuggestions } from './growth/seo'
import { StorageService } from './growth/storage'
import { WebsiteService } from './website/service'
import { AmazonLists } from './pipeline/amazonLists'
import type { AdapterContext, PlatformAdapter } from './adapters/types'
import { fitText } from '@shared/growth'
import { COPY } from '@shared/copy'
import type { Account, AppEvent, Platform, Settings } from '@shared/types'

const APP_NAME = 'Expect Less Output'
app.setName(APP_NAME)
// ELO_DATA_DIR lets tests run against a throwaway data folder.
app.setPath('userData', process.env['ELO_DATA_DIR'] ?? join(app.getPath('appData'), APP_NAME))

preferIpv4()

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'elo-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

let mainWindow: BrowserWindow | null = null
// The expectless:// link can arrive before the app has finished starting.
let pendingOpenUrl: string | null = null
let tiktokRef: { handleOpenUrl: (url: string) => boolean } | null = null
let quitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

function send(event: AppEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('elo:event', event)
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  else {
    mainWindow.show()
    mainWindow.focus()
  }
  app.dock?.show()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#2D2B28',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  // Right click: Copy for highlighted text, Cut, Copy and Paste in a text box.
  mainWindow.webContents.on('context-menu', (_e, p) => {
    if (!p.selectionText && !p.isEditable) return
    const items: Electron.MenuItemConstructorOptions[] = p.isEditable
      ? [
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { type: 'separator' },
          { role: 'selectAll' },
        ]
      : [{ role: 'copy' }, { role: 'selectAll' }]
    Menu.buildFromTemplate(items).popup()
  })
  // Closing the window keeps the scheduler running from the menu bar.
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
      app.dock?.hide()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault()
  })
  if (process.env['ELECTRON_RENDERER_URL'])
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

async function boot(): Promise<void> {
  const dataDir = app.getPath('userData')
  mkdirSync(dataDir, { recursive: true })
  const dbPath = join(dataDir, 'elo.sqlite')
  const postersDir = join(dataDir, 'posters')
  mkdirSync(postersDir, { recursive: true })

  // A restore from a backup is parked on disk and swapped in here, before the database opens.
  const restored = applyPendingRestore(dataDir)
  const db = openDb(dbPath)
  seedIfEmpty(db)
  ensureSlugs(db)
  if (restored) finishRestore(db, restored.mediaRoot)
  const settings = new SettingsService(db)
  const log = new ActivityLog(db)
  const library = new Library(() => settings.get().mediaRoot)
  const media = new MediaService(postersDir)
  const secrets = new SecretStore(join(dataDir, 'secrets.bin'), safeStorage)

  const emit = () => send({ type: 'changed' })
  const brands = new BrandService(db, (name) => library.ensureBrandFolders(name))
  // The reconcile check runs a few seconds after any post changes, once for a burst of changes.
  let reconcileSoon: () => void = () => {}
  const posts = new PostService(db, library, media, log, () => {
    emit()
    reconcileSoon()
  })

  const ensureAllFolders = () => {
    mkdirSync(settings.get().mediaRoot, { recursive: true })
    for (const b of brands.list(false)) library.ensureBrandFolders(b.name)
  }
  ensureAllFolders()

  const alerts = new AlertService({
    getSettings: () => settings.get(),
    secrets,
    showLocal: makeLocalShow(send),
    log: (level, message) => log.log(level, message),
    mediaRoot: () => settings.get().mediaRoot,
    // Test only: write alerts to a file instead of sending real iMessages.
    sendIMessage: process.env['ELO_FAKE_IMESSAGE_LOG']
      ? async (number, text) => {
          appendFileSync(process.env['ELO_FAKE_IMESSAGE_LOG'] as string, `${number}\t${text}\n`)
          return { ok: true, message: 'Sent (test log).' }
        }
      : undefined,
  })
  const notifier = makeNotifier(send, alerts)
  const urls = googleUrls()
  const quota = new QuotaTracker(db, Date.now, (bucket, used, limit) => {
    const msg = `YouTube ${bucket === 'uploads' ? 'upload' : 'API'} quota is at ${used} of ${limit} for today (resets midnight Pacific).`
    log.log('warn', msg, { platform: 'youtube' })
    send({ type: 'toast', toast: { kind: 'info', headline: 'YouTube quota warning', detail: msg } })
  })
  const brandName = (id: number) =>
    (db.prepare('SELECT name FROM brands WHERE id = ?').get(id) as { name: string } | undefined)
      ?.name ?? 'A brand'
  const tokens = new TokenManager({
    db,
    secrets,
    urls,
    onNeedsReauth: (accountId, reason) => {
      const a = db.prepare('SELECT brand_id FROM accounts WHERE id = ?').get(accountId) as
        { brand_id: number } | undefined
      const name = a ? brandName(a.brand_id) : 'A brand'
      // An archived channel never alerts anyone. The account is still marked, so un-archiving shows the problem.
      const archived = a
        ? ((db.prepare('SELECT archived FROM brands WHERE id = ?').get(a.brand_id) as { archived: number } | undefined)
            ?.archived ?? 0) === 1
        : false
      if (archived) {
        log.log('warn', `YouTube sign-in expired for archived channel ${name}: ${reason}`, { platform: 'youtube' })
        emit()
        return
      }
      log.log('error', `YouTube sign-in expired for ${name}: ${reason}`, { platform: 'youtube' })
      notifier.failure(
        COPY.reauthHeadline,
        `${name}: reconnect YouTube in Setup Channels, on the Connections tab.`,
        { kind: 'reauth' },
      )
      emit()
    },
  })
  const ytClient = new YoutubeClient(tokens, urls, quota)
  const youtube = new YoutubeService({
    db,
    secrets,
    urls,
    tokens,
    client: ytClient,
    quota,
    log,
    emit,
    notifyReauth: () => {},
    openBrowser: async (url) => {
      if (process.env['ELO_TEST_NO_BROWSER']) {
        // Test only: a fake Google server answers right away, so follow the redirect ourselves.
        void fetch(url).catch(() => {})
        return
      }
      await shell.openExternal(url)
    },
  })
  const ytStats = new YoutubeStatsProvider(ytClient)
  const youtubeAdapter = new YoutubeAdapter({
    stats: ytStats,
    client: ytClient,
    brandDefaults: (brandId) => brands.getDefaults(brandId),
    log: (level, message, ctx) =>
      log.log(level, message, { postId: ctx.postId, platform: 'youtube' }),
    host: {
      notify: (title, body) => {
        if (Notification.isSupported()) new Notification({ title, body }).show()
        send({ type: 'toast', toast: { kind: 'info', headline: title, detail: body } })
      },
      copyText: (text) => clipboard.writeText(text),
      openExternal: (url) => {
        if (url === STUDIO_URL) void shell.openExternal(url)
      },
    },
  })
  // Meta (Facebook Pages and Instagram)
  const mUrls = metaUrls()
  const graph = new GraphClient({ urls: mUrls })
  const meta: MetaService = new MetaService({
    db,
    secrets,
    urls: mUrls,
    graph,
    log,
    emit,
    alert: (headline, detail) =>
      notifier.failure(headline, detail, {
        kind: headline === COPY.metaExpiryHeadline ? 'expiry' : 'reauth',
      }),
    openBrowser: async (url) => {
      if (process.env['ELO_TEST_NO_BROWSER']) {
        void fetch(url).catch(() => {})
        return
      }
      await shell.openExternal(url)
    },
  })
  const metaHost = {
    notify: (title: string, body: string) => {
      if (Notification.isSupported()) new Notification({ title, body }).show()
      send({ type: 'toast', toast: { kind: 'info', headline: title, detail: body } })
    },
    authFailed: (reason: string) => meta.markReauth(reason),
    tokenFor: (account: Account | null) => meta.tokenForAccount(account),
    log: (level: 'info' | 'warn' | 'error', message: string, ctx: { postId: number }) =>
      log.log(level, message, { postId: ctx.postId }),
  }
  const metaStatsDeps = {
    graph,
    tokenFor: (account: Account | null) => meta.tokenForAccount(account),
    onAuthFailed: (reason: string) => meta.markReauth(reason),
  }
  const fbStats = new FacebookStatsProvider(metaStatsDeps)
  const igStats = new InstagramStatsProvider(metaStatsDeps)
  const facebookAdapter = new FacebookAdapter({
    stats: fbStats,
    graph,
    urls: mUrls,
    host: metaHost,
    publishesLast24h: (pageId) => meta.fbPublishesLast24h(pageId),
    recordPublish: (pageId) => meta.recordFbPublish(pageId),
  })
  const instagramAdapter = new InstagramAdapter({
    stats: igStats,
    graph,
    urls: mUrls,
    host: metaHost,
    brandDefaults: (brandId) => brands.getDefaults(brandId),
  })

  // TikTok
  const tUrls = tiktokUrls()
  const tiktokClient = new TikTokClient({ urls: tUrls })
  const tiktok = new TikTokService({
    db,
    secrets,
    settings,
    urls: tUrls,
    client: tiktokClient,
    log,
    emit,
    alert: (headline, detail) => notifier.failure(headline, detail, { kind: 'reauth' }),
    openBrowser: async (url) => {
      if (process.env['ELO_TEST_NO_BROWSER']) {
        // Test only: a fake TikTok answers right away. Keep the code so the test can play the bounce page.
        void fetch(url, { redirect: 'manual' })
          .then((r) => {
            const back = new URL(r.headers.get('location') as string)
            ;(globalThis as Record<string, unknown>).__ttLast = {
              code: back.searchParams.get('code'),
              state: back.searchParams.get('state'),
            }
          })
          .catch(() => {})
        return
      }
      await shell.openExternal(url)
    },
  })
  tiktokRef = tiktok
  if (pendingOpenUrl) {
    tiktok.handleOpenUrl(pendingOpenUrl)
    pendingOpenUrl = null
  }
  const ttStats = new TikTokStatsProvider({
    client: tiktokClient,
    accessToken: (id, force) => tiktok.accessToken(id, force),
    grantedScope: (id) => tiktok.grantedScope(id),
  })
  const imported = new ImportService({
    db,
    log,
    emit,
    providers: { youtube: ytStats, facebook: fbStats, instagram: igStats, tiktok: ttStats },
    listers: {
      youtube: new YoutubeLister(ytClient),
      facebook: new FacebookLister(metaStatsDeps),
      instagram: new InstagramLister(metaStatsDeps),
    },
  })
  const stats = new StatsService({
    db,
    log,
    emit,
    imported,
    // Upload-Post first for every platform it can read, ELO's own connection when it cannot.
    providers: Object.fromEntries(
      (['youtube', 'facebook', 'instagram', 'tiktok'] as const).map((p) => [
        p,
        uploadPostFirst({ youtube: ytStats, facebook: fbStats, instagram: igStats, tiktok: ttStats }[p], p, {
          db,
          client: new UploadPostClient(),
          apiKey: () => uploadPost.apiKey(),
          profileFor: (brandId) => uploadPost.profileFor(brandId),
          active: (brandId, platform) => uploadPost.active(brandId, platform),
          log: (m) => log.log('info', m),
        }),
      ]),
    ) as never,
  })
  const tiktokAdapter = new TikTokAdapter({
    stats: ttStats,
    client: tiktokClient,
    accessToken: (id, force) => tiktok.accessToken(id, force),
    freshCreator: (id) => tiktok.fresh(id),
    host: {
      notify: (title, body) => {
        if (Notification.isSupported()) new Notification({ title, body }).show()
        send({ type: 'toast', toast: { kind: 'info', headline: title, detail: body } })
      },
      copyText: (text) => clipboard.writeText(text),
      log: (level, message, ctx) =>
        log.log(level, message, { postId: ctx.postId, platform: 'tiktok' }),
    },
  })

  // More platforms: Bluesky, X, LinkedIn and Pinterest. A channel uses one only when it has a login for it.
  const xClient = new XClient({ urls: xUrls() })
  const linkedinClient = new LinkedInClient({ urls: linkedinUrls() })
  const pinterestClient = new PinterestClient({ urls: pinterestUrls() })
  const platformService = new PlatformService({
    db,
    secrets,
    log,
    clients: { x: xClient, linkedin: linkedinClient, pinterest: pinterestClient },
    bluesky: {
      notReady: (b) => studio.socialAccounts.notReady(b),
      handle: (b) => studio.socialAccounts.blueskyHandle(b),
    },
    openBrowser: async (url) => {
      await shell.openExternal(url)
    },
    alert: (headline, detail) => notifier.failure(headline, detail, { kind: 'reauth' }),
    emit,
  })
  const extraLog =
    (platform: Platform) =>
    (level: 'info' | 'warn' | 'error', message: string, ctx: { postId: number }) =>
      log.log(level, message, { postId: ctx.postId, platform })
  const dryRuns = Object.fromEntries(
    ALL_PLATFORMS.map((p) => [p, new DryRunAdapter(p, { getSettings: () => settings.get() })]),
  ) as unknown as Record<Platform, PlatformAdapter>
  const realAdapters = {
    youtube: youtubeAdapter,
    facebook: facebookAdapter,
    instagram: instagramAdapter,
    tiktok: tiktokAdapter,
    bluesky: new BlueskyAdapter({
      client: (b) => studio.socialAccounts.blueskyFor(b),
      log: extraLog('bluesky'),
    }),
    x: new XAdapter({
      client: xClient,
      accessToken: (id, force) => platformService.accessToken(id, force),
      log: extraLog('x'),
    }),
    linkedin: new LinkedInAdapter({
      client: linkedinClient,
      accessToken: (id) => platformService.accessToken(id),
      log: extraLog('linkedin'),
    }),
    pinterest: new PinterestAdapter({
      client: pinterestClient,
      accessToken: (id) => platformService.accessToken(id),
      log: extraLog('pinterest'),
    }),
  } as unknown as Record<Platform, PlatformAdapter>
  // Upload-Post: a channel with TikTok ticked on the AI Settings page posts to TikTok through them. Unticked, it uses
  // the ELO TikTok login (Drafts). A post already started one way is finished the same way.
  const uploadPost = new UploadPostService(db, secrets, new UploadPostClient())
  const uploadPostTikTok = new UploadPostTikTokAdapter({
    client: new UploadPostClient(),
    apiKey: () => uploadPost.apiKey(),
    profileFor: (brandId) => uploadPost.profileFor(brandId),
    host: {
      log: (level, message, ctx) => log.log(level, message, { postId: ctx.postId, platform: 'tiktok' }),
    },
  })
  const uploadPostInstagram = new UploadPostInstagramAdapter({
    client: new UploadPostClient(),
    apiKey: () => uploadPost.apiKey(),
    profileFor: (brandId) => uploadPost.profileFor(brandId),
    host: {
      log: (level, message, ctx) => log.log(level, message, { postId: ctx.postId, platform: 'instagram' }),
    },
  })
  // ELO's own login for comments and messages: the backup when Upload-Post fails.
  const ownEngage = new OwnEngage({
    graph,
    tokenFor: (account) => meta.tokenForAccount(account),
    accountFor: (brandId, platform, accountId) =>
      brands.listAccounts(brandId).find((a) => a.platform === platform && (accountId === null || a.id === accountId)) ?? null,
    youtube: ytClient,
    bluesky: (brandId) => studio.socialAccounts.blueskyFor(brandId),
  })
  const firstComments = new FirstCommentService({
    db,
    uploadPost,
    client: new UploadPostClient(),
    ownComment: (i) => ownEngage.postComment(i),
    log,
    alert: (headline, detail) => notifier.failure(headline, detail, { kind: 'other' }),
    emit,
  })
  setInterval(() => void firstComments.sweep().catch(() => {}), 30_000)
  // Comments and Instagram messages through Upload-Post. The local AI only suggests replies, and only when asked.
  const engage = new EngageService({
    db,
    uploadPost,
    client: new UploadPostClient(),
    log,
    emit,
    own: ownEngage,
    alert: (headline, detail) => notifier.failure(headline, detail, { kind: 'other' }),
    suggest: async (ctx) => {
      const { llmProvider } = await import('./api')
      return (await llmProvider(settings.get(), studio)).suggestReply(ctx)
    },
  })
  const accountStats = new AccountStatsService({ db, uploadPost, client: new UploadPostClient(), log, emit })
  setTimeout(() => void accountStats.sync().catch(() => {}), 90_000)
  setInterval(() => void accountStats.sync().catch(() => {}), 60 * 60_000)
  setTimeout(() => void engage.sync().catch(() => {}), 60_000)
  setInterval(() => void engage.sync().catch(() => {}), 5 * 60_000)
  // Upload-Post first for every platform it can post. Each wraps ELO's own adapter as the backup.
  const upHost = {
    log: (level: 'info' | 'warn' | 'error', message: string, ctx: { postId: number }, platform: Platform) =>
      log.log(level, message, { postId: ctx.postId, platform }),
  }
  const upFields = (platform: Platform, ctx: AdapterContext): UploadFields => {
    if (platform === 'youtube') {
      const m = youtubeAdapter.publicMetadata(ctx)
      const playlist = brands.getDefaults(ctx.brandId).youtubePlaylistId
      const thumb = ctx.settings.thumbnailPath
      return {
        fields: {
          title: m.snippet.title,
          youtube_title: m.snippet.title,
          youtube_description: m.snippet.description,
          'tags[]': m.snippet.tags,
          categoryId: m.snippet.categoryId,
          privacyStatus: 'public',
          selfDeclaredMadeForKids: String(m.status.selfDeclaredMadeForKids),
          containsSyntheticMedia: String(m.status.containsSyntheticMedia),
          ...(playlist ? { youtube_playlist_id: playlist } : {}),
        },
        thumbnailPath: typeof thumb === 'string' && thumb ? thumb : undefined,
      }
    }
    if (platform === 'facebook')
      return {
        fields: {
          title: ctx.title,
          facebook_title: ctx.title,
          facebook_description: ctx.caption,
          facebook_media_type: 'REELS',
          video_state: 'PUBLISHED',
          facebook_is_ai_generated: String(ctx.aiFlag),
        },
      }
    const text = fitText('bluesky', ctx.caption || ctx.title, 300)
    return { fields: { title: text, bluesky_title: text } }
  }
  const upVideo = (platform: Platform) =>
    new UploadPostVideoAdapter(platform, {
      client: new UploadPostClient(),
      apiKey: () => uploadPost.apiKey(),
      profileFor: (brandId) => uploadPost.profileFor(brandId),
      fieldsFor: upFields,
      host: { log: (level, message, ctx) => upHost.log(level, message, ctx, platform) },
    })
  const backupHost = (platform: Platform) => ({
    log: (level: 'info' | 'warn' | 'error', message: string, ctx: AdapterContext) => upHost.log(level, message, ctx, platform),
    onFallback: (ctx: AdapterContext, reason: string) => {
      auditEvents.write({
        actor: 'system',
        action: 'post.fallback',
        target: `${ctx.brandName}/${ctx.episodeId ?? ctx.postId}`,
        after: { platform, reason },
      })
      notifier.failure(
        'Upload-Post failed, ELO took over.',
        `${ctx.brandName}, ${platform}: ${reason.replace(/\.$/, '')}. ELO's own login is posting it instead.`,
        { kind: 'other' },
      )
    },
  })
  const primaries: Partial<Record<Platform, PlatformAdapter>> = {
    youtube: new PrimaryBackupAdapter('youtube', upVideo('youtube'), realAdapters.youtube, backupHost('youtube')),
    facebook: new PrimaryBackupAdapter('facebook', upVideo('facebook'), realAdapters.facebook, backupHost('facebook')),
    bluesky: new PrimaryBackupAdapter('bluesky', upVideo('bluesky'), realAdapters.bluesky, backupHost('bluesky')),
    instagram: new PrimaryBackupAdapter('instagram', uploadPostInstagram, realAdapters.instagram, backupHost('instagram')),
    tiktok: new PrimaryBackupAdapter('tiktok', uploadPostTikTok, realAdapters.tiktok, backupHost('tiktok')),
  }
  const adapterFor = (
    platform: Platform,
    account: Account | null,
    targetSettings?: Record<string, unknown>,
  ): PlatformAdapter => {
    const base = pickAdapter(
      platform,
      account,
      targetSettings,
      { dry: dryRuns, real: realAdapters },
      settings.get().globalDryRun,
    )
    // Upload-Post first, ELO's own login only after Upload-Post fails. A target already started on ELO's own path (a
    // YouTube video id, a Facebook or Instagram upload, a TikTok publish id) or already switched to the backup is
    // finished there; one already sent to Upload-Post keeps being followed on Upload-Post.
    const up = primaries[platform]
    if (!up || !account || base === dryRuns[platform]) return base
    const st = targetSettings ?? {}
    if (st.route === 'elo') return base
    if (typeof st.upRequestId === 'string') return up
    const startedNative = ['videoId', 'fbVideoId', 'igContainerId', 'igMediaId', 'ttPublishId'].some((k) => typeof st[k] === 'string' && st[k])
    if (startedNative) return base
    return uploadPost.active(account.brandId, platform) ? up : base
  }

  const scheduler = new Scheduler({
    db,
    posts,
    library,
    log,
    getSettings: () => settings.get(),
    adapterFor,
    notifier,
    tell: (text) => alerts.broadcast(text),
    emit,
    preflight: async (postId) => {
      addEpisodeLink(db, postId)
      return verifyPipelinePost(db, library, postId)
    },
    audit: (e) => auditEvents.write(e),
  })
  const dropLog = new DropLog(db, join(dataDir, 'logs', 'drops.jsonl'))
  const auditEvents = new AuditEvents(db)
  const PIPELINE_KIND: Record<string, string> = {
    drop_accepted: 'accepted',
    drop_rejected: 'rejected',
    scheduled: 'scheduled',
    posted: 'posted',
    reconcile: 'reconcile',
    low_queue: 'low_queue',
    summary: 'summary',
  }
  const pipelineNotify = (kind: AlertKind, headline: string, detail: string) => {
    const want = PIPELINE_KIND[kind]
    if (want && !settings.get().pipelineNotifyKinds.includes(want)) return
    void alerts.alert({ kind, headline, detail })
  }
  const upcoming = new UpcomingService({
    db,
    settings,
    brands,
    audit: auditEvents,
    notify: (h, d) => pipelineNotify('reconcile', h, d),
    mediaRoot: () => settings.get().mediaRoot,
    onChange: emit,
    studioIdeas: () =>
      brands
        .list()
        .flatMap((b) =>
          studio.bibles.ideas(b.id).map((i) => ({ id: i.id, brandId: b.id, text: i.text })),
        ),
  })
  const pipeline = new PipelineIntake({
    db,
    settings,
    brands,
    posts,
    library,
    drops: dropLog,
    audit: auditEvents,
    log,
    notify: pipelineNotify,
    probe: (p) => probeVideo(p),
    extraPlatforms: (brandId) => platformService.connected(brandId),
    suggest: (q) => fetchSuggestions(q),
    loudness: (p) => media.loudness(p),
    onChange: emit,
    onAccepted: (i) => void upcoming.markDropped(i.channel, i.episodeId, i.dropId).catch(() => {}),
  })

  const beforeResume = (brandId: number) => {
    const problem = pipeline.resumeProblem(brandId)
    if (problem) throw new Error(problem)
  }
  const reconciler = new Reconciler({
    db,
    posts,
    library,
    settings,
    notify: pipelineNotify,
    reschedule: (id, slot) => void posts.update(id, { scheduledAtUtc: slot }),
    log: (level, m) => log.log(level, m),
    onChange: emit,
    extra: [() => upcoming.issues()],
  })
  {
    let t: NodeJS.Timeout | null = null
    reconcileSoon = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => void reconciler.run().catch(() => {}), 8_000)
    }
  }
  const freshStart = new FreshStart({
    db,
    posts,
    settings,
    audit: auditEvents,
    upcoming,
    backupRoot: join(homedir(), 'ELO', 'Backups'),
  })
  const inboxService = new InboxService({
    freshStart,
    brands,
    db,
    posts,
    library,
    settings,
    intake: pipeline,
    drops: dropLog,
    audit: auditEvents,
    reconciler,
    openPath: async (p) => void (await shell.openPath(p)),
    emit,
  })
  const afterResume = (brandId: number) =>
    void pipeline
      .scheduleWaiting(brandId)
      .then((r) => {
        if (r.message) log.log('info', `Resumed channel ${brandId}. ${r.message}`)
      })
      .catch((e) =>
        log.log('error', `Waiting drops could not be scheduled: ${(e as Error).message}`),
      )
      .finally(() => emit())

  let telegramRef: TelegramAssistant | null = null
  let apiRef: ReturnType<typeof buildApi> | null = null
  const studio: Studio = new Studio({
    db,
    secrets,
    posts,
    media: library,
    log,
    alert: (headline, detail) => void alerts.alert({ kind: 'other', headline, detail }),
    alertItem: (item) => void alerts.alert(item),
    emit,
    beforeResume,
    afterResume,
    addUpcomingIdea: async (brandId, text) => {
      const b = brands.get(brandId)
      if (!settings.get().upcomingEnabled || !b.slug) {
        await studio.addIdeas(brandId, [text])
        return 'Idea added to the bank.'
      }
      const e = await upcoming.add(
        { name: 'josh' },
        {
          channel: b.slug,
          working_title: text.slice(0, 120),
          premise: text.length > 120 ? text : '',
        },
      )
      return `Idea added to Upcoming as ${e.episode_id}.`
    },
    onSettingChange: (key, before, after) =>
      auditEvents.write({ actor: 'josh', action: 'settings.change', target: key, before, after }),
    onRetentionDelete: (i) =>
      auditEvents.write({
        actor: 'system',
        action: 'retention.delete',
        target: `post ${i.postId}`,
        after: { title: i.title, file: i.path.split('/').pop(), bytes: i.bytes },
      }),
    setSchedulerPaused: (p) => setSchedulerPaused(p),
    setSchedulerBrandPaused: (id, p) => {
      const cur = settings.get().pausedBrandIds ?? []
      const next = p ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)
      if (next.length !== cur.length || next.some((x, i) => x !== cur[i]))
        settings.set({ pausedBrandIds: next })
    },
    startPaused: true,
    dataDir,
    postersDir,
    appVersion: app.getVersion(),
    mediaRoot: () => settings.get().mediaRoot,
    openPath: async (p) => void (await shell.openPath(p)),
    retention: (a, v, f, t) =>
      new YoutubeRetentionReader((id) => tokens.getAccessToken(id)).read(a, v, f, t),
    postViews: (id) => stats.postStats(id).totals.views,
    uploadCaption: (a, v, l, n, srt) => ytClient.uploadCaption(a, v, l, n, srt),
    youtube: ytClient,
    youtubeAccountFor: (brandId) => {
      const q = (where: string, ...a: unknown[]) =>
        (
          db
            .prepare(
              `SELECT id FROM accounts WHERE platform = 'youtube' AND mode != 'dry_run' AND status = 'connected' ${where} ORDER BY id LIMIT 1`,
            )
            .get(...a) as { id: number } | undefined
        )?.id ?? null
      return q('AND brand_id = ?', brandId) ?? q('')
    },
    youtubeCategoryFor: (brandId) => brands.getDefaults(brandId).youtubeCategoryId,
    refreshStats: () => stats.refresh({ force: true }),
    broadcast: async (text) => {
      await alerts.broadcast(text)
      await telegramRef?.notify(text).catch(() => undefined)
    },
    watchdogDir: () =>
      app.isPackaged
        ? join(process.resourcesPath, 'watchdog')
        : join(app.getAppPath(), 'scripts', 'watchdog'),
    expiring: () => {
      const lines: string[] = []
      for (const r of healthRows({
        db,
        metaExpiresAt: () => meta.status().expiresAt,
        tiktokExpiresAt: (id) => tiktok.refreshExpiry(id),
      })) {
        if (r.status === 'needs_reauth')
          lines.push(`${r.brandName} ${r.platform} needs you to sign in again.`)
        else if (r.expiresAt) {
          const days = Math.ceil((Date.parse(r.expiresAt) - Date.now()) / 86_400_000)
          if (days <= 7)
            lines.push(
              `${r.platform} login for ${r.brandName} expires in ${Math.max(0, days)} day(s).`,
            )
        }
      }
      return [...new Set(lines)]
    },
    commentSources: () => {
      const acct = (ref: { accountId: number | null; brandId: number }) =>
        brands.listAccounts(ref.brandId).find((a) => a.id === ref.accountId) ?? null
      return {
        youtube: new YoutubeCommentSource(ytClient),
        facebook: new MetaCommentSource('facebook', graph, (a) => meta.tokenForAccount(a), acct),
        instagram: new MetaCommentSource('instagram', graph, (a) => meta.tokenForAccount(a), acct),
      }
    },
    analytics: new YoutubeAnalyticsReader((id) => tokens.getAccessToken(id)),
    setYoutubeThumbnail: async (accountId, videoId, file) => {
      if (accountId === null) throw new Error('No YouTube account is linked to this video.')
      await ytClient.setThumbnail(accountId, videoId, file)
    },
  })

  const growth = new GrowthService({
    db,
    settings,
    log,
    notify: (headline, detail) => {
      makeLocalShow(send)(headline, detail, 'info')
      void telegramRef?.notify(`${headline}\n${detail}`).catch(() => undefined)
    },
    send: async (text) => {
      await alerts.broadcast(text)
      await telegramRef?.notify(text).catch(() => undefined)
    },
    youtube: {
      postComment: (a, v, t) => ytClient.postComment(a, v, t),
      listComments: (a, v) => ytClient.listComments(a, v),
      setPrivacy: (a, v, p) => ytClient.setPrivacy(a, v, p),
      videoStatus: (a, v) => ytClient.videoStatus(a, v),
    },
    refreshStats: (postId) => stats.refresh({ postId, force: true }),
    readRetention: (a, v, f, t) =>
      new YoutubeRetentionReader((id) => tokens.getAccessToken(id)).read(a, v, f, t),
    readCtr: async (a, v, from, to) => {
      const m = await new YoutubeAnalyticsReader((id) => tokens.getAccessToken(id)).read(
        a,
        v,
        from,
        to,
      )
      return m.impressions > 0 ? m.ctr : null
    },
    setThumbnail: (a, v, f) => ytClient.setThumbnail(a, v, f),
    resolve: (rel) => library.resolve(rel),
    addIdea: async (i) => {
      const e = await upcoming.add(
        { name: 'elo-community', role: 'orchestrator' },
        {
          channel: i.channel,
          working_title: i.title,
          premise: i.premise,
          notes: 'community_request',
          extra: i.extra,
        },
      )
      return e.episode_id
    },
    upcomingCounts: () => {
      const out: Record<string, number> = {}
      for (const r of upcoming.view().rows) out[r.status] = (out[r.status] ?? 0) + 1
      return out
    },
    bestTimeLines: () => {
      const lines: string[] = []
      for (const b of brands.list(false)) {
        if (channelState(db, b.id) !== 'active') continue
        const rec = stats.recommendedSlots(b.id)
        if (!rec.enough) continue
        const mine = brands.getSlots(b.id)
        for (const type of ['weekday', 'weekend'] as const) {
          const top = rec[type][0]
          if (!top || top.lift < 1.15) continue
          if (mine.some((m) => m.dayType === type && m.enabled && m.timeLocal === top.timeLocal))
            continue
          lines.push(
            `${b.name}: ${type} posts at ${top.timeLocal} get about ${top.lift.toFixed(1)} times the usual views. You can add that slot in Channels.`,
          )
        }
      }
      return lines
    },
    emptySlotCount: (days) => {
      const from = new Date()
      return openSlotsFor(
        { db, brands, posts, clipsOn: () => !studio.isOff() },
        from.toISOString(),
        new Date(from.getTime() + days * 86_400_000).toISOString(),
        null,
      ).filter((x) => x.channelState === 'active').length
    },
    sharedDir: () => join(settings.get().mediaRoot, 'Shared'),
    live: () => !settings.get().globalDryRun,
  })
  const storage = new StorageService({
    db,
    library,
    compress: (a, b) => media.archiveH265(a, b),
    duration: async (p) => (await media.probe(p)).durationSeconds,
    brandNames: () => brands.list(true).map((b) => b.name),
    log,
  })
  const website = new WebsiteService({
    db,
    repoDir: join(dataDir, 'website-repo'),
    heroDir: join(dataDir, 'website-heroes'),
    audit: (action, target, after) => auditEvents.write({ actor: 'system', action, target, after }),
    notify: (headline, detail) => notifier.failure(headline, detail, { kind: 'failure' }),
    emit,
  })
  const amazon = new AmazonLists({
    db,
    publishList: (file) => website.publishList(file),
    fillStarters: (slug, linkFor) => website.fillStarters(slug, linkFor),
    log: (level, m, o) => log.log(level, m, o),
    audit: (action, target, after) => auditEvents.write({ actor: 'system', action, target, after }),
    emit,
  })
  posts.afterCreate = (postId, products) => amazon.attach(postId, products)
  setInterval(() => void amazon.syncVideoIds().catch(() => {}), 10 * 60_000)
  setInterval(() => void amazon.catchUp().catch(() => {}), 30 * 60_000)
  setInterval(() => void website.tick().catch(() => {}), 30 * 60_000)
  setTimeout(() => void website.tick().catch(() => {}), 150_000)
  setInterval(() => platformService.ensureBluesky(), 5 * 60_000)
  setTimeout(() => platformService.ensureBluesky(), 30_000)
  setInterval(() => platformService.checkHealth(), 3_600_000)
  setTimeout(() => platformService.checkHealth(), 120_000)
  setInterval(() => void growth.tick().catch(() => {}), 5 * 60_000)
  setTimeout(() => void growth.tick().catch(() => {}), 90_000)

  // Agents: the local API, the watched Inbox folders and the MCP server file.
  const bots = new BotStore(db)
  const agent = new AgentRuntime(
    {
      settings,
      brands,
      posts,
      scheduler,
      log,
      appVersion: app.getVersion(),
      stats,
      drops: dropLog,
      library,
      intake: pipeline,
      growth,
      suggest: (q) => fetchSuggestions(q),
      notifyOwner: (headline, detail) => {
        makeLocalShow(send)(headline, detail, 'info')
        void telegramRef?.notify(`${headline}\n${detail}`).catch(() => undefined)
      },
      youtubeThumbnail: (a, v, f) => ytClient.setThumbnail(a, v, f),
      youtubeEdit: (a, v, patch) => ytClient.updateVideo(a, v, patch),
      upcoming,
      reconciler,
      audit: auditEvents,
      bots,
      pipeline: { receive: (c, sc, f, a) => inbox.receive(c, sc, f, a) },
      episodes: () => studio.episodes,
      studio: () => studio,
      health: () =>
        buildHealth({
          db,
          scheduler,
          settings,
          version: app.getVersion(),
          quota: () => youtube.quotaStatus(),
          metaExpiresAt: () => meta.status().expiresAt,
          tiktokExpiresAt: (id) => tiktok.refreshExpiry(id),
        }),
    },
    secrets,
    settings,
    {
      scriptPath: app.isPackaged
        ? join(process.resourcesPath, 'mcp', 'elo-mcp.mjs')
        : join(app.getAppPath(), 'mcp', 'dist', 'elo-mcp.mjs'),
    },
  )
  const dashboard = new DashboardService({
    db,
    services: agent.services,
    settings,
    refreshWatchTime: () => studio.refreshRecentWatchTime(),
    studioOn: () => !studio.isOff(),
    accountTotals: () => accountStats.homeTotals(),
  })
  agent.server.phone = {
    token: () => agent.phoneToken(),
    look: () => settings.get().colorTheme,
    snapshot: async () => dashboard.snapshot(),
    refresh: async () => dashboard.refresh(),
    week: async (offset) => dashboard.weekMap(offset),
    tiles: async () => apiRef!.home.summary(),
  }
  const inbox = new InboxWatcher({
    s: {
      settings,
      brands,
      posts,
      scheduler,
      log,
      appVersion: app.getVersion(),
      health: () => null,
    },
    library,
    studio: studio.ingest,
    pipeline,
    drops: dropLog,
    alert: (headline, detail) => notifier.failure(headline, detail, { kind: 'other' }),
  })

  // One pause per brand. If the Studio or the scheduler had a brand paused, both have it paused from now on.
  {
    const ids = new Set(settings.get().pausedBrandIds ?? [])
    const before = ids.size
    for (const b of studio.cfg.listBrandConfigs()) if (b.config.paused) ids.add(b.brandId)
    if (ids.size !== before) settings.set({ pausedBrandIds: [...ids] })
    for (const b of studio.cfg.listBrandConfigs())
      if (ids.has(b.brandId) && !b.config.paused) studio.cfg.setBrand(b.brandId, { paused: true })
  }

  let trayApi: { refresh: () => void } | null = null
  const setSchedulerPaused = (paused: boolean) => {
    settings.set({ schedulerPaused: paused })
    log.log('info', paused ? 'Scheduler paused.' : 'Scheduler resumed.')
    trayApi?.refresh()
    emit()
    if (!paused) void scheduler.tick()
  }
  /** The one pause for the whole app: the Studio and the posting scheduler together. */
  const setPaused = (paused: boolean) => {
    void studio.pauseAll(paused)
  }

  const host: Host = {
    async pickFolder(defaultPath) {
      const r = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        defaultPath,
      })
      return r.canceled ? null : r.filePaths[0]
    },
    async pickVideos(multiple) {
      const r = await dialog.showOpenDialog({
        properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: [{ name: 'Videos', extensions: ['mp4', 'mov'] }],
      })
      return r.canceled ? [] : r.filePaths
    },
    async pickImages(multiple) {
      const r = await dialog.showOpenDialog({
        properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
      })
      return r.canceled ? [] : r.filePaths
    },
    async openPath(p) {
      await shell.openPath(p)
    },
    async pickSavePath(defaultName, filter) {
      const r = await dialog.showSaveDialog({
        defaultPath: join(app.getPath('documents'), defaultName),
        filters: [filter ?? { name: 'Zip', extensions: ['zip'] }],
      })
      return r.canceled || !r.filePath ? null : r.filePath
    },
    async pickZip() {
      const r = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Backup', extensions: ['zip'] }],
      })
      return r.canceled ? null : r.filePaths[0]
    },
    relaunch() {
      quitting = true
      app.relaunch()
      app.exit(0)
    },
    quit: () => void requestQuit(),
    appInfo: () => ({
      version: app.getVersion(),
      dataDir,
      dbPath,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    }),
    applySettings(prev: Settings, next: Settings) {
      if (prev.mediaRoot !== next.mediaRoot) ensureAllFolders()
      if (prev.launchAtLogin !== next.launchAtLogin) {
        try {
          app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
        } catch (err) {
          log.log('warn', `Could not change the launch at login setting: ${(err as Error).message}`)
        }
      }
      if (prev.colorTheme !== next.colorTheme) nativeTheme.themeSource = next.colorTheme === 'daylight' ? 'light' : 'dark'
      if (
        prev.agentApiEnabled !== next.agentApiEnabled ||
        prev.agentApiPort !== next.agentApiPort ||
        prev.agentApiTailscale !== next.agentApiTailscale
      )
        void agent.apply().then(emit)
      if (
        prev.upcomingEnabled !== next.upcomingEnabled ||
        prev.upcomingLiveWatch !== next.upcomingLiveWatch ||
        prev.upcomingPollSeconds !== next.upcomingPollSeconds ||
        prev.upcomingFilePath !== next.upcomingFilePath
      )
        upcoming.start()
      if (JSON.stringify(prev.inboxBrandIds) !== JSON.stringify(next.inboxBrandIds))
        void inbox.scan().catch(() => {})
      trayApi?.refresh()
    },
  }

  const editor = new PlatformEditor({
    db,
    youtubeUpdate: (accountId, videoId, patch) => ytClient.updateVideo(accountId, videoId, patch),
    facebookUpdate: async (brandId, accountId, videoId, patch) => {
      const acct = brands.listAccounts(brandId).find((a) => a.id === accountId) ?? null
      await graph.post(
        `/${videoId}`,
        { title: patch.title, description: patch.description },
        meta.tokenForAccount(acct),
      )
    },
    mock: () => studio.cfg.get().mockMode,
    log: (m) => log.log('info', m),
  })

  const TG_KEY = 'studio.telegram'
  const telegram = new TelegramAssistant({
    token: () => (secrets.has('telegram.botToken') ? secrets.get('telegram.botToken') : null),
    load: () => {
      const r = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(TG_KEY) as
        { value_json: string } | undefined
      try {
        return r
          ? { ...EMPTY_TG_STATE, ...(JSON.parse(r.value_json) as object) }
          : { ...EMPTY_TG_STATE }
      } catch {
        return { ...EMPTY_TG_STATE }
      }
    },
    save: (st) =>
      void db
        .prepare(
          'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
        )
        .run(TG_KEY, JSON.stringify(st)),
    snapshot: async () => {
      const sum = await apiRef!.home.summary()
      const text = homeSnapshotText(sum)
      return { text, status: text.split('\n').slice(0, 14).join('\n'), latest: latestLines(sum) }
    },
    ask: (system, user) => studio.assistantAsk(system, user),
    addIdea: async (brandId, text) => {
      const b = brands.get(brandId)
      if (!settings.get().upcomingEnabled || !b.slug) {
        await studio.addIdeas(brandId, [text])
        return `Idea added to the ${b.name} bank.`
      }
      const e = await upcoming.add(
        { name: 'josh' },
        {
          channel: b.slug,
          working_title: text.slice(0, 120),
          premise: text.length > 120 ? text : '',
        },
      )
      return `Added to Upcoming for ${b.name} as ${e.episode_id}.`
    },
    setPaused: (p) => studio.pauseAll(p),
    reports: new TelegramReports({
      db,
      brands: () =>
        studio.cfg
          .listBrandConfigs()
          .map((b) => ({ id: b.brandId, name: b.name, paused: b.config.paused })),
      spend: () => studio.spend.summary(),
      flagged: () =>
        studio.tasks.list({ status: ['flagged', 'stopped'] }).map((t) => ({
          taskId: t.id,
          brandName: t.brandId
            ? (studio.cfg.listBrandConfigs().find((b) => b.brandId === t.brandId)?.name ?? null)
            : null,
          title: t.episodeId ? (studio.episodes.find(t.episodeId)?.title ?? null) : null,
          error: t.error,
        })),
      brandStats: (brandId, range) => stats.brandSummary(brandId, range),
    }),
    setBrandPaused: async (id, paused) => {
      await studio.setBrand(id, { paused })
    },
    log: (m) => log.log('info', m),
  })
  telegramRef = telegram

  const api = buildApi({
    uploadPost,
    firstComments,
    engage,
    accountStats,
    growth,
    storage,
    website,
    amazon,
    platforms: platformService,
    audit: auditEvents,
    drops: dropLog,
    pipeline,
    inbox: inboxService,
    upcoming,
    bots,
    beforeResume,
    afterResume,
    telegram,
    editor,
    settings,
    brands,
    posts,
    media,
    log,
    scheduler,
    secrets,
    library,
    youtube,
    meta,
    tiktok,
    alerts,
    agent,
    dashboard,
    studio,
    stats,
    imported,
    db,
    dataDir,
    postersDir,
    appVersion: app.getVersion(),
    maxSchema: latestSchemaVersion(),
    host,
    emit,
  })

  apiRef = api
  telegram.start()
  log.log(
    'info',
    `Claude API is ${settings.get().claudeApiEnabled ? 'ON' : 'OFF'}. Studio production is ${settings.get().studioProductionEnabled ? 'ON' : 'OFF'}.`,
  )

  // Once, the first time the app starts with an Ollama machine set up: turn the Suggest buttons on with it.
  const textAssistMark = join(dataDir, 'text-assist-autosetup.done')
  if (!existsSync(textAssistMark) && settings.get().llmProvider === 'none') {
    void api.textAssist
      .autoSetup()
      .then((r) => {
        if (r.ok) writeFileSync(textAssistMark, new Date().toISOString())
        log.log('info', `Text assist setup: ${r.message}`)
      })
      .catch(() => undefined)
  }

  ipcMain.handle('elo:invoke', async (event, name: string, ...args: unknown[]) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Blocked.')
    const [ns, fn] = String(name).split('.')
    const group = (api as any)[ns]
    if (!group || typeof group[fn] !== 'function') throw new Error(`Unknown action ${name}.`)
    return group[fn](...args)
  })

  protocol.handle('elo-media', (req) => {
    const url = new URL(req.url)
    if (url.hostname === 'video') {
      // Videos play from the Media Root only. Anything outside it is refused.
      const root = normalize(settings.get().mediaRoot)
      const vfile = normalize(join(root, decodeURIComponent(url.pathname)))
      if (!vfile.startsWith(root + sep) || !existsSync(vfile))
        return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(vfile).toString(), { headers: req.headers })
    }
    if (url.hostname === 'asset') {
      // Reference images are looked up by id, so no path from the page is ever read.
      const file = studio.assetFile(Number(decodeURIComponent(url.pathname).replace(/^\//, '')))
      return file
        ? net.fetch(pathToFileURL(file).toString())
        : new Response('Not found', { status: 404 })
    }
    if (url.hostname !== 'poster') return new Response('Not found', { status: 404 })
    const file = normalize(join(postersDir, decodeURIComponent(url.pathname)))
    if (!file.startsWith(postersDir) || !existsSync(file))
      return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  // The bounce page on the website sends the TikTok login back through expectless://
  if (app.isPackaged) app.setAsDefaultProtocolClient('expectless')
  nativeTheme.themeSource = settings.get().colorTheme === 'daylight' ? 'light' : 'dark'
  if (settings.get().launchAtLogin) app.setLoginItemSettings({ openAtLogin: true })

  trayApi = createTray({
    scheduler,
    settings,
    showWindow,
    setPaused,
    requestQuit: () => void requestQuit(),
  })

  const iconPath = join(resourcesDir(), 'icon.png')
  if (existsSync(iconPath)) app.dock?.setIcon(nativeImage.createFromPath(iconPath))

  // Keep the Mac awake while a post is due within 30 minutes.
  let blockerId: number | null = null
  const updateBlocker = () => {
    const need = !settings.get().schedulerPaused && scheduler.hasDueWithin(30)
    if (need && blockerId === null) {
      blockerId = powerSaveBlocker.start('prevent-app-suspension')
      log.log('info', 'Keeping the Mac awake: a post is due within 30 minutes.')
    } else if (!need && blockerId !== null) {
      powerSaveBlocker.stop(blockerId)
      blockerId = null
    }
  }
  setInterval(() => {
    updateBlocker()
    trayApi?.refresh()
  }, 30_000)

  powerMonitor.on('resume', () => void scheduler.onWake().then(updateBlocker))

  scheduler.start()
  youtube.startHealthChecks()
  meta.startHealthChecks()
  tiktok.startHealthChecks()
  alerts.start()
  stats.start()
  void agent.apply()
  dashboard.start()
  inbox.start()
  upcoming.start()
  const gaps = new GapWarner({
    db,
    brands,
    posts,
    settings,
    clipsOn: () => !studio.isOff(),
    send: async (text) => {
      await alerts.broadcast(text)
      await telegramRef?.notify(text).catch(() => undefined)
    },
  })
  setInterval(() => void gaps.check().catch(() => {}), 5 * 60_000)
  setTimeout(() => void gaps.check().catch(() => {}), 60_000)
  setTimeout(() => void reconciler.run().catch(() => {}), 20_000)
  setInterval(() => void reconciler.run().catch(() => {}), 3_600_000)
  studio.start()
  updateBlocker()
  log.log('info', 'App started.')

  async function requestQuit(): Promise<void> {
    if (await confirmQuit(scheduler.status().pendingCount)) {
      quitting = true
      scheduler.stop()
      youtube.stop()
      meta.stop()
      tiktok.stop()
      alerts.stop()
      stats.stop()
      inbox.stop()
      studio.stop()
      void agent.server.stop()
      app.quit()
    }
  }
  // The system is shutting down, restarting or logging out: let that through instead of hiding.
  powerMonitor.on('shutdown', () => {
    quitting = true
  })
  // Command+Q works like closing the window: the app keeps running from the menu bar. Only Quit in the
  // menu bar icon menu really stops it, so a stray Command+Q cannot stop your scheduled posts.
  app.on('before-quit', (e) => {
    // The automated test runs close the app for real. Nobody else sets this.
    if (process.env.ELO_E2E === '1') quitting = true
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
      app.dock?.hide()
    }
  })

  createWindow()
}

app.on('second-instance', showWindow)
app.on('activate', showWindow)
app.on('open-url', (e, url) => {
  e.preventDefault()
  if (tiktokRef) tiktokRef.handleOpenUrl(url)
  else pendingOpenUrl = url
  if (mainWindow) showWindow()
})

app
  .whenReady()
  .then(boot)
  .catch((err) => {
    dialog.showErrorBox('Could not start', String(err?.stack ?? err))
    app.exit(1)
  })
