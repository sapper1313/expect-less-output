import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Db } from '../db'
import type { ActivityLog } from '../services/activity'
import type { Library as MediaLibrary } from '../services/library'
import type { PostService } from '../services/posts'
import type { SecretStore } from '../services/secrets'
import { mask } from '../services/secrets'
import { addDays, dueDates, nextDue, todayEastern } from '@shared/studio/cadence'
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
import type { StudioBrandConfig } from '@shared/studio/types'
import { StudioConfigService } from './configService'
import { SpendService } from './spend'
import { AgentRunner, AuditLog, TaskStore, FlagNow } from './agents/framework'
import { AnthropicClient, LlmGateway, MockLlm } from './agents/llm'
import { Director } from './agents/director'
import { EpisodeLibrary } from './library'
import { CalendarFeed } from './calendarFeed'
import { Archivist } from './retention'
import { LocalAi } from './localAi'
import { MockVideoClient, XaiClient, type VideoClient } from './xai'
import { makeIngestHooks, type IngestHooks } from './ingest'
import { probe } from './ffmpeg'

export interface StudioDeps {
  db: Db
  secrets: SecretStore
  posts: PostService
  media: MediaLibrary
  log: ActivityLog
  /** Sends an alert through the existing notification and iMessage path. */
  alert: (headline: string, detail: string) => void
  emit: () => void
  now?: () => number
  fetchImpl?: typeof fetch
}

const KEY_NAMES: Record<KeyId, { secret: string; label: string }> = {
  xai: { secret: 'xai.apiKey', label: 'Grok / xAI API key' },
  anthropic: { secret: 'anthropic.apiKey', label: 'Anthropic API key' },
  threads: { secret: 'threads.token', label: 'Threads token' },
  bluesky: { secret: 'bluesky.appPassword', label: 'Bluesky app password' },
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
  readonly runner: AgentRunner
  readonly director: Director
  readonly episodes: EpisodeLibrary
  readonly calendarFeed: CalendarFeed
  readonly archivist: Archivist
  readonly localAi: LocalAi
  readonly ingest: IngestHooks
  private timers: NodeJS.Timeout[] = []
  private pulls = new Map<string, { pct: number; status: string }>()
  private ticking = false

  constructor(readonly d: StudioDeps) {
    const now = d.now ?? Date.now
    this.cfg = new StudioConfigService(d.db, now)
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
    this.gateway = new LlmGateway({
      db: d.db,
      config: this.cfg,
      spend: this.spend,
      client: () => (this.cfg.get().mockMode ? this.mockLlm : this.anthropic),
      now,
    })
    this.episodes = new EpisodeLibrary(d.db, this.cfg, brandName, now)
    this.calendarFeed = new CalendarFeed(d.db, this.cfg, this.episodes, d.media, now)
    this.archivist = new Archivist({ db: d.db, cfg: this.cfg, media: d.media, episodes: this.episodes, audit: this.audit, now })
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
    this.director = new Director({ db: d.db, config: this.cfg, tasks: this.tasks, audit: this.audit, alert: d.alert, now })
    this.ingest = makeIngestHooks({ db: d.db, cfg: this.cfg, episodes: this.episodes, posts: d.posts, now })
  }

  private now() {
    return this.d.now ? this.d.now() : Date.now()
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

  // ---------- config ----------

  async getConfig() {
    return this.cfg.get()
  }
  async setConfig(patch: Parameters<StudioApi['setConfig']>[0]) {
    const c = this.cfg.set(patch)
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
      else if (id === 'bluesky') result = await this.testBluesky()
      else result = await this.testThreads()
    } catch (e) {
      result = { ok: false, message: (e as Error).message }
    }
    const tests = this.readJson<Record<string, unknown>>(TESTS_KEY, {})
    tests[id] = { ...result, at: new Date(this.now()).toISOString() }
    this.writeJson(TESTS_KEY, tests)
    this.d.emit()
    return result
  }

  private async testBluesky(): Promise<TestResult> {
    const handle = this.readJson<Record<string, string>>(ACCOUNTS_KEY, {}).bluesky
    const pw = this.d.secrets.get(KEY_NAMES.bluesky.secret)
    if (!handle) return { ok: false, message: 'Type your Bluesky handle too, for example name.bsky.social.' }
    const res = await (this.d.fetchImpl ?? fetch)('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: handle, password: pw }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return { ok: false, message: res.status === 401 ? 'Bluesky refused that handle and app password.' : `Bluesky answered HTTP ${res.status}.` }
    return { ok: true, message: `Signed in as ${handle}.` }
  }

  private async testThreads(): Promise<TestResult> {
    const token = this.d.secrets.get(KEY_NAMES.threads.secret)
    const res = await (this.d.fetchImpl ?? fetch)(`https://graph.threads.net/v1.0/me?fields=username&access_token=${encodeURIComponent(token ?? '')}`, {
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return { ok: false, message: res.status === 400 || res.status === 401 ? 'Threads refused that token.' : `Threads answered HTTP ${res.status}.` }
    const d = (await res.json()) as { username?: string }
    if (d.username) this.writeJson(ACCOUNTS_KEY, { ...this.readJson<Record<string, string>>(ACCOUNTS_KEY, {}), threads: d.username })
    return { ok: true, message: `Connected as ${d.username ?? 'your account'}.` }
  }

  // ---------- spend ----------

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

  /** Simulates a day of Director decisions in mock mode and returns a plain report. Spends nothing. */
  async dryRunDay(): Promise<string[]> {
    const lines: string[] = []
    const r = this.director.tick()
    lines.push(...r.notes)
    for (const t of r.created) lines.push(`Would start task ${t.type} for brand ${t.brandId}: ${JSON.stringify(t.payload)}`)
    for (const b of this.cfg.listBrandConfigs()) {
      const est = typicalEpisodeEstimate(this.cfg.get(), b.config)
      lines.push(`${b.name}: next due ${nextDue(b.config, todayEastern(this.now()))}, about $${est.firstPass.toFixed(2)} per episode (worst case $${est.worstCase.toFixed(2)}).`)
    }
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
