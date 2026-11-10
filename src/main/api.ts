import type { AuditEvents } from './pipeline/auditEvents'
import type { DropLog } from './pipeline/dropLog'
import type { PipelineIntake } from './pipeline/intake'
import type { InboxService } from './pipeline/inboxService'
import type { UpcomingService } from './pipeline/upcoming'
import { type Actor } from '@shared/upcoming'
import type { BotStore } from './agent/bots'
import { rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { sha256File } from './pipeline/verify'
import { fetchSuggestions } from './growth/seo'
import { morphCaption } from '@shared/growth'
import type { Api } from '@shared/api'
import type { Platform, Settings } from '@shared/types'
import { openSlotsFor } from './pipeline/gaps'
import type { ActivityLog } from './services/activity'
import type { BrandService } from './services/brands'
import type { MediaService } from './services/media'
import type { PostService } from './services/posts'
import type { SecretStore } from './services/secrets'
import type { UploadPostService } from './services/uploadPost'
import type { FirstCommentService } from './services/firstComments'
import type { EngageService } from './services/engage'
import type { AccountStatsService } from './services/accountStats'
import type { SettingsService } from './services/settings'
import { channelOverrides, setBrandOverrides } from './services/channelSettings'
import type { Scheduler } from './scheduler/scheduler'
import type { Library } from './services/library'
import type { YoutubeService } from './google/youtubeService'
import type { MetaService } from './meta/metaService'
import type { TikTokService } from './tiktok/service'
import type { AlertService } from './alerts/service'
import type { AgentRuntime } from './agent/runtime'
import type { StatsService } from './stats/service'
import type { ImportService } from './stats/imported'
import { buildHomeSummary } from './homeSummary'
import type { DashboardService } from './dashboard/service'
import { searchAll } from './search'
import type { PlatformEditor } from './studio/platformEdit'
import type { TelegramAssistant } from './studio/telegram'
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
import type { Studio } from './studio/studio'

/** The parts that need Electron. Everything else is plain services. */
export interface Host {
  pickFolder(defaultPath: string): Promise<string | null>
  pickVideos(multiple: boolean): Promise<string[]>
  pickImages(multiple: boolean): Promise<string[]>
  openPath(path: string): Promise<void>
  quit(): void
  appInfo(): { version: string; dataDir: string; dbPath: string; encryptionAvailable: boolean }
  applySettings(prev: Settings, next: Settings): void
  pickSavePath(
    defaultName: string,
    filter?: { name: string; extensions: string[] },
  ): Promise<string | null>
  pickZip(): Promise<string | null>
  relaunch(): void
}

const JOSH: Actor = { name: 'josh' }

export interface ApiDeps {
  settings: SettingsService
  brands: BrandService
  posts: PostService
  media: MediaService
  log: ActivityLog
  scheduler: Scheduler
  secrets: SecretStore
  uploadPost: UploadPostService
  firstComments: FirstCommentService
  engage: EngageService
  accountStats: AccountStatsService
  library: Library
  youtube: YoutubeService
  meta: MetaService
  tiktok: TikTokService
  alerts: AlertService
  agent: AgentRuntime
  dashboard: DashboardService
  studio: Studio
  editor: PlatformEditor
  telegram: TelegramAssistant
  stats: StatsService
  imported: ImportService
  db: Db
  dataDir: string
  postersDir: string
  appVersion: string
  maxSchema: number
  host: Host
  emit: () => void
  audit: AuditEvents
  drops: DropLog
  pipeline: PipelineIntake
  inbox: InboxService
  growth: import('./growth/service').GrowthService
  website: import('./website/service').WebsiteService
  storage: import('./growth/storage').StorageService
  platforms: import('./platforms/service').PlatformService
  upcoming: UpcomingService
  bots: BotStore
  /** Throws when a paused channel may not be resumed yet. */
  beforeResume: (brandId: number) => void
  afterResume: (brandId: number) => void
}

export async function llmProvider(c: Settings, studio: Studio): Promise<OpenAICompatibleProvider> {
  if (c.llmProvider === 'none')
    throw new Error('Text assist is turned off. Turn it on in Settings, under Text assist.')
  if (c.llmProvider === 'studio-local') {
    const l = (await studio.getConfig()).local
    if (!l.ollamaHost)
      throw new Error(
        'Set the Ollama host on the Local AI section in Settings, under AI models and Local AI first.',
      )
    if (!l.textModel) throw new Error('Pick a text model in Settings, under Text assist.')
    return new OpenAICompatibleProvider({
      baseUrl: l.ollamaHost.replace(/\/+$/, '') + '/v1',
      model: l.textModel,
    })
  }
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
        const resumed = patch.pausedBrandIds
          ? (prev.pausedBrandIds ?? []).filter((id) => !patch.pausedBrandIds!.includes(id))
          : []
        for (const id of resumed) d.beforeResume(id)
        const next = d.settings.set(patch)
        for (const [k, v] of Object.entries(patch)) {
          const before = (prev as unknown as Record<string, unknown>)[k]
          if (JSON.stringify(before) !== JSON.stringify(v))
            d.audit.write({ actor: 'josh', action: 'settings.change', target: k, before, after: v })
        }
        d.host.applySettings(prev, next)
        for (const id of resumed) d.afterResume(id)
        d.emit()
        return next
      },
      pickMediaRoot: async () => d.host.pickFolder(d.settings.get().mediaRoot),
    },
    uploadPost: {
      get: async () => d.uploadPost.state(),
      setKey: async (key) => {
        d.uploadPost.setKey(key)
        d.emit()
        return d.uploadPost.state()
      },
      removeKey: async () => {
        d.uploadPost.removeKey()
        d.emit()
        return d.uploadPost.state()
      },
      setLink: async (brandId, profile, platforms) => {
        d.uploadPost.setLink(brandId, profile, platforms)
        d.emit()
        return d.uploadPost.state()
      },
      test: async () => d.uploadPost.test(),
      accountStats: async () => d.accountStats.view(),
      refreshAccountStats: async () => {
        const r = await d.accountStats.sync({ force: true })
        d.emit()
        return r
      },
      commentNow: async (postId, text) => {
        await d.firstComments.commentNow(postId, text)
        return d.posts.get(postId) as import('@shared/types').Post
      },
      retryFirstComment: async (targetId) => {
        d.firstComments.retry(targetId)
        void d.firstComments.sweep().catch(() => {})
      },
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
        // An archived channel posts nothing more. What it had waiting is canceled, and what already went live is left alone.
        if (archived) {
          const n = d.posts.cancelUnposted(id)
          if (n) d.log.log('info', `Archived the channel and canceled ${n} post(s) that had not gone out.`)
          // Its video files go too. The channel is archived for good, so nothing keeps them.
          try {
            const r = d.storage.deleteChannelFiles(id)
            d.audit.write({ actor: 'josh', action: 'storage.deleteChannelFiles', target: r.name, after: { freedBytes: r.freedBytes } })
          } catch (e) {
            d.log.log('warn', `The channel was archived, but its video files could not be deleted: ${(e as Error).message}`)
          }
        } else {
          const b = d.brands.get(id)
          if (b) d.library.ensureBrandFolders(b.name)
        }
        d.website.requestSync()
        d.emit()
      },
      getSlots: async (id) => d.brands.getSlots(id),
      getPlatformSlots: async (id) => d.brands.getPlatformSlots(id),
      setPlatformSlots: async (id, slots) => {
        const out = d.brands.setPlatformSlots(id, slots)
        d.emit()
        return out
      },
      setSlots: async (id, slots) => d.brands.setSlots(id, slots),
      getSlotKinds: async (id) => d.brands.getSlotKinds(id),
      setSlotKinds: async (id, kinds) => {
        const out = d.brands.setSlotKinds(id, kinds)
        // The Studio makes what the channel makes. With one kind ticked it follows; with both it keeps its own format.
        const on = out.filter((k) => k.enabled)
        if (on.length === 1) await d.studio.setBrand(id, { format: on[0]!.kind }).catch(() => undefined)
        return out
      },
      getOverrides: async (id) => channelOverrides(d.db, id, d.settings.get()),
      setOverrides: async (id, patch) => {
        setBrandOverrides(d.db, id, patch)
        return channelOverrides(d.db, id, d.settings.get())
      },
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
      pickImages: async (multiple) => d.host.pickImages(multiple),
      /** Asks where to save, then writes the text there. Returns the path, or null when cancelled. */
      saveCsv: async (defaultName, text) => {
        const path = await d.host.pickSavePath(defaultName, { name: 'CSV', extensions: ['csv'] })
        if (!path) return null
        writeFileSync(path, text, 'utf8')
        return path
      },
      inspect: async (path) => d.media.inspect(path),
    },
    slots: {
      next: async (brandId, count, fromUtc, platform, kind) =>
        platform
          ? d.posts.nextSlotsFor(brandId, platform, count, fromUtc, [], kind)
          : d.posts.nextSlots(brandId, count, fromUtc, [], kind),
      plan: async (brandId, count, kind, platforms) => d.posts.slotPlans(brandId, count, kind, platforms),
      countOnDay: async (brandId, dayIso) => d.posts.countOnDay(brandId, dayIso),
      checkTime: async (brandId, whenUtc) => d.posts.checkCustomTime(brandId, whenUtc),
      open: async (fromUtc, toUtc, brandId) =>
        openSlotsFor(
          { db: d.db, brands: d.brands, posts: d.posts, clipsOn: () => !d.studio.isOff() },
          fromUtc,
          toUtc,
          brandId,
        ),
    },
    posts: {
      list: async (filter) => d.posts.list(filter),
      get: async (id) => d.posts.get(id),
      create: async (input) => d.posts.create(input),
      createMany: async (inputs) => d.posts.createMany(inputs),
      update: async (id, patch) => {
        const before = d.posts.get(id)
        const out = d.posts.update(id, patch)
        if (
          before &&
          patch.scheduledAtUtc !== undefined &&
          patch.scheduledAtUtc !== before.scheduledAtUtc
        )
          d.audit.write({
            actor: 'josh',
            action: 'post.reschedule',
            target: `${before.brandName}/${before.episodeRef ?? id}`,
            before: before.scheduledAtUtc,
            after: patch.scheduledAtUtc,
          })
        return out
      },
      reschedule: async (ids, when) => {
        const before = ids.map((id) => d.posts.get(id)?.scheduledAtUtc ?? null)
        d.posts.reschedule(ids, when)
        ids.forEach((id, i) =>
          d.audit.write({
            actor: 'josh',
            action: 'post.reschedule',
            target: `post ${id}`,
            before: before[i],
            after: when,
          }),
        )
      },
      setRelatedDone: async (id, done) => d.posts.setRelatedDone(id, done),
      swap: async (a, b) => {
        const [pa, pb] = [d.posts.get(a)?.scheduledAtUtc, d.posts.get(b)?.scheduledAtUtc]
        d.posts.swapTimes(a, b)
        d.audit.write({
          actor: 'josh',
          action: 'post.swap',
          target: `post ${a} and post ${b}`,
          before: [pa, pb],
          after: [pb, pa],
        })
      },
      cancel: async (ids) => {
        d.posts.cancel(ids)
        for (const id of ids)
          d.audit.write({ actor: 'josh', action: 'post.cancel', target: `post ${id}` })
      },
      remove: async (ids, alsoDeleteFile) => {
        d.posts.remove(ids, alsoDeleteFile)
        for (const id of ids)
          d.audit.write({
            actor: 'josh',
            action: 'post.delete',
            target: `post ${id}`,
            after: { alsoDeleteFile },
          })
      },
      olderMissingPlatform: async (brandId, platform) => d.posts.olderMissingPlatform(brandId, platform),
      addPlatform: async (postIds, platform, schedule) => {
        const r = d.posts.addPlatform(postIds, platform, { schedule })
        if (r.added) void d.scheduler.tick()
        return r
      },
      retryTarget: async (id) => d.scheduler.retryTarget(id),
      markPosted: async (id, url) => d.scheduler.markPosted(id, url),
      duplicate: async (id) => d.posts.duplicate(id),
      dismissChecklist: async (id) => d.posts.dismissChecklist(id),
      postNow: async (id) => d.scheduler.postNow(id),
    },
    log: { list: async (filter) => d.log.list(filter) },
    scheduler: {
      status: async () => d.scheduler.status(),
      // One pause for the whole app: the Studio and the posting scheduler together.
      pause: async () => d.studio.pauseAll(true),
      resume: async () => d.studio.pauseAll(false),
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
      exportRows: async (brandId, range) => d.stats.exportRows(brandId, range),
      brandSummary: async (brandId, range) => d.stats.brandSummary(brandId, range),
    },
    agent: {
      status: async () => d.agent.status(),
      generateToken: async () => ({ token: d.agent.generateToken() }),
      phoneLink: async () => d.agent.phoneLink(),
      newPhoneLink: async () => {
        d.agent.newPhoneToken()
        d.audit.write({ actor: 'josh', action: 'phone.newLink' })
        return d.agent.phoneLink()
      },
      mcpConfig: async () => d.agent.mcpConfig(),
      bots: async () => d.bots.list(),
      createBot: async (name, channels, role) => {
        const r = d.bots.create(name, channels, role)
        d.audit.write({
          actor: 'josh',
          action: 'bot.create',
          target: r.bot.name,
          after: { channels, role },
        })
        d.emit()
        return r
      },
      newBotToken: async (id) => {
        const r = d.bots.regenerate(id)
        d.audit.write({ actor: 'josh', action: 'bot.newToken', target: r.bot.name })
        return { token: r.token }
      },
      updateBot: async (id, patch) => {
        const b = d.bots.update(id, patch)
        d.audit.write({ actor: 'josh', action: 'bot.update', target: b.name, after: patch })
        d.emit()
        return b
      },
      revokeBot: async (id) => {
        const b = d.bots.get(id)
        d.bots.revoke(id)
        d.audit.write({ actor: 'josh', action: 'bot.revoke', target: b?.name ?? String(id) })
        d.emit()
      },
    },
    studio: d.studio,
    search: { query: async (q) => searchAll(d.db, q) },
    telegram: {
      status: async () => d.telegram.status(),
      newCode: async () => d.telegram.newCode(),
      unpair: async () => d.telegram.unpairAll(),
      setEnabled: async (on) => d.telegram.setEnabled(on),
      test: async () => d.telegram.test(),
    },
    platform: { edit: async (postId, platform, patch) => d.editor.edit(postId, platform, patch) },
    dashboard: {
      snapshot: async () => d.dashboard.snapshot(),
      refresh: async () => d.dashboard.refresh(),
      week: async (offset) => d.dashboard.weekMap(offset),
    },
    home: {
      summary: async () =>
        buildHomeSummary({
          db: d.db,
          settings: () => d.settings.get(),
          now: () => Date.now(),
          posts: (f) => d.posts.list(f),
          health: () =>
            healthRows({
              db: d.db,
              metaExpiresAt: () => d.meta.status().expiresAt,
              tiktokExpiresAt: (id) => d.tiktok.refreshExpiry(id),
            }),
          bluesky: () => d.studio.socialAccountList(),
          studioBrands: () => d.studio.brands(),
          openFlags: () => d.studio.openFlagCount(),
          spend: () => d.studio.spendSummary(),
          mockMode: () => d.studio.cfg.get().mockMode,
          postStats: (id) => d.stats.postStats(id),
        }),
    },
    platforms: {
      views: async () => d.platforms.views(),
      credentials: async (p) => d.platforms.credentialsStatus(p),
      saveCredentials: async (p, id, secret) => d.platforms.saveCredentials(p, id, secret),
      connect: async (brandId, p) => d.platforms.connect(brandId, p),
      cancel: async () => d.platforms.cancel(),
      disconnect: async (brandId, p) => d.platforms.disconnect(brandId, p),
      boards: async (brandId) => d.platforms.boards(brandId),
      setBoard: async (brandId, id, name) => d.platforms.setBoard(brandId, id, name),
      connectedFor: async (brandId) => d.platforms.connected(brandId),
    },
    website: {
      config: async () => d.website.config(),
      setConfig: async (patch) => d.website.setConfig(patch),
      profile: async (brandId) => d.website.profile(brandId),
      saveProfile: async (brandId, patch) => d.website.saveProfile(brandId, patch),
      setHero: async (brandId, path) => d.website.setHero(brandId, path),
      heroPreview: async (brandId) => d.website.heroPreview(brandId),
      status: async () => d.website.status(),
      pull: async () => d.website.pull(),
      publish: async () => d.website.publish(),
    },
    growth: {
      storageReport: async () => d.storage.report(),
      archivedChannelFiles: async () => d.storage.archivedChannels(),
      deleteArchivedFiles: async (brandIds) => {
        let freedBytes = 0
        let deleted = 0
        for (const id of brandIds) {
          const r = d.storage.deleteChannelFiles(id)
          freedBytes += r.freedBytes
          deleted++
          d.audit.write({ actor: 'josh', action: 'storage.deleteChannelFiles', target: r.name, after: { freedBytes: r.freedBytes } })
        }
        d.emit()
        return { deleted, freedBytes }
      },
      archiveOld: async (days, removeOriginals) => {
        const r = await d.storage.archiveOld(days, removeOriginals)
        d.audit.write({
          actor: 'josh',
          action: 'storage.archive',
          target: `older than ${days} days`,
          after: r,
        })
        d.emit()
        return r
      },
      learnings: async () => d.growth.learningsMarkdown(),
      brief: async () => d.growth.briefText(),
      sendBriefNow: async () => d.growth.sendBrief(),
      suggest: async (q) => fetchSuggestions(q),
      morphCaptions: async (postId) => {
        const post = d.posts.get(postId)
        if (!post) throw new Error('Post not found.')
        const changed: string[] = []
        for (const t of post.targets) {
          if (t.platform === 'youtube' || t.status !== 'pending') continue
          const text = morphCaption(t.platform, { description: post.caption })
          if (text && text !== (t.captionOverride ?? '')) {
            d.db
              .prepare('UPDATE post_targets SET caption_override = ? WHERE id = ?')
              .run(text, t.id)
            changed.push(t.platform)
          }
        }
        if (changed.length) d.emit()
        return changed
      },
      retract: async (episodeId) => {
        const r = await d.growth.retract(episodeId, 'josh')
        d.audit.write({
          actor: 'josh',
          action: 'episode.retracted',
          target: episodeId,
          after: { results: r.results },
        })
        d.emit()
        return { postIds: r.postIds, results: r.results }
      },
      normalizeAudio: async (postId) => {
        const post = d.posts.get(postId)
        if (!post) throw new Error('Post not found.')
        if (post.status === 'posted' || post.targets.some((t) => t.status !== 'pending'))
          throw new Error('This video is already with a platform, so the sound cannot be changed.')
        const src = d.library.resolve(post.videoPath)
        const tmp = join(d.dataDir, `normalize-${postId}.mp4`)
        await d.media.normalizeAudio(src, tmp)
        try {
          await d.posts.replaceMedia(postId, { sourcePath: tmp, checksum: await sha256File(tmp) })
        } finally {
          rmSync(tmp, { force: true })
        }
        d.emit()
        return 'The sound is now about -14 LUFS. The old file is in the Replaced folder.'
      },
    },
    pipeline: d.inbox.api(),
    upcoming: {
      view: async () => d.upcoming.view(),
      needsReview: async () => d.upcoming.needsReviewCount(),
      add: async (input) => d.upcoming.add(JOSH, input),
      patch: async (channel, episodeId, patch, base) =>
        d.upcoming.patch(JOSH, channel, episodeId, patch, base),
      remove: async (channel, episodeId) => d.upcoming.remove(channel, episodeId),
      restorePrevious: async () => void (await d.upcoming.restorePrevious()),
      dismiss: async () => d.upcoming.dismissViolations(),
      moveStudioIdeas: async () => d.upcoming.moveStudioIdeas(),
      openScript: async (path) => d.host.openPath(path),
      reload: async () => void d.upcoming.load(),
    },
    engage: {
      comments: async (filter) => d.engage.list(filter),
      refresh: async () => {
        const r = await d.engage.sync({ force: true })
        d.emit()
        return r
      },
      reply: async (id, text) => d.engage.reply(id, text),
      setStatus: async (id, status) => d.engage.setStatus(id, status),
      draft: async (id) => d.engage.draft(id),
      newCount: async () => d.engage.newCount(),
      dms: async (force) => d.engage.dms(force),
      dmSend: async (brandId, recipientId, text) => d.engage.dmSend(brandId, recipientId, text),
      dmDraft: async (brandId, recipientId) => d.engage.dmDraft(brandId, recipientId),
    },
    textAssist: {
      available: async () => d.settings.get().llmProvider !== 'none',
      status: async () => {
        const c = d.settings.get()
        if (c.llmProvider === 'studio-local') {
          const l = (await d.studio.getConfig()).local
          return {
            provider: c.llmProvider,
            available: !!l.ollamaHost && !!l.textModel,
            model: l.textModel,
            baseUrl: l.ollamaHost,
          }
        }
        return {
          provider: c.llmProvider,
          available: c.llmProvider !== 'none' && !!c.llmModel,
          model: c.llmModel,
          baseUrl: c.llmBaseUrl,
        }
      },
      autoSetup: async () => {
        const host = (await d.studio.getConfig()).local.ollamaHost
        if (!host)
          return {
            ok: false,
            message:
              'Set the Ollama host on the Local AI section in Settings, under AI models and Local AI first.',
          }
        const { options, localOnline } = await d.studio.modelOptions()
        if (!localOnline)
          return {
            ok: false,
            message: `Could not reach Ollama at ${host}. Check that it is running.`,
          }
        const text = options.filter(
          (o) => o.kind === 'local' && !/embed|llava|vision|-vl/i.test(o.id),
        )
        const pick = text.find((o) => /\b(7|8|9)b\b/i.test(o.id)) ?? text[0]
        if (!pick)
          return {
            ok: false,
            message:
              'Ollama has no text model yet. On the Ollama machine run: ollama pull llama3.1:8b',
          }
        const name = pick.id.replace(/^ollama:/, '')
        await d.studio.setConfig({ local: { textModel: name } } as never)
        d.settings.set({ llmProvider: 'studio-local' })
        return { ok: true, message: `Suggest buttons now use ${name} on your Ollama machine.` }
      },
      suggest: async (kind, brandId, title, caption) => {
        const p = await llmProvider(d.settings.get(), d.studio)
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
          const said = await (await llmProvider(d.settings.get(), d.studio)).test()
          return { ok: true, message: `The model answered: ${said}` }
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
      },
    },
  }
}
