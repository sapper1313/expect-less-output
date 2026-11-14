import { useState } from 'react'
import { PLATFORM_LABELS } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { toCsv } from '@shared/csv'
import { formatEastern } from '@shared/time'
import type { StatsRange } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { fmt } from '../components/StatsPanel'
import { useSort } from '../components/useSort'
import { AccountStats } from './AccountStats'
import { BestTimes } from '../components/BestTimes'
import { StudioInsights } from './StudioOperations'
import { Button, Card, Empty, Select, useBusy, PlatformName, PlatformLogo } from '../ui'

function StatsNumbers() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: brands } = useLoad(() => api.brands.list())
  const [brandId, setBrandId] = useState<number | null>(null)
  const [range, setRange] = useState<StatsRange>('7d')
  const { data, reload } = useLoad(() => api.stats.brandSummary(brandId, range), [brandId, range])
  const { data: old, reload: reloadOld } = useLoad(
    () => api.stats.imported(brandId, range),
    [brandId, range],
  )

  const num = (
    v: { state: string; numbers: object },
    k: 'views' | 'likes' | 'comments' | 'shares',
  ) => (v.state === 'ok' ? ((v.numbers as Record<string, number | null>)[k] ?? -1) : -1)
  const oldSort = useSort(old, {
    title: (v) => (v.title || '').toLowerCase(),
    platform: (v) => v.platform,
    published: (v) => v.publishedAt ?? '',
    views: (v) => num(v, 'views'),
    likes: (v) => num(v, 'likes'),
    comments: (v) => num(v, 'comments'),
    shares: (v) => num(v, 'shares'),
  }, 'published')
  const platSort = useSort(data?.platforms, {
    platform: (p) => PLATFORM_LABELS[p.platform],
    videos: (p) => p.videos,
    views: (p) => p.views ?? 0,
    likes: (p) => p.likes ?? 0,
    comments: (p) => p.comments ?? 0,
    shares: (p) => p.shares ?? 0,
  }, 'views')

  return (
    <div className="h-full overflow-auto pb-10">
      <div className="space-y-4 px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
          <Select
            className="w-52"
            aria-label="Brand"
            value={brandId ?? ''}
            onChange={(e) => setBrandId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">All brands</option>
            {brands?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select
            className="w-44"
            aria-label="Range"
            value={range}
            onChange={(e) => setRange(e.target.value as StatsRange)}
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={busy}
          onClick={async () => {
            const r = await run(() => api.stats.refresh())
            reload()
            reloadOld()
            if (r)
              toast({
                kind: 'info',
                headline: COPY.stats.refreshed,
                detail: `${r.fetched} read, ${r.unavailable} not available.`,
              })
          }}
        >
          Refresh stats
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            const rows = await api.stats.exportRows(brandId, range)
            if (!rows.length) {
              toast({ kind: 'info', headline: 'Nothing to export in this range yet.' })
              return
            }
            const cols = Object.keys(rows[0])
            const stamp = new Date().toISOString().slice(0, 10)
            const path = await api.media.saveCsv(
              `ELO analytics ${range} ${stamp}.csv`,
              toCsv(cols, rows),
            )
            if (path) toast({ kind: 'success', headline: 'Saved.', detail: path })
          }}
        >
          Export CSV
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            const r = await run(() => api.stats.importExisting(brandId))
            reload()
            reloadOld()
            if (r) {
              toast({
                kind: r.problems.length ? 'error' : 'success',
                headline: r.problems.length ? COPY.stats.importProblems : COPY.stats.imported,
                detail:
                  `${r.found} videos found, ${r.added} new.` +
                  r.problems
                    .map((p) => ` ${p.brand}, ${PLATFORM_LABELS[p.platform]}: ${p.message}`)
                    .join(''),
              })
            }
          }}
        >
          Import existing videos
        </Button>
          </div>
        </div>
        <div className="text-[12px] text-muted">{COPY.stats.summaryNote}</div>
        {data && data.posts === 0 ? (
          <Empty>{COPY.stats.empty}</Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {(
                [
                  ['Posts published', data?.posts ?? 0],
                  ['Total views', data ? fmt(data.totals.views) : '-'],
                  ['Likes', data ? fmt(data.totals.likes) : '-'],
                  ['Comments', data ? fmt(data.totals.comments) : '-'],
                  ['Shares', data ? fmt(data.totals.shares) : '-'],
                ] as Array<[string, string | number]>
              ).map(([label, v]) => (
                <div key={label} className="rounded-lg border border-line bg-surface p-4">
                  <div className="text-[34px] font-bold leading-none">{v}</div>
                  <div className="mt-2 text-[13px] text-muted">{label}</div>
                </div>
              ))}
            </div>
            <section className="rounded-lg border border-line bg-surface p-5">
              <h2 className="mb-3 text-xl">Platform performance</h2>
              <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
                {platSort.sorted?.map((p) => {
                  const dead = p.videos > 0 && p.unavailable >= p.videos
                  const top = Math.max(...(data?.platforms ?? []).map((x) => x.views ?? 0), 1)
                  return (
                    <div key={p.platform} className="flex items-start gap-3">
                      <PlatformLogo platform={p.platform} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[16px] font-bold">{PLATFORM_LABELS[p.platform]}</div>
                        {dead ? (
                          <div className="text-[13px] text-muted">
                            {p.videos} videos. {COPY.stats.notAvailable}. {p.reason ?? ''}
                          </div>
                        ) : (
                          <>
                            <div className="text-[13px] text-muted">
                              {p.videos} videos · {fmt(p.views)} views · {fmt(p.likes)} likes ·{' '}
                              {fmt(p.comments)} comments · {fmt(p.shares)} shares
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface2">
                              <div
                                className="h-full rounded-full bg-accent"
                                style={{ width: `${((p.views ?? 0) / top) * 100}%` }}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}
        <BestTimes brandId={brandId} />
        {old && old.length > 0 && (
          <Card title={`Existing videos (${old.length})`}>
            <div className="mb-2 text-[12px] text-muted">{COPY.stats.importedNote}</div>
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  {oldSort.th('title', 'Video')}
                  {oldSort.th('platform', 'Platform')}
                  {oldSort.th('published', 'Published')}
                  {oldSort.th('views', 'Views')}
                  {oldSort.th('likes', 'Likes')}
                  {oldSort.th('comments', 'Comments')}
                  {oldSort.th('shares', 'Shares')}
                </tr>
              </thead>
              <tbody>
                {(oldSort.sorted ?? old).map((v) => (
                  <tr key={v.id} className="border-t border-line">
                    <td className="max-w-[280px] p-2">
                      <div className="truncate font-semibold" title={v.title}>
                        {v.title || '(no title)'}
                      </div>
                      <div className="text-[11px] text-muted">{v.brandName}</div>
                    </td>
                    <td className="p-2"><PlatformName platform={v.platform} /></td>
                    <td className="p-2">{v.publishedAt ? formatEastern(v.publishedAt) : '-'}</td>
                    {v.state === 'ok' ? (
                      (['views', 'likes', 'comments', 'shares'] as const).map((k) => (
                        <td key={k} className="p-2 tabular-nums">
                          {fmt(v.numbers[k])}
                          {v.approximate.includes(k) ? '~' : ''}
                        </td>
                      ))
                    ) : (
                      <td className="p-2 text-muted" colSpan={4}>
                        {v.state === 'pending'
                          ? COPY.stats.pending
                          : `${COPY.stats.notAvailable}. ${v.reason ?? ''}`}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  )
}

export type AnalyticsTab = 'numbers' | 'accounts' | 'working'

/** Results: the numbers for every video, and what is working (the Studio's insights). */
export function Stats({ initialTab = 'numbers' }: { initialTab?: AnalyticsTab }) {
  const [tab, setTab] = useState<AnalyticsTab>(initialTab)
  const tabs: Array<[AnalyticsTab, string]> = [
    ['numbers', 'Numbers'],
    ['accounts', 'By channel and platform'],
    ['working', "What's working"],
  ]
  return (
    <div className="flex h-full flex-col">
      <div className="drag flex flex-wrap items-center gap-x-6 gap-y-3 px-8 pb-2 pt-7">
        <h1 className="text-4xl">{COPY.nav.stats}</h1>
        <div className="no-drag flex gap-1">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${tab === id ? 'bg-accent text-[#111]' : 'text-ink hover:bg-surface2'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'numbers' ? (
          <StatsNumbers />
        ) : tab === 'accounts' ? (
          <div className="h-full overflow-auto px-8 pb-10 pt-4">
            <AccountStats />
          </div>
        ) : (
          <div className="h-full overflow-auto px-8 pb-10 pt-4">
            <StudioInsights />
          </div>
        )}
      </div>
    </div>
  )
}
