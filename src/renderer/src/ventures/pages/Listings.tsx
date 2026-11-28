import { useState } from 'react'
import { COPY } from '@shared/copy'
import type { ListingSort } from '@shared/ventures'
import { useFetch, type VenturesData } from '../useVentures'
import { LinkOut, Note, money } from '../kit'

const COLS: Array<[ListingSort, string]> = [
  ['title', 'Title'],
  ['price', 'Price'],
  ['views', 'Views'],
  ['favorites', 'Favorites'],
  ['quantity', 'Qty'],
]

export function Listings({ data, storefront, onOpen }: { data: VenturesData; storefront: string; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ListingSort>('title')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const { data: rows, error } = useFetch(() => data.listings(storefront, { search, sort, dir }), [storefront, search, sort, dir])
  const toggle = (c: ListingSort) => {
    if (c === sort) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setSort(c)
      setDir(c === 'title' ? 'asc' : 'desc')
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search listings"
          placeholder="Search listings"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-line bg-bg px-3 py-2 text-[13px] md:w-72"
        />
        <label className="flex items-center gap-2 text-[13px] text-muted md:hidden">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as ListingSort)} className="rounded-md border border-line bg-bg px-2 py-1.5 text-ink">
            {COLS.map(([id, l]) => (
              <option key={id} value={id}>
                {l}
              </option>
            ))}
          </select>
          <button onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')} className="rounded-md border border-line px-2 py-1.5 text-ink" aria-label="Flip sort direction">
            {dir === 'asc' ? '↑' : '↓'}
          </button>
        </label>
      </div>
      {error && <Note>{error}</Note>}
      {rows && rows.length === 0 && <Note>{COPY.ventures.emptyListings}</Note>}
      {rows && rows.length > 0 && (
        <>
          <table className="hidden w-full text-[13px] md:table">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="w-14 py-2" />
                {COLS.map(([id, l]) => (
                  <th key={id} className="py-2 pr-3" aria-sort={sort === id ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button onClick={() => toggle(id)} className="font-bold uppercase">
                      {l} {sort === id ? (dir === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </th>
                ))}
                <th className="py-2 pr-3">State</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b border-line/60">
                  <td className="py-2">{l.thumbUrl && <img src={l.thumbUrl} alt="" className="h-10 w-10 rounded object-cover" />}</td>
                  <td className="py-2 pr-3">
                    <button className="text-left font-semibold hover:underline" onClick={() => onOpen(l.id)}>
                      {l.title}
                    </button>
                  </td>
                  <td className="py-2 pr-3">{money(l.priceCents, l.currency)}</td>
                  <td className="py-2 pr-3">{l.views}</td>
                  <td className="py-2 pr-3">{l.favorites}</td>
                  <td className="py-2 pr-3">{l.quantity}</td>
                  <td className="py-2 pr-3 capitalize">{l.state}</td>
                  <td className="py-2">
                    <LinkOut href={l.url}>{COPY.ventures.openOnEtsy}</LinkOut>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="space-y-2 md:hidden">
            {rows.map((l) => (
              <li key={l.id} className="flex gap-3 rounded-lg border border-line bg-surface p-3">
                {l.thumbUrl && <img src={l.thumbUrl} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />}
                <div className="min-w-0 flex-1 text-[13px]">
                  <button className="block max-w-full truncate text-left font-semibold" onClick={() => onOpen(l.id)}>
                    {l.title}
                  </button>
                  <div className="text-muted">
                    {money(l.priceCents, l.currency)} · {l.views} views · {l.favorites} favorites · qty {l.quantity} · <span className="capitalize">{l.state}</span>
                  </div>
                  <LinkOut href={l.url}>{COPY.ventures.openOnEtsy}</LinkOut>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
