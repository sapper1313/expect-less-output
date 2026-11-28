import { COPY } from '@shared/copy'
import { useFetch, type VenturesData } from '../useVentures'
import { Note, Stars, when } from '../kit'

export function Reviews({ data, storefront, onOpenListing }: { data: VenturesData; storefront: string; onOpenListing: (id: string) => void }) {
  const { data: rows, error } = useFetch(() => data.reviews(storefront, 50), [storefront])
  return (
    <div className="space-y-2">
      {error && <Note>{error}</Note>}
      {rows && rows.length === 0 && <Note>{COPY.ventures.emptyReviews}</Note>}
      {rows?.map((r) => (
        <article key={r.id} className={`rounded-lg border bg-surface p-3 text-[13px] ${r.low ? 'border-warn' : 'border-line'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Stars n={r.rating} />
              {r.low && <span className="rounded-full bg-warn/20 px-2 py-0.5 text-[11px] font-bold text-warn">{COPY.ventures.lowStarFlag}</span>}
            </span>
            <span className="text-muted">
              {r.buyerUsername} · {when(r.at)}
            </span>
          </div>
          <p className="mt-2">{r.text || 'No comment.'}</p>
          {r.listingId && (
            <button className="mt-1 text-[12px] text-accent" onClick={() => onOpenListing(r.listingId!)}>
              View listing
            </button>
          )}
        </article>
      ))}
    </div>
  )
}
