import { useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { PLATFORM_LABELS, type Platform } from '@shared/platformLimits'
import { ZONE } from '@shared/time'
import {
  FLAG_TITLE,
  STAGE_LABEL,
  TRACKER_STAGES,
  type CellState,
  type PlatformCell,
  type TrackerEpisode,
  type TrackerFlag,
  type TrackerView,
} from '@shared/tracker'
import { Card, Empty } from '../ui'

const CELL: Record<CellState, { text: string; cls: string }> = {
  'not-ready': { text: 'Not ready', cls: 'border-line text-muted' },
  ready: { text: 'Ready', cls: 'border-accent text-accent' },
  scheduled: { text: 'Scheduled', cls: 'border-ok text-ok' },
  posting: { text: 'Posting', cls: 'border-accent text-accent' },
  posted: { text: 'Posted', cls: 'border-ok bg-ok/20 text-ok' },
  failed: { text: 'Failed', cls: 'border-bad bg-bad/20 text-bad' },
  skipped: { text: 'Skipped', cls: 'border-line text-muted' },
  missing: { text: 'Not dropped', cls: 'border-bad bg-bad/20 text-bad' },
}

const dayText = (day: string | null) =>
  day ? DateTime.fromISO(day, { zone: ZONE }).toFormat('ccc L/d') : 'No date'
const timeText = (iso: string | null) =>
  iso ? DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE).toFormat('ccc h:mm a') : ''
const pLabel = (p: string) => PLATFORM_LABELS[p as Platform] ?? p

function Cell({ c }: { c: PlatformCell }) {
  const s = CELL[c.state]
  return (
    <td className="px-2 py-2 align-top">
      <div className={`rounded border px-1.5 py-1 text-[11px] leading-tight ${s.cls}`}>
        <div className="font-semibold">{s.text}</div>
        {c.atUtc && c.state !== 'not-ready' && <div className="opacity-90">{timeText(c.atUtc)}</div>}
      </div>
    </td>
  )
}

function Steps({ stage }: { stage: TrackerEpisode['stage'] }) {
  const at = TRACKER_STAGES.indexOf(stage)
  return (
    <div className="flex items-center gap-1" title={STAGE_LABEL[stage]}>
      {TRACKER_STAGES.map((s, i) => (
        <span
          key={s}
          title={STAGE_LABEL[s]}
          className={`h-2 w-4 rounded-sm ${i <= at ? (i === at ? 'bg-accent' : 'bg-ok') : 'bg-surface2'}`}
        />
      ))}
      <span className="ml-1 whitespace-nowrap text-[11px] font-semibold">{STAGE_LABEL[stage]}</span>
    </div>
  )
}

function FlagRow({ f }: { f: TrackerFlag }) {
  return (
    <div className="flex gap-2 text-[13px]" role="listitem">
      <span
        className={`mt-0.5 h-fit shrink-0 rounded border px-1 text-[10px] font-bold uppercase ${f.severity === 'bad' ? 'border-bad text-bad' : 'border-warn text-warn'}`}
      >
        {f.severity === 'bad' ? 'Act now' : 'Watch'}
      </span>
      <div>
        <b>{FLAG_TITLE[f.kind]}.</b> {f.detail}
      </div>
    </div>
  )
}

/** Planned versus finished, per channel and platform. Read only: it never moves a post. */
export function UpcomingTracker({
  view,
  channel,
  text,
  onOpen,
}: {
  view: TrackerView | null
  channel: string
  text: string
  onOpen: (channel: string, episodeId: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const needle = text.trim().toLowerCase()
  const flags = useMemo(
    () => (view?.flags ?? []).filter((f) => !channel || f.channel === channel),
    [view, channel],
  )
  if (!view) return <Empty>Loading the tracker.</Empty>
  const shown = view.channels.filter((c) => !channel || c.slug === channel)
  return (
    <div className="space-y-4">
      <Card title={`Flags (${flags.length})`}>
        {flags.length === 0 ? (
          <div className="text-[13px] text-muted">
            Nothing to flag in the next {view.flagDays} days. Every scheduled slot has an episode
            coming, nothing finished is waiting to be dropped, and no drop is missing a platform.
          </div>
        ) : (
          <div className="space-y-2" role="list">
            {flags.map((f) => (
              <FlagRow key={f.key} f={f} />
            ))}
          </div>
        )}
        <div className="mt-2 text-[11px] text-muted">
          The tracker only reports. It never changes a post, a slot or a time. An empty slot is
          flagged when it is within {view.flagDays} days and no finished episode is planned for it.
        </div>
      </Card>

      <label className="flex items-center gap-2 text-[12px] text-muted">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        Show ideas and paused channels too
      </label>

      {shown.map((c) => {
        const eps = c.episodes.filter(
          (e) =>
            (showAll || e.stage !== 'idea') &&
            (!needle || `${e.title} ${e.episodeId}`.toLowerCase().includes(needle)),
        )
        if (!showAll && c.state !== 'active' && eps.length === 0) return null
        if (!showAll && eps.length === 0 && Object.values(c.counts).every((n) => n === 0)) return null
        return (
          <div
            key={c.slug}
            className="overflow-hidden rounded-lg border border-line"
            style={{ borderLeft: `4px solid ${c.color}` }}
          >
            <div className="flex flex-wrap items-center gap-3 bg-surface2 px-3 py-2">
              <b className="text-[14px]">{c.name}</b>
              {c.state !== 'active' && (
                <span className="rounded border border-warn px-1 text-[10px] font-bold uppercase text-warn">
                  {c.state}
                </span>
              )}
              <div className="flex flex-wrap gap-2 text-[11px] text-muted">
                {TRACKER_STAGES.map((s) => (
                  <span key={s}>
                    {STAGE_LABEL[s]} <b className="text-ink">{c.counts[s]}</b>
                  </span>
                ))}
              </div>
            </div>
            {eps.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-muted">Nothing planned on this channel.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="text-[11px] uppercase text-muted">
                    <tr>
                      <th className="px-3 py-1.5">Episode</th>
                      <th className="px-2 py-1.5">Air</th>
                      <th className="px-2 py-1.5">Stage</th>
                      {c.platforms.map((p) => (
                        <th key={p} className="px-2 py-1.5">
                          {pLabel(p)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {eps.map((e) => (
                      <tr key={e.episodeId} className="border-t border-line align-top">
                        <td className="px-3 py-2">
                          <button
                            className="text-left font-semibold hover:text-accent"
                            onClick={() => onOpen(e.channel, e.episodeId)}
                          >
                            {e.title}
                          </button>
                          <div className="text-[11px] text-muted">{e.episodeId}</div>
                          {e.flags.length > 0 && (
                            <div className="mt-1 text-[11px] font-semibold text-bad">
                              {e.flags.map((k) => FLAG_TITLE[k]).join(' | ')}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          {dayText(e.airDate)}
                          {e.airSource === 'scheduled' && (
                            <div className="text-[11px] text-muted">as scheduled</div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <Steps stage={e.stage} />
                        </td>
                        {e.cells.map((cell) => (
                          <Cell key={cell.platform} c={cell} />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
