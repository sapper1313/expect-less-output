import { DateTime } from 'luxon'
import type { Db } from '../db'
import type { BrandService } from '../services/brands'
import type { PostService } from '../services/posts'
import type { SettingsService } from '../services/settings'
import { ZONE } from '@shared/time'
import type { OpenSlot } from '@shared/pipeline'
import { channelState } from './state'

/** The slots in a window that have nothing in them, for every channel (or one), from each channel's settings. */
export function openSlotsFor(
  d: { db: Db; brands: BrandService; posts: PostService },
  fromUtc: string,
  toUtc: string,
  brandId: number | null,
): OpenSlot[] {
  const out: OpenSlot[] = []
  for (const b of d.brands.list(false)) {
    if (brandId && b.id !== brandId) continue
    const state = channelState(d.db, b.id)
    if (state === 'archived') continue
    const waiting = (type: string) =>
      (
        d.db
          .prepare(
            `SELECT COUNT(*) AS n FROM posts WHERE brand_id = ? AND origin = 'inbox' AND status = 'draft'
             AND hold_reason IS NULL AND post_type = ? AND media_purged_at IS NULL`,
          )
          .get(b.id, type) as { n: number }
      ).n
    for (const s of d.posts.openSlotsInRange(b.id, fromUtc, toUtc))
      out.push({
        brandId: b.id,
        brandName: b.name,
        brandColor: b.color,
        whenUtc: s.whenUtc,
        kind: s.kind,
        channelState: state,
        waiting: waiting(s.kind),
      })
  }
  return out.sort((a, c) => a.whenUtc.localeCompare(c.whenUtc))
}

export interface GapDeps {
  db: Db
  brands: BrandService
  posts: PostService
  settings: SettingsService
  /** Sends the warning to the owner (iMessage, email and Telegram). */
  send: (text: string) => Promise<void>
  now?: () => number
}

/**
 * Once a day, at the set time, tells the owner about empty slots from now until the end of tomorrow, for channels that
 * are running. Sends nothing when every slot is filled. Never sends twice in one day.
 */
export class GapWarner {
  constructor(private d: GapDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  /** The text of the warning, or null when there is nothing to say. */
  message(): string | null {
    const now = DateTime.fromMillis(this.now(), { zone: ZONE })
    const end = now.plus({ days: 1 }).endOf('day')
    const slots = openSlotsFor(
      this.d,
      now.toUTC().toISO() as string,
      end.toUTC().toISO() as string,
      null,
    ).filter((s) => s.channelState === 'active')
    if (!slots.length) return null
    const lines: string[] = []
    const byDay = new Map<string, OpenSlot[]>()
    for (const s of slots) {
      const day = DateTime.fromISO(s.whenUtc, { zone: 'utc' }).setZone(ZONE)
      const key = day.toFormat('yyyy-MM-dd')
      byDay.set(key, [...(byDay.get(key) ?? []), s])
    }
    const today = now.toFormat('yyyy-MM-dd')
    for (const [key, list] of byDay) {
      const label = key === today ? 'Today' : 'Tomorrow'
      const day = DateTime.fromISO(key, { zone: ZONE })
      lines.push(
        `${label}, ${day.toFormat('ccc L/d')}: ` +
          list
            .map(
              (s) =>
                `${s.brandName} ${DateTime.fromISO(s.whenUtc, { zone: 'utc' }).setZone(ZONE).toFormat('h:mma').toLowerCase()}${s.kind === 'clip' ? ' (clip)' : ''}${s.waiting ? ` [${s.waiting} waiting in the Inbox]` : ''}`,
            )
            .join(', '),
      )
    }
    return `Empty slots coming up:\n${lines.join('\n')}`
  }

  /** Called every few minutes. Sends at most one warning a day, after the set time. */
  async check(): Promise<boolean> {
    const s = this.d.settings.get()
    if (!s.gapWarnEnabled) return false
    const now = DateTime.fromMillis(this.now(), { zone: ZONE })
    const today = now.toFormat('yyyy-MM-dd')
    if (s.gapWarnLastDay === today) return false
    const [h, m] = s.gapWarnTime.split(':').map(Number)
    if (now.hour * 60 + now.minute < h * 60 + m) return false
    this.d.settings.set({ gapWarnLastDay: today })
    const text = this.message()
    if (!text) return false
    await this.d.send(text)
    return true
  }
}
