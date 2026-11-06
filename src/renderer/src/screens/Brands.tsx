import { useMemo, useState } from 'react'
import { COPY } from '@shared/copy'
import type { Brand, BrandSlot } from '@shared/types'
import { api } from '../api'
import { useApp, useDraft, useLoad } from '../hooks'
import { DateList } from './PipelineSettings'
import { Button, Card, Check, Confirm, Field, Input, Select, TimeSelect, useBusy } from '../ui'

type Kind = 'short' | 'long'
type SlotDraft = Pick<BrandSlot, 'dayType' | 'timeLocal' | 'enabled' | 'kind'>
interface KindDraft {
  enabled: boolean
  /** ISO weekdays this kind posts on. */
  days: number[]
}
interface SlotsDraft {
  slots: SlotDraft[]
  kinds: Record<Kind, KindDraft>
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const KIND_LABEL: Record<Kind, string> = { short: 'Shorts', long: 'Long form' }
const KIND_HINT: Record<Kind, string> = {
  short: 'Tall videos (9:16), 5 to 180 seconds.',
  long: 'Wide videos (16:9), any length.',
}

/** The Channel Setup tab: the channel itself, its rules, and its posting times for Shorts and Long form. */
export function ChannelSetup({ brand, onArchived }: { brand: Brand; onArchived: () => void }) {
  return (
    <div className="space-y-4">
      <BrandCard brand={brand} onArchived={onArchived} />
      <PipelineRules brand={brand} />
      <SlotEditor brandId={brand.id} />
    </div>
  )
}

function BrandCard({ brand, onArchived }: { brand: Brand; onArchived: () => void }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [name, setName] = useState(brand.name)
  const [color, setColor] = useState(brand.color)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const { data: settings } = useLoad(() => api.settings.get())
  const paused = !!settings?.pausedBrandIds.includes(brand.id)
  return (
    <Card title="Channel">
      <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_auto]">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Color">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-16 rounded border border-line bg-bg"
          />
        </Field>
        <Button
          variant="primary"
          disabled={busy || !name.trim() || (name === brand.name && color === brand.color)}
          onClick={async () => {
            if (await run(() => api.brands.update(brand.id, { name, color })))
              toast({ kind: 'success', headline: COPY.success, detail: 'Channel saved.' })
          }}
        >
          Save
        </Button>
      </div>
      <div className="mt-3 space-y-3">
        <div>
          <Check
            checked={paused}
            onChange={(v) => run(() => api.studio.setBrand(brand.id, { paused: v }))}
          >
            Pause this channel
          </Check>
          <div className="ml-6 text-[12px] text-muted">
            Posts stay scheduled but nothing goes out. When you resume, a post that is less than
            your grace time late goes out and older ones are held as missed.
          </div>
        </div>
        {brand.archived ? (
          <Button onClick={() => run(() => api.brands.archive(brand.id, false))}>
            Restore channel
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setConfirmArchive(true)}>
            Archive channel
          </Button>
        )}
      </div>
      {confirmArchive && (
        <Confirm
          title="Are you sure?"
          message={`Archive ${brand.name}? ${COPY.confirm.archiveBrand}`}
          confirmLabel="Yes, archive it"
          danger
          onCancel={() => setConfirmArchive(false)}
          onConfirm={async () => {
            await run(() => api.brands.archive(brand.id, true))
            setConfirmArchive(false)
            onArchived()
          }}
        />
      )}
    </Card>
  )
}

