import { useState } from 'react'
import { PLATFORM_LABELS } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import type { StatsRange } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { fmt } from '../components/StatsPanel'
import { Button, Card, Empty, PageHeader, Select, useBusy } from '../ui'

export function Stats() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: brands } = useLoad(() => api.brands.list())
  const [brandId, setBrandId] = useState<number | null>(null)
  const [range, setRange] = useState<StatsRange>('7d')
  const { data, reload } = useLoad(() => api.stats.brandSummary(brandId, range), [brandId, range])

  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.stats}>
        <Button
          disabled={busy}
          onClick={async () => {
            const r = await run(() => api.stats.refresh())
            reload()
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
      </div>
    </div>
  )
}
