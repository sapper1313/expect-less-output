import { useMemo, useState } from 'react'
import { COPY } from '@shared/copy'
import type { PlatformSlot } from '@shared/types'
import { api } from '../api'
import { useApp, useDraft, useLoad } from '../hooks'
import { Button, Card, Check, TimeSelect, useBusy } from '../ui'

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
      <div className="flex flex-wrap items-center gap-2">
        {list.length === 0 && <span className="text-[12px] text-muted">No posts</span>}
        {list.map(({ s, i }) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full border border-line px-1 py-0.5">
            <TimeSelect
              value={s.timeLocal}
              onChange={(v) => setSlots(slots.map((x, j) => (j === i ? { ...x, timeLocal: v } : x)))}
              label={`${p} ${dayType} time`}
            />
            <button
              className="px-1 text-muted hover:text-bad"
              aria-label="Remove this time"
              onClick={() => setSlots(slots.filter((_, j) => j !== i))}
            >
              x
            </button>
          </span>
        ))}
        <Button
          onClick={() =>
            setSlots([...slots, { platform: p, kind, dayType, timeLocal: list.length ? '21:00' : '19:00', enabled: true }])
          }
        >
          + time
        </Button>
      </div>
    )
  }

  const picks = [
    ...(rec?.weekday ?? []).map((p) => ({ ...p, dayType: 'weekday' as const })),
    ...(rec?.weekend ?? []).map((p) => ({ ...p, dayType: 'weekend' as const })),
  ]
  const tickedPlatforms = PLATFORMS.filter(([p]) => ticked(p)).map(([p]) => p)

  return (
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
      <div className="mb-3 text-[12px] text-muted">
        Every platform has its own weekday and weekend times. A new video takes the next open time of each platform on
        its own, so a time one platform already uses never blocks another. A Short is a tall video of 3 minutes or less,
        everything else is Long form. If only one kind is ticked, it is used for every video. Times you pick by hand
        when scheduling can be anything.
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-md border border-line">
          {(['short', 'long'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-4 py-1.5 text-[13px] font-semibold ${kind === k ? 'bg-accent text-[#111]' : 'hover:bg-surface2'}`}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <Check checked={kinds[kind].enabled} onChange={(v) => setKindDraft(kind, { enabled: v })}>
          This channel makes <b>{KIND_LABEL[kind]}</b> <span className="text-muted">{KIND_HINT[kind]}</span>
        </Check>
      </div>

      <div className={kinds[kind].enabled ? '' : 'opacity-50'}>
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Posts on</span>
          {ALL_DAYS.map((d) => (
            <Check
              key={d}
              checked={kinds[kind].days.includes(d)}
              onChange={(v) =>
                setKindDraft(kind, {
                  days: v ? [...kinds[kind].days, d].sort((a, b) => a - b) : kinds[kind].days.filter((x) => x !== d),
                })
              }
            >
              {DAY_LABELS[d - 1]}
            </Check>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div className="grid min-w-[720px] grid-cols-[170px_minmax(0,1fr)_minmax(0,1fr)] text-[13px]">
            <div className="p-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Platform</div>
            <div className="p-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Weekdays (Mon to Fri)</div>
            <div className="p-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Weekends (Sat and Sun)</div>
            {PLATFORMS.map(([p, label, color]) => (
              <div key={p} className="contents">
                <div className="border-t border-line p-2">
                  <Check checked={ticked(p)} onChange={(v) => setKindDraft(kind, { platforms: { ...(kinds[kind].platforms ?? {}), [p]: v } })}>
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                      <b>{label}</b>
                    </span>
                  </Check>
                  {!connected(p) && <div className="ml-6 text-[11px] text-muted">not connected</div>}
                  <div className="ml-6 mt-1 flex flex-wrap gap-1">
                    <button className="text-[11px] text-accent underline" onClick={() => copyRow(p, PLATFORMS.map(([x]) => x).filter((x) => x !== p))}>
                      copy to all
                    </button>
                    <button className="text-[11px] text-accent underline" onClick={() => weekdaysToWeekends(p)}>
                      weekdays to weekends
                    </button>
                  </div>
                </div>
                <div className={`border-t border-line p-2 ${ticked(p) ? '' : 'opacity-40'}`}>{cell(p, 'weekday')}</div>
                <div className={`border-t border-line p-2 ${ticked(p) ? '' : 'opacity-40'}`}>{cell(p, 'weekend')}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 text-[11px] text-muted">
          Untick a platform to stop posting {KIND_LABEL[kind]} there (its times are kept). Only platforms that are also
          connected on the Connections tab are used.
        </div>
      </div>

      <div className="mt-4 rounded-md border border-line p-2 text-[12px]">
        <div className="mb-1 font-semibold">Recommended</div>
        {rec && !rec.enough ? (
          <div className="text-muted">{COPY.stats.slotNotEnough}</div>
        ) : picks.length === 0 ? (
          <div className="text-muted">{COPY.stats.slotNote}</div>
        ) : (
          picks.map((p) => {
            const have = tickedPlatforms.every((pl) =>
              slots.some((s) => s.platform === pl && s.kind === kind && s.dayType === p.dayType && s.timeLocal === p.timeLocal),
            )
            return (
              <div key={`${p.dayType}${p.timeLocal}`} className="flex items-center justify-between gap-2 py-0.5">
                <span>
                  <b>{p.timeLocal}</b>{' '}
                  <span className="text-muted">
                    {p.dayType === 'weekday' ? 'weekdays' : 'weekends'},{' '}
                    {p.lift >= 1 ? `${Math.round((p.lift - 1) * 100)}% above typical` : `${Math.round((1 - p.lift) * 100)}% below typical`}
                    , {p.count} videos
                  </span>
                </span>
                <Button
                  disabled={have}
                  onClick={() =>
                    setSlots([
                      ...slots,
                      ...tickedPlatforms
                        .filter((pl) => !slots.some((s) => s.platform === pl && s.kind === kind && s.dayType === p.dayType && s.timeLocal === p.timeLocal))
                        .map((pl) => ({ platform: pl, kind, dayType: p.dayType, timeLocal: p.timeLocal, enabled: true })),
                    ])
                  }
                >
                  {have ? 'Added' : `Add to every ${KIND_LABEL[kind]} platform`}
                </Button>
              </div>
            )
          })
        )}
      </div>
    </Card>
  )
}
