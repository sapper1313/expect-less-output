import { useState } from 'react'
import { PLATFORM_LABELS } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { toCsv } from '@shared/csv'
import { formatEastern } from '@shared/time'
import type { StatsRange } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { fmt } from '../components/StatsPanel'
import { BestTimes } from '../components/BestTimes'
import { StudioInsights } from './StudioOperations'
import { Button, Card, Empty, PageHeader, Select, useBusy } from '../ui'

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

  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.stats}>
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
      </PageHeader>
      <div className="space-y-4 px-8">
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
        <div className="text-[12px] text-muted">{COPY.stats.summaryNote}</div>
        {data && data.posts === 0 ? (
          <Empty>{COPY.stats.empty}</Empty>
        ) : (
          <Card title={`${data?.posts ?? 0} posts published`}>
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="p-2">Platform</th>
                  <th className="p-2">Videos</th>
                  <th className="p-2">Views</th>
                  <th className="p-2">Likes</th>
                  <th className="p-2">Comments</th>
                  <th className="p-2">Shares</th>
                </tr>
              </thead>
              <tbody>
                {data?.platforms.map((p) => (
                  <tr key={p.platform} className="border-t border-line">
                    <td className="p-2 font-semibold">{PLATFORM_LABELS[p.platform]}</td>
                    <td className="p-2">{p.videos}</td>
                    {p.videos > 0 && p.unavailable >= p.videos ? (
                      <td className="p-2 text-muted" colSpan={4}>
                        {COPY.stats.notAvailable}. {p.reason ?? ''}
                      </td>
                    ) : (
                      <>
                        <td className="p-2">{fmt(p.views)}</td>
                        <td className="p-2">{fmt(p.likes)}</td>
                        <td className="p-2">{fmt(p.comments)}</td>
                        <td className="p-2">{fmt(p.shares)}</td>
                      </>
                    )}
                  </tr>
                ))}
                {data && (
                  <tr className="border-t border-line font-bold">
                    <td className="p-2">All</td>
                    <td className="p-2" />
                    <td className="p-2">{fmt(data.totals.views)}</td>
                    <td className="p-2">{fmt(data.totals.likes)}</td>
                    <td className="p-2">{fmt(data.totals.comments)}</td>
                    <td className="p-2">{fmt(data.totals.shares)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        )}
        <BestTimes brandId={brandId} />
        {old && old.length > 0 && (
          <Card title={`Existing videos (${old.length})`}>
            <div className="mb-2 text-[12px] text-muted">{COPY.stats.importedNote}</div>
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="p-2">Video</th>
                  <th className="p-2">Platform</th>
                  <th className="p-2">Published</th>
                  <th className="p-2">Views</th>
                  <th className="p-2">Likes</th>
                  <th className="p-2">Comments</th>
                  <th className="p-2">Shares</th>
                </tr>
              </thead>
              <tbody>
                {old.map((v) => (
                  <tr key={v.id} className="border-t border-line">
                    <td className="max-w-[280px] p-2">
                      <div className="truncate font-semibold" title={v.title}>
                        {v.title || '(no title)'}
                      </div>
                      <div className="text-[11px] text-muted">{v.brandName}</div>
                    </td>
                    <td className="p-2">{PLATFORM_LABELS[v.platform]}</td>
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

export type AnalyticsTab = 'numbers' | 'working'

/** Results: the numbers for every video, and what is working (the Studio's insights). */
export function Stats({ initialTab = 'numbers' }: { initialTab?: AnalyticsTab }) {
  const [tab, setTab] = useState<AnalyticsTab>(initialTab)
  const tabs: Array<[AnalyticsTab, string]> = [
    ['numbers', 'Numbers'],
    ['working', "What's working"],
  ]
  return (
    <div className="flex h-full flex-col">
      <div className="no-drag flex gap-1 px-8 pt-7">
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
      <div className="min-h-0 flex-1">
        {tab === 'numbers' ? (
          <StatsNumbers />
        ) : (
          <div className="h-full overflow-auto px-8 pb-10 pt-4">
            <StudioInsights />
          </div>
        )}
      </div>
    </div>
  )
}
