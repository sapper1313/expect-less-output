import { DateTime } from 'luxon'
import type { Post, Slot, SlotState } from './types'

export interface MatchedSlot extends Slot {
  state: SlotState
  postId: number | null
}

export interface Totals {
  slots: number
  filled: number
  open: number
  attention: number
  percent: number
  empty: boolean
}

export interface MatchOptions {
  tz?: string
  /** Brand id to ELO daily cap. A brand missing from the map (or with cap 0) matches episodes by exact minute. */
  dailyCapByBrand?: Map<number, number>
}

function minuteIso(iso: string): string | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Date(Math.floor(t / 60000) * 60000).toISOString()
}

function stateOf(status: string): SlotState | null {
  if (status === 'canceled' || status === 'draft') return null
  if (status === 'failed' || status === 'missed') return 'attention'
  return 'filled'
}

interface Usable {
  post: Post
  state: SlotState
  minute: string
}

/**
 * Matches posts to expected slots the way ELO does.
 * - Episodes of a brand with a daily cap, and all clips, are matched per Eastern date: any usable post that date
 *   fills one of that date's expected slots (an exact-minute post claims its own slot first).
 * - Episodes of a brand with no cap are matched by exact scheduled minute.
 */
export function matchSlots(slots: Slot[], posts: Post[], opts: MatchOptions = {}): MatchedSlot[] {
  const tz = opts.tz ?? 'America/New_York'
  const caps = opts.dailyCapByBrand ?? new Map<number, number>()
  const usable: Usable[] = []
  for (const post of posts) {
    const state = stateOf(post.status)
    const minute = minuteIso(post.scheduledAtUtc)
    if (state && minute) usable.push({ post, state, minute })
  }
  const dayLevel = (s: Slot) => s.type === 'clip' || (caps.get(s.brandId) ?? 0) > 0
  const result = new Map<Slot, { state: SlotState; postId: number }>()

  // Exact-minute matching (uncapped episodes).
  const byMinute = new Map<string, { state: SlotState; postId: number }>()
  for (const u of usable) {
    const key = `${u.post.brandId}|${u.post.type}|${u.minute}`
    const cur = byMinute.get(key)
    if (!cur || (cur.state === 'attention' && u.state === 'filled'))
      byMinute.set(key, { state: u.state, postId: u.post.id })
  }
  for (const s of slots) {
    if (dayLevel(s)) continue
    const hit = byMinute.get(`${s.brandId}|${s.type}|${s.instant}`)
    if (hit) result.set(s, hit)
  }

  // Per Eastern date matching (capped episodes and clips).
  const postsByDay = new Map<string, Usable[]>()
  for (const u of usable) {
    const date = DateTime.fromISO(u.minute, { zone: 'utc' }).setZone(tz).toISODate()
    const key = `${u.post.brandId}|${u.post.type}|${date}`
    const list = postsByDay.get(key)
    if (list) list.push(u)
    else postsByDay.set(key, [u])
  }
  const slotsByDay = new Map<string, Slot[]>()
  for (const s of slots) {
    if (!dayLevel(s)) continue
    const key = `${s.brandId}|${s.type}|${s.date}`
    const list = slotsByDay.get(key)
    if (list) list.push(s)
    else slotsByDay.set(key, [s])
  }
  for (const [key, daySlots] of slotsByDay) {
    const candidates = [...(postsByDay.get(key) ?? [])].sort(
      (a, b) =>
        Number(a.state === 'attention') - Number(b.state === 'attention') ||
        a.minute.localeCompare(b.minute),
    )
    const free = [...daySlots].sort((a, b) => a.instant.localeCompare(b.instant))
    const rest: Usable[] = []
    for (const c of candidates) {
      const i = free.findIndex((s) => s.instant === c.minute)
      if (i >= 0) {
        result.set(free[i], { state: c.state, postId: c.post.id })
        free.splice(i, 1)
      } else rest.push(c)
    }
    for (const c of rest) {
      const s = free.shift()
      if (!s) break
      result.set(s, { state: c.state, postId: c.post.id })
    }
  }

  return slots.map((s) => {
    const hit = result.get(s)
    return { ...s, state: hit?.state ?? 'open', postId: hit?.postId ?? null }
  })
}

export function summarize(matched: MatchedSlot[]): Totals {
  const slots = matched.length
  const attention = matched.filter((m) => m.state === 'attention').length
  const open = matched.filter((m) => m.state === 'open').length
  const filled = slots - open
  return {
    slots,
    filled,
    open,
    attention,
    percent: slots === 0 ? 0 : Math.round((filled / slots) * 100),
    empty: slots === 0,
  }
}
