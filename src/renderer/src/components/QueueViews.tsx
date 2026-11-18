import { useMemo, useState } from 'react'
import type { Post, TargetStatus } from '@shared/types'
import { api } from '../api'
import { useLoad } from '../hooks'
import { Button, PlatformLogo } from '../ui'
import { dayKey, entryAt, entryDays, firstOn } from './queueDays'

const TZ = 'America/New_York'
const dayLabel = (key: string) =>
  new Date(key + 'T12:00:00Z')
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .toUpperCase()
const timeET = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }) + ' ET'
    : 'No time'
/** When this post next needs to go out: its earliest platform still waiting, else its own time. */
export function nextDue(p: Post): string | null {
  const open = p.targets
    .filter((t) => t.status !== 'posted' && t.status !== 'skipped' && (t.scheduledAtUtc ?? p.scheduledAtUtc))
    .map((t) => (t.scheduledAtUtc ?? p.scheduledAtUtc) as string)
  return open.length ? open.reduce((a, b) => (a < b ? a : b)) : p.scheduledAtUtc
}
const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (key: string, n: number) => {
  const d = new Date(key + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const STATUS_TEXT: Record<TargetStatus, string> = {
  pending: 'Scheduled',
  uploading: 'Sending',
  processing: 'Processing',
  posted: 'Posted ✓',
  handed_off: 'Handed off',
  needs_action: 'Needs action',
  failed: 'Failed',
  skipped: 'Skipped',
}
const STATUS_STYLE: Record<TargetStatus, string> = {
  pending: 'border-line text-muted',
  uploading: 'border-accent text-accent',
  processing: 'border-accent text-accent',
  posted: 'border-ok text-ok',
  handed_off: 'border-accent text-accent',
  needs_action: 'border-warn text-warn',
  failed: 'border-bad text-bad',
  skipped: 'border-line text-muted line-through',
}

type Props = {
  posts: Post[]
  selected: Set<number>
  onToggle: (id: number) => void
  onOpen: (id: number) => void
  onPreview: (post: Post) => void
  onSchedule: () => void
  /** When the Queue is filtered to one channel, only that channel's open slots are shown. */
  onlyBrand?: string | null
}

function Thumb({ post, w = 'w-[52px]', h = 'h-[74px]' }: { post: Post; w?: string; h?: string }) {
  const secs = Math.round(Number(post.videoMeta?.durationSeconds ?? 0))
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-lg bg-surface2 ${w} ${h}`}>
      {post.posterUrl && <img src={post.posterUrl} alt="" className="h-full w-full object-cover" />}
      {secs > 0 && (
        <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1 text-[10px] font-semibold text-white">
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
        </span>
      )}
    </div>
  )
}

/** One post as a card: picture, channel, title, and one pill per platform with its own time and state. */
function PostCard({ p, day, selected, onToggle, onOpen, onPreview }: Omit<Props, 'posts' | 'selected' | 'onSchedule'> & { p: Post; day?: string; selected: boolean }) {
  const here = day ? p.targets.filter((t) => t.status !== 'skipped' && (entryAt(p, t) ? dayKey(entryAt(p, t)!) === day : true)) : p.targets
  const elsewhere = p.targets.length - here.length
  return (
    <div className={`rounded-lg border bg-surface p-3 ${selected ? 'border-accent' : 'border-line'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`Select ${p.title}`}
          className="mt-1 h-4 w-4 accent-[var(--accent)]"
          checked={selected}
          onChange={() => onToggle(p.id)}
        />
        <Thumb post={p} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: p.brandColor }} />
                {p.brandName}
              </div>
              <div className="truncate text-[17px] font-bold" title={p.title}>
                {p.title || p.fileName}
              </div>
            </div>
            <div className="flex shrink-0 gap-4 text-[13px] font-semibold text-muted">
              <button onClick={() => onOpen(p.id)} className="hover:text-ink">Edit</button>
              <button onClick={() => onOpen(p.id)} className="hover:text-ink">Move</button>
              <button onClick={() => onPreview(p)} className="hover:text-ink">Preview</button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {here.map((t) => (
              <span
                key={t.id}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-semibold ${STATUS_STYLE[t.status]}`}
              >
                <PlatformLogo platform={t.platform} size={16} />
                {timeET(entryAt(p, t))}{' '}
                · {STATUS_TEXT[t.status]}
              </span>
            ))}
            {day && elsewhere > 0 && <span className="self-center text-[12px] text-muted">+{elsewhere} on other days</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Posts grouped by day, newest day last, with the open slots of each day as dashed cards. */
export function VisualTimeline(props: Props) {
  const { posts, selected, onToggle, onOpen, onPreview, onSchedule, onlyBrand } = props
  const { data: snap } = useLoad(() => api.dashboard.snapshot(), [])
  const days = useMemo(() => {
    const by = new Map<string, Post[]>()
    for (const p of posts) {
      const ds = entryDays(p)
      for (const k of ds.length ? ds : ['none']) by.set(k, [...(by.get(k) ?? []), p])
    }
    const open = new Map<string, Map<string, string[]>>()
    for (const s of snap?.openSlots ?? []) {
      if (s.date < todayKey() || (onlyBrand && s.brand !== onlyBrand)) continue
      const m = open.get(s.date) ?? new Map<string, string[]>()
      m.set(s.brand, [...(m.get(s.brand) ?? []), s.timeET])
      open.set(s.date, m)
    }
    const keys = [...new Set([...by.keys(), ...open.keys()])].sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : a.localeCompare(b)))
    return keys.map((k) => ({
      key: k,
      posts: (by.get(k) ?? []).sort((a, b) => firstOn(a, k).localeCompare(firstOn(b, k))),
      open: open.get(k),
    }))
  }, [posts, snap, onlyBrand])
  const today = todayKey()

  return (
    <div className="space-y-6">
      {days.map((d) => (
        <section key={d.key}>
          <h2 className="mb-2 text-[15px] font-bold tracking-wide">
            {d.key === 'none'
              ? 'NO TIME SET'
              : `${d.key === today ? 'TODAY' : d.key === addDays(today, 1) ? 'TOMORROW' : ''}${d.key === today || d.key === addDays(today, 1) ? ' · ' : ''}${dayLabel(d.key)}`}
          </h2>
          <div className="space-y-2.5">
            {d.posts.map((p) => (
              <PostCard key={p.id} p={p} day={d.key === 'none' ? undefined : d.key} selected={selected.has(p.id)} onToggle={onToggle} onOpen={onOpen} onPreview={onPreview} />
            ))}
            {d.open &&
              [...d.open.entries()].map(([brand, times]) => (
                <div key={brand} className="rounded-lg border border-dashed border-line p-4 text-center">
                  <div className="text-[14px]">
                    {times.length} open slot{times.length === 1 ? '' : 's'} {d.key === today ? 'today' : d.key === addDays(today, 1) ? 'tomorrow' : 'on ' + dayLabel(d.key)} on {brand} ({times.join(' & ')} ET)
                  </div>
                  <Button className="mt-2" onClick={onSchedule}>
                    + Drop or pick video
                  </Button>
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** A plain seven day calendar of the posts that are listed. */
export function WeekCalendar(props: Props) {
  const { posts, onOpen } = props
  const [offset, setOffset] = useState(0)
  const start = useMemo(() => {
    const t = todayKey()
    const dow = new Date(t + 'T12:00:00Z').getUTCDay()
    return addDays(t, -dow + offset * 7)
  }, [offset])
  const keys = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const today = todayKey()
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Button onClick={() => setOffset(offset - 1)}>◀</Button>
        <b className="text-[14px]">
          {dayLabel(keys[0])} to {dayLabel(keys[6])}
        </b>
        <Button onClick={() => setOffset(offset + 1)}>▶</Button>
        {offset !== 0 && <Button onClick={() => setOffset(0)}>This week</Button>}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {keys.map((k) => {
          const list = posts
            .filter((p) => entryDays(p).includes(k))
            .sort((a, b) => firstOn(a, k).localeCompare(firstOn(b, k)))
          return (
            <div key={k} className={`min-h-[180px] rounded-lg border p-2 ${k === today ? 'border-accent' : 'border-line'} bg-surface`}>
              <div className="mb-2 text-[11px] font-bold tracking-wide text-muted">{dayLabel(k)}</div>
              <div className="space-y-2">
                {list.map((p) => (
                  <button key={p.id} onClick={() => onOpen(p.id)} className="block w-full rounded-lg bg-surface2 p-1.5 text-left">
                    <div className="flex gap-2">
                      <Thumb post={p} w="w-[30px]" h="h-[44px]" />
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold">{timeET(firstOn(p, k))}</div>
                        <div className="truncate text-[11px]" title={p.title}>{p.title || p.fileName}</div>
                        <div className="mt-1 flex gap-1">
                          {p.targets.filter((t) => t.status !== 'skipped' && entryAt(p, t) && dayKey(entryAt(p, t)!) === k).slice(0, 5).map((t) => (
                            <PlatformLogo key={t.id} platform={t.platform} size={12} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
