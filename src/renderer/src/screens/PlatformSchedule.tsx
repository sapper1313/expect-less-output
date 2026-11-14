import { useMemo, useState } from 'react'
import { COPY } from '@shared/copy'
import type { PlatformSlot } from '@shared/types'
import { api } from '../api'
import { useApp, useDraft, useLoad } from '../hooks'
import { Button, Card, PlatformLogo, TimeSelect, useBusy } from '../ui'

type Kind = 'short' | 'long'
type DayType = 'weekday' | 'weekend'

const PLATFORMS: Array<[PlatformSlot['platform'], string, string]> = [
  ['youtube', 'YouTube', '#E24B4A'],
  ['instagram', 'Instagram', '#D4537E'],
  ['facebook', 'Facebook', '#378ADD'],
  ['tiktok', 'TikTok', '#7F77DD'],
  ['bluesky', 'Bluesky', '#1D9E75'],
]
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const KIND_LABEL: Record<Kind, string> = { short: 'Shorts', long: 'Long form' }
const KIND_HINT: Record<Kind, string> = {
  short: 'Tall videos (9:16), 5 to 180 seconds.',
  long: 'Wide videos (16:9), any length.',
}

interface KindDraft {
  platforms: Record<string, boolean> | null
  enabled: boolean
  days: number[]
}
interface Draft {
  slots: PlatformSlot[]
  kinds: Record<Kind, KindDraft>
}


const niceTime = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** A time as a small chip, like "7:00 PM x". Click the time to change it. */
function TimeChip({ value, onChange, onRemove, label }: { value: string; onChange: (v: string) => void; onRemove: () => void; label: string }) {
  const [edit, setEdit] = useState(false)
  if (edit)
    return (
      <span className="inline-flex items-center gap-1 rounded-xl border border-accent bg-surface2 px-1 py-0.5">
        <TimeSelect value={value} onChange={onChange} label={label} />
        <button className="px-1 text-[12px] font-semibold text-accent" onClick={() => setEdit(false)}>
          Done
        </button>
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface2 px-3 py-1 text-[14px]">
      <button onClick={() => setEdit(true)} title="Click to change this time" aria-label={`${label}: ${niceTime(value)}. Change`}>
        {niceTime(value)}
      </button>
      <button className="pl-1 text-muted hover:text-bad" aria-label="Remove this time" onClick={onRemove}>
        ×
      </button>
    </span>
  )
}

/** A strip of the day: each platform's logo sits at its time, so you can see how a day's posts are staggered. */
function RolloutPreview({ slots, kind }: { slots: PlatformSlot[]; kind: Kind }) {
  const [dayType, setDayType] = useState<DayType>('weekday')
  const mins = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + (m || 0)
  }
  const items = slots
    .filter((s) => s.kind === kind && s.dayType === dayType && s.enabled)
    .map((s) => ({ platform: s.platform, at: mins(s.timeLocal), time: s.timeLocal }))
  const lo = items.length ? Math.floor((Math.min(...items.map((i) => i.at)) - 60) / 60) * 60 : 9 * 60
  const hi = items.length ? Math.ceil((Math.max(...items.map((i) => i.at)) + 60) / 60) * 60 : 21 * 60
  const span = Math.max(hi - lo, 60)
  const pos = (at: number) => `${((at - lo) / span) * 100}%`
  const label = (m: number) => {
    const h = Math.floor(m / 60) % 24
    return `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`
  }
  const step = span > 600 ? 240 : span > 300 ? 120 : 60
  const ticks: number[] = []
  for (let m = lo; m <= hi; m += step) ticks.push(m)
  const nice = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  }
  return (
    <Card
      title="Daily staggered rollout preview (Eastern time)"
      actions={
        <div className="inline-flex overflow-hidden rounded-full border border-line">
          {(['weekday', 'weekend'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDayType(d)}
              className={`px-4 py-1 text-[12px] font-semibold ${dayType === d ? 'bg-accent text-[#111]' : 'hover:bg-surface2'}`}
            >
              {d === 'weekday' ? 'Weekdays' : 'Weekends'}
            </button>
          ))}
        </div>
      }
    >
      <div className="relative mx-6 mb-8 mt-2 h-20">
        <div className="absolute left-0 right-0 top-[34px] h-1 rounded-full bg-surface2" />
        {items.map((i, n) => (
          <div
            key={`${i.platform}-${i.at}-${n}`}
            className="absolute -translate-x-1/2 text-center"
            style={{ left: pos(i.at), top: 6 + (items.filter((o, k) => k < n && Math.abs(o.at - i.at) < 40).length % 2) * 0 }}
            title={`${i.platform} at ${nice(i.time)}`}
          >
            <PlatformLogo platform={i.platform} size={26} />
            <div className="mx-auto mt-1 h-3 w-[2px] bg-line" />
          </div>
        ))}
        {ticks.map((m) => (
          <div key={m} className="absolute top-[46px] -translate-x-1/2 text-[11px] text-muted" style={{ left: pos(m) }}>
            {label(m)}
          </div>
        ))}
      </div>
      {items.length === 0 && <div className="text-[12px] text-muted">No times set for this kind of day yet.</div>}
    </Card>
  )
}

