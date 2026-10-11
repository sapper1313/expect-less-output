import type { Db } from '../db'
import { monthEastern, todayEastern } from '@shared/studio/cadence'
import { round } from '@shared/studio/pricing'
import type { Cap, CapUsage, LedgerRow, SpendSummary } from '@shared/studio/types'
import type { StudioConfigService } from './configService'

export class CapReached extends Error {
  constructor(
    public capKey: string,
    public label: string,
    public limit: number,
    public spent: number,
    public attempted: number,
  ) {
    super(
      `Stopped: ${label} reached. Spent $${spent.toFixed(2)} of $${limit.toFixed(2)}, and this step needs about $${attempted.toFixed(2)} more.`,
    )
    this.name = 'CapReached'
  }
}

export interface NewLedgerRow {
  brandId?: number | null
  episodeId?: string | null
  taskId?: number | null
  vendor: 'xai' | 'anthropic'
  model: string
  resolution?: string | null
  units: number
  unitKind: 'seconds' | 'images' | 'tokens'
  unitPrice: number
  dollars: number
  requestId?: string | null
  outcome?: string
  purpose: string
  mock: boolean
}

export interface PaidCall {
  brandId?: number | null
  episodeId?: string | null
  vendor: 'xai' | 'anthropic'
  /** Worst case dollars for this one call. Caps are checked against this BEFORE the call. */
  dollars: number
  mock?: boolean
}

type Alert = (headline: string, detail: string) => void

const LABELS: Record<string, string> = {
  global: 'the global monthly cap',
  text: 'the AI text cap',
}

export class SpendService {
  constructor(
    private db: Db,
    private cfg: StudioConfigService,
    private alert: Alert,
    private now: () => number = Date.now,
    private brandName: (id: number) => string = (id) => `Brand ${id}`,
  ) {}

  private month(): string {
    return monthEastern(this.now())
  }

