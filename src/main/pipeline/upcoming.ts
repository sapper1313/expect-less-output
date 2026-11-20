import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'fs'
import { dirname, join } from 'path'
import { DateTime } from 'luxon'
import type { Db } from '../db'
import type { BrandService } from '../services/brands'
import type { SettingsService } from '../services/settings'
import { canonicalSlug } from '@shared/pipeline'
import { channelState } from './state'
import type { AuditEvents } from './auditEvents'
import type { FoundIssue } from './reconcile'
import {
  UPCOMING_VERSION,
  UpcomingFile,
  changedFields,
  mayChange,
  nextEpisodeId,
  type Actor,
  type UpcomingEntryT,
  type UpcomingFileT,
  type UpcomingRow,
  type UpcomingView,
} from '@shared/upcoming'

export class UpcomingError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export interface UpcomingDeps {
  db: Db
  settings: SettingsService
  brands: BrandService
  audit: AuditEvents
  /** One message to the owner. */
  notify: (headline: string, detail: string) => void
  /** The app's Media Root, for the default file location. */
  mediaRoot: () => string
  now?: () => number
  onChange?: () => void
  /** The unused ideas in the Studio ideas bank, for the one time move. */
  studioIdeas?: () => Array<{ id: number; brandId: number; text: string }>
}

interface Violation {
  key: string
  detail: string
  channel: string
  episodeId: string
  entryRevision: number | null
  at: string
}

interface State {
  revision: number
  hash: string
  json: string
  invalidSince: string | null
  invalidReason: string | null
  invalidAlerted: boolean
  violations: Violation[]
}

const STALE_REVIEW_DAYS = 7
const INVALID_HOUR_MS = 3_600_000

const sha = (t: string) => createHash('sha256').update(t).digest('hex')
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * The shared list of episodes in flight. The FILE is the truth that bots and ELO share. ELO keeps a cached copy in its
 * database for display, history and the reconcile check, writes with a temporary file and a rename, never overwrites a
 * newer revision, and never deletes anything.
 */
