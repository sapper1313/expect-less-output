import { useFetch, type VenturesData } from '../useVentures'
import { COPY } from '@shared/copy'
import { Card, LinkOut, Note, Tile, money, when } from '../kit'

export function ListingDetail({ data, storefront, id, onBack }: { data: VenturesData; storefront: string; id: string; onBack: () => void }) {
  const { data: l, error } = useFetch(() => data.listing(storefront, id), [storefront, id])
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-[13px] font-semibold text-accent">
        ← Back
      </button>
      {error && <Note>{error}</Note>}
      {l === null && !error && <Note>That listing is not in the list yet.</Note>}
      {l && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-2xl">{l.title}</h2>
            <LinkOut href={l.url}>{COPY.ventures.openOnEtsy}</LinkOut>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="Price" value={money(l.priceCents, l.currency)} />
            <Tile label="Views" value={String(l.views)} />
            <Tile label="Favorites" value={String(l.favorites)} />
            <Tile label="Sales" value={String(l.sales)} />
            <Tile label="State" value={l.state} />
          </div>
          {l.images.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {l.images.map((u, i) => (
                <img key={i} src={u} alt={`${l.title} ${i + 1}`} className="h-32 w-32 shrink-0 rounded-lg object-cover" />
              ))}
            </div>
          )}
          <Card title="Description">
            <p className="whitespace-pre-wrap text-[13px]">{l.description || 'No description.'}</p>
          </Card>
          <Card title="Tags">
            <div className="flex flex-wrap gap-2">
              {l.tags.length === 0 && <span className="text-muted">No tags.</span>}
              {l.tags.map((t) => (
                <span key={t} className="rounded-full border border-line px-3 py-1 text-[12px]">
                  {t}
                </span>
              ))}
            </div>
          </Card>
          <Card title="Price history">
            <ul className="divide-y divide-line text-[13px]">
              {l.priceHistory.map((p, i) => (
                <li key={i} className="flex justify-between py-1.5">
                  <span className="text-muted">{when(p.at)}</span>
                  <span>{money(p.cents, l.currency)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted">History starts the day the shop was connected.</p>
          </Card>
        </>
      )}
    </div>
  )
}