  private sum(where: string, ...args: unknown[]): number {
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(dollars), 0) AS s FROM spend_ledger WHERE mock = 0 AND ${where}`,
      )
      .get(...args) as { s: number }
    return r.s
  }

  /** What one episode has cost so far, split by what the money bought. */
  episodeCost(episodeId: string): {
    total: number
    mock: number
    parts: Array<{ label: string; dollars: number }>
  } {
    const rows = this.db
      .prepare(
        'SELECT vendor, purpose, mock, COALESCE(SUM(dollars), 0) AS d FROM spend_ledger WHERE episode_id = ? GROUP BY vendor, purpose, mock',
      )
      .all(episodeId) as Array<{ vendor: string; purpose: string; mock: number; d: number }>
    const name = (r: { vendor: string; purpose: string }) =>
      r.vendor === 'anthropic'
        ? 'Writing and checking (AI text)'
        : r.purpose === 'thumbnail'
          ? 'Thumbnails'
          : r.purpose === 'retry'
            ? 'Video retakes'
            : r.vendor === 'xai'
              ? 'Video and images'
              : `${r.vendor} ${r.purpose}`
    const parts = new Map<string, number>()
    let total = 0
    let mock = 0
    for (const r of rows) {
      if (r.mock) {
        mock += r.d
        continue
      }
      total += r.d
      parts.set(name(r), (parts.get(name(r)) ?? 0) + r.d)
    }
    return {
      total: Math.round(total * 1e6) / 1e6,
      mock,
      parts: Array.from(parts, ([label, dollars]) => ({
        label,
        dollars: Math.round(dollars * 1e6) / 1e6,
      })).sort((a, b) => b.dollars - a.dollars),
    }
  }

  /** Dollars spent against each cap that applies to a call. */
  private applicable(call: { brandId?: number | null; episodeId?: string | null; vendor: string }) {
    const c = this.cfg.get()
    const m = this.month()
    const out: Array<{ key: string; label: string; cap: Cap; spent: number }> = []
    out.push({
      key: 'global',
      label: LABELS.global,
      cap: c.globalCap,
      spent: this.sum('month_et = ?', m),
    })
    if (call.vendor === 'anthropic')
      out.push({
        key: 'text',
        label: LABELS.text,
        cap: c.aiTextCap,
        spent: this.sum("month_et = ? AND vendor = 'anthropic'", m),
      })
    if (call.brandId) {
      const bc = this.cfg.getBrand(call.brandId)
      out.push({
        key: `brand:${call.brandId}`,
        label: `the monthly cap for ${this.brandName(call.brandId)}`,
        cap: bc.monthlyCap,
        spent: this.sum('month_et = ? AND brand_id = ?', m, call.brandId),
      })
      if (call.episodeId)
        out.push({
          key: `episode:${call.episodeId}`,
          label: `the per episode cap for ${call.episodeId}`,
          cap: this.cfg.episodeCap(call.brandId),
          spent: this.sum('episode_id = ?', call.episodeId),
        })
    }
    return out
  }

  /** Throws CapReached, and sends one alert per cap per day, if this call would cross an enabled cap. */
  check(call: PaidCall): void {
    if (call.mock ?? this.cfg.get().mockMode) return
    for (const a of this.applicable(call)) {
      if (a.cap.none) continue
      if (a.spent + call.dollars > a.cap.value + 1e-9) {
        this.announceStop(a.key, a.label, a.cap.value, a.spent, call.dollars)
        throw new CapReached(a.key, a.label, a.cap.value, a.spent, call.dollars)
      }
    }
  }

  private announceStop(
    key: string,
    label: string,
    limit: number,
    spent: number,
    attempted: number,
  ) {
    const period = `stop:${todayEastern(this.now())}`
    const r = this.db
      .prepare(
        'INSERT OR IGNORE INTO spend_alerts (period, cap_key, threshold, ts_utc) VALUES (?, ?, 1, ?)',
      )
      .run(period, key, new Date(this.now()).toISOString())
    if (r.changes)
      this.alert(
        'Spending stopped.',
        `Stopped: ${label} reached ($${spent.toFixed(2)} of $${limit.toFixed(2)}). A step needing about $${attempted.toFixed(2)} did not run.`,
      )
  }

  /** Writes one ledger row. A repeat of the same vendor, request id and purpose is ignored, so a resumed job is never paid twice. */
  record(row: NewLedgerRow): LedgerRow | null {
    const ts = new Date(this.now()).toISOString()
    const r = this.db
      .prepare(
        `INSERT OR IGNORE INTO spend_ledger (ts_utc, month_et, brand_id, episode_id, task_id, vendor, model, resolution,
           units, unit_kind, unit_price, dollars, request_id, outcome, purpose, mock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ts,
        this.month(),
        row.brandId ?? null,
        row.episodeId ?? null,
        row.taskId ?? null,
        row.vendor,
        row.model,
        row.resolution ?? null,
        row.units,
        row.unitKind,
        row.unitPrice,
        round(row.dollars),
        row.requestId ?? null,
        row.outcome ?? 'ok',
        row.purpose,
        row.mock ? 1 : 0,
      )
    if (!r.changes) return null
    if (!row.mock) this.announceThresholds(row)
    return this.byId(Number(r.lastInsertRowid))
  }

  private announceThresholds(row: NewLedgerRow) {
    const m = this.month()
    for (const a of this.applicable(row)) {
      if (a.cap.none || a.cap.value <= 0) continue
      const pct = (a.spent / a.cap.value) * 100
      const period = a.key.startsWith('episode:') ? 'all' : m
      for (const t of [50, 80, 100]) {
        if (pct < t) continue
        const ins = this.db
          .prepare(
            'INSERT OR IGNORE INTO spend_alerts (period, cap_key, threshold, ts_utc) VALUES (?, ?, ?, ?)',
          )
          .run(period, a.key, t, new Date(this.now()).toISOString())
        if (ins.changes)
          this.alert(
            `Spend at ${t} percent.`,
            `${a.label} is at ${Math.round(pct)} percent ($${a.spent.toFixed(2)} of $${a.cap.value.toFixed(2)}).`,
          )
      }
    }
  }

  private byId(id: number): LedgerRow {
    return mapRow(this.db.prepare('SELECT * FROM spend_ledger WHERE id = ?').get(id))
  }

  recent(limit = 50): LedgerRow[] {
    return (
      this.db.prepare('SELECT * FROM spend_ledger ORDER BY id DESC LIMIT ?').all(limit) as unknown[]
    ).map(mapRow)
  }

  forEpisode(episodeId: string): { dollars: number; rows: LedgerRow[] } {
    const rows = (
      this.db
        .prepare('SELECT * FROM spend_ledger WHERE episode_id = ? ORDER BY id')
        .all(episodeId) as unknown[]
    ).map(mapRow)
    return { dollars: round(rows.filter((r) => !r.mock).reduce((n, r) => n + r.dollars, 0)), rows }
  }

  summary(): SpendSummary {
    const m = this.month()
    const c = this.cfg.get()
    const brands = this.db
      .prepare(
        `SELECT l.brand_id AS brandId, COALESCE(b.name, 'No brand') AS brandName, SUM(l.dollars) AS dollars
         FROM spend_ledger l LEFT JOIN brands b ON b.id = l.brand_id
         WHERE l.mock = 0 AND l.month_et = ? GROUP BY l.brand_id ORDER BY dollars DESC`,
      )
      .all(m) as SpendSummary['byBrand']
    const vendors = this.db
      .prepare(
        `SELECT vendor, SUM(dollars) AS dollars FROM spend_ledger WHERE mock = 0 AND month_et = ? GROUP BY vendor`,
      )
      .all(m) as SpendSummary['byVendor']
    const total = this.sum('month_et = ?', m)
    const mockTotal = (
      this.db
        .prepare(
          'SELECT COALESCE(SUM(dollars),0) AS s FROM spend_ledger WHERE mock = 1 AND month_et = ?',
        )
        .get(m) as { s: number }
    ).s
    const caps: CapUsage[] = []
    const add = (key: string, label: string, cap: Cap, spent: number) =>
      caps.push({
        key,
        label,
        cap,
        spent: round(spent),
        remaining: cap.none ? null : round(cap.value - spent),
      })
    add('global', 'Global monthly', c.globalCap, total)
    add(
      'text',
      'AI text (Anthropic)',
      c.aiTextCap,
      this.sum("month_et = ? AND vendor = 'anthropic'", m),
    )
    for (const b of this.cfg.listBrandConfigs())
      add(
        `brand:${b.brandId}`,
        b.name,
        b.config.monthlyCap,
        this.sum('month_et = ? AND brand_id = ?', m, b.brandId),
      )
    return {
      month: m,
      byBrand: brands,
      byVendor: vendors,
      total: round(total),
      mockTotal: round(mockTotal),
      caps,
    }
  }

  exportCsv(): string {
    const head = [
      'timestamp_utc',
      'brand',
      'episode',
      'task',
      'vendor',
      'model',
      'resolution',
      'units',
      'unit_kind',
      'unit_price',
      'dollars',
      'request_id',
      'outcome',
      'purpose',
      'mock',
    ]
    const rows = this.db
      .prepare(
        `SELECT l.*, COALESCE(b.name,'') AS bname FROM spend_ledger l LEFT JOIN brands b ON b.id = l.brand_id ORDER BY l.id`,
      )
      .all() as Array<Record<string, unknown>>
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
    }
    const lines = rows.map((r) =>
      [
        r.ts_utc,
        r.bname,
        r.episode_id,
        r.task_id,
        r.vendor,
        r.model,
        r.resolution,
        r.units,
        r.unit_kind,
        r.unit_price,
        r.dollars,
        r.request_id,
        r.outcome,
        r.purpose,
        r.mock ? 'mock' : 'real',
      ]
        .map(esc)
        .join(','),
    )
    return [head.join(','), ...lines].join('\n') + '\n'
  }
}

function mapRow(r: any): LedgerRow {
  return {
    id: r.id,
    tsUtc: r.ts_utc,
    brandId: r.brand_id,
    episodeId: r.episode_id,
    taskId: r.task_id,
    vendor: r.vendor,
    model: r.model,
    resolution: r.resolution,
    units: r.units,
    unitKind: r.unit_kind,
    unitPrice: r.unit_price,
    dollars: r.dollars,
    requestId: r.request_id,
    outcome: r.outcome,
    purpose: r.purpose,
    mock: !!r.mock,
  }
}
