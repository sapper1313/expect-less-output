import { DateTime } from 'luxon'
import type { Db } from '../../db'
import { addDays, dueDates, productionDays, slotToUtc, todayEastern, windowOpensOn } from '@shared/studio/cadence'
import type { AgentTask, StudioBrandConfig } from '@shared/studio/types'
import type { StudioConfigService } from '../configService'
import type { AuditLog, TaskStore } from './framework'

const AGENT = 'Director'

export interface BrandContext {
  brandId: number
  name: string
  config: StudioBrandConfig
  today: string
  nowMs: number
}

/** A planner looks at one brand and may create tasks. Later phases add planners (produce, publish, analytics). */
export type Planner = (ctx: BrandContext, d: DirectorDeps, notes: string[]) => AgentTask[]

export interface DirectorDeps {
  db: Db
  config: StudioConfigService
  tasks: TaskStore
  audit: AuditLog
  alert: (headline: string, detail: string) => void
  now?: () => number
  /** Called at the end of every tick. The watchdog heartbeat file is written from here. */
  onTick?: () => void
}

export interface TickResult {
  created: AgentTask[]
  notes: string[]
}

const DELIVERED = ['Video received', 'Checking video', 'Scheduled', 'Posted']
const GONE = ['Failed', 'Archived']

/**
 * The manager. Wakes on a timer, looks at every brand's cadence, runway, caps and calendar, and creates the next
 * tasks. It never writes content. Retries and escalation to FLAGGED are done by the runner.
 */
export class Director {
  private planners: Planner[] = []

  constructor(private d: DirectorDeps) {
    this.planners.push(runwayPlanner, missedSlotWatcher)
  }

  addPlanner(p: Planner): void {
    this.planners.push(p)
  }

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  tick(): TickResult {
    const cfg = this.d.config.get()
    const out: TickResult = { created: [], notes: [] }
    if (cfg.paused) {
      out.notes.push('Everything is paused. No new work was started.')
      this.d.audit.write({ agent: AGENT, action: 'tick', detail: { paused: true } })
      this.d.onTick?.()
      return out
    }
    const nowMs = this.now()
    const today = todayEastern(nowMs)
    for (const b of this.d.config.listBrandConfigs()) {
      if (b.config.paused) {
        out.notes.push(`${b.name} is paused.`)
        continue
      }
      const ctx: BrandContext = { brandId: b.brandId, name: b.name, config: b.config, today, nowMs }
      for (const p of this.planners) out.created.push(...p(ctx, this.d, out.notes))
    }
    this.d.audit.write({
      agent: AGENT,
      action: 'tick',
      detail: { created: out.created.map((t) => `${t.type}#${t.id}`), notes: out.notes.slice(0, 20) },
    })
    this.d.onTick?.()
    return out
  }
}

function episodesOn(db: Db, brandId: number, date: string) {
  return db
    .prepare('SELECT id, status FROM episodes WHERE brand_id = ? AND slot_date = ?')
    .all(brandId, date) as Array<{ id: string; status: string }>
}

/** Keeps N days of scripts ahead. Asks the Writer for every uncovered posting date. No alert: this is the Director's job. */
const runwayPlanner: Planner = (ctx, d, notes) => {
  const horizon = addDays(ctx.today, ctx.config.runwayDays)
  const created: AgentTask[] = []
  for (const date of dueDates(ctx.config, ctx.today, horizon)) {
    const covered = episodesOn(d.db, ctx.brandId, date).some((e) => !GONE.includes(e.status))
    if (covered) continue
    // A write task that was flagged or stopped waits for the owner. Asking again every tick would only repeat the failure.
    const parked = d.tasks
      .list({ brandId: ctx.brandId, type: 'write_episode', status: ['flagged', 'stopped'] })
      .some((t) => (t.payload as { slotDate?: string }).slotDate === date)
    if (parked) continue
    const key = `write:${ctx.brandId}:${date}`
    const before = d.tasks.list({ brandId: ctx.brandId, type: 'write_episode', status: ['queued', 'running', 'waiting'] })
    const had = before.some((t) => (t.payload as { slotDate?: string }).slotDate === date)
    const t = d.tasks.create({
      type: 'write_episode',
      brandId: ctx.brandId,
      payload: { slotDate: date },
      dedupeKey: key,
    })
    if (!had) {
      created.push(t)
      d.audit.write({ agent: AGENT, action: 'ask_writer', brandId: ctx.brandId, taskId: t.id, detail: { slotDate: date } })
    }
  }
  if (created.length) notes.push(`${ctx.name}: asked the Writer for ${created.length} episode(s) to fill the runway.`)
  return created
}

