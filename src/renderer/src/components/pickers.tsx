import { useEffect, useState } from 'react'
import {
  ALL_PLATFORMS,
  isExtraPlatform,
  PLATFORM_LABELS,
  SOFT_WARN_POSTS_PER_BRAND_PER_DAY,
  type Platform,
} from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { formatEastern, isoToLocalInput, localInputToIso } from '@shared/time'
import type { SchedulingMode } from '@shared/types'
import { api } from '../api'
import { useLoad } from '../hooks'
import { Check, DateTimeSelect, Select } from '../ui'

export function PlatformPicker({
  brandId,
  value,
  onChange,
}: {
  brandId: number | null
  value: Platform[]
  onChange: (v: Platform[]) => void
}) {
  const { data: accounts } = useLoad(
    () => (brandId ? api.accounts.list(brandId) : Promise.resolve([])),
    [brandId],
  )
  const byPlatform = new Map((accounts ?? []).map((a) => [a.platform, a]))
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {ALL_PLATFORMS.map((p) => {
        const acct = byPlatform.get(p)
        const ok = !!acct && acct.status === 'connected'
        // Bluesky, X, LinkedIn and Pinterest are only part of a channel that has a login for them.
        if (isExtraPlatform(p) && !ok) return null
        return (
          <Check
            key={p}
            checked={value.includes(p) && ok}
            disabled={!ok}
            onChange={(on) => onChange(on ? [...value, p] : value.filter((x) => x !== p))}
          >
            {PLATFORM_LABELS[p]}
            {acct?.mode === 'dry_run' && (
              <span className="rounded bg-surface2 px-1.5 text-[10px] uppercase text-muted">
                {COPY.dryRunBadge}
              </span>
            )}
            {!ok && <span className="text-[11px] text-muted">(not connected)</span>}
          </Check>
        )
      })}
    </div>
  )
}

/**
 * For changing the time of a post that already exists: pick one of the channel's open slots, or pick any other time.
 * The post's own time is always in the list, so nothing changes unless you choose something else.
 */
export function WhenPicker({
  brandId,
  value,
  onChange,
  disabled,
  slotsToo = true,
}: {
  brandId: number | null
  value: string | null
  onChange: (iso: string | null) => void
  disabled?: boolean
  /** false: only the free time box (for clips, which have no episode slots). */
  slotsToo?: boolean
}) {
  const { data: slots } = useLoad(
    () => (brandId && slotsToo ? api.slots.next(brandId, 40) : Promise.resolve([] as string[])),
    [brandId, slotsToo],
  )
  const [custom, setCustom] = useState(false)
  const list = slots ?? []
  const own = !!value && !list.includes(value)
  const ready = slots !== undefined
  const showCustom = !slotsToo || custom
  return (
    <div className="space-y-2">
      {slotsToo && (
        <Select
          disabled={disabled || !ready}
          value={showCustom ? '__custom' : (value ?? '')}
          onChange={(e) => {
            if (e.target.value === '__custom') setCustom(true)
            else {
              setCustom(false)
              onChange(e.target.value || null)
            }
          }}
        >
          {own && value && <option value={value}>Now: {formatEastern(value)}</option>}
          {!value && <option value="">Pick a slot</option>}
          {list.map((s) => (
            <option key={s} value={s}>
              {formatEastern(s)} (open slot)
            </option>
          ))}
          <option value="__custom">Pick a different time...</option>
        </Select>
      )}
      {showCustom && (
        <DateTimeSelect
          step={1}
          disabled={disabled}
          value={isoToLocalInput(value)}
          onChange={(v) => onChange(localInputToIso(v))}
          label="When"
        />
      )}
    </div>
  )
}

export function SchedulePicker({
  brandId,
  value,
  onChange,
  mode,
  autoFill = true,
}: {
  brandId: number | null
  value: string | null
  onChange: (iso: string | null) => void
  mode: SchedulingMode
  autoFill?: boolean
}) {
  const { data: slots } = useLoad(
    () => (brandId ? api.slots.next(brandId, 14) : Promise.resolve([])),
    [brandId],
  )
  const [custom, setCustom] = useState(mode === 'manual')
  const [dayCount, setDayCount] = useState(0)

  useEffect(() => {
    if (autoFill && !value && slots && slots.length && mode !== 'manual') onChange(slots[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, mode])

  useEffect(() => {
    if (brandId && value) void api.slots.countOnDay(brandId, value).then(setDayCount)
    else setDayCount(0)
  }, [brandId, value])

  const inSlots = !!value && !!slots?.includes(value)
  const showCustom = mode === 'manual' || custom || (!!value && !inSlots)
  return (
    <div className="space-y-2">
      {mode !== 'manual' && (
        <Select
          value={showCustom ? '__custom' : (value ?? '')}
          onChange={(e) => {
            if (e.target.value === '__custom') {
              setCustom(true)
            } else {
              setCustom(false)
              onChange(e.target.value || null)
            }
          }}
        >
          {!slots?.length && (
            <option value="">No open slots. Add slot times on the Brands screen.</option>
          )}
          {slots?.map((s) => (
            <option key={s} value={s}>
              {formatEastern(s)}
            </option>
          ))}
          {mode === 'both' && <option value="__custom">Pick a different time...</option>}
        </Select>
      )}
      {showCustom && (
        <DateTimeSelect
          step={1}
          value={isoToLocalInput(value)}
          onChange={(v) => onChange(localInputToIso(v))}
          label="Date and time in Eastern"
        />
      )}
      {value && <div className="text-[12px] text-muted">{formatEastern(value)}</div>}
      {dayCount >= SOFT_WARN_POSTS_PER_BRAND_PER_DAY && (
        <div className="text-[12px] font-semibold text-warn">
          Heads up: this brand already has {dayCount} posts that day.
        </div>
      )}
    </div>
  )
}
