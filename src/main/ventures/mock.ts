import type { ListingDetail, ListingState, ReviewRow } from '@shared/ventures'
import type { VentureStore } from './store'

const DAY = 86_400_000

const svg = (label: string, hue: number) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="hsl(${hue},45%,35%)"/><text x="200" y="215" font-size="28" text-anchor="middle" fill="white" font-family="sans-serif">${label}</text></svg>`,
  )

const PRODUCTS: Array<{ id: string; title: string; cents: number; state: ListingState; was?: number }> = [
  { id: '1001', title: 'Blue Ceramic Mug', cents: 1800, state: 'active', was: 1500 },
  { id: '1002', title: 'Printable Weekly Planner', cents: 600, state: 'active' },
  { id: '1003', title: 'Cozy Reading Candle', cents: 2200, state: 'active', was: 2000 },
  { id: '1004', title: 'Botanical Wall Print Set', cents: 1400, state: 'active' },
  { id: '1005', title: 'Recipe Card Template Pack', cents: 500, state: 'active', was: 700 },
  { id: '1006', title: 'Handmade Mug Coaster Set', cents: 1600, state: 'active' },
  { id: '1007', title: 'Budget Tracker Spreadsheet', cents: 900, state: 'active' },
  { id: '1008', title: 'Linen Tea Towel', cents: 1900, state: 'inactive' },
  { id: '1009', title: 'Holiday Gift Tag Bundle', cents: 400, state: 'expired' },
  { id: '1010', title: 'Wooden Spoon Rest', cents: 1300, state: 'draft' },
  { id: '1011', title: 'Kids Chore Chart Printable', cents: 500, state: 'draft' },
  { id: '1012', title: 'Embroidered Tote Bag', cents: 2600, state: 'active' },
]

const BUYERS = ['maple_fan', 'sam_k', 'quietlark', 'junebug22', 'tea_and_toast', 'rowan_b', 'pixelpeach']

/** Fills the cache with believable fake data so every page can be seen before Etsy approves the app. */
export function seedMockData(store: VentureStore, storefront: string, nowMs: number): void {
  const iso = (ms: number) => new Date(ms).toISOString()
  PRODUCTS.forEach((p, i) => {
    const base: ListingDetail = {
      id: p.id,
      title: p.title,
      thumbUrl: svg(p.title.split(' ')[0], (i * 37) % 360),
      priceCents: p.was ?? p.cents,
      currency: 'USD',
      views: 120 + i * 53,
      favorites: 4 + i * 3,
      quantity: p.state === 'active' ? 5 + i : 0,
      state: p.state,
      url: `https://www.etsy.com/listing/${p.id}`,
      description: `${p.title}. Sample description for the demo shop.`,
      tags: ['gift', 'handmade', p.title.split(' ')[0].toLowerCase()],
      images: [svg(p.title.split(' ')[0], (i * 37) % 360), svg('Detail', (i * 37 + 60) % 360)],
      priceHistory: [{ at: iso(nowMs - 60 * DAY) }].map((h) => ({ ...h, cents: 0 })),
      sales: 0,
    }
    store.upsertListing(storefront, base)
    if (p.was !== undefined)
      store.upsertListing(storefront, { ...base, priceCents: p.cents, priceHistory: [{ at: iso(nowMs - 20 * DAY), cents: p.cents }] })
  })

  const active = PRODUCTS.filter((p) => p.state === 'active')
  for (let n = 0; n < 40; n++) {
    const at = nowMs - (n * 1.45 + 0.2) * DAY
    const a = active[n % active.length]
    const items = [{ listingId: a.id, title: a.title, quantity: 1 + (n % 3 === 0 ? 1 : 0), priceCents: a.cents }]
    if (n % 4 === 0) {
      const b = active[(n + 3) % active.length]
      items.push({ listingId: b.id, title: b.title, quantity: 1, priceCents: b.cents })
    }
    const gross = items.reduce((s, x) => s + x.quantity * x.priceCents, 0)
    store.upsertOrder(storefront, {
      receiptId: `R${5000 + n}`,
      placedAt: iso(at),
      buyerUsername: BUYERS[n % BUYERS.length],
      items,
      feesCents: Math.round(gross * 0.095 + 20 + 25),
      currency: 'USD',
    })
  }

  const reviews: Array<[number, string, string]> = [
    [5, 'Love it, arrived fast.', '1001'],
    [5, 'Exactly as pictured.', '1002'],
    [4, 'Nice quality for the price.', '1003'],
    [5, 'Great gift.', '1004'],
    [2, 'Smaller than I expected.', '1006'],
    [1, 'Arrived chipped.', '1001'],
    [3, 'Fine, but slow shipping.', '1012'],
    [5, 'Will buy again.', '1007'],
  ]
  reviews.forEach(([rating, text, listingId], i) => {
    const r: ReviewRow = {
      id: `V${700 + i}`,
      listingId,
      rating,
      text,
      at: iso(nowMs - (i * 3 + 1) * DAY),
      buyerUsername: BUYERS[(i + 2) % BUYERS.length],
      low: rating <= 3,
    }
    store.upsertReview(storefront, r)
  })

  const notes: Array<[Parameters<VentureStore['addNotification']>[0]['kind'], string, string]> = [
    ['order', 'New order from maple_fan', 'Blue Ceramic Mug, 1 item'],
    ['review', 'New 5 star review', 'Love it, arrived fast.'],
    ['low_review', 'New 1 star review', 'Arrived chipped.'],
    ['message', 'New message from quietlark', 'Hi, is this still available?'],
    ['order', 'New order from sam_k', 'Printable Weekly Planner, 2 items'],
  ]
  notes.forEach(([kind, title, detail], i) =>
    store.addNotification(
      { storefront, kind, title, detail, at: iso(nowMs - i * 3_600_000), url: 'https://www.etsy.com/your/orders' },
      `mock:${i}`,
    ),
  )
}