/** Tells the owner when a posting slot will be missed, or when a package is still not READY after its window opened. */
const missedSlotWatcher: Planner = (ctx, d, notes) => {
  const isPackage = ctx.config.path === 'package'
  const tomorrow = addDays(ctx.today, 1)
  const etHour = DateTime.fromMillis(ctx.nowMs, { zone: 'America/New_York' }).hour
  for (const date of dueDates(ctx.config, ctx.today, tomorrow)) {
    const eps = episodesOn(d.db, ctx.brandId, date).filter((e) => !GONE.includes(e.status))
    if (eps.some((e) => DELIVERED.includes(e.status))) continue
    if (isPackage) {
      // A package brand is produced elsewhere. It is late once the date is here, or on the last production day in the evening.
      const days = productionDays(ctx.config, date)
      const lastDay = days[days.length - 1]
      const lateTomorrow = date === tomorrow && lastDay === ctx.today && etHour >= 17
      if (date > ctx.today && !lateTomorrow) continue
    } else if (ctx.nowMs < firstSlotMs(d.db, ctx.brandId, date) - 30 * 60_000) {
      // A short is made well ahead, so it only counts as missed once its posting time is close.
      continue
    }
    if (alerted(d.db, ctx.brandId, 'missed_slot_alert', date)) continue
    const why = eps.length ? `its episode is "${eps[0].status}"` : 'there is no episode for it'
    d.alert('A posting slot will be missed.', `${ctx.name} is due ${date} but ${why}.`)
    d.audit.write({ agent: AGENT, action: 'missed_slot_alert', brandId: ctx.brandId, detail: { date } })
    notes.push(`${ctx.name}: alerted that the ${date} slot will be missed.`)
  }
  if (isPackage) {
    for (const date of dueDates(ctx.config, ctx.today, addDays(ctx.today, 8))) {
      const opens = windowOpensOn(ctx.config, date)
      if (!opens || opens > ctx.today) continue
      const eps = episodesOn(d.db, ctx.brandId, date).filter((e) => !GONE.includes(e.status))
      const ready = eps.some((e) => ['Ready for production', 'In production', 'Awaiting video', ...DELIVERED].includes(e.status))
      if (ready || alerted(d.db, ctx.brandId, 'not_ready_alert', date)) continue
      // The Writer is still on it: that is the Director's job, not a reason to bother the owner.
      const active = d.tasks
        .list({ brandId: ctx.brandId, type: 'write_episode', status: ['queued', 'running', 'waiting'] })
        .some((t) => (t.payload as { slotDate?: string }).slotDate === date)
      if (active) continue
      d.alert('An episode package is not ready.', `${ctx.name} for ${date}: the production window opened ${opens} and the package is not READY.`)
      d.audit.write({ agent: AGENT, action: 'not_ready_alert', brandId: ctx.brandId, detail: { date } })
    }
  }
  return []
}

/** The first enabled posting slot of that day for the brand, as a UTC time. Midday when the brand has none. */
function firstSlotMs(db: Db, brandId: number, date: string): number {
  const weekend = [6, 7].includes(DateTime.fromISO(date, { zone: 'America/New_York' }).weekday)
  const row = db
    .prepare('SELECT time_local FROM brand_slots WHERE brand_id = ? AND enabled = 1 AND day_type = ? ORDER BY time_local LIMIT 1')
    .get(brandId, weekend ? 'weekend' : 'weekday') as { time_local: string } | undefined
  return new Date(slotToUtc(date, row?.time_local ?? '12:00')).getTime()
}

function alerted(db: Db, brandId: number, action: string, date: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM audit_log WHERE agent = 'Director' AND action = ? AND brand_id = ? AND detail_json LIKE ?")
    .get(action, brandId, `%"date":"${date}"%`)
}
