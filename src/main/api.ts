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
import { noneProvider } from './services/textAssist'
import type { YoutubeService } from './google/youtubeService'
import type { MetaService } from './meta/metaService'

/** The parts that need Electron. Everything else is plain services. */
export interface Host {
  pickFolder(defaultPath: string): Promise<string | null>
  pickVideos(multiple: boolean): Promise<string[]>
  openPath(path: string): Promise<void>
  quit(): void
  appInfo(): { version: string; dataDir: string; dbPath: string; encryptionAvailable: boolean }
  applySettings(prev: Settings, next: Settings): void
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
  host: Host
  emit: () => void
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
    textAssist: { available: async () => noneProvider.available },
  }
}
