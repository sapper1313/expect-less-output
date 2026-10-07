import type { Api } from '@shared/api'
import type { Platform, Settings } from '@shared/types'
import type { ActivityLog } from './services/activity'
import type { BrandService } from './services/brands'
import type { MediaService } from './services/media'
import type { PostService } from './services/posts'
import type { SecretStore } from './services/secrets'
import type { SettingsService } from './services/settings'
import type { Scheduler } from './scheduler/scheduler'
import type { Library } from './services/library'
import type { YoutubeService } from './google/youtubeService'
import type { MetaService } from './meta/metaService'
import type { TikTokService } from './tiktok/service'
import type { AlertService } from './alerts/service'
import type { AgentRuntime } from './agent/runtime'
import type { StatsService } from './stats/service'
import type { ImportService } from './stats/imported'
import { OpenAICompatibleProvider, checkLlmUrl } from './services/textAssist'
import type { RestorePreview } from '@shared/types'
import { healthRows } from './services/health'
import {
  createBackup,
  dismissRestoreReport,
  readBackup,
  readRestoreReport,
  stageRestore,
} from './services/backup'
import type { Db } from './db'

/** The parts that need Electron. Everything else is plain services. */
export interface Host {
  pickFolder(defaultPath: string): Promise<string | null>
  pickVideos(multiple: boolean): Promise<string[]>
  openPath(path: string): Promise<void>
  quit(): void
  appInfo(): { version: string; dataDir: string; dbPath: string; encryptionAvailable: boolean }
  applySettings(prev: Settings, next: Settings): void
  pickSavePath(defaultName: string): Promise<string | null>
  pickZip(): Promise<string | null>
  relaunch(): void
}

export interface ApiDeps {
  settings: SettingsService
  brands: BrandService
  posts: PostService
  media: MediaService
  log: ActivityLog
  scheduler: Scheduler
  secrets: SecretStore
  library: Library
  youtube: YoutubeService
  meta: MetaService
  tiktok: TikTokService
  alerts: AlertService
  agent: AgentRuntime
  stats: StatsService
  imported: ImportService
  db: Db
  dataDir: string
  postersDir: string
  appVersion: string
  maxSchema: number
  host: Host
  emit: () => void
}

function llmProvider(c: Settings): OpenAICompatibleProvider {
  if (c.llmProvider === 'none')
    throw new Error('Text assist is turned off. Turn it on in Settings, under Text assist.')
  if (!c.llmModel.trim()) throw new Error('Type the model name in Settings, under Text assist.')
  const check = checkLlmUrl(c.llmBaseUrl, c.llmAllowLan)
  if (!check.ok) throw new Error(check.message)
  return new OpenAICompatibleProvider({ baseUrl: check.url, model: c.llmModel.trim() })
}