function SlotEditor({ brandId }: { brandId: number }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: slotRows } = useLoad(() => api.brands.getSlots(brandId), [brandId])
  const { data: kindRows } = useLoad(() => api.brands.getSlotKinds(brandId), [brandId])
  const { data: rec } = useLoad(() => api.stats.recommendedSlots(brandId), [brandId])
  const fresh = useMemo<SlotsDraft | null>(() => {
    if (!slotRows || !kindRows) return null
    const kind = (k: Kind): KindDraft => {
      const r = kindRows.find((x) => x.kind === k)
      return { enabled: r?.enabled ?? false, days: r?.days ?? ALL_DAYS }
    }
    return {
      slots: slotRows.map(({ dayType, timeLocal, enabled, kind: k }) => ({
        dayType,
        timeLocal,
        enabled,
        kind: k,
      })),
      kinds: { short: kind('short'), long: kind('long') },
    }
  }, [slotRows, kindRows])
  const { draft, setDraft, dirty } = useDraft<SlotsDraft>(fresh, brandId)
  if (!draft) return null
  const { slots, kinds } = draft
  const setSlots = (next: SlotDraft[]) => setDraft({ ...draft, slots: next })
  const setKind = (k: Kind, patch: Partial<KindDraft>) =>
    setDraft({ ...draft, kinds: { ...kinds, [k]: { ...kinds[k], ...patch } } })

  const picks = [
    ...(rec?.weekday ?? []).map((p) => ({ ...p, dayType: 'weekday' as const })),
    ...(rec?.weekend ?? []).map((p) => ({ ...p, dayType: 'weekend' as const })),
  ]
  const addTarget: Kind = kinds.short.enabled ? 'short' : 'long'

  const timeList = (k: Kind, type: 'weekday' | 'weekend', label: string) => (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className="space-y-2">
        {slots.map((s, i) =>
          s.kind !== k || s.dayType !== type ? null : (
            <div key={i} className="flex items-center gap-2">
              <TimeSelect
                value={s.timeLocal}
                onChange={(v) =>
                  setSlots(slots.map((x, j) => (j === i ? { ...x, timeLocal: v } : x)))
                }
                label={`${KIND_LABEL[k]} ${label} time`}
              />
              <Check
                checked={s.enabled}
                onChange={(v) =>
                  setSlots(slots.map((x, j) => (j === i ? { ...x, enabled: v } : x)))
                }
              >
                On
              </Check>
              <button
                className="text-muted hover:text-bad"
                aria-label="Remove this time"
                onClick={() => setSlots(slots.filter((_, j) => j !== i))}
              >
                x
              </button>
            </div>
          ),
        )}
        <Button
          onClick={() =>
            setSlots([...slots, { dayType: type, timeLocal: '12:00', enabled: true, kind: k }])
          }
        >
          Add time
        </Button>
      </div>
    </div>
  )

  const section = (k: Kind) => (
    <div className="rounded-md border border-line p-3">
      <Check checked={kinds[k].enabled} onChange={(v) => setKind(k, { enabled: v })}>
        <b>{KIND_LABEL[k]}</b> <span className="text-muted">{KIND_HINT[k]}</span>
      </Check>
      {kinds[k].enabled && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {ALL_DAYS.map((d) => (
              <Check
                key={d}
                checked={kinds[k].days.includes(d)}
                onChange={(v) =>
                  setKind(k, {
                    days: v
                      ? [...kinds[k].days, d].sort((a, b) => a - b)
                      : kinds[k].days.filter((x) => x !== d),
                  })
                }
              >
                {DAY_LABELS[d - 1]}
              </Check>
            ))}
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {timeList(k, 'weekday', 'Weekdays (Mon to Fri)')}
            {timeList(k, 'weekend', 'Weekends (Sat and Sun)')}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <Card
      title="Posting slots (Eastern time)"
      actions={
        <Button
          variant="primary"
          disabled={!dirty || busy}
          onClick={async () => {
            // Times of a kind that is not ticked are kept, so ticking it again brings them back.
            const ok = await run(async () => {
              await api.brands.setSlots(brandId, slots)
              await api.brands.setSlotKinds(
                brandId,
                (['short', 'long'] as const).map((k) => ({
                  kind: k,
                  enabled: kinds[k].enabled,
                  days:
                    kinds[k].days.length === 0 || kinds[k].days.length === 7 ? null : kinds[k].days,
                })),
              )
              return true
            })
            if (ok) toast({ kind: 'success', headline: COPY.success, detail: 'Slots saved.' })
          }}
        >
          Save slots
        </Button>
      }
    >
      <div className="mb-3 text-[12px] text-muted">
        Tick what this channel makes. A tall video of 3 minutes or less is a Short, a wide video is
        Long form. A new post takes the next open time for its kind. If only one kind is ticked it
        uses that kind for everything.
      </div>
      <div className="mb-3 rounded-md border border-line p-2 text-[12px]">
        <div className="mb-1 font-semibold">Recommended</div>
        {rec && !rec.enough ? (
          <div className="text-muted">{COPY.stats.slotNotEnough}</div>
        ) : picks.length === 0 ? (
          <div className="text-muted">{COPY.stats.slotNote}</div>
        ) : (
          picks.map((p) => {
            const have = slots.some(
              (s) => s.kind === addTarget && s.dayType === p.dayType && s.timeLocal === p.timeLocal,
            )
            return (
              <div
                key={`${p.dayType}${p.timeLocal}`}
                className="flex items-center justify-between gap-2 py-0.5"
              >
                <span>
                  <b>{p.timeLocal}</b>{' '}
                  <span className="text-muted">
                    {p.dayType === 'weekday' ? 'weekdays' : 'weekends'},{' '}
                    {p.lift >= 1
                      ? `${Math.round((p.lift - 1) * 100)}% above typical`
                      : `${Math.round((1 - p.lift) * 100)}% below typical`}
                    , {p.count} videos
                  </span>
                </span>
                <Button
                  disabled={have}
                  onClick={() =>
                    setSlots([
                      ...slots,
                      {
                        dayType: p.dayType,
                        timeLocal: p.timeLocal,
                        enabled: true,
                        kind: addTarget,
                      },
                    ])
                  }
                >
                  {have ? 'Added' : `Add to ${KIND_LABEL[addTarget]}`}
                </Button>
              </div>
            )
          })
        )}
      </div>
      <div className="space-y-3">
        {section('short')}
        {section('long')}
      </div>
    </Card>
  )
}

/** The limits that belong to one channel: how many posts a day, how low the queue may run, and days it never posts. */
function PipelineRules({ brand }: { brand: Brand }) {
  const [busy, run] = useBusy()
  const { data: rules, reload } = useLoad(() => api.pipeline.channelRules(brand.id), [brand.id])
  if (!rules) return null
  const save = async (patch: Parameters<typeof api.pipeline.setChannelRules>[1]) => {
    if (await run(() => api.pipeline.setChannelRules(brand.id, patch))) reload()
  }
  return (
    <Card title="Pipeline rules">
      <p className="mb-3 text-[13px] text-muted">
        These control where the next open slot lands. A daily limit of 1 means only the first slot
        of each day is used, even if you have more times set below.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Most posts a day" hint="0 means no limit.">
          <Select
            aria-label="Most posts a day"
            disabled={busy}
            value={rules.maxPerDay}
            onChange={(e) => void save({ maxPerDay: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'No limit' : n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Low queue alert (days)" hint="Blank uses the setting for every channel.">
          <Select
            aria-label="Low queue alert"
            disabled={busy}
            value={rules.lowQueueDays ?? ''}
            onChange={(e) =>
              void save({ lowQueueDays: e.target.value === '' ? null : Number(e.target.value) })
            }
          >
            <option value="">Same as every channel</option>
            {[1, 2, 3, 5, 7, 14].map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <DateList
          label="Dates this channel does not post"
          dates={rules.blackoutDates}
          onChange={(d) => void save({ blackoutDates: d })}
        />
      </div>
    </Card>
  )
}
