import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { VenturesLayout } from './VenturesLayout'
import type { VenturesData } from './useVentures'

/**
 * The phone page. Same pages as the Mac, but every read goes to the Mac over the secret link and there is no
 * way to write: this object has no methods that change anything.
 */
const base = location.pathname.replace(/\/?$/, '/')
async function get<T>(file: string, q: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()
  const r = await fetch(base + file + (qs ? '?' + qs : ''), { cache: 'no-store' })
  if (!r.ok) throw new Error(r.status === 400 ? ((await r.json()) as { error: string }).error : `HTTP ${r.status}`)
  return (await r.json()) as T
}

const data: VenturesData = {
  storefronts: () => get('storefronts.json'),
  status: (id) => get('status.json', { storefront: id }),
  dashboard: (id, preset, custom) => get('dashboard.json', { storefront: id, preset, from: custom?.from, to: custom?.to }),
  listings: (id, q) => get('listings.json', { storefront: id, search: q.search, sort: q.sort, dir: q.dir }),
  listing: (id, listingId) => get('listing.json', { storefront: id, id: listingId }),
  orders: (id, preset, custom) => get('orders.json', { storefront: id, preset, from: custom?.from, to: custom?.to }),
  reviews: (id, limit) => get('reviews.json', { storefront: id, limit }),
  notifications: (id) => get('notifications.json', { storefront: id }),
}

document.documentElement.dataset.theme = 'dark'
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="glass-app glass-bg min-h-full" data-look="midnight">
      <VenturesLayout data={data} />
    </div>
  </StrictMode>,
)
