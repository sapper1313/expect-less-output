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
import { existsSync, mkdirSync } from 'fs'
import { join, normalize } from 'path'
import { pathToFileURL } from 'url'
import { openDb } from './db'
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
import { googleUrls, STUDIO_URL } from './google/config'
import { QuotaTracker } from './google/quota'
import { TokenManager } from './google/tokens'
import { YoutubeClient } from './google/youtubeClient'
import { YoutubeService } from './google/youtubeService'
import { makeNotifier } from './notifier'
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

  const db = openDb(dbPath)
  seedIfEmpty(db)
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

  const notifier = makeNotifier(send)
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
      notifier.failure(COPY.reauthHeadline, `${name}: reconnect YouTube on the Connections screen.`)
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
  const youtubeAdapter = new YoutubeAdapter({
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
    alert: (headline, detail) => notifier.failure(headline, detail),
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
  const facebookAdapter = new FacebookAdapter({
    graph,
    urls: mUrls,
    host: metaHost,
    publishesLast24h: (pageId) => meta.fbPublishesLast24h(pageId),
    recordPublish: (pageId) => meta.recordFbPublish(pageId),
  })
  const instagramAdapter = new InstagramAdapter({
    graph,
    urls: mUrls,
    host: metaHost,
    brandDefaults: (brandId) => brands.getDefaults(brandId),
  })

  const dryRuns = Object.fromEntries(
    PLATFORMS.map((p) => [p, new DryRunAdapter(p, { getSettings: () => settings.get() })]),
  ) as unknown as Record<Platform, PlatformAdapter>
  const adapterFor = (platform: Platform, account: Account | null): PlatformAdapter => {
    if (account && account.mode !== 'dry_run') {
      if (platform === 'youtube') return youtubeAdapter
      if (platform === 'facebook') return facebookAdapter
      if (platform === 'instagram') return instagramAdapter
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
  updateBlocker()
  log.log('info', 'App started.')

  async function requestQuit(): Promise<void> {
    if (await confirmQuit(scheduler.status().pendingCount)) {
      quitting = true
      scheduler.stop()
      youtube.stop()
      meta.stop()
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
app.on('open-url', (e) => e.preventDefault()) // expectless:// is wired up in the TikTok phase

app
  .whenReady()
  .then(boot)
  .catch((err) => {
    dialog.showErrorBox('Could not start', String(err?.stack ?? err))
    app.exit(1)
  })
