import type { Brand, BrandState, Post, PostType } from './types'

export class EloError extends Error {
  constructor(
    public kind: 'unauthorized' | 'unreachable' | 'badResponse',
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = 'EloError'
  }
}

export interface BrandStats {
  views: number
  likes: number
  comments: number
  shares: number
  approximate: boolean
}

export interface PostStats {
  views: number | null
  approximate: boolean
}

const bad = (msg: string) => new EloError('badResponse', msg)

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** ELO list responses are either a bare array or an object holding the array under `key`. */
function unwrapList(raw: unknown, key: string): unknown[] {
  if (Array.isArray(raw)) return raw
  if (isObj(raw) && Array.isArray(raw[key])) return raw[key] as unknown[]
  throw bad(`expected a list under "${key}"`)
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const timeStr = (v: unknown): string | null => {
  const m = typeof v === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(v) : null
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return m[0].padStart(5, '0')
}
const intList = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : []

function normalizeSlots(raw: unknown): { weekday: string[]; weekend: string[] } {
  const out = { weekday: [] as string[], weekend: [] as string[] }
  if (Array.isArray(raw)) {
    for (const s of raw) {
      if (!isObj(s)) continue
      const enabled = s.enabled === undefined ? true : Boolean(s.enabled)
      const t = timeStr(s.time_local ?? s.time)
      if (!enabled || !t) continue
      const kind =
        s.day_type === 'weekend' ? 'weekend' : s.day_type === 'weekday' ? 'weekday' : null
      if (kind) out[kind].push(t)
    }
  } else if (isObj(raw)) {
    for (const kind of ['weekday', 'weekend'] as const) {
      const list = raw[kind]
      if (Array.isArray(list)) {
        for (const t of list) {
          const ts = timeStr(t)
          if (ts) out[kind].push(ts)
        }
      }
    }
  }
  return out
}

export function normalizeBrand(raw: unknown): Brand {
  if (!isObj(raw) || typeof raw.id !== 'number' || typeof raw.name !== 'string') {
    throw bad('unrecognized brand')
  }
  let state: BrandState
  if (raw.archived === true || raw.state === 'archived') state = 'archived'
  else if (raw.state === 'paused' || raw.paused === true) state = 'paused'
  else if (raw.state === 'on-hold' || raw.on_hold === true) state = 'on-hold'
  else state = 'active'
  return {
    id: raw.id,
    name: raw.name,
    state,
    // ELO treats null and [] alike: post every day.
    postDays:
      Array.isArray(raw.post_days) && raw.post_days.length > 0 ? intList(raw.post_days) : null,
    dailyCap:
      typeof raw.daily_cap === 'number' && raw.daily_cap >= 0 ? Math.floor(raw.daily_cap) : 1,
    episodeTimes: normalizeSlots(raw.slots),
    kinds: Array.isArray(raw.kinds)
      ? raw.kinds
          .filter((k): k is Record<string, unknown> => isObj(k) && k.enabled !== false)
          .map((k) => ({
            kind: (k.kind === 'long' ? 'long' : 'short') as 'short' | 'long',
            days: Array.isArray(k.days) && k.days.length > 0 ? intList(k.days) : null,
            times: normalizeSlots(k.slots),
          }))
      : undefined,
    clipDays: intList(raw.clip_post_days),
    clipTime: timeStr(raw.clip_time),
    blackoutDates: Array.isArray(raw.blackout_dates)
      ? raw.blackout_dates.filter((d): d is string => typeof d === 'string')
      : [],
  }
}

/** Field names and value types only, never values, so errors are safe to paste. */
function describeFields(raw: unknown, names: string[]): string {
  if (!isObj(raw)) return `not an object: ${raw === null ? 'null' : typeof raw}`
  return names
    .map((n) => {
      const v = raw[n]
      return `${n}:${v === undefined ? 'missing' : v === null ? 'null' : typeof v}`
    })
    .join(', ')
}

export function normalizePost(raw: unknown): Post {
  const scheduled = isObj(raw) ? (raw.scheduled_at ?? raw.scheduled_at_utc) : undefined
  if (
    !isObj(raw) ||
    typeof raw.id !== 'number' ||
    typeof raw.brand_id !== 'number' ||
    typeof scheduled !== 'string'
  ) {
    throw bad(
      `unrecognized post (${describeFields(raw, ['id', 'brand_id', 'scheduled_at', 'post_type', 'status'])})`,
    )
  }
  const status = typeof raw.status === 'string' ? raw.status : 'unknown'
  const postedAt =
    typeof raw.posted_at === 'string'
      ? raw.posted_at
      : typeof raw.posted_at_utc === 'string'
        ? raw.posted_at_utc
        : null
  return {
    id: raw.id,
    brandId: raw.brand_id,
    type: raw.post_type as PostType,
    status,
    scheduledAtUtc: scheduled,
    // ELO has no separate posted time; a posted post went out at its scheduled time.
    postedAtUtc: postedAt ?? (status === 'posted' ? scheduled : null),
    title: typeof raw.title === 'string' ? raw.title : '',
  }
}

/** Like normalizePost, but returns null for a post with no scheduled time (an unscheduled draft). */
export function tryNormalizePost(raw: unknown): Post | null {
  if (
    isObj(raw) &&
    typeof raw.id === 'number' &&
    (raw.scheduled_at ?? raw.scheduled_at_utc) == null
  )
    return null
  return normalizePost(raw)
}

/** Where answers come from. ELO answers from inside the app, no network. */
export type EloTransport = (
  path: string,
  params?: Record<string, string | number | undefined>,
) => Promise<unknown>

export class EloClient {
  constructor(private request: EloTransport) {}

  async health(): Promise<number> {
    await this.request('/v1/health')
    return 200
  }

  async brands(): Promise<Brand[]> {
    const raw = await this.request('/v1/brands')
    const brands = unwrapList(raw, 'brands').map(normalizeBrand)
    // ELO may report global blackout dates beside the list; every brand observes them.
    const global =
      isObj(raw) && Array.isArray(raw.global_blackout_dates)
        ? raw.global_blackout_dates.filter((d): d is string => typeof d === 'string')
        : []
    if (global.length > 0) {
      for (const b of brands) b.blackoutDates = [...new Set([...b.blackoutDates, ...global])]
    }
    return brands
  }

  async posts(brandId: number, fromIso: string, toIso: string): Promise<Post[]> {
    const raw = unwrapList(
      await this.request('/v1/posts', { brand_id: brandId, from: fromIso, to: toIso }),
      'posts',
    )
    return raw
      .map(tryNormalizePost)
      .filter((p): p is Post => p !== null && (p.type === 'episode' || p.type === 'clip'))
  }

  async nextOpen(brandId: number, days: number): Promise<string[]> {
    const raw = await this.request('/v1/slots/next-open', { brand_id: brandId, count: 60, days })
    return unwrapList(raw, 'slots')
      .map((s) => (isObj(s) && typeof s.at === 'string' ? new Date(s.at).toISOString() : null))
      .filter((s): s is string => s !== null)
  }

  async brandStats(brandId: number, range: '7d' | '30d'): Promise<BrandStats> {
    const raw = await this.request(`/v1/brands/${brandId}/stats`, { range })
    if (!isObj(raw)) throw bad('unrecognized brand stats')
    let t: Record<string, unknown> | null = isObj(raw.totals) ? raw.totals : null
    const platforms = Array.isArray(raw.platforms) ? raw.platforms : []
    let approximate = false
    if (!t) {
      t = { views: 0, likes: 0, comments: 0, shares: 0 }
      for (const p of platforms) {
        const n = isObj(p) && isObj(p.numbers) ? p.numbers : isObj(p) ? p : {}
        for (const k of ['views', 'likes', 'comments', 'shares']) t[k] = num(t[k]) + num(n[k])
      }
    }
    for (const p of platforms) {
      if (isObj(p) && Array.isArray(p.approximate) && p.approximate.length > 0) approximate = true
    }
    return {
      views: num(t.views),
      likes: num(t.likes),
      comments: num(t.comments),
      shares: num(t.shares),
      approximate,
    }
  }

  async postStats(postId: number): Promise<PostStats> {
    const raw = await this.request(`/v1/posts/${postId}/stats`)
    if (!isObj(raw)) throw bad('unrecognized post stats')
    let total = 0
    let any = false
    let approximate = false
    for (const t of Array.isArray(raw.targets) ? raw.targets : []) {
      if (!isObj(t)) continue
      const v = isObj(t.numbers) ? t.numbers.views : undefined
      if (typeof v === 'number') {
        total += v
        any = true
      }
      if (Array.isArray(t.approximate) && t.approximate.length > 0) approximate = true
    }
    return { views: any ? total : null, approximate }
  }
}
