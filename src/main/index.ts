import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
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
import { makeNotifier } from './notifier'
import { confirmQuit, createTray, resourcesDir } from './tray'
import { PLATFORMS } from '@shared/platformLimits'
import type { PlatformAdapter } from './adapters/types'
import type { AppEvent, Platform, Settings } from '@shared/types'

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

  const adapters = Object.fromEntries(
    PLATFORMS.map((p) => [p, new DryRunAdapter(p, { getSettings: () => settings.get() })]),
  ) as unknown as Record<Platform, PlatformAdapter>

  const scheduler = new Scheduler({
    db,
    posts,
    library,
    log,
    getSettings: () => settings.get(),
    adapters,
    notifier: makeNotifier(send),
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
  updateBlocker()
  log.log('info', 'App started.')

  async function requestQuit(): Promise<void> {
    if (await confirmQuit(scheduler.status().pendingCount)) {
      quitting = true
      scheduler.stop()
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
