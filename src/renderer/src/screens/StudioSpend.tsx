import { formatEastern } from '@shared/time'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Empty } from '../ui'

export function StudioSpend() {
  const { toast } = useApp()
  const { data: s } = useLoad(() => api.studio.spendSummary())
  const { data: rows } = useLoad(() => api.studio.spendRecent(50))
  if (!s) return null
  return (
    <div className="space-y-4">
      <Card
        title={`This month (${s.month}, Eastern)`}
        actions={
          <Button
            onClick={async () => {
              const csv = await api.studio.spendCsv()
              await navigator.clipboard.writeText(csv)
              toast({
                kind: 'success',
                headline: 'Ledger copied as CSV.',
                detail: 'Paste it into a spreadsheet.',
              })
            }}
          >
            Export CSV
          </Button>
        }
      >
        <div className="text-2xl">${s.total.toFixed(2)} real</div>
        <div className="text-[12px] text-muted">
          Mock spend this month: ${s.mockTotal.toFixed(2)} (never counted against caps).
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase text-muted">By brand</h3>
            {s.byBrand.length ? (
              s.byBrand.map((b) => (
                <div key={b.brandName} className="flex justify-between text-[13px]">
                  <span>{b.brandName}</span>
                  <span>${b.dollars.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="text-[13px] text-muted">Nothing yet.</div>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase text-muted">By vendor</h3>
            {s.byVendor.length ? (
              s.byVendor.map((v) => (
                <div key={v.vendor} className="flex justify-between text-[13px]">
                  <span>{v.vendor === 'xai' ? 'xAI (video, images)' : 'Anthropic (text)'}</span>
                  <span>${v.dollars.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="text-[13px] text-muted">Nothing yet.</div>
            )}
          </div>
        </div>
      </Card>
      <Card title="Caps">
        {s.caps.map((c) => (
          <div
            key={c.key}
            className="flex items-center justify-between border-b border-line py-1.5 text-[13px] last:border-0"
          >
            <span>{c.label}</span>
            <span className="text-muted">
              {c.cap.none
                ? 'No spend cap'
                : `$${c.spent.toFixed(2)} of $${c.cap.value.toFixed(2)}, $${(c.remaining ?? 0).toFixed(2)} left`}
            </span>
          </div>
        ))}
      </Card>
      <Card title="Last 50 ledger rows">
        {!rows?.length ? (
          <Empty>No paid calls yet.</Empty>
        ) : (
          <table className="w-full text-left text-[12px]">
            <thead className="text-muted">
              <tr>
                <th>When</th>
                <th>Vendor</th>
                <th>Purpose</th>
                <th>Units</th>
                <th>$</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-1">{formatEastern(r.tsUtc)}</td>
                  <td>{r.vendor}</td>
                  <td>
                    {r.purpose}
                    {r.episodeId ? ` (${r.episodeId})` : ''}
                  </td>
                  <td>
                    {r.units} {r.unitKind}
                  </td>
                  <td>{r.dollars.toFixed(4)}</td>
                  <td>{r.mock ? 'mock' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
