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
} from 'electron'
import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { join, normalize } from 'path'
import { pathToFileURL } from 'url'
import { latestSchemaVersion, openDb } from './db'
import { AlertService } from './alerts/service'
import { AgentRuntime } from './agent/runtime'
import { InboxWatcher } from './agent/inbox'
import { buildHealth } from './agent/health'
import { StatsService } from './stats/service'
import {
  FacebookStatsProvider,
  InstagramStatsProvider,
  TikTokStatsProvider,
  YoutubeStatsProvider,
} from './stats/providers'
import { applyPendingRestore, finishRestore } from './services/backup'
import { seedIfEmpty } from './db/seed'
import { buildApi, type Host } from './api'
import { ActivityLog } from './services/activity'
import { BrandService } from './services/brands'
import { Library } from './services/library'
import { MediaService } from './services/media'
import { PostService } from './services/posts'
import { SecretStore } from './services/secrets'
import { SettingsService } from './services/settings'
import { Scheduler } from './scheduler/scheduler'
import { DryRunAdapter } from './adapters/dryRun'
import { YoutubeAdapter } from './adapters/youtube'
import { FacebookAdapter } from './adapters/facebook'
import { InstagramAdapter } from './adapters/instagram'
import { metaUrls } from './meta/config'
import { GraphClient } from './meta/graph'
import { MetaService } from './meta/metaService'
import { TikTokAdapter } from './adapters/tiktok'
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
import { PLATFORMS } from '@shared/platformLimits'
import type { PlatformAdapter } from './adapters/types'
import { COPY } from '@shared/copy'
import type { Account, AppEvent, Platform, Settings } from '@shared/types'

const APP_NAME = 'Expect Less Output'
app.setName(APP_NAME)
// ELO_DATA_DIR lets tests run against a throwaway data folder.
app.setPath('userData', process.env['ELO_DATA_DIR'] ?? join(app.getPath('appData'), APP_NAME))

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
  if (restored) finishRestore(db, restored.mediaRoot)
  const settings = new SettingsService(db)
  const log = new ActivityLog(db)
  const library = new Library(() => settings.get().mediaRoot)
  const media = new MediaService(postersDir)
  const secrets = new SecretStore(join(dataDir, 'secrets.bin'), safeStorage)

  const emit = () => send({ type: 'changed' })
  const brands = new BrandService(db, (name) => library.ensureBrandFolders(name))
  const posts = new PostService(db, library, media, log, emit)

  const ensureAllFolders = () => {
    mkdirSync(settings.get().mediaRoot, { recursive: true })
    for (const b of brands.list(true)) library.ensureBrandFolders(b.name)
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
      log.log('error', `YouTube sign-in expired for ${name}: ${reason}`, { platform: 'youtube' })
      notifier.failure(
        COPY.reauthHeadline,
        `${name}: reconnect YouTube on the Connections screen.`,
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
  const stats = new StatsService({
    db,
    log,
    emit,
    providers: { youtube: ytStats, facebook: fbStats, instagram: igStats, tiktok: ttStats },
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
      log: (level, message, ctx) =>
        log.log(level, message, { postId: ctx.postId, platform: 'tiktok' }),
    },
  })

  const dryRuns = Object.fromEntries(
    PLATFORMS.map((p) => [p, new DryRunAdapter(p, { getSettings: () => settings.get() })]),
  ) as unknown as Record<Platform, PlatformAdapter>
  const adapterFor = (platform: Platform, account: Account | null): PlatformAdapter => {
    if (account && account.mode !== 'dry_run') {
      if (platform === 'youtube') return youtubeAdapter
      if (platform === 'facebook') return facebookAdapter
      if (platform === 'instagram') return instagramAdapter
      if (platform === 'tiktok') return tiktokAdapter
    }
    return dryRuns[platform]
  }

  const scheduler = new Scheduler({
    db,
    posts,
    library,
    log,
    getSettings: () => settings.get(),
    adapterFor,
    notifier,
    emit,
  })

  // Agents: the local API, the watched Inbox folders and the MCP server file.
  const agent = new AgentRuntime(
    {
      settings,
      brands,
      posts,
      scheduler,
      log,
      appVersion: app.getVersion(),
      stats,
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
    alert: (headline, detail) => notifier.failure(headline, detail, { kind: 'other' }),
  })

  let trayApi: { refresh: () => void } | null = null
  const setPaused = (paused: boolean) => {
    settings.set({ schedulerPaused: paused })
    log.log('info', paused ? 'Scheduler paused.' : 'Scheduler resumed.')
    trayApi?.refresh()
    emit()
    if (!paused) void scheduler.tick()
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
    async openPath(p) {
      await shell.openPath(p)
    },
    async pickSavePath(defaultName) {
      const r = await dialog.showSaveDialog({
        defaultPath: join(app.getPath('documents'), defaultName),
        filters: [{ name: 'Zip', extensions: ['zip'] }],
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
      if (prev.theme !== next.theme) nativeTheme.themeSource = next.theme
      if (prev.agentApiEnabled !== next.agentApiEnabled || prev.agentApiPort !== next.agentApiPort)
        void agent.apply().then(emit)
      if (JSON.stringify(prev.inboxBrandIds) !== JSON.stringify(next.inboxBrandIds))
        void inbox.scan().catch(() => {})
      trayApi?.refresh()
    },
  }

  const api = buildApi({
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
    stats,
    db,
    dataDir,
    postersDir,
    appVersion: app.getVersion(),
    maxSchema: latestSchemaVersion(),
    host,
    emit,
  })

  ipcMain.handle('elo:invoke', async (event, name: string, ...args: unknown[]) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Blocked.')
    const [ns, fn] = String(name).split('.')
    const group = (api as any)[ns]
    if (!group || typeof group[fn] !== 'function') throw new Error(`Unknown action ${name}.`)
    return group[fn](...args)
  })

  protocol.handle('elo-media', (req) => {
    const url = new URL(req.url)
    if (url.hostname !== 'poster') return new Response('Not found', { status: 404 })
    const file = normalize(join(postersDir, decodeURIComponent(url.pathname)))
    if (!file.startsWith(postersDir) || !existsSync(file))
      return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  // The bounce page on the website sends the TikTok login back through expectless://
  if (app.isPackaged) app.setAsDefaultProtocolClient('expectless')
  nativeTheme.themeSource = settings.get().theme
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
  inbox.start()
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
      void agent.server.stop()
      app.quit()
    }
  }
  app.on('before-quit', (e) => {
    if (!quitting) {
      e.preventDefault()
      void requestQuit()
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
