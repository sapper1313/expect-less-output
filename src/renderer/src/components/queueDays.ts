import type { Post } from '@shared/types'

const TZ = 'America/New_York'
export const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
/** The time one platform entry goes out: its own time, else the post's. */
export const entryAt = (p: Post, t: Post['targets'][number]) => t.scheduledAtUtc ?? p.scheduledAtUtc
/** Every Eastern day this post has a live entry on, oldest first. A post with no entry times files under its own time. */
export function entryDays(p: Post): string[] {
  const days = new Set<string>()
  for (const t of p.targets) {
    const at = t.status === 'skipped' ? null : entryAt(p, t)
    if (at) days.add(dayKey(at))
  }
  if (!days.size && p.scheduledAtUtc) days.add(dayKey(p.scheduledAtUtc))
  return [...days].sort()
}
/** The first time this post has on one day, for sorting inside that day. */
export function firstOn(p: Post, day: string): string {
  const times = p.targets.filter((t) => t.status !== 'skipped').map((t) => entryAt(p, t)).filter((x): x is string => !!x && dayKey(x) === day)
  return times.length ? times.reduce((a, b) => (a < b ? a : b)) : String(p.scheduledAtUtc)
}
