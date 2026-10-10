import type { ZodType } from 'zod'
import type { Db } from '../../db'
import type { AgentTask, AuditEntry, TaskStatus } from '@shared/studio/types'
import type { StudioConfigService } from '../configService'
import { CapReached } from '../spend'

/** Throw from a handler for a problem worth retrying with backoff (network, rate limit, bad output). */
export class RetryableError extends Error {
  constructor(
    message: string,
    public retryAfterSeconds?: number,
    /** Tokens a failed call still used, so the spend ledger stays honest. */
    public usage?: { inputTokens: number; outputTokens: number },
  ) {
    super(message)
    this.name = 'RetryableError'
  }
}

/** Throw from a handler to say "nothing to do yet, ask me again at this time" (for example a video still rendering). */
export class Waiting extends Error {
  constructor(
    public untilMs: number,
    message = 'waiting',
  ) {
    super(message)
    this.name = 'Waiting'
  }
}

/** Throw when the problem needs the owner. The task becomes FLAGGED at once, with no more retries. */
export class FlagNow extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlagNow'
  }
}

const iso = (ms: number) => new Date(ms).toISOString()

function mapTask(r: any): AgentTask {
  return {
    id: r.id,
    type: r.type,
    brandId: r.brand_id,
    episodeId: r.episode_id,
    parentId: r.parent_id,
    status: r.status,
    attempts: r.attempts,
    payload: JSON.parse(r.payload_json || '{}'),
    result: r.result_json ? JSON.parse(r.result_json) : null,
    error: r.error,
    notBeforeUtc: r.not_before_utc,
    createdUtc: r.created_utc,
    startedUtc: r.started_utc,
    finishedUtc: r.finished_utc,
  }
}

export interface NewTask {
  type: string
  brandId?: number | null
  episodeId?: string | null
  parentId?: number | null
  payload?: Record<string, unknown>
  /** Only one active task may have this key. A second create returns the existing one. */
  dedupeKey?: string
  notBeforeMs?: number
}

export class AuditLog {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  write(e: {
    agent: string
    action: string
    brandId?: number | null
    taskId?: number | null
    episodeId?: string | null
    detail?: unknown
  }): void {
    this.db
      .prepare(
        'INSERT INTO audit_log (ts_utc, brand_id, agent, action, task_id, episode_id, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        iso(this.now()),
        e.brandId ?? null,
        e.agent,
        e.action,
        e.taskId ?? null,
        e.episodeId ?? null,
        e.detail === undefined ? null : JSON.stringify(e.detail),
      )
  }

  list(f: { brandId?: number | null; agent?: string; fromUtc?: string; toUtc?: string; limit?: number } = {}): AuditEntry[] {
    const where: string[] = []
    const args: unknown[] = []
    if (f.brandId) {
      where.push('brand_id = ?')
      args.push(f.brandId)
    }
    if (f.agent) {
      where.push('agent = ?')
      args.push(f.agent)
    }
    if (f.fromUtc) {
      where.push('ts_utc >= ?')
      args.push(f.fromUtc)
    }
    if (f.toUtc) {
      where.push('ts_utc < ?')
      args.push(f.toUtc)
    }
    args.push(f.limit ?? 300)
    const rows = this.db
      .prepare(`SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`)
      .all(...args) as any[]
    return rows.map((r) => ({
      id: r.id,
      tsUtc: r.ts_utc,
      brandId: r.brand_id,
      agent: r.agent,
      action: r.action,
      taskId: r.task_id,
      episodeId: r.episode_id,
      detail: r.detail_json ? JSON.parse(r.detail_json) : null,
    }))
  }
}