export class UpcomingService {
  private watcher: FSWatcher | null = null
  private sweep: NodeJS.Timeout | null = null
  private poll: NodeJS.Timeout | null = null
  private debounce: NodeJS.Timeout | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private d: UpcomingDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }
  private iso() {
    return new Date(this.now()).toISOString()
  }

  filePath(): string {
    const p = this.d.settings.get().upcomingFilePath.trim()
    return p || join(this.d.mediaRoot(), 'Shared', 'upcoming.json')
  }

  private state(): State {
    const r = this.d.db.prepare('SELECT * FROM upcoming_state WHERE id = 1').get() as any
    return {
      revision: r.revision,
      hash: r.hash,
      json: r.json,
      invalidSince: r.invalid_since,
      invalidReason: r.invalid_reason,
      invalidAlerted: !!r.invalid_alerted,
      violations: JSON.parse(r.violations_json) as Violation[],
    }
  }

  private saveState(p: Partial<State>): void {
    const s = { ...this.state(), ...p }
    this.d.db
      .prepare(
        `UPDATE upcoming_state SET revision = ?, hash = ?, json = ?, loaded_at = ?, invalid_since = ?, invalid_reason = ?,
         invalid_alerted = ?, violations_json = ? WHERE id = 1`,
      )
      .run(
        s.revision,
        s.hash,
        s.json,
        this.iso(),
        s.invalidSince,
        s.invalidReason,
        s.invalidAlerted ? 1 : 0,
        JSON.stringify(s.violations),
      )
  }

  private cached(): UpcomingFileT {
    const s = this.state()
    if (!s.json)
      return { schema_version: UPCOMING_VERSION, revision: 0, updated_at: this.iso(), episodes: [] }
    return JSON.parse(s.json) as UpcomingFileT
  }

  private history(f: UpcomingFileT, actor: string, action: string): void {
    this.d.db
      .prepare(
        'INSERT INTO upcoming_history (revision, at, actor, action, json) VALUES (?, ?, ?, ?, ?)',
      )
      .run(f.revision, this.iso(), actor, action, JSON.stringify(f))
    this.d.db
      .prepare(
        'DELETE FROM upcoming_history WHERE id NOT IN (SELECT id FROM upcoming_history ORDER BY id DESC LIMIT 200)',
      )
      .run()
  }

  // ---------- who is who ----------

  private actorInfo(name: string): Actor {
    if (name === 'josh' || name === 'system') return { name }
    const r = this.d.db
      .prepare(
        'SELECT channels_json, role FROM agent_bots WHERE name = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1',
      )
      .get(name) as { channels_json: string; role: 'writer' | 'orchestrator' } | undefined
    return r
      ? { name, role: r.role, channels: JSON.parse(r.channels_json) as string[] }
      : { name, channels: [] }
  }

  // ---------- reading ----------

  private readDisk():
    | { kind: 'missing' }
    | { kind: 'invalid'; reason: string }
    | { kind: 'ok'; file: UpcomingFileT; text: string; hash: string } {
    const p = this.filePath()
    if (!existsSync(p)) return { kind: 'missing' }
    let text: string
    try {
      text = readFileSync(p, 'utf8')
    } catch (e) {
      return { kind: 'invalid', reason: `The file could not be read: ${(e as Error).message}` }
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return { kind: 'invalid', reason: 'The file is not valid JSON (it may be half written).' }
    }
    const parsed = UpcomingFile.safeParse(raw)
    if (!parsed.success)
      return {
        kind: 'invalid',
        reason: `The file does not match the format: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || '(top)'}: ${i.message}`)
          .join('; ')}`,
      }
    return { kind: 'ok', file: parsed.data as UpcomingFileT, text, hash: sha(text) }
  }

  private duplicates(f: UpcomingFileT): string[] {
    const seen = new Set<string>()
    const dup = new Set<string>()
    for (const e of f.episodes) {
      const k = `${e.channel}/${e.episode_id}`
      if (seen.has(k)) dup.add(k)
      seen.add(k)
    }
    return [...dup]
  }

  /** Reads the file now. Returns true when the cached copy changed. */
  load(): boolean {
    if (!this.d.settings.get().upcomingEnabled) return false
    const disk = this.readDisk()
    const st = this.state()
    if (disk.kind === 'missing') {
      if (!st.json) return false
      // The folder or file was moved or deleted. The last good copy is written back, so bots and ELO keep sharing one file.
      try {
        const p = this.filePath()
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(`${p}.tmp`, st.json)
        renameSync(`${p}.tmp`, p)
        this.d.audit.write({
          actor: 'system',
          action: 'upcoming.recreate',
          target: 'upcoming.json',
          after: { revision: st.revision, path: p },
        })
        this.saveState({ invalidSince: null, invalidReason: null, invalidAlerted: false })
        this.d.notify(
          'upcoming.json was missing',
          `ELO wrote the last good copy (revision ${st.revision}) back to ${p}.`,
        )
        this.d.onChange?.()
        return false
      } catch (e) {
        return this.markInvalid(
          `The file is missing and could not be put back (${(e as Error).message}). Showing the last good copy.`,
        )
      }
    }
    if (disk.kind === 'invalid') return this.markInvalid(disk.reason)
    if (st.invalidSince)
      this.saveState({ invalidSince: null, invalidReason: null, invalidAlerted: false })
    if (disk.hash === st.hash) return false
    const prev = this.cached()
    if (st.json && disk.file.revision <= st.revision) {
      // The text changed but the revision did not go up. Reload only when the revision increased.
      this.addViolation({
        key: `norev:${disk.hash.slice(0, 12)}`,
        detail: `upcoming.json changed without a higher revision (it says ${disk.file.revision}). The change was not loaded.`,
        channel: '',
        episodeId: '',
        entryRevision: null,
      })
      return false
    }
    const found = this.violationsBetween(st.json ? prev : null, disk.file)
    this.saveState({ revision: disk.file.revision, hash: disk.hash, json: disk.text })
    this.history(disk.file, 'file', 'load')
    for (const v of found) this.addViolation(v)
    this.d.onChange?.()
    return true
  }

  private markInvalid(reason: string): boolean {
    const st = this.state()
    const since = st.invalidSince ?? this.iso()
    if (!st.invalidAlerted)
      this.d.notify(
        'upcoming.json is invalid',
        `${reason} ELO is keeping the last good copy until it is fixed.`,
      )
    this.saveState({ invalidSince: since, invalidReason: reason, invalidAlerted: true })
    this.d.onChange?.()
    return false
  }

  /** Changes made by editing the file directly that the actor was not allowed to make. */
  private violationsBetween(
    prev: UpcomingFileT | null,
    next: UpcomingFileT,
  ): Omit<Violation, 'at'>[] {
    if (!prev) return []
    const out: Omit<Violation, 'at'>[] = []
    const old = new Map(prev.episodes.map((e) => [`${e.channel}/${e.episode_id}`, e]))
    const now = new Map(next.episodes.map((e) => [`${e.channel}/${e.episode_id}`, e]))
    for (const [k, e] of now) {
      const before = old.get(k) ?? null
      if (before && JSON.stringify(before) === JSON.stringify(e)) continue
      const verdict = mayChange(
        this.actorInfo(e.updated_by),
        before as Record<string, any> | null,
        e as Record<string, any>,
      )
      const silent =
        before &&
        changedFields(before as Record<string, unknown>, e as Record<string, unknown>).length > 0 &&
        e.entry_revision <= before.entry_revision
      if (!verdict.ok || silent)
        out.push({
          key: `edit:${k}:${e.entry_revision}`,
          detail: `${e.channel} ${e.episode_id} was changed in the file by ${e.updated_by}. ${verdict.ok ? 'The entry revision did not go up.' : verdict.reason}`,
          channel: e.channel,
          episodeId: e.episode_id,
          entryRevision: e.entry_revision,
        })
    }
    for (const [k, e] of old)
      if (!now.has(k))
        out.push({
          key: `removed:${k}`,
          detail: `${e.channel} ${e.episode_id} ("${e.working_title}") is no longer in the file. ELO never deletes entries; use Restore previous to bring it back.`,
          channel: e.channel,
          episodeId: e.episode_id,
          entryRevision: null,
        })
    return out
  }

  /** `quiet` keeps the note in the Upcoming issues list but sends no alert to the owner. */
  private addViolation(v: Omit<Violation, 'at'>, quiet = false): void {
    const st = this.state()
    if (st.violations.some((x) => x.key === v.key)) return
    this.saveState({ violations: [...st.violations, { ...v, at: this.iso() }].slice(-100) })
    if (!quiet) this.d.notify('Upcoming needs a look', v.detail)
  }

  // ---------- the view ----------

  view(): UpcomingView {
    const enabled = this.d.settings.get().upcomingEnabled
    const st = this.state()
    const f = this.cached()
    const dup = new Set(this.duplicates(f))
    const brands = new Map(this.d.brands.list(true).map((b) => [b.slug ?? '', b]))
    const paused = new Set(this.d.settings.get().pausedBrandIds ?? [])
    const nowMs = this.now()
    const rows: UpcomingRow[] = f.episodes.map((e) => {
      const b = brands.get(e.channel)
      const post = e.drop_id
        ? (this.d.db.prepare('SELECT post_id FROM drops WHERE drop_id = ?').get(e.drop_id) as
            { post_id: number | null } | undefined)
        : undefined
      return {
        ...e,
        channelName: b?.name ?? e.channel,
        channelColor: b?.color ?? '#888888',
        paused: !!b && paused.has(b.id),
        postId: post?.post_id ?? null,
        readOnly: dup.has(`${e.channel}/${e.episode_id}`) || !!e.conflict,
        staleDays: Math.max(0, Math.floor((nowMs - new Date(e.updated_at).getTime()) / 86_400_000)),
      }
    })
    return {
      enabled,
      revision: f.revision,
      invalidReason: st.invalidReason,
      readOnly: dup.size > 0 || !!st.invalidSince,
      rows,
      filePath: this.filePath(),
    }
  }

  /** When the file was last written (the list's own updated_at). */
  updatedAt(): string | null {
    return this.state().json ? this.cached().updated_at : null
  }

  needsReviewCount(): number {
    if (!this.d.settings.get().upcomingEnabled) return 0
    return this.cached().episodes.filter((e) => e.status === 'needs-review').length
  }

  // ---------- writing ----------

  private serial<T>(fn: () => T): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => undefined)
    return run
  }

  /**
   * The copy a change is built on. Normally the file as it is on disk. When the disk copy is an older one (a bot or a sync
   * put back a copy with a revision ELO has already passed), building on it would silently drop every entry added since.
   * ELO then builds on its last good copy and keeps any entry that only the old file has.
   */
  private baseFor(disk: UpcomingFileT, hash: string): UpcomingFileT {
    const st = this.state()
    if (!st.json || hash === st.hash || disk.revision > st.revision) return disk
    const base = clone(this.cached())
    const have = new Set(base.episodes.map((e) => `${e.channel}/${e.episode_id}`))
    for (const e of disk.episodes)
      if (!have.has(`${e.channel}/${e.episode_id}`)) base.episodes.push(e)
    this.addViolation({
      key: `stale:${hash.slice(0, 12)}`,
      detail: `upcoming.json was replaced by an older copy (revision ${disk.revision}, ELO is at ${st.revision}). ELO kept its newer entries and wrote them back.`,
      channel: '',
      episodeId: '',
      entryRevision: null,
    })
    return base
  }

  /** Reads the file fresh, applies the change, and writes it back with a temporary file and a rename. */
  private mutate(actorName: string, action: string, fn: (f: UpcomingFileT) => void): UpcomingFileT {
    if (!this.d.settings.get().upcomingEnabled)
      throw new UpcomingError(400, 'Upcoming is switched off in Settings.')
    const disk = this.readDisk()
    let file: UpcomingFileT
    if (disk.kind === 'invalid')
      throw new UpcomingError(
        409,
        `upcoming.json is invalid, keeping the last good copy. ${disk.reason}`,
      )
    if (disk.kind === 'missing')
      file = this.state().json
        ? this.cached()
        : { schema_version: UPCOMING_VERSION, revision: 0, updated_at: this.iso(), episodes: [] }
    else file = this.baseFor(disk.file, disk.hash)
    // The file may have moved on since ELO last looked. Load it first so changes by others are checked and kept.
    if (
      disk.kind === 'ok' &&
      disk.hash !== this.state().hash &&
      disk.file.revision > this.state().revision
    )
      this.load()
    if (this.duplicates(file).length)
      throw new UpcomingError(
        409,
        'The file has duplicate episode ids, so it is read only until that is fixed.',
      )
    const next = clone(file)
    fn(next)
    next.revision = Math.max(file.revision, this.state().revision) + 1
    next.updated_at = this.iso()
    const text = JSON.stringify(next, null, 2) + '\n'
    const p = this.filePath()
    mkdirSync(dirname(p), { recursive: true })
    const tmp = `${p}.tmp`
    writeFileSync(tmp, text)
    renameSync(tmp, p)
    this.saveState({
      revision: next.revision,
      hash: sha(text),
      json: text,
      invalidSince: null,
      invalidReason: null,
      invalidAlerted: false,
    })
    this.history(next, actorName, action)
    this.d.onChange?.()
    return next
  }

  private find(f: UpcomingFileT, channel: string, episodeId: string) {
    return f.episodes.find((e) => e.channel === channel && e.episode_id === episodeId) ?? null
  }

  private usedIds(channel: string, f: UpcomingFileT): string[] {
    return [
      ...f.episodes.filter((e) => e.channel === channel).map((e) => e.episode_id),
      ...(
        this.d.db
          .prepare('SELECT episode_ref AS id FROM posts WHERE episode_ref IS NOT NULL')
          .all() as Array<{ id: string }>
      ).map((r) => r.id),
      ...(
        this.d.db
          .prepare('SELECT episode_id AS id FROM drops WHERE episode_id IS NOT NULL')
          .all() as Array<{ id: string }>
      ).map((r) => r.id),
    ]
  }

  private deny(actor: Actor, reason: string, target: string): never {
    this.d.audit.write({
      actor: actor.name === 'josh' ? 'josh' : `agent:${actor.name}`,
      action: 'upcoming.denied',
      target,
      after: { reason },
    })
    throw new UpcomingError(403, reason)
  }

  private auditActor(actor: Actor): string {
    return actor.name === 'josh' || actor.name === 'system' ? actor.name : `agent:${actor.name}`
  }

  add(
    actor: Actor,
    input: {
      channel: string
      working_title: string
      premise?: string
      notes?: string
      status?: UpcomingEntryT['status']
      episode_id?: string
      script_path?: string | null
      air_date?: string
      post_type?: 'episode' | 'clip'
      source_episode_id?: string
      /** Extra fields kept on the entry, for example community_request. */
      extra?: Record<string, unknown>
    },
  ): Promise<UpcomingEntryT> {
    return this.serial(() => {
      input = { ...input, channel: canonicalSlug(input.channel) }
      const brand = this.d.brands.bySlug(input.channel)
      if (!brand) throw new UpcomingError(404, `No channel with the slug ${input.channel}.`)
      if (channelState(this.d.db, brand.id) === 'archived')
        throw new UpcomingError(409, `${brand.name} is archived. Nothing can be added to it.`)
      const title = input.working_title.trim()
      if (!title) throw new UpcomingError(400, 'A working title is needed.')
      let made: UpcomingEntryT | null = null
      const t = this.iso()
      this.mutate(this.auditActor(actor), 'add', (f) => {
        const year = DateTime.fromMillis(this.now(), { zone: 'America/New_York' }).year
        const id =
          input.episode_id?.trim() ||
          nextEpisodeId(input.channel, year, this.usedIds(input.channel, f))
        if (this.find(f, input.channel, id))
          throw new UpcomingError(409, `${id} is already in ${input.channel}.`)
        const entry = UpcomingEntryParse({
          channel: input.channel,
          episode_id: id,
          working_title: title,
          premise: input.premise ?? '',
          status: input.status ?? 'idea',
          source_bot: actor.name,
          created_by: actor.name,
          created_at: t,
          updated_by: actor.name,
          updated_at: t,
          entry_revision: 1,
          notes: input.notes ?? '',
          script_path: input.script_path ?? null,
          ...(input.air_date ? { air_date: input.air_date } : {}),
          ...(input.post_type === 'clip' ? { post_type: 'clip' } : {}),
          ...(input.source_episode_id ? { source_episode_id: input.source_episode_id } : {}),
          drop_id: null,
          ...(input.extra ?? {}),
        })
        const v = mayChange(actor, null, entry as Record<string, any>)
        if (!v.ok) this.deny(actor, v.reason ?? 'Not allowed.', `${input.channel}/${id}`)
        f.episodes.push(entry)
        made = entry
      })
      this.d.audit.write({
        actor: this.auditActor(actor),
        action: 'upcoming.add',
        target: `${input.channel}/${(made as unknown as UpcomingEntryT).episode_id}`,
        after: made,
      })
      return made as unknown as UpcomingEntryT
    })
  }

  /**
   * Edits or advances one entry. The caller says which revisions it read. If the entry moved on since, changes to
   * different fields are merged; changes to the same field keep both versions and flag a conflict.
   */
  patch(
    actor: Actor,
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
    > & { clear_conflict?: boolean },
    base: { entry_revision?: number } = {},
  ): Promise<{ entry: UpcomingEntryT; conflict: boolean }> {
    return this.serial(() => {
      channel = canonicalSlug(channel)
      let conflict = false
      let result: UpcomingEntryT | null = null
      const pb = this.d.brands.bySlug(channel)
      if (pb && channelState(this.d.db, pb.id) === 'archived')
        throw new UpcomingError(409, `${pb.name} is archived. Its entries cannot change.`)
      const target = `${channel}/${episodeId}`
      this.mutate(this.auditActor(actor), 'patch', (f) => {
        const cur = this.find(f, channel, episodeId)
        if (!cur) throw new UpcomingError(404, `No entry ${target}.`)
        if (cur.conflict && !(patch.clear_conflict && actor.name === 'josh'))
          throw new UpcomingError(409, 'This entry has a conflict. Josh resolves it first.')
        const before = clone(cur)
        const wanted: Record<string, unknown> = {}
        for (const k of [
          'working_title',
          'premise',
          'notes',
          'script_path',
          'air_date',
          'status',
          'post_type',
          'source_episode_id',
        ] as const)
          if (patch[k] !== undefined) wanted[k] = patch[k]
        let apply = wanted
        if (base.entry_revision !== undefined && base.entry_revision !== cur.entry_revision) {
          // Someone changed the entry after the caller read it. Find what they changed.
          const old = this.entryAt(channel, episodeId, base.entry_revision)
          const theirs = old
            ? changedFields(old as Record<string, unknown>, cur as Record<string, unknown>)
            : Object.keys(wanted)
          const overlap = Object.keys(wanted).filter(
            (k) =>
              theirs.includes(k) &&
              JSON.stringify(wanted[k]) !== JSON.stringify((cur as Record<string, unknown>)[k]),
          )
          if (overlap.length) {
            conflict = true
            apply = Object.fromEntries(Object.entries(wanted).filter(([k]) => !overlap.includes(k)))
            const detail = overlap
              .map(
                (k) =>
                  `${k}: ${cur.updated_by} has ${JSON.stringify((cur as Record<string, unknown>)[k])}, ${actor.name} wanted ${JSON.stringify(wanted[k])}`,
              )
              .join('; ')
            cur.conflict = true
            cur.conflict_detail = detail
          }
        }
        const merged = { ...cur, ...apply } as UpcomingEntryT
        if (patch.clear_conflict && actor.name === 'josh') {
          delete merged.conflict
          delete merged.conflict_detail
        }
        const v = mayChange(
          actor,
          before as Record<string, any>,
          {
            ...merged,
            ...(conflict ? { conflict: undefined, conflict_detail: undefined } : {}),
          } as Record<string, any>,
        )
        if (!v.ok) this.deny(actor, v.reason ?? 'Not allowed.', target)
        merged.updated_by = actor.name
        merged.updated_at = this.iso()
        merged.entry_revision = cur.entry_revision + 1
        const idx = f.episodes.findIndex((e) => e.channel === channel && e.episode_id === episodeId)
        f.episodes[idx] = merged
        result = merged
      })
      this.d.audit.write({
        actor: this.auditActor(actor),
        action: conflict ? 'upcoming.conflict' : 'upcoming.patch',
        target,
        after: patch,
      })
      if (conflict)
        this.d.notify(
          'Upcoming conflict',
          `${target}: two edits changed the same field. Both versions are kept in the entry. Open Upcoming to resolve it.`,
        )
      return { entry: result as unknown as UpcomingEntryT, conflict }
    })
  }

  /** The owner removes an entry he does not want. A copy stays in the history, so Restore previous brings it back. */
  remove(channel: string, episodeId: string): Promise<void> {
    return this.serial(() => {
      let gone: UpcomingEntryT | null = null
      this.mutate('josh', 'remove', (f) => {
        const i = f.episodes.findIndex((e) => e.channel === channel && e.episode_id === episodeId)
        if (i < 0) throw new UpcomingError(404, `No entry ${channel}/${episodeId}.`)
        if (f.episodes[i].status === 'dropped')
          throw new UpcomingError(
            409,
            'A dropped entry is linked to a real video and cannot be removed.',
          )
        gone = f.episodes[i]
        f.episodes.splice(i, 1)
      })
      this.d.audit.write({
        actor: 'josh',
        action: 'upcoming.remove',
        target: `${channel}/${episodeId}`,
        before: gone,
      })
    })
  }

  /** The entry as it was at a given entry_revision, from the saved snapshots. */
  private entryAt(
    channel: string,
    episodeId: string,
    entryRevision: number,
  ): UpcomingEntryT | null {
    const rows = this.d.db
      .prepare('SELECT json FROM upcoming_history ORDER BY id DESC LIMIT 200')
      .all() as Array<{ json: string }>
    for (const r of rows) {
      const f = JSON.parse(r.json) as UpcomingFileT
      const e = f.episodes.find((x) => x.channel === channel && x.episode_id === episodeId)
      if (e && e.entry_revision === entryRevision) return e
    }
    return null
  }

  /**
   * The one change ELO makes by itself: a drop with the exact episode id moves an entry from needs-review or muse-passed to dropped.
   * An entry at an earlier status is not advanced. An id with no entry makes no change.
   */
  async markDropped(
    channel: string,
    episodeId: string,
    dropId: string,
  ): Promise<'dropped' | 'early' | 'none'> {
    if (!this.d.settings.get().upcomingEnabled) return 'none'
    return this.serial(() => {
      const f = this.readDiskOrCache()
      const e = this.find(f, channel, episodeId)
      if (!e)
        return this.adopt(channel, episodeId, dropId) ? ('dropped' as const) : ('none' as const)
      if (e.status === 'dropped') return 'none' as const
      if (e.status !== 'needs-review' && e.status !== 'muse-passed') {
        this.addViolation({
          key: `early:${channel}/${episodeId}:${dropId}`,
          detail: `${channel} ${episodeId} was dropped while its Upcoming status is "${e.status}". The drop arrived before the status caught up. Nothing was changed.`,
          channel,
          episodeId,
          entryRevision: e.entry_revision,
          // The owner asked for no alert on this one. The note stays in the issues list on the Upcoming screen.
        }, true)
        return 'early' as const
      }
      this.mutate('system', 'dropped', (file) => {
        const cur = this.find(file, channel, episodeId)
        if (!cur) return
        cur.status = 'dropped'
        cur.drop_id = dropId
        cur.updated_by = 'system'
        cur.updated_at = this.iso()
        cur.entry_revision += 1
      })
      this.d.audit.write({
        actor: 'system',
        action: 'upcoming.dropped',
        target: `${channel}/${episodeId}`,
        after: { drop_id: dropId },
      })
      return 'dropped' as const
    })
  }

  /**
   * A dropped episode that has no entry (the bot never added one, or the entry was lost) gets one, already marked dropped,
   * so it always shows in Upcoming. Returns true when an entry was made. Runs inside the serial chain.
   */
  private adopt(channel: string, episodeId: string, dropId: string): boolean {
    const brand = this.d.brands.bySlug(channel)
    if (!brand || channelState(this.d.db, brand.id) === 'archived') return false
    const d = this.d.db
      .prepare(
        "SELECT title FROM drops WHERE drop_id = ? AND result = 'accepted' AND post_type = 'episode'",
      )
      .get(dropId) as { title: string | null } | undefined
    if (!d) return false
    const t = this.iso()
    let made = false
    this.mutate('system', 'adopt', (file) => {
      if (this.find(file, channel, episodeId)) return
      file.episodes.push(
        UpcomingEntryParse({
          channel,
          episode_id: episodeId,
          working_title: d.title?.trim() || episodeId,
          premise: '',
          status: 'dropped',
          source_bot: 'elo',
          created_by: 'system',
          created_at: t,
          updated_by: 'system',
          updated_at: t,
          entry_revision: 1,
          notes: 'Added by ELO because the episode was dropped with no Upcoming entry.',
          script_path: null,
          drop_id: dropId,
        }) as UpcomingEntryT,
      )
      made = true
    })
    if (made)
      this.d.audit.write({
        actor: 'system',
        action: 'upcoming.adopt',
        target: `${channel}/${episodeId}`,
        after: { drop_id: dropId },
      })
    return made
  }

  /** Gives every recent accepted episode drop that has no entry its entry. Safe to run again. */
  adoptOrphanDrops(): Promise<number> {
    if (!this.d.settings.get().upcomingEnabled) return Promise.resolve(0)
    return this.serial(() => {
      const f = this.readDiskOrCache()
      const known = new Set(f.episodes.map((e) => `${e.channel}/${e.episode_id}`))
      const cutoff = new Date(this.now() - 14 * 86_400_000).toISOString()
      let n = 0
      for (const d of this.d.db
        .prepare(
          "SELECT drop_id, channel, episode_id FROM drops WHERE result = 'accepted' AND post_type = 'episode' AND episode_id IS NOT NULL AND received_at >= ? ORDER BY received_at",
        )
        .all(cutoff) as Array<{ drop_id: string; channel: string; episode_id: string }>) {
        if (known.has(`${d.channel}/${d.episode_id}`)) continue
        try {
          if (this.adopt(d.channel, d.episode_id, d.drop_id)) n++
        } catch {
          // One bad row must not stop the rest.
        }
      }
      return n
    })
  }

  private readDiskOrCache(): UpcomingFileT {
    const disk = this.readDisk()
    return disk.kind === 'ok' ? disk.file : this.cached()
  }

  /** Puts the file back to the copy before the last change by someone else. Nothing is deleted from history. */
  restorePrevious(): Promise<UpcomingFileT> {
    return this.serial(() => {
      const rows = this.d.db
        .prepare('SELECT id, json, actor FROM upcoming_history ORDER BY id DESC LIMIT 50')
        .all() as Array<{ id: number; json: string; actor: string }>
      // The newest snapshot is the current one. Go back to the last one written by an allowed actor (josh, system or ELO's own writes).
      const current = rows[0]
      const prev = rows.slice(1).find((r) => r.json !== current?.json)
      if (!prev) throw new UpcomingError(404, 'There is no earlier copy to restore.')
      const snap = JSON.parse(prev.json) as UpcomingFileT
      const out = this.mutate('josh', 'restore', (f) => {
        f.episodes = snap.episodes
      })
      this.saveState({ violations: [] })
      this.d.audit.write({
        actor: 'josh',
        action: 'upcoming.restore',
        target: 'upcoming.json',
        after: { fromRevision: snap.revision, toRevision: out.revision },
      })
      return out
    })
  }

  /** Starts the list over: no entries, revision 1. The old file is in the history and in the fresh start backup. */
  resetClean(): Promise<{ revision: number; updatedAt: string }> {
    return this.serial(() => {
      const next: UpcomingFileT = {
        schema_version: UPCOMING_VERSION,
        revision: 1,
        updated_at: this.iso(),
        episodes: [],
      }
      const text = JSON.stringify(next, null, 2) + '\n'
      const p = this.filePath()
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(`${p}.tmp`, text)
      renameSync(`${p}.tmp`, p)
      this.saveState({
        revision: 1,
        hash: sha(text),
        json: text,
        invalidSince: null,
        invalidReason: null,
        invalidAlerted: false,
        violations: [],
      })
      this.history(next, 'josh', 'fresh start')
      this.d.onChange?.()
      return { revision: 1, updatedAt: next.updated_at }
    })
  }

  /** Dismisses the flagged file edits without restoring. */
  dismissViolations(): void {
    this.saveState({ violations: [] })
    this.d.audit.write({ actor: 'josh', action: 'upcoming.dismiss', target: 'violations' })
    this.d.onChange?.()
  }

  /** One time, once per idea: each unused Studio idea becomes an idea entry for its channel. */
  async moveStudioIdeas(): Promise<number> {
    const ideas = this.d.studioIdeas?.() ?? []
    const moved = new Set(
      (
        this.d.db.prepare('SELECT idea_id FROM upcoming_moved_ideas').all() as Array<{
          idea_id: number
        }>
      ).map((r) => r.idea_id),
    )
    let n = 0
    for (const idea of ideas) {
      if (moved.has(idea.id)) continue
      let brand
      try {
        brand = this.d.brands.get(idea.brandId)
      } catch {
        continue
      }
      if (!brand.slug) continue
      await this.add(
        { name: 'josh' },
        {
          channel: brand.slug,
          working_title: idea.text.slice(0, 120),
          premise: idea.text.length > 120 ? idea.text : '',
        },
      )
      this.d.db
        .prepare('INSERT OR IGNORE INTO upcoming_moved_ideas (idea_id, moved_at) VALUES (?, ?)')
        .run(idea.id, this.iso())
      n++
    }
    this.d.audit.write({
      actor: 'josh',
      action: 'upcoming.moveIdeas',
      target: 'studio ideas',
      after: { moved: n },
    })
    return n
  }

  // ---------- watching ----------

  start(): void {
    this.stop()
    const s = this.d.settings.get()
    if (!s.upcomingEnabled) return
    this.load()
    const p = this.filePath()
    if (s.upcomingLiveWatch) {
      try {
        mkdirSync(dirname(p), { recursive: true })
        this.watcher = watch(dirname(p), () => {
          if (this.debounce) clearTimeout(this.debounce)
          this.debounce = setTimeout(() => this.load(), 500)
        })
        this.watcher.on('error', () => {})
      } catch {
        // Polling below still works.
      }
    }
    this.poll = setInterval(() => this.load(), Math.max(2, s.upcomingPollSeconds) * 1000)
    void this.adoptOrphanDrops().catch(() => undefined)
    this.sweep = setInterval(() => void this.adoptOrphanDrops().catch(() => undefined), 5 * 60_000)
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.poll) clearInterval(this.poll)
    this.poll = null
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = null
    if (this.sweep) clearInterval(this.sweep)
    this.sweep = null
  }

  // ---------- reconcile ----------

  /** Problems for the reconcile check (section 6.8). Report only. */
  issues(): FoundIssue[] {
    const s = this.d.settings.get()
    if (!s.upcomingEnabled) return []
    const out: FoundIssue[] = []
    const f = this.cached()
    const st = this.state()
    const brandId = (slug: string) => this.d.brands.bySlug(slug)?.id ?? null
    for (const k of this.duplicates(f))
      out.push({
        key: `upcoming:dup:${k}`,
        kind: 'upcoming',
        brandId: null,
        postId: null,
        detail: `Upcoming has the episode id ${k} more than once. The list is read only until that is fixed.`,
      })
    const dropIds = new Set(
      (
        this.d.db
          .prepare("SELECT drop_id FROM drops WHERE result IN ('accepted','held')")
          .all() as Array<{ drop_id: string }>
      ).map((r) => r.drop_id),
    )
    const nowMs = this.now()
    for (const e of f.episodes) {
      if (e.status === 'dropped' && (!e.drop_id || !dropIds.has(e.drop_id)))
        out.push({
          key: `upcoming:nodrop:${e.channel}/${e.episode_id}`,
          kind: 'upcoming',
          brandId: brandId(e.channel),
          postId: null,
          detail: `${e.channel} ${e.episode_id} is marked dropped but there is no matching row in the drop log.`,
        })
      if (
        e.status === 'needs-review' &&
        nowMs - new Date(e.updated_at).getTime() > STALE_REVIEW_DAYS * 86_400_000
      )
        out.push({
          key: `upcoming:stale:${e.channel}/${e.episode_id}`,
          kind: 'upcoming',
          brandId: brandId(e.channel),
          postId: null,
          detail: `${e.channel} ${e.episode_id} has been in needs-review for more than ${STALE_REVIEW_DAYS} days.`,
        })
      if (e.conflict)
        out.push({
          key: `upcoming:conflict:${e.channel}/${e.episode_id}`,
          kind: 'upcoming',
          brandId: brandId(e.channel),
          postId: null,
          detail: `${e.channel} ${e.episode_id} has a conflict: ${e.conflict_detail ?? ''}`,
        })
    }
    const known = new Set(f.episodes.map((e) => `${e.channel}/${e.episode_id}`))
    const cutoff = new Date(nowMs - 14 * 86_400_000).toISOString()
    for (const d of this.d.db
      .prepare(
        "SELECT drop_id, channel, episode_id FROM drops WHERE result = 'accepted' AND post_type = 'episode' AND episode_id IS NOT NULL AND received_at >= ?",
      )
      .all(cutoff) as Array<{ drop_id: string; channel: string; episode_id: string }>)
      if (!known.has(`${d.channel}/${d.episode_id}`))
        out.push({
          key: `upcoming:orphandrop:${d.drop_id}`,
          kind: 'upcoming',
          brandId: brandId(d.channel),
          postId: null,
          detail: `${d.channel} ${d.episode_id} was dropped but has no entry in Upcoming (warning).`,
        })
    for (const v of st.violations) {
      const e = v.channel ? this.find(f, v.channel, v.episodeId) : null
      // A problem with an entry clears once somebody changes that entry again.
      if (e && v.entryRevision !== null && e.entry_revision !== v.entryRevision) continue
      out.push({
        key: `upcoming:violation:${v.key}`,
        kind: 'upcoming',
        brandId: v.channel ? brandId(v.channel) : null,
        postId: null,
        detail: v.detail,
      })
    }
    if (st.invalidSince && nowMs - new Date(st.invalidSince).getTime() > INVALID_HOUR_MS)
      out.push({
        key: 'upcoming:invalid',
        kind: 'upcoming',
        brandId: null,
        postId: null,
        detail: `upcoming.json could not be read for over an hour: ${st.invalidReason ?? ''}`,
      })
    return out
  }

  /** Unused: kept so a file's modification time can be shown. */
  fileTime(): string | null {
    try {
      return statSync(this.filePath()).mtime.toISOString()
    } catch {
      return null
    }
  }
}

function UpcomingEntryParse(raw: Record<string, unknown>): UpcomingEntryT {
  const parsed = UpcomingFile.shape.episodes.element.safeParse(raw)
  if (!parsed.success)
    throw new UpcomingError(
      400,
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    )
  return parsed.data as UpcomingEntryT
}
