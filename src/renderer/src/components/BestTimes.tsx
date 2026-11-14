import { useState } from 'react'
import { PLATFORMS, PLATFORM_LABELS } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import type { Platform } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { fmt } from './StatsPanel'
import { Button, Select, useBusy } from '../ui'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const hourLabel = (h: number) => {
  const n = h % 12 === 0 ? 12 : h % 12
  return `${n}${h < 12 ? 'am' : 'pm'}`
}

/** Best time of day and week for views, from the owner's own videos. Times are Eastern. */
export function BestTimes({ brandId }: { brandId: number | null }) {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const { data } = useLoad(() => api.stats.bestTimes(brandId, platform), [brandId, platform])
  const { toast } = useApp()
  const [busy, run] = useBusy()
  if (!data) return null
  const show = (v: number) =>
    data.relative ? `${v.toFixed(1)}x typical` : `${fmt(Math.round(v))} views`
  const maxHour = Math.max(...data.hours.map((h) => h.median), 0.0001)
  const maxCell = Math.max(...data.cells.map((c) => c.median), 0.0001)

  const canAdd = brandId !== null && platform !== null
  /** Puts this hour on the channel's posting schedule for the chosen platform (Shorts, weekdays and weekends). */
  const addToSchedule = async (hour: number) => {
    if (brandId === null || platform === null) return
    const time = `${String(hour).padStart(2, '0')}:00`
    const ok = await run(async () => {
      const slots = await api.brands.getPlatformSlots(brandId)
      const next = [...slots]
      let added = 0
      for (const dayType of ['weekday', 'weekend'] as const) {
        const has = next.some((x) => x.platform === platform && x.kind === 'short' && x.dayType === dayType && x.timeLocal === time)
        if (!has) {
          next.push({ platform, kind: 'short', dayType, timeLocal: time, enabled: true })
          added++
        }
      }
      if (added) await api.brands.setPlatformSlots(brandId, next)
      return added
    })
    if (ok === undefined) return
    toast({
      kind: ok ? 'success' : 'info',
      headline: ok ? `Added ${hourLabel(hour)} to the schedule.` : `${hourLabel(hour)} is already on the schedule.`,
      detail: 'Shorts, weekdays and weekends. Change it in Setup Channels, Posting schedule.',
    })
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <header className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl">Best times to post (Eastern time)</h2>
        <Select
          className="w-44"
          aria-label="Platform for best times"
          value={platform ?? ''}
          onChange={(e) => setPlatform((e.target.value || null) as Platform | null)}
        >
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABELS[p]}
            </option>
          ))}
        </Select>
      </header>
      <div className="mb-4 text-[12px] text-muted">
        {data.used} of {data.videos} videos used (only videos at least {data.minAgeDays} days old
        are compared, so new ones do not look worse than they are).{' '}
        {data.relative ? COPY.stats.relativeNote : COPY.stats.rawNote}
      </div>
      {!data.enough ? (
        <div className="text-[13px] text-muted">{COPY.stats.notEnough}</div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                Day and hour (brighter is better, empty means no videos)
              </div>
              <div className="space-y-[4px]">
                {DAYS.map((d, i) => (
                  <div key={d} className="flex items-center gap-[4px]">
                    <span className="w-9 text-[11px] text-muted">{d}</span>
                    {Array.from({ length: 24 }, (_, h) => {
                      const c = data.cells.find((x) => x.weekday === i + 1 && x.hour === h)
                      return (
                        <div
                          key={h}
                          className="h-6 flex-1 rounded-md bg-surface2"
                          style={
                            c
                              ? {
                                  background: 'var(--accent)',
                                  opacity: 0.18 + 0.82 * (c.median / maxCell),
                                }
                              : undefined
                          }
                          title={
                            c
                              ? `${d} ${hourLabel(h)}: ${show(c.median)} (${c.count} videos)`
                              : `${d} ${hourLabel(h)}: no videos`
                          }
                        />
                      )
                    })}
                  </div>
                ))}
                <div className="ml-[40px] flex justify-between text-[10px] text-muted">
                  <span>12am</span>
                  <span>6am</span>
                  <span>12pm</span>
                  <span>6pm</span>
                  <span>11pm</span>
                </div>
              </div>
            </div>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                Typical views by hour
              </div>
              <div className="flex h-24 items-end gap-[4px]" role="img" aria-label="Views by hour">
                {data.hours.map((h) => (
                  <div key={h.hour} className="flex h-full flex-1 flex-col justify-end">
                    <div
                      className="rounded-md bg-accent"
                      style={{ height: `${(h.median / maxHour) * 100}%`, minHeight: h.count ? 2 : 0 }}
                      title={`${hourLabel(h.hour)}: ${h.count ? show(h.median) : 'no videos'} (${h.count} videos)`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-[15px] font-bold">Top winning hours</h3>
            {data.top.length === 0 ? (
              <div className="text-[13px] text-muted">{COPY.stats.noTop}</div>
            ) : (
              <ol className="space-y-2.5">
                {data.top.map((h, i) => (
                  <li
                    key={h.hour}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface2 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-bold">
                        {i + 1}
                      </span>
                      <div>
                        <div className="text-[15px] font-bold">{hourLabel(h.hour)} ET</div>
                        <div className="text-[12px] text-muted">
                          {show(h.median)} typical, average {show(h.mean)}, {h.count} videos
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      disabled={!canAdd || busy}
                      title={canAdd ? 'Adds this time to the posting schedule' : 'Pick one channel and one platform above first'}
                      onClick={() => addToSchedule(h.hour)}
                    >
                      + Add to schedule
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            {!canAdd && data.top.length > 0 && (
              <div className="mt-2 text-[11px] text-muted">
                To add a time, pick one channel and one platform.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
