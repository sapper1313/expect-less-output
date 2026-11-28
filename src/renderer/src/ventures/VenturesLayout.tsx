import { useState } from 'react'
import { COPY } from '@shared/copy'
import { useFetch, type VenturesData } from './useVentures'
import { Dashboard } from './pages/Dashboard'
import { Listings } from './pages/Listings'
import { ItemsSold } from './pages/ItemsSold'
import { ListingDetail } from './pages/ListingDetail'
import { Reviews } from './pages/Reviews'
import { Notifications } from './pages/Notifications'
import { Chip, Note } from './kit'
import type { ReactNode } from 'react'

type PageId = 'dashboard' | 'listings' | 'itemsSold' | 'reviews' | 'notifications'
const PAGES: PageId[] = ['dashboard', 'listings', 'itemsSold', 'reviews', 'notifications']

/**
 * ELS Ventures: a storefront picker, then the same six pages for whichever storefront is picked.
 * The Mac shows it inside the app. The phone shows it on its own page. `extra` is where the Mac puts Connect Etsy.
 */
export function VenturesLayout({
  data,
  initialStorefront,
  onUnreadChange,
  extra,
}: {
  data: VenturesData
  initialStorefront?: string
  onUnreadChange?: () => void
  extra?: (storefront: string) => ReactNode
}) {
  const [tick, setTick] = useState(0)
  const { data: stores } = useFetch(() => data.storefronts(), [tick])
  const [picked, setPicked] = useState(initialStorefront ?? '')
  const [page, setPage] = useState<PageId>('dashboard')
  const [listingId, setListingId] = useState<string | null>(null)
  const storefront = picked || stores?.[0]?.id || ''
  const store = stores?.find((s) => s.id === storefront)
  const { data: status } = useFetch(() => (storefront ? data.status(storefront) : Promise.resolve(null)), [storefront, tick])
  const open = (id: string) => setListingId(id)
  const changed = () => {
    setTick((t) => t + 1)
    onUnreadChange?.()
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 pb-10 pt-6 md:px-8">
      <h1 className="text-3xl md:text-4xl">{COPY.ventures.nav}</h1>
      {stores && stores.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Storefronts">
          {stores.map((s) => (
            <Chip
              key={s.id}
              active={s.id === storefront}
              onClick={() => {
                setPicked(s.id)
                setListingId(null)
              }}
            >
              {s.label}
              {s.unread > 0 && <span className="ml-2 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{s.unread}</span>}
            </Chip>
          ))}
        </div>
      )}
      {status?.mode === 'mock' && <Note>{COPY.ventures.mockBanner}</Note>}
      {status?.mode === 'needs_reauth' && <Note>Etsy needs you to sign in again.</Note>}
      {extra?.(storefront)}
      <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Pages">
        {PAGES.map((p) => (
          <Chip
            key={p}
            active={!listingId && page === p}
            onClick={() => {
              setPage(p)
              setListingId(null)
            }}
          >
            {COPY.ventures.pages[p]}
            {p === 'notifications' && !!store?.unread && (
              <span className="ml-2 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{store.unread}</span>
            )}
          </Chip>
        ))}
      </nav>
      {!storefront && <Note>No storefronts yet.</Note>}
      {storefront && listingId && <ListingDetail data={data} storefront={storefront} id={listingId} onBack={() => setListingId(null)} />}
      {storefront && !listingId && page === 'dashboard' && <Dashboard data={data} storefront={storefront} onOpenListing={open} />}
      {storefront && !listingId && page === 'listings' && <Listings data={data} storefront={storefront} onOpen={open} />}
      {storefront && !listingId && page === 'itemsSold' && <ItemsSold data={data} storefront={storefront} onOpenListing={open} />}
      {storefront && !listingId && page === 'reviews' && <Reviews data={data} storefront={storefront} onOpenListing={open} />}
      {storefront && !listingId && page === 'notifications' && <Notifications data={data} storefront={storefront} onChange={changed} />}
    </div>
  )
}
