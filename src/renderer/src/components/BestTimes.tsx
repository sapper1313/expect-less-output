import { useState } from 'react'
import { PLATFORMS, PLATFORM_LABELS } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import type { Platform } from '@shared/types'
import { api } from '../api'
import { useLoad } from '../hooks'
import { fmt } from './StatsPanel'
import { Card, Select } from '../ui'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const hourLabel = (h: number) => {
  const n = h % 12 === 0 ? 12 : h % 12
  return `${n}${h < 12 ? 'am' : 'pm'}`
}

/** Best time of day and week for views, from the owner's own videos. Times are Eastern. */
export function BestTimes({ brandId }: { brandId: number | null }) {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const { data } = useLoad(() => api.stats.bestTimes(brandId, platform), [brandId, platform])
  if (!data) return null
  const show = (v: number) =>
    data.relative ? `${v.toFixed(1)}x typical` : `${fmt(Math.round(v))} views`
  const maxHour = Math.max(...data.hours.map((h) => h.median), 0.0001)
  const maxCell = Math.max(...data.cells.map((c) => c.median), 0.0001)

  return (
    <Card
      title="Best times to post (Eastern time)"
      actions={
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
      }
    >
      <div className="mb-3 text-[12px] text-muted">
        {data.used} of {data.videos} videos used (only videos at least {data.minAgeDays} days old
        are compared, so new ones do not look worse than they are).{' '}
        {data.relative ? COPY.stats.relativeNote : COPY.stats.rawNote}
      </div>
      {!data.enough ? (
        <div className="text-[13px] text-muted">{COPY.stats.notEnough}</div>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
              Top hours
            </div>
            {data.top.length === 0 ? (
              <div className="text-[13px] text-muted">{COPY.stats.noTop}</div>
            ) : (
              <ol className="space-y-1 text-[13px]">
                {data.top.map((h, i) => (
                  <li key={h.hour}>
                    <b>
                      {i + 1}. {hourLabel(h.hour)}
                    </b>{' '}
                    <span className="text-muted">
                      typical {show(h.median)}, average {show(h.mean)}, {h.count} videos
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
              Typical views by hour
            </div>
            <div className="flex h-28 items-end gap-[3px]" role="img" aria-label="Views by hour">
              {data.hours.map((h) => (
                <div key={h.hour} className="flex h-full flex-1 flex-col justify-end">
                  <div
                    className="rounded-sm bg-accent"
                    style={{ height: `${(h.median / maxHour) * 100}%`, minHeight: h.count ? 2 : 0 }}
                    title={`${hourLabel(h.hour)}: ${h.count ? show(h.median) : 'no videos'} (${h.count} videos)`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted">
              <span>12am</span>
              <span>6am</span>
              <span>12pm</span>
              <span>6pm</span>
              <span>11pm</span>
            </div>
          </div>

          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
              Day and hour (darker is better, empty means no videos)
            </div>
            <div className="space-y-[3px]">
              {DAYS.map((d, i) => (
                <div key={d} className="flex items-center gap-[3px]">
                  <span className="w-8 text-[10px] text-muted">{d}</span>
                  {Array.from({ length: 24 }, (_, h) => {
                    const c = data.cells.find((x) => x.weekday === i + 1 && x.hour === h)
                    return (
                      <div
                        key={h}
                        className="h-5 flex-1 rounded-sm bg-surface2"
                        style={
                          c
                            ? {
                                background: 'var(--accent)',
                                opacity: 0.2 + 0.8 * (c.median / maxCell),
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
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
