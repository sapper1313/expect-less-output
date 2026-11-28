import { useState } from 'react'
import { COPY } from '@shared/copy'
import type { RangePreset } from '@shared/ventures'
import { useFetch, type VenturesData } from '../useVentures'
import { Chip, Note, money, when } from '../kit'

const PRESETS: Array<[RangePreset, string]> = [
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['ytd', 'Year to date'],
]

/** Buyers show as a username only. There is no email or address in the data at all. */
export function ItemsSold({ data, storefront, onOpenListing }: { data: VenturesData; storefront: string; onOpenListing: (id: string) => void }) {
  const [preset, setPreset] = useState<RangePreset>('30d')
  const { data: orders, error } = useFetch(() => data.orders(storefront, preset), [storefront, preset])
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(([id, l]) => (
          <Chip key={id} active={preset === id} onClick={() => setPreset(id)}>
            {l}
          </Chip>
        ))}
      </div>
      {error && <Note>{error}</Note>}
      {orders && orders.length === 0 && <Note>{COPY.ventures.emptyOrders}</Note>}
      <ul className="space-y-2">
        {orders?.map((o) => (
          <li key={o.receiptId} className="rounded-lg border border-line bg-surface p-3 text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2 text-muted">
              <span>
                Order {o.receiptId} · {when(o.placedAt)}
              </span>
              <span>{o.buyerUsername}</span>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {o.items.map((i, n) => (
                <li key={n} className="flex items-center justify-between gap-3 py-1.5">
                  <button className="min-w-0 truncate text-left font-semibold hover:underline" onClick={() => onOpenListing(i.listingId)}>
                    {i.title}
                  </button>
                  <span className="shrink-0 text-muted">
                    {i.quantity} × {money(i.priceCents)}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
