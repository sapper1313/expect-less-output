import { useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import luxon3Plugin from '@fullcalendar/luxon3'
import type { EventDropArg } from '@fullcalendar/core'
import { COPY } from '@shared/copy'
import { ZONE, formatEastern } from '@shared/time'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { PostEditor } from '../components/PostEditor'
import { PLATFORM_SHORT, PageHeader, Select, Confirm, useBusy } from '../ui'

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

export function Calendar() {
  const { toast } = useApp()
  const [, run] = useBusy()
  const [brandId, setBrandId] = useState<number | 'all'>('all')
  const { data: brands } = useLoad(() => api.brands.list())
  const { data: posts } = useLoad(
    () => api.posts.list({ brandId: brandId === 'all' ? null : brandId }),
    [brandId],
  )
  const [editing, setEditing] = useState<number | null>(null)
  const [drop, setDrop] = useState<{ info: EventDropArg; when: string } | null>(null)
  const cal = useRef<FullCalendar>(null)

  const visible = useMemo(
    () => (posts ?? []).filter((p) => p.scheduledAtUtc && p.status !== 'canceled'),
    [posts],
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={COPY.nav.calendar}>
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
        {posts && visible.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 text-center text-lg text-muted">
            {COPY.emptyCalendar}
          </div>
        )}
        <FullCalendar
          ref={cal}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxon3Plugin]}
          timeZone={ZONE}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek',
          }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week' }}
          height="100%"
          events={events}
          editable
          eventStartEditable
          eventDurationEditable={false}
          dayMaxEventRows={4}
          nowIndicator
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
          slotEventOverlap={false}
          eventClick={(i) => setEditing(Number(i.event.id))}
          eventDrop={(info) => {
            if (!info.event.start) return info.revert()
            setDrop({ info, when: info.event.start.toISOString() })
          }}
          eventContent={(arg) => {
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
