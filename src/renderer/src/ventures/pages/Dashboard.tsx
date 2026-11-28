import { useState } from 'react'
import { COPY } from '@shared/copy'
import type { RangePreset } from '@shared/ventures'
import { useFetch, type VenturesData } from '../useVentures'
import { Card, Chip, Note, Tile, money } from '../kit'

const PRESETS: Array<[RangePreset, string]> = [
  ['today', 'Today'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['ytd', 'Year to date'],
  ['custom', 'Custom'],
]

export function Dashboard({ data, storefront, onOpenListing }: { data: VenturesData; storefront: string; onOpenListing: (id: string) => void }) {
  const [preset, setPreset] = useState<RangePreset>('30d')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const custom = preset === 'custom' ? { from, to } : undefined
  const ready = preset !== 'custom' || (!!from && !!to)
  const { data: d, error } = useFetch(
    () => (ready ? data.dashboard(storefront, preset, custom) : Promise.resolve(null)),
    [storefront, preset, from, to],
  )
  const max = Math.max(1, ...(d?.series.map((p) => p.revenueCents) ?? [1]))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(([id, label]) => (
          <Chip key={id} active={preset === id} onClick={() => setPreset(id)}>
            {label}
          </Chip>
        ))}
        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5" />
            <span className="text-muted">to</span>
            <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1.5" />
          </div>
        )}
      </div>
      {error && <Note>{error}</Note>}
      {!ready && <Note>Pick a start and end date.</Note>}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Revenue" value={money(d.revenue.cents, d.revenue.currency)} />
            <Tile label="Fees" value={money(d.fees.cents, d.fees.currency)} />
            <Tile label="Net" value={money(d.net.cents, d.net.currency)} hint="Revenue minus fees" />
            <Tile label="Orders" value={String(d.orders)} />
            <Tile label="Units sold" value={String(d.units)} />
            <Tile label="Average order" value={money(d.averageOrder.cents, d.averageOrder.currency)} />
          </div>
          <Card title="Revenue over time">
            {d.orders === 0 ? (
              <Note>{COPY.ventures.emptyOrders}</Note>
            ) : (
              <div role="img" aria-label="Revenue per day" className="flex h-40 items-end gap-[2px]">
                {d.series.map((p) => (
                  <div
                    key={p.date}
                    title={`${p.date}: ${money(p.revenueCents, d.revenue.currency)}`}
                    className="min-w-[2px] flex-1 rounded-t bg-accent"
                    style={{ height: `${Math.max(2, (p.revenueCents / max) * 100)}%`, opacity: p.revenueCents ? 1 : 0.25 }}
                  />
                ))}
              </div>
            )}
          </Card>
          <Card title="Top products">
            {d.topProducts.length === 0 ? (
              <Note>{COPY.ventures.emptyOrders}</Note>
            ) : (
              <ul className="divide-y divide-line">
                {d.topProducts.map((p) => (
                  <li key={p.listingId} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <button className="min-w-0 truncate text-left font-semibold hover:underline" onClick={() => onOpenListing(p.listingId)}>
                      {p.title}
                    </button>
                    <span className="shrink-0 text-muted">
                      {p.units} sold · {money(p.revenueCents, d.revenue.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
