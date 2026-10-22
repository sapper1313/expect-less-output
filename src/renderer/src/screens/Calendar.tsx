import { useEffect, useMemo, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import type { CalendarItem, CalendarKind } from '@shared/studio/types'
import type { OpenSlot } from '@shared/pipeline'
import type { Post } from '@shared/types'
import { COPY } from '@shared/copy'
import { ZONE } from '@shared/time'
import { api } from '../api'
import { useLoad } from '../hooks'
import { PostEditor } from '../components/PostEditor'
import { ItemDetail, PostDetail } from '../components/ItemDetail'
import { Button, ClipBadge, PLATFORM_SHORT, PageHeader, Select, StatusBadge } from '../ui'
import { EpisodePeek } from './StudioLibrary'

const TARGET_COLOR: Record<string, string> = {
  posted: '#8fbf7f',
  failed: '#ff7a6b',
  missed: '#ff7a6b',
  pending: '#ffffff88',
  handed_off: '#ffb347',
  uploading: '#ffb347',
  processing: '#ffb347',
  needs_action: '#e8b34a',
  skipped: '#ffffff44',
}

const KIND_LABEL: Record<CalendarKind, string> = {
  posted: 'Posted',
  scheduled: 'Scheduled',
  in_production: 'In production',
  awaiting_video: 'Awaiting video',
  flagged: 'Flagged',
  failed: 'Failed',
  planned: 'Planned',
  production_window: 'Production window',
}
const POST_KIND: Record<string, CalendarKind> = {
  posted: 'posted',
  failed: 'failed',
  missed: 'failed',
}

/** One line of the list: a post, a Studio item, or a slot with nothing in it. */
type Row =
  | { type: 'post'; at: string; post: Post }
  | { type: 'item'; at: string; item: CalendarItem }
  | { type: 'open'; at: string; slot: OpenSlot }

const dayKey = (iso: string) =>
  DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('yyyy-MM-dd')

export function Calendar({
  onNewPost,
  openInbox,
}: {
  onNewPost?: (whenUtc: string | null) => void
  openInbox?: () => void
} = {}) {
  const [brandId, setBrandId] = useState<number | 'all'>('all')
  const [platform, setPlatform] = useState('')
  /** '' shows everything. 'open' shows only the slots with nothing in them. */
  const [kind, setKind] = useState<CalendarKind | 'open' | ''>('')
  const [month, setMonth] = useState(() => DateTime.now().setZone(ZONE).startOf('month'))
  const range = useMemo(
    () => ({
      from: month.toUTC().toISO() as string,
      to: month.plus({ months: 1 }).toUTC().toISO() as string,
    }),
    [month],
  )
  const { data: brands } = useLoad(() => api.brands.list())
  const { data: posts } = useLoad(
    () =>
      api.posts.list({
        brandId: brandId === 'all' ? null : brandId,
        fromUtc: range.from,
        toUtc: range.to,
      }),
    [brandId, range.from],
  )
  const { data: items } = useLoad(
    () =>
      api.studio.calendar({
        fromUtc: range.from,
        toUtc: range.to,
        brandId: brandId === 'all' ? null : brandId,
        platform: platform || null,
        kind: null,
      }),
    [brandId, platform, range.from],
  )
  const { data: slots } = useLoad(
    () => api.slots.open(range.from, range.to, brandId === 'all' ? null : brandId),
    [brandId, range.from],
  )
  const [viewing, setViewing] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [viewItem, setViewItem] = useState<CalendarItem | null>(null)
  const [openEpisode, setOpenEpisode] = useState<string | null>(null)

  const rows = useMemo(() => {
    const out: Row[] = []
    for (const p of posts ?? []) {
      if (!p.scheduledAtUtc || p.status === 'canceled') continue
      if (platform && !p.targets.some((t) => t.platform === platform)) continue
      if (kind === 'open') continue
      if (kind && (POST_KIND[p.status] ?? 'scheduled') !== kind) continue
      out.push({ type: 'post', at: p.scheduledAtUtc, post: p })
    }
    if (kind !== 'open')
      for (const i of items ?? []) {
        if (i.postId !== null) continue
        // The open slots below come from the channel settings, so the Studio's own planned days and windows are left out.
        if (i.kind === 'planned' || i.kind === 'production_window') continue
        if (kind && i.kind !== kind) continue
        out.push({ type: 'item', at: i.allDay ? `${i.date}T12:00:00.000Z` : i.startUtc, item: i })
      }
    // Slots do not belong to a platform, so they hide while a platform filter is on.
    if (!platform && (kind === '' || kind === 'open'))
      for (const s of slots ?? []) out.push({ type: 'open', at: s.whenUtc, slot: s })
    return out.sort((a, b) => a.at.localeCompare(b.at))
  }, [posts, items, slots, platform, kind])

  const days = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of rows) m.set(dayKey(r.at), [...(m.get(dayKey(r.at)) ?? []), r])
    return [...m.entries()]
  }, [rows])

  const today = DateTime.now().setZone(ZONE).toFormat('yyyy-MM-dd')
  const todayRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    todayRef.current?.scrollIntoView({ block: 'start' })
  }, [month.toMillis(), days.length > 0])

  const time = (iso: string) =>
    DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('h:mma').toLowerCase()

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={COPY.nav.calendar}>
        {onNewPost && (
          <Button variant="primary" onClick={() => onNewPost(null)}>
            New post
          </Button>
        )}
        <Select
          className="w-40"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          aria-label="Platform"
        >
          <option value="">All platforms</option>
          {['youtube', 'facebook', 'instagram', 'tiktok', 'bluesky'].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select
          className="w-44"
          value={kind}
          onChange={(e) => setKind(e.target.value as CalendarKind | 'open' | '')}
          aria-label="Status"
        >
          <option value="">All statuses</option>
          <option value="open">Open slots only</option>
          {(Object.keys(KIND_LABEL) as CalendarKind[])
            .filter((k) => k !== 'planned' && k !== 'production_window')
            .map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
        </Select>
        <Select
          className="w-64"
          value={brandId}
          onChange={(e) => setBrandId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          aria-label="Brand"
        >
          <option value="all">All brands</option>
          {brands?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </PageHeader>

      <div className="flex items-center gap-3 px-8 pb-3">
        <Button aria-label="Previous month" onClick={() => setMonth(month.minus({ months: 1 }))}>
          ‹
        </Button>
        <Button aria-label="Next month" onClick={() => setMonth(month.plus({ months: 1 }))}>
          ›
        </Button>
        <Button onClick={() => setMonth(DateTime.now().setZone(ZONE).startOf('month'))}>
          Today
        </Button>
        <h2 className="display ml-4 text-3xl uppercase">{month.toFormat('LLLL yyyy')}</h2>
        <span className="ml-auto text-[12px] text-muted">
          Slots come from each channel's settings. A dashed circle is a slot with nothing in it.
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-8 pb-6">
        {days.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line p-10 text-center text-muted">
            {COPY.emptyCalendar}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            {days.map(([day, list]) => {
              const d = DateTime.fromISO(day, { zone: ZONE })
              const isToday = day === today
              return (
                <div key={day} ref={isToday ? todayRef : undefined}>
                  <div
                    className={`flex items-center justify-between border-b border-line px-5 py-3 text-[15px] font-bold ${isToday ? 'bg-accent/20' : 'bg-surface2'}`}
                  >
                    <span>
                      {d.toFormat('LLLL d, yyyy')}
                      {isToday && (
                        <span className="ml-3 text-[11px] uppercase text-accent">Today</span>
                      )}
                    </span>
                    <span>{d.toFormat('cccc')}</span>
                  </div>
                  {list.map((r, i) => (
                    <div
                      key={`${r.type}-${i}-${r.at}`}
                      className="flex items-start gap-4 border-b border-line px-5 py-3 last:border-b-0"
                    >
                      <div className="w-20 shrink-0 pt-0.5 text-[15px] text-muted">
                        {time(r.at)}
                      </div>
                      {r.type === 'post' && (
                        <PostLine post={r.post} onOpen={() => setViewing(r.post.id)} />
                      )}
                      {r.type === 'item' && (
                        <ItemLine item={r.item} onOpen={() => setViewItem(r.item)} />
                      )}
                      {r.type === 'open' && (
                        <OpenLine
                          slot={r.slot}
                          onAdd={() => onNewPost?.(r.slot.whenUtc)}
                          onInbox={openInbox}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {viewing !== null && (
        <PostDetail
          postId={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing)
            setViewing(null)
          }}
        />
      )}
      {viewItem && (
        <ItemDetail
          item={viewItem}
          onClose={() => setViewItem(null)}
          onOpenEpisode={() => {
            setOpenEpisode(viewItem.episodeId)
            setViewItem(null)
          }}
        />
      )}
      {editing !== null && <PostEditor postId={editing} onClose={() => setEditing(null)} />}
      {openEpisode && <EpisodePeek id={openEpisode} onClose={() => setOpenEpisode(null)} />}
    </div>
  )
}

function Dot({ color, hollow }: { color: string; hollow?: boolean }) {
  return hollow ? (
    <span
      aria-hidden
      className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-dashed"
      style={{ borderColor: color }}
    />
  ) : (
    <span
      aria-hidden
      className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  )
}

function PostLine({ post, onOpen }: { post: Post; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex min-w-0 flex-1 items-start gap-4 text-left hover:opacity-80"
    >
      <Dot color={post.brandColor} />
      <div className="min-w-0 flex-1">
        <div className="text-[15px]">
          {post.title || post.fileName}
          {post.postType === 'clip' && <ClipBadge />}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-muted">{post.brandName}</span>
          {post.targets.map((t) => (
            <span
              key={t.id}
              className="rounded-sm bg-black/60 px-1.5 text-[10px] font-bold"
              style={{ color: TARGET_COLOR[t.status] ?? '#fff' }}
              title={t.status}
            >
              {PLATFORM_SHORT[t.platform]}
            </span>
          ))}
          {post.holdReason ? (
            <span className="rounded bg-warn/20 px-1.5 text-[10px] font-bold uppercase text-warn">
              Held
            </span>
          ) : (
            post.status !== 'scheduled' && <StatusBadge status={post.status} />
          )}
        </div>
      </div>
    </button>
  )
}

function ItemLine({ item, onOpen }: { item: CalendarItem; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex min-w-0 flex-1 items-start gap-4 text-left hover:opacity-80"
    >
      <Dot
        color={item.brandColor}
        hollow={item.kind === 'planned' || item.kind === 'production_window'}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[15px]">{item.title}</div>
        <div className="mt-1 text-[11px] uppercase text-muted">{KIND_LABEL[item.kind]}</div>
      </div>
    </button>
  )
}

/** A slot that the channel settings offer and nothing sits in. */
function OpenLine({
  slot,
  onAdd,
  onInbox,
}: {
  slot: OpenSlot
  onAdd: () => void
  onInbox?: () => void
}) {
  const what = slot.kind === 'clip' ? 'clips' : 'videos'
  const off = slot.channelState !== 'active'
  return (
    <div className="flex min-w-0 flex-1 items-start gap-4">
      <Dot color={slot.brandColor} hollow />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] italic text-muted">
          <b className="not-italic text-ink">{slot.brandName}</b> has no {what} scheduled
          {slot.kind === 'clip' && <ClipBadge />}
        </div>
        <div className="mt-1 text-[11px] text-muted">
          {off
            ? `This channel is ${slot.channelState === 'paused' ? 'paused' : 'on hold'}, so nothing will post in this slot.`
            : slot.waiting > 0
              ? `${slot.waiting} finished ${slot.waiting === 1 ? 'video is' : 'videos are'} waiting in the Inbox.`
              : 'Open slot.'}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {slot.waiting > 0 && onInbox && <Button onClick={onInbox}>Open Inbox</Button>}
        <Button onClick={onAdd}>Add a {slot.kind === 'clip' ? 'clip' : 'video'}</Button>
      </div>
    </div>
  )
}
