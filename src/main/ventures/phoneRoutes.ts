import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ListingSort, RangePreset } from '@shared/ventures'
import type { VenturesService } from './service'

export interface PhoneVentures {
  service: VenturesService
  /** Folder holding the built phone page (`ventures.html` and `assets/`). Null when it was not built. */
  dir: string | null
}

export interface VenturesPhoneResponse {
  status: number
  type: string
  body: string | Buffer
}

const PRESETS: RangePreset[] = ['today', '7d', '30d', 'ytd', 'custom']
const SORTS: ListingSort[] = ['title', 'price', 'views', 'favorites', 'quantity']
const ID = /^[a-z0-9_-]{1,32}$/
const LISTING_ID = /^[A-Za-z0-9_:.-]{1,64}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ASSET = /^assets\/[A-Za-z0-9._-]+$/

const TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  woff2: 'font/woff2',
  woff: 'font/woff',
  png: 'image/png',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
}

const json = (body: unknown, status = 200): VenturesPhoneResponse => ({
  status,
  type: 'application/json; charset=utf-8',
  body: JSON.stringify(body ?? null),
})
const plain = (status: number, text: string): VenturesPhoneResponse => ({ status, type: 'text/plain; charset=utf-8', body: text })
class Bad extends Error {}

/**
 * Everything the phone may ask of ELS Ventures. GET only, and only these reads: no connect, no settings, no
 * mark-as-read, no sync, no writes of any kind. `rest` is the path after `ventures/`. Anything else is a 404.
 */
export function handleVenturesPhone(v: PhoneVentures, rest: string, q: URLSearchParams): VenturesPhoneResponse {
  if (rest === '') {
    const f = v.dir && join(v.dir, 'ventures.html')
    if (!f || !existsSync(f)) return plain(404, 'Not found.')
    return { status: 200, type: 'text/html; charset=utf-8', body: readFileSync(f) }
  }
  if (ASSET.test(rest)) {
    const f = v.dir && join(v.dir, rest)
    if (!f || !existsSync(f)) return plain(404, 'Not found.')
    const ext = rest.split('.').pop() ?? ''
    return { status: 200, type: TYPES[ext] ?? 'application/octet-stream', body: readFileSync(f) }
  }
  const storefront = () => {
    const s = q.get('storefront') ?? ''
    if (!ID.test(s)) throw new Bad('Pick a storefront.')
    return s
  }
  const range = () => {
    const preset = (q.get('preset') ?? '30d') as RangePreset
    if (!PRESETS.includes(preset)) throw new Bad('That range is not allowed.')
    const from = q.get('from') ?? ''
    const to = q.get('to') ?? ''
    if (preset === 'custom' && !(DATE.test(from) && DATE.test(to))) throw new Bad('Pick a start and end date.')
    return { preset, custom: preset === 'custom' ? { from, to } : undefined }
  }
  const s = v.service
  try {
    switch (rest) {
      case 'storefronts.json':
        return json(s.storefronts())
      case 'status.json':
        return json(s.status(storefront()))
      case 'dashboard.json': {
        const r = range()
        return json(s.dashboard(storefront(), r.preset, r.custom))
      }
      case 'orders.json': {
        const r = range()
        return json(s.orders(storefront(), r.preset, r.custom))
      }
      case 'listings.json': {
        const sort = q.get('sort') as ListingSort | null
        if (sort && !SORTS.includes(sort)) throw new Bad('That sort is not allowed.')
        return json(
          s.listings(storefront(), {
            search: (q.get('search') ?? '').slice(0, 100),
            sort: sort ?? undefined,
            dir: q.get('dir') === 'desc' ? 'desc' : 'asc',
          }),
        )
      }
      case 'listing.json': {
        const id = q.get('id') ?? ''
        if (!LISTING_ID.test(id)) throw new Bad('Pick a listing.')
        return json(s.listing(storefront(), id))
      }
      case 'reviews.json':
        return json(s.reviews(storefront(), Number(q.get('limit') ?? 50) || 50))
      case 'notifications.json':
        return json(s.notifications(storefront()))
    }
  } catch (e) {
    if (e instanceof Bad || (e instanceof Error && /Unknown storefront|Start date|date is not valid|Pick a/.test(e.message)))
      return json({ error: (e as Error).message }, 400)
    return plain(500, 'Something went wrong inside the app.')
  }
  return plain(404, 'Not found.')
}