export class TaskStore {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  create(t: NewTask): AgentTask {
    if (t.dedupeKey) {
      const ex = this.db
        .prepare(
          "SELECT * FROM agent_tasks WHERE dedupe_key = ? AND status IN ('queued','running','waiting')",
        )
        .get(t.dedupeKey)
      if (ex) return mapTask(ex)
    }
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO agent_tasks (type, brand_id, episode_id, parent_id, status, payload_json, dedupe_key, not_before_utc, created_utc)
           VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
        )
        .run(
          t.type,
          t.brandId ?? null,
          t.episodeId ?? null,
          t.parentId ?? null,
          JSON.stringify(t.payload ?? {}),
          t.dedupeKey ?? null,
          t.notBeforeMs ? iso(t.notBeforeMs) : null,
          iso(this.now()),
        ).lastInsertRowid,
    )
    return this.get(id) as AgentTask
  }

  get(id: number): AgentTask | null {
    const r = this.db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id)
    return r ? mapTask(r) : null
  }

  list(f: { status?: TaskStatus | TaskStatus[]; brandId?: number | null; type?: string; limit?: number } = {}): AgentTask[] {
    const where: string[] = []
    const args: unknown[] = []
    if (f.status) {
      const s = Array.isArray(f.status) ? f.status : [f.status]
      where.push(`status IN (${s.map(() => '?').join(',')})`)
      args.push(...s)
    }
    if (f.brandId) {
      where.push('brand_id = ?')
      args.push(f.brandId)
    }
    if (f.type) {
      where.push('type = ?')
      args.push(f.type)
    }
    args.push(f.limit ?? 300)
    return (
      this.db
        .prepare(`SELECT * FROM agent_tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`)
        .all(...args) as any[]
    ).map(mapTask)
  }

  /** Tasks ready to start: queued, or waiting whose time has come. */
  due(types: string[]): AgentTask[] {
    if (!types.length) return []
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_tasks WHERE status IN ('queued','waiting') AND type IN (${types.map(() => '?').join(',')})
         AND (not_before_utc IS NULL OR not_before_utc <= ?) ORDER BY id`,
      )
      .all(...types, iso(this.now())) as any[]
    return rows.map(mapTask)
  }

  /** Claims a task. Returns false if someone else already did. */
  claim(id: number): boolean {
    const r = this.db
      .prepare("UPDATE agent_tasks SET status = 'running', started_utc = ? WHERE id = ? AND status IN ('queued','waiting')")
      .run(iso(this.now()), id)
    return r.changes === 1
  }

  /** After a crash or quit: anything left running goes back to queued. Attempts are kept. */
  recoverRunning(): number {
    return this.db.prepare("UPDATE agent_tasks SET status = 'queued' WHERE status = 'running'").run().changes
  }

  setStatus(id: number, status: TaskStatus, extra: { result?: unknown; error?: string | null; notBeforeMs?: number | null; attempts?: number } = {}): void {
    const done = ['done', 'failed', 'stopped', 'flagged'].includes(status)
    this.db
      .prepare(
        `UPDATE agent_tasks SET status = ?, result_json = COALESCE(?, result_json), error = ?, not_before_utc = ?,
         attempts = COALESCE(?, attempts), finished_utc = ? WHERE id = ?`,
      )
      .run(
        status,
        extra.result === undefined ? null : JSON.stringify(extra.result),
        extra.error ?? null,
        extra.notBeforeMs ? iso(extra.notBeforeMs) : null,
        extra.attempts ?? null,
        done ? iso(this.now()) : null,
        id,
      )
  }

  /** The owner pressed Retry on a flagged or stopped task. */
  reopen(id: number): void {
    this.db
      .prepare("UPDATE agent_tasks SET status = 'queued', attempts = 0, error = NULL, not_before_utc = NULL, finished_utc = NULL WHERE id = ? AND status IN ('flagged','stopped','failed')")
      .run(id)
  }

  setEpisode(id: number, episodeId: string): void {
    this.db.prepare('UPDATE agent_tasks SET episode_id = ? WHERE id = ?').run(episodeId, id)
  }

  setPayload(id: number, payload: Record<string, unknown>): void {
    this.db.prepare('UPDATE agent_tasks SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), id)
  }
}

export interface AgentCtx {
  task: AgentTask
  audit: (action: string, detail?: unknown) => void
  now: () => number
  config: StudioConfigService
  tasks: TaskStore
}

export interface AgentDef<I = unknown, O = unknown> {
  /** Name shown in the Director's Log, for example "Show Writer". */
  name: string
  /** The task type that runs this agent. */
  taskType: string
  /** What the agent is for. Sent as the system prompt for text agents. */
  role: string
  input: ZodType<I>
  output: ZodType<O>
  /** Tools the agent may use. Anything else is refused by the runner. */
  tools: string[]
  /** True for steps that make a paid call. These run under the paid concurrency limit. */
  paid?: boolean
  run(ctx: AgentCtx, input: I): Promise<O>
}

export interface RunnerDeps {
  tasks: TaskStore
  audit: AuditLog
  config: StudioConfigService
  now?: () => number
  /** Called once when a task becomes FLAGGED so the owner is told. */
  onFlag?: (task: AgentTask, reason: string) => void
}

export class AgentRunner {
  private agents = new Map<string, AgentDef<any, any>>()
  private active = 0
  private disabled = new Set<string>()

  constructor(private d: RunnerDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  register(def: AgentDef<any, any>): void {
    this.agents.set(def.taskType, def)
  }

  agentNames(): string[] {
    return [...new Set([...this.agents.values()].map((a) => a.name))]
  }

  setDisabled(names: string[]): void {
    this.disabled = new Set(names)
  }

  /** Starts every due task it is allowed to. Returns how many ran. New paid work is held back when paused. */
  async runDue(): Promise<number> {
    const cfg = this.d.config.get()
    if (cfg.paused) return 0
    const types = [...this.agents.entries()]
      .filter(([, a]) => !this.disabled.has(a.name))
      .map(([t]) => t)
    const due = this.d.tasks.due(types).filter((t) => {
      if (t.brandId && this.d.config.getBrand(t.brandId).paused) return false
      return true
    })
    let started = 0
    const running: Array<Promise<void>> = []
    for (const t of due) {
      const def = this.agents.get(t.type) as AgentDef
      if (def.paid && this.active >= cfg.paidConcurrency) continue
      if (!this.d.tasks.claim(t.id)) continue
      started++
      if (def.paid) this.active++
      running.push(
        this.execute(t, def).finally(() => {
          if (def.paid) this.active--
        }),
      )
    }
    await Promise.all(running)
    return started
  }

  /** Keeps running until nothing is due. Used by tests and the "Dry run day" button. */
  async runUntilIdle(max = 200): Promise<number> {
    let total = 0
    for (let i = 0; i < max; i++) {
      const n = await this.runDue()
      if (!n) break
      total += n
    }
    return total
  }

  private async execute(task: AgentTask, def: AgentDef): Promise<void> {
    const audit = (action: string, detail?: unknown) =>
      this.d.audit.write({ agent: def.name, action, brandId: task.brandId, taskId: task.id, episodeId: task.episodeId, detail })
    audit('start', { type: task.type, attempt: task.attempts + 1 })
    try {
      const input = def.input.parse(task.payload)
      const out = await def.run(
        { task, audit, now: () => this.now(), config: this.d.config, tasks: this.d.tasks },
        input,
      )
      const parsed = def.output.safeParse(out)
      if (!parsed.success) throw new RetryableError(`The agent's answer did not match its schema: ${parsed.error.message.slice(0, 200)}`)
      this.d.tasks.setStatus(task.id, 'done', { result: parsed.data, attempts: task.attempts + 1 })
      audit('done')
    } catch (e) {
      this.fail(task, e, audit)
    }
  }

  private fail(task: AgentTask, e: unknown, audit: (a: string, d?: unknown) => void): void {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof CapReached) {
      this.d.tasks.setStatus(task.id, 'stopped', { error: msg, attempts: task.attempts })
      audit('stopped', { reason: msg })
      return
    }
    if (e instanceof Waiting) {
      this.d.tasks.setStatus(task.id, 'waiting', { notBeforeMs: e.untilMs, attempts: task.attempts })
      audit('waiting', { until: new Date(e.untilMs).toISOString() })
      return
    }
    if (e instanceof FlagNow) {
      this.d.tasks.setStatus(task.id, 'flagged', { error: msg, attempts: task.attempts + 1 })
      audit('flagged', { reason: msg })
      this.d.onFlag?.(this.d.tasks.get(task.id) ?? task, msg)
      return
    }
    const cfg = this.d.config.get()
    const attempts = task.attempts + 1
    if (attempts >= cfg.retryCap) {
      this.d.tasks.setStatus(task.id, 'flagged', { error: msg, attempts })
      audit('flagged', { reason: msg, attempts })
      this.d.onFlag?.(this.d.tasks.get(task.id) ?? task, msg)
      return
    }
    const wait =
      e instanceof RetryableError && e.retryAfterSeconds
        ? e.retryAfterSeconds
        : cfg.backoffBaseSeconds * 2 ** (attempts - 1)
    this.d.tasks.setStatus(task.id, 'queued', { error: msg, attempts, notBeforeMs: this.now() + wait * 1000 })
    audit('retry', { attempt: attempts, error: msg, inSeconds: wait })
  }
}