/** Every UI action goes through this one service layer, so an agent API can reuse it later (Phase 6). */
export function buildApi(d: ApiDeps): Api {
  return {
    app: {
      info: async () => ({ ...d.host.appInfo(), mediaRoot: d.settings.get().mediaRoot }),
      quit: async () => d.host.quit(),
      openMediaRoot: async () => d.host.openPath(d.settings.get().mediaRoot),
    },
    settings: {
      get: async () => d.settings.get(),
      set: async (patch) => {
        const prev = d.settings.get()
        const next = d.settings.set(patch)
        d.host.applySettings(prev, next)
        d.emit()
        return next
      },
      pickMediaRoot: async () => d.host.pickFolder(d.settings.get().mediaRoot),
    },
    secrets: {
      status: async (keys) => d.secrets.status(keys),
      set: async (key, value) => d.secrets.set(key, value),
      remove: async (key) => d.secrets.delete(key),
    },
    brands: {
      list: async (includeArchived) => d.brands.list(includeArchived),
      create: async (name, color) => {
        const b = d.brands.create(name, color)
        d.emit()
        return b
      },
      update: async (id, patch) => {
        const b = d.brands.update(id, patch)
        d.emit()
        return b
      },
      archive: async (id, archived) => {
        d.brands.archive(id, archived)
        d.emit()
      },
      getSlots: async (id) => d.brands.getSlots(id),
      setSlots: async (id, slots) => d.brands.setSlots(id, slots),
      getDefaults: async (id) => d.brands.getDefaults(id),
      setDefaults: async (defaults) => d.brands.setDefaults(defaults),
    },
    hashtags: {
      list: async (brandId) => d.brands.listHashtags(brandId),
      save: async (set) => d.brands.saveHashtags(set),
      remove: async (id) => d.brands.removeHashtags(id),
    },
    accounts: { list: async (brandId) => d.brands.listAccounts(brandId) },
    media: {
      pickVideos: async (multiple) => d.host.pickVideos(multiple),
      inspect: async (path) => d.media.inspect(path),
    },
    slots: {
      next: async (brandId, count, fromUtc) => d.posts.nextSlots(brandId, count, fromUtc),
      countOnDay: async (brandId, dayIso) => d.posts.countOnDay(brandId, dayIso),
    },
    posts: {
      list: async (filter) => d.posts.list(filter),
      get: async (id) => d.posts.get(id),
      create: async (input) => d.posts.create(input),
      createMany: async (inputs) => d.posts.createMany(inputs),
      update: async (id, patch) => d.posts.update(id, patch),
      reschedule: async (ids, when) => d.posts.reschedule(ids, when),
      cancel: async (ids) => d.posts.cancel(ids),
      remove: async (ids, alsoDeleteFile) => d.posts.remove(ids, alsoDeleteFile),
      retryTarget: async (id) => d.scheduler.retryTarget(id),
      markPosted: async (id, url) => d.scheduler.markPosted(id, url),
      duplicate: async (id) => d.posts.duplicate(id),
      dismissChecklist: async (id) => d.posts.dismissChecklist(id),
      postNow: async (id) => d.scheduler.postNow(id),
    },
    log: { list: async (filter) => d.log.list(filter) },
    scheduler: {
      status: async () => d.scheduler.status(),
      pause: async () => {
        d.settings.set({ schedulerPaused: true })
        d.log.log('info', 'Scheduler paused.')
        d.emit()
      },
      resume: async () => {
        d.settings.set({ schedulerPaused: false })
        d.log.log('info', 'Scheduler resumed.')
        d.emit()
        void d.scheduler.tick()
      },
      simulateFailure: async (platform: Platform | null, kind = 'transient') => {
        d.settings.set({ dryRunFailPlatform: platform, dryRunFailKind: kind })
        d.emit()
      },
    },
    youtube: {
      credentialsStatus: async () => d.youtube.credentialsStatus(),
      saveCredentials: async (id, secret) => d.youtube.saveCredentials(id, secret),
      connect: async (brandId) => d.youtube.connect(brandId),
      finishConnect: async (sessionId, channelId) => d.youtube.finishConnect(sessionId, channelId),
      cancelConnect: async () => d.youtube.cancelConnect(),
      disconnect: async (brandId) => d.youtube.disconnect(brandId),
      setMode: async (brandId, mode) => d.youtube.setMode(brandId, mode),
      quota: async () => d.youtube.quotaStatus(),
      categories: async () => d.youtube.categories(),
      playlists: async (brandId) => d.youtube.playlists(brandId),
      checkHealth: async () => d.youtube.checkHealth(true),
    },
    tiktok: {
      credentialsStatus: async () => d.tiktok.credentialsStatus(),
      saveCredentials: async (key, secret, redirect, publish, stats) =>
        d.tiktok.saveCredentials(key, secret, redirect, publish, stats),
      connect: async (brandId) => d.tiktok.connect(brandId),
      submitCode: async (code) => d.tiktok.submitCode(code),
      cancelConnect: async () => d.tiktok.cancelConnect(),
      disconnect: async (brandId) => d.tiktok.disconnect(brandId),
      setMode: async (brandId, mode, approved) => d.tiktok.setMode(brandId, mode, approved),
      creatorInfo: async (brandId, refresh) => d.tiktok.creatorInfo(brandId, refresh),
      checkHealth: async () => d.tiktok.checkHealth(),
    },
    meta: {
      credentialsStatus: async () => d.meta.credentialsStatus(),
      saveCredentials: async (id, secret) => d.meta.saveCredentials(id, secret),
      connect: async () => d.meta.connect(),
      cancelConnect: async () => d.meta.cancelConnect(),
      disconnect: async () => d.meta.disconnect(),
      status: async () => d.meta.status(),
      assign: async (brandId, pageId, igId) => d.meta.assign(brandId, pageId, igId),
      checkHealth: async () => d.meta.checkHealth(),
    },
    alerts: {
      status: async () => d.alerts.status(),
      saveEmailPassword: async (pw) => d.alerts.saveEmailPassword(pw),
      sendTest: async (channel) => d.alerts.sendTest(channel),
    },
    health: {
      list: async () =>
        healthRows({
          db: d.db,
          metaExpiresAt: () => d.meta.status().expiresAt,
          tiktokExpiresAt: (id) => d.tiktok.refreshExpiry(id),
        }),
    },
    backup: {
      export: async () => {
        const stamp = new Date().toISOString().slice(0, 10)
        const out = await d.host.pickSavePath(`Expect Less Output backup ${stamp}.zip`)
        if (!out) return null
        const r = await createBackup({
          db: d.db,
          outPath: out,
          appVersion: d.appVersion,
          mediaRoot: d.settings.get().mediaRoot,
          postersDir: d.postersDir,
        })
        d.log.log('info', `Backup saved to ${out} (${Math.round(r.bytes / 1024)} KB).`)
        return { saved: out, accounts: r.accounts }
      },
      pick: async (): Promise<RestorePreview | null> => {
        const zip = await d.host.pickZip()
        if (!zip) return null
        const { manifest } = readBackup(zip, d.maxSchema)
        return {
          zipPath: zip,
          appVersion: manifest.appVersion,
          createdAt: manifest.createdAt,
          oldMediaRoot: manifest.mediaRoot,
          folderCount: manifest.folders.length,
          accountsToReconnect: manifest.accountsToReconnect,
        }
      },
      restore: async (zipPath, newMediaRoot) => {
        if (!newMediaRoot) throw new Error('Choose the Media Root folder on this Mac first.')
        // A safety copy of what is here now, then park the new data. The swap happens when the app restarts.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        await createBackup({
          db: d.db,
          outPath: `${d.dataDir}/safety-backup-${stamp}.zip`,
          appVersion: d.appVersion,
          mediaRoot: d.settings.get().mediaRoot,
          postersDir: d.postersDir,
        })
        stageRestore({ zipPath, dataDir: d.dataDir, newMediaRoot, maxSchema: d.maxSchema })
        d.log.log('info', 'Restore staged. Restarting to finish it.')
        setTimeout(() => d.host.relaunch(), 600)
      },
      report: async () => readRestoreReport(d.db),
      dismissReport: async () => {
        dismissRestoreReport(d.db)
        d.emit()
      },
    },
    stats: {
      forPosts: async (ids) => d.stats.forPosts(ids),
      post: async (id) => d.stats.postStats(id),
      refresh: async (postId) => {
        const mine = await d.stats.refresh({ postId, force: true })
        if (postId) return mine
        const old = await d.imported.refresh({ force: true })
        return {
          fetched: mine.fetched + old.fetched,
          unavailable: mine.unavailable + old.unavailable,
        }
      },
      importExisting: async (brandId) => d.imported.importExisting(brandId),
      imported: async (brandId, range) => d.imported.list(brandId, range),
      bestTimes: async (brandId, platform) => d.stats.bestTimes(brandId, platform),
      recommendedSlots: async (brandId) => d.stats.recommendedSlots(brandId),
      brandSummary: async (brandId, range) => d.stats.brandSummary(brandId, range),
    },
    agent: {
      status: async () => d.agent.status(),
      generateToken: async () => ({ token: d.agent.generateToken() }),
      mcpConfig: async () => d.agent.mcpConfig(),
    },
    textAssist: {
      available: async () => d.settings.get().llmProvider !== 'none',
      status: async () => {
        const c = d.settings.get()
        return {
          provider: c.llmProvider,
          available: c.llmProvider !== 'none' && !!c.llmModel,
          model: c.llmModel,
          baseUrl: c.llmBaseUrl,
        }
      },
      suggest: async (kind, brandId, title, caption) => {
        const p = llmProvider(d.settings.get())
        const input = { brand: d.brands.get(brandId).name, title, caption }
        const r =
          kind === 'title'
            ? await p.suggestTitle(input)
            : kind === 'caption'
              ? await p.suggestCaption(input)
              : await p.suggestHashtags(input)
        return r
      },
      test: async () => {
        try {
          const said = await llmProvider(d.settings.get()).test()
          return { ok: true, message: `The model answered: ${said}` }
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
      },
    },
  }
}