/**
 * The channel's posting schedule: one row for each platform, with its own weekday times and its own weekend times, for
 * Shorts and for Long form separately. A new video takes the next open time of every platform on its own.
 */
export function PlatformSchedule({ brandId }: { brandId: number }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [kind, setKind] = useState<Kind>('short')
  const { data: rows } = useLoad(() => api.brands.getPlatformSlots(brandId), [brandId])
  const { data: kindRows } = useLoad(() => api.brands.getSlotKinds(brandId), [brandId])
  const { data: rec } = useLoad(() => api.stats.recommendedSlots(brandId), [brandId])
  const { data: accounts } = useLoad(() => api.accounts.list(brandId), [brandId])

  const fresh = useMemo<Draft | null>(() => {
    if (!rows || !kindRows) return null
    const k = (x: Kind): KindDraft => {
      const r = kindRows.find((y) => y.kind === x)
      return { enabled: r?.enabled ?? false, days: r?.days ?? ALL_DAYS, platforms: r?.platforms ?? null }
    }
    return { slots: rows.map((r) => ({ ...r })), kinds: { short: k('short'), long: k('long') } }
  }, [rows, kindRows])
  const { draft, setDraft, dirty } = useDraft<Draft>(fresh, brandId)
  if (!draft) return null
  const { slots, kinds } = draft
  const setSlots = (next: PlatformSlot[]) => setDraft({ ...draft, slots: next })
  const setKindDraft = (k: Kind, patch: Partial<KindDraft>) =>
    setDraft({ ...draft, kinds: { ...kinds, [k]: { ...kinds[k], ...patch } } })

  const connected = (p: string) => (accounts ?? []).some((a) => a.platform === p && a.status === 'connected')
  const ticked = (p: string) => kinds[kind].platforms?.[p] !== false
  const mine = (p: string, dayType: DayType) =>
    slots
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.platform === p && s.kind === kind && s.dayType === dayType)

  const copyRow = (from: string, to: string[]) => {
    const source = slots.filter((s) => s.platform === from && s.kind === kind)
    const rest = slots.filter((s) => !(to.includes(s.platform) && s.kind === kind))
    setSlots([...rest, ...to.flatMap((p) => source.map((s) => ({ ...s, platform: p as PlatformSlot['platform'] })))])
  }
  const weekdaysToWeekends = (p: string) => {
    const wk = slots.filter((s) => s.platform === p && s.kind === kind && s.dayType === 'weekday')
    const rest = slots.filter((s) => !(s.platform === p && s.kind === kind && s.dayType === 'weekend'))
    setSlots([...rest, ...wk.map((s) => ({ ...s, dayType: 'weekend' as const }))])
  }

  const cell = (p: PlatformSlot['platform'], dayType: DayType) => {
    const list = mine(p, dayType)
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[14px]">{dayType === 'weekday' ? 'Weekdays:' : 'Weekends:'}</span>
        {list.map(({ s, i }) => (
          <TimeChip
            key={i}
            value={s.timeLocal}
            label={`${p} ${dayType} time`}
            onChange={(v) => setSlots(slots.map((x, j) => (j === i ? { ...x, timeLocal: v } : x)))}
            onRemove={() => setSlots(slots.filter((_, j) => j !== i))}
          />
        ))}
        <button
          className="rounded-full px-2 py-0.5 text-[13px] font-semibold text-accent hover:bg-surface2"
          onClick={() =>
            setSlots([...slots, { platform: p, kind, dayType, timeLocal: list.length ? '21:00' : '19:00', enabled: true }])
          }
        >
          + Add
        </button>
      </div>
    )
  }

  const picks = [
    ...(rec?.weekday ?? []).map((p) => ({ ...p, dayType: 'weekday' as const })),
    ...(rec?.weekend ?? []).map((p) => ({ ...p, dayType: 'weekend' as const })),
  ]
  const tickedPlatforms = PLATFORMS.filter(([p]) => ticked(p)).map(([p]) => p)

  return (
    <>
    <RolloutPreview slots={slots} kind={kind} />
    <Card
      title="Posting schedule (Eastern time)"
      actions={
        <Button
          variant="primary"
          disabled={!dirty || busy}
          onClick={async () => {
            const ok = await run(async () => {
              await api.brands.setPlatformSlots(brandId, slots)
              await api.brands.setSlotKinds(
                brandId,
                (['short', 'long'] as const).map((k) => ({
                  kind: k,
                  enabled: kinds[k].enabled,
                  days: kinds[k].days.length === 0 || kinds[k].days.length === 7 ? null : kinds[k].days,
                  platforms: kinds[k].platforms,
                })),
              )
              return true
            })
            if (ok) toast({ kind: 'success', headline: COPY.success, detail: 'Schedule saved.' })
          }}
        >
          Save schedule
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-full border border-line">
          {(['short', 'long'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-4 py-1.5 text-[14px] font-semibold ${kind === k ? 'bg-accent text-[#111]' : 'hover:bg-surface2'}`}
            >
              {k === 'short' ? 'Shorts (9:16)' : 'Long form'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setKindDraft(kind, { enabled: !kinds[kind].enabled })}
          aria-pressed={kinds[kind].enabled}
          title={`${KIND_HINT[kind]} If only one kind is on, it is used for every video.`}
          className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold ${kinds[kind].enabled ? 'border-accent text-accent' : 'border-line text-muted'}`}
        >
          {kinds[kind].enabled ? `Makes ${KIND_LABEL[kind]}: on` : `Makes ${KIND_LABEL[kind]}: off`}
        </button>
        <span className="h-7 w-px bg-line" />
        {ALL_DAYS.map((d) => {
          const on = kinds[kind].days.includes(d)
          return (
            <button
              key={d}
              aria-pressed={on}
              onClick={() =>
                setKindDraft(kind, {
                  days: on ? kinds[kind].days.filter((x) => x !== d) : [...kinds[kind].days, d].sort((a, b) => a - b),
                })
              }
              className={`rounded-full border px-4 py-1.5 text-[14px] font-semibold ${on ? 'border-line bg-surface2' : 'border-transparent text-muted opacity-60'}`}
            >
              {DAY_LABELS[d - 1]}
            </button>
          )
        })}
        <div className="ml-auto">
          <Button
            disabled={!rec || !rec.enough || picks.length === 0 || busy}
            title={rec && !rec.enough ? COPY.stats.slotNotEnough : picks.length === 0 ? COPY.stats.slotNote : 'Adds the best times from your analytics to every ticked platform'}
            onClick={() => {
              const add = picks.flatMap((p) =>
                tickedPlatforms
                  .filter((pl) => !slots.some((s) => s.platform === pl && s.kind === kind && s.dayType === p.dayType && s.timeLocal === p.timeLocal))
                  .map((pl) => ({ platform: pl, kind, dayType: p.dayType, timeLocal: p.timeLocal, enabled: true })),
              )
              if (add.length) setSlots([...slots, ...add])
              else toast({ kind: 'info', headline: 'The best times are already on the schedule.' })
            }}
          >
            ✨ Fill best times from analytics
          </Button>
        </div>
      </div>

      <div className={kinds[kind].enabled ? '' : 'opacity-50'}>
        <div className="overflow-x-auto">
          <div className="grid min-w-[820px] grid-cols-[170px_minmax(260px,1fr)_minmax(300px,1fr)]">
            {PLATFORMS.map(([p, label]) => (
              <div key={p} className="contents">
                <div className={`flex flex-col items-start justify-center gap-1 border-t border-line p-3 ${ticked(p) ? '' : 'opacity-40'}`}>
                  <button
                    onClick={() => setKindDraft(kind, { platforms: { ...(kinds[kind].platforms ?? {}), [p]: !ticked(p) } })}
                    aria-pressed={ticked(p)}
                    title={ticked(p) ? `Click to stop posting ${KIND_LABEL[kind]} on ${label} (its times are kept)` : `Click to post ${KIND_LABEL[kind]} on ${label} again`}
                    className="flex items-center gap-3"
                  >
                    <PlatformLogo platform={p} size={30} />
                    <span className="text-[16px] font-semibold">{label}</span>
                  </button>
                  {!connected(p) && <span className="text-[11px] text-muted">not connected</span>}
                  <span className="flex flex-col gap-0.5 text-[11px]">
                    <button className="text-left underline hover:text-accent" onClick={() => copyRow(p, PLATFORMS.map(([x]) => x).filter((x) => x !== p))}>
                      Copy to all
                    </button>
                    <button className="text-left text-muted underline hover:text-accent" onClick={() => weekdaysToWeekends(p)}>
                      Weekdays to weekends
                    </button>
                  </span>

                </div>
                <div className={`border-t border-l border-line p-3 ${ticked(p) ? '' : 'opacity-40'}`}>{cell(p, 'weekday')}</div>
                <div className={`border-t border-l border-line p-3 ${ticked(p) ? '' : 'opacity-40'}`}>
                  {cell(p, 'weekend')}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 text-[12px] text-muted">
          Every platform has its own times, and a new video takes the next open time of each one. A Short is a tall video of 3 minutes
          or less, everything else is Long form. Click a platform to stop posting there (its times are kept). Only platforms that are
          connected on the Connections tab are used.
        </div>
      </div>
    </Card>
    </>
  )
}
