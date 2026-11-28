/** The contract every storefront (Etsy first, others later) fills in. Pages only know this shape. */

/** Eastern dates, YYYY-MM-DD, both ends included. */
export interface VentureRange {
  from: string
  to: string
}
export type RangePreset = 'today' | '7d' | '30d' | 'ytd' | 'custom'

export interface Money {
  cents: number
  currency: string
}

export interface DashboardSummary {
  range: VentureRange
  revenue: Money
  fees: Money
  net: Money
  orders: number
  units: number
  averageOrder: Money
  series: Array<{ date: string; revenueCents: number }>
  topProducts: Array<{ listingId: string; title: string; units: number; revenueCents: number }>
}

export type ListingState = 'active' | 'draft' | 'inactive' | 'expired'

export interface ListingRow {
  id: string
  title: string
  thumbUrl: string | null
  priceCents: number
  currency: string
  views: number
  favorites: number
  quantity: number
  state: ListingState
  url: string
}

export interface ListingDetail extends ListingRow {
  description: string
  tags: string[]
  images: string[]
  priceHistory: Array<{ at: string; cents: number }>
  sales: number
}

export interface OrderItem {
  listingId: string
  title: string
  quantity: number
  priceCents: number
}

/** Buyers are shown by username only. No email, no address. */
export interface OrderRow {
  receiptId: string
  placedAt: string
  buyerUsername: string
  items: OrderItem[]
}

export interface ReviewRow {
  id: string
  listingId: string | null
  rating: number
  text: string
  at: string
  buyerUsername: string
  low: boolean
}

export type NotificationKind = 'order' | 'review' | 'low_review' | 'message'

export interface VentureNotification {
  id: number
  storefront: string
  kind: NotificationKind
  title: string
  detail: string
  at: string
  read: boolean
  url: string | null
}

export interface ConnectionStatus {
  mode: 'mock' | 'connected' | 'not_connected' | 'needs_reauth'
  shopName: string | null
  lastSyncAt: string | null
  expiresAt: string | null
}

export type ListingSort = 'title' | 'price' | 'views' | 'favorites' | 'quantity'
export interface ListingQuery {
  search?: string
  sort?: ListingSort
  dir?: 'asc' | 'desc'
}

export interface VentureProvider {
  id: string
  label: string
  status(): ConnectionStatus
  dashboard(r: VentureRange): DashboardSummary
  listings(q: ListingQuery): ListingRow[]
  listing(id: string): ListingDetail | null
  orders(r: VentureRange): OrderRow[]
  reviews(limit: number): ReviewRow[]
  notifications(): VentureNotification[]
  unread(): number
}

export interface StorefrontInfo {
  id: string
  label: string
  unread: number
  mode: ConnectionStatus['mode']
}
