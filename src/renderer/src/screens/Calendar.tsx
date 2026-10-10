import { useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import luxon3Plugin from '@fullcalendar/luxon3'
import type { DatesSetArg, EventDropArg } from '@fullcalendar/core'
import type { CalendarItem, CalendarKind } from '@shared/studio/types'
import { COPY } from '@shared/copy'
import { ZONE, formatEastern } from '@shared/time'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { PostEditor } from '../components/PostEditor'
import { PLATFORM_SHORT, PageHeader, Select, Confirm, useBusy } from '../ui'
import { EpisodePeek } from './StudioLibrary'

const STATUS_DOT: Record<string, string> = {
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
const KIND_COLOR: Record<CalendarKind, string> = {
  posted: '#8fbf7f',
  scheduled: '#7fb2e5',
  in_production: '#e8b34a',
  awaiting_video: '#c79bf2',
  flagged: '#ff7a6b',
  failed: '#ff7a6b',
  planned: '#a8a090',
  production_window: '#6b6358',
}
const POST_KIND: Record<string, CalendarKind> = {
  posted: 'posted',
  failed: 'failed',
  missed: 'failed',
}

export function Calendar() {
  const { toast } = useApp()
  const [, run] = useBusy()
  const [brandId, setBrandId] = useState<number | 'all'>('all')
  const { data: brands } = useLoad(() => api.brands.list())
  const { data: posts } = useLoad(
    () => api.posts.list({ brandId: brandId === 'all' ? null : brandId }),
    [brandId],
  )
  const [platform, setPlatform] = useState('')
  const [kind, setKind] = useState<CalendarKind | ''>('')
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [items, setItems] = useState<CalendarItem[]>([])
  const [openEpisode, setOpenEpisode] = useState<string | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  useEffect(() => {
    if (!range) return
    let alive = true
    api.studio
      .calendar({ fromUtc: range.from, toUtc: range.to, brandId: brandId === 'all' ? null : brandId, platform: platform || null, kind: kind || null })
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [range, brandId, platform, kind, posts])
  const [drop, setDrop] = useState<{ info: EventDropArg; when: string } | null>(null)
  const cal = useRef<FullCalendar>(null)

  const visible = useMemo(
    () =>
      (posts ?? []).filter((p) => {
        if (!p.scheduledAtUtc || p.status === 'canceled') return false
        if (platform && !p.targets.some((t) => t.platform === platform)) return false
        if (kind && (POST_KIND[p.status] ?? 'scheduled') !== kind) return false
        return true
      }),
    [posts, platform, kind],
  )
  const events = visible.map((p) => ({
    id: String(p.id),
    title: p.title || p.fileName,
    start: p.scheduledAtUtc!,
    backgroundColor: p.brandColor,
    borderColor: p.brandColor,
    textColor: '#111111',
    editable: ['draft', 'scheduled', 'missed', 'failed', 'partial'].includes(p.status),
    extendedProps: { post: p },
  }))

  // Everything the studio knows that is not already a post: planned slots, production windows, episodes, old history.
  const studioEvents = items
    .filter((i) => i.postId === null)
    .map((i) => ({
      id: i.id,
      title: i.title,
      start: i.allDay ? i.date : i.startUtc,
      allDay: i.allDay,
      backgroundColor: i.kind === 'planned' || i.kind === 'production_window' ? 'transparent' : KIND_COLOR[i.kind],
      borderColor: i.kind === 'planned' || i.kind === 'production_window' ? i.brandColor : KIND_COLOR[i.kind],
      textColor: i.kind === 'planned' || i.kind === 'production_window' ? undefined : '#111111',
      editable: false,
      extendedProps: { item: i },
    }))
  const empty = posts && visible.length === 0 && studioEvents.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={COPY.nav.calendar}>
        <Select className="w-40" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
          <option value="">All platforms</option>
          {['youtube', 'facebook', 'instagram', 'tiktok', 'bluesky'].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </Select>
        <Select className="w-44" value={kind} onChange={(e) => setKind(e.target.value as CalendarKind | '')} aria-label="Status">
          <option value="">All statuses</option>
          {(Object.keys(KIND_LABEL) as CalendarKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
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
      <div className="relative min-h-0 flex-1 px-8 pb-6">
        {empty && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 text-center text-lg text-muted">
            {COPY.emptyCalendar}
          </div>
        )}
        <FullCalendar
          ref={cal}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxon3Plugin]}
          timeZone={ZONE}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,listMonth',
          }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', list: 'List' }}
          datesSet={(a: DatesSetArg) => setRange({ from: a.start.toISOString(), to: a.end.toISOString() })}
          height="100%"
          events={[...events, ...studioEvents]}
          editable
          eventStartEditable
          eventDurationEditable={false}
          dayMaxEventRows={4}
          nowIndicator
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
          slotEventOverlap={false}
          eventClick={(i) => {
            const item = i.event.extendedProps.item as CalendarItem | undefined
            if (item) {
              if (item.episodeId) setOpenEpisode(item.episodeId)
              return
            }
            setEditing(Number(i.event.id))
          }}
          eventDrop={(info) => {
            if (!info.event.start) return info.revert()
            setDrop({ info, when: info.event.start.toISOString() })
          }}
          eventContent={(arg) => {
            const item = arg.event.extendedProps.item as CalendarItem | undefined
            if (item)
              return (
                <div className="w-full overflow-hidden px-1 py-px text-[11px] leading-tight" style={{ color: item.kind === 'planned' || item.kind === 'production_window' ? item.brandColor : undefined }}>
                  <div className="truncate"><b>{item.title}</b></div>
                  <div className="text-[9px] font-bold uppercase opacity-80">{KIND_LABEL[item.kind]}</div>
                </div>
              )
            const post = arg.event.extendedProps.post as (typeof visible)[number]
            return (
              <div className="w-full overflow-hidden px-1 py-px text-[11px] leading-tight">
                <div className="flex items-center gap-1">
                  <b className="shrink-0">{arg.timeText}</b>
                  <span className="min-w-0 flex-1 truncate">{arg.event.title}</span>
                </div>
                <div className="mt-px flex flex-wrap items-center gap-px" title={post.status}>
                  {post.targets.map((t) => (
                    <span
                      key={t.id}
                      className="rounded-sm bg-black/70 px-[3px] text-[8px] font-bold"
                      style={{ color: STATUS_DOT[t.status] ?? '#fff' }}
                    >
                      {PLATFORM_SHORT[t.platform]}
                    </span>
                  ))}
                  {post.status !== 'scheduled' && (
                    <span className="ml-1 rounded-sm bg-black/70 px-1 text-[8px] font-bold uppercase text-white">
                      {post.status.replace('_', ' ')}
                    </span>
                  )}
                </div>
              </div>
            )
          }}
        />
      </div>
      {editing !== null && <PostEditor postId={editing} onClose={() => setEditing(null)} />}
      {openEpisode && <EpisodePeek id={openEpisode} onClose={() => setOpenEpisode(null)} />}
      {drop && (
        <Confirm
          title="Move this post?"
          message={COPY.confirm.reschedule(formatEastern(drop.when))}
          confirmLabel="Move it"
          onCancel={() => {
            drop.info.revert()
            setDrop(null)
          }}
          onConfirm={async () => {
            const d = drop
            setDrop(null)
            const ok = await run(async () => {
              await api.posts.reschedule([Number(d.info.event.id)], d.when)
              return true
            })
            if (ok)
              toast({
                kind: 'success',
                headline: COPY.success,
                detail: `Moved to ${formatEastern(d.when)}.`,
              })
            else d.info.revert()
          }}
        />
      )}
    </div>
  )
}
