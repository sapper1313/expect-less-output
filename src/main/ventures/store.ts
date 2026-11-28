import type { Db } from '../db'
import type {
  ListingDetail,
  ListingRow,
  ListingState,
  OrderRow,
  ReviewRow,
  VentureNotification,
} from '@shared/ventures'

export type StoredOrder = OrderRow & { feesCents: number; currency: string }

/** All reads and writes for the storefront cache. Pages never call a storefront directly. */
export class VentureStore {
  constructor(private db: Db) {}

  // ---------- listings ----------

  upsertListing(storefront: string, l: ListingDetail): void {
    this.db.transaction(() => {
      const prev = this.db
        .prepare('SELECT price_cents FROM venture_listings WHERE storefront = ? AND id = ?')
        .get(storefront, l.id) as { price_cents: number } | undefined
      this.db
        .prepare(
          `INSERT INTO venture_listings (storefront, id, title, thumb_url, price_cents, currency, views, favorites, quantity, state, url, description, tags_json, sales, updated_at)
           VALUES (@storefront, @id, @title, @thumb, @price, @currency, @views, @favorites, @quantity, @state, @url, @description, @tags, @sales, @now)
           ON CONFLICT(storefront, id) DO UPDATE SET title=@title, thumb_url=@thumb, price_cents=@price, currency=@currency, views=@views,
             favorites=@favorites, quantity=@quantity, state=@state, url=@url, description=@description, tags_json=@tags, sales=@sales, updated_at=@now`,
        )
        .run({
          storefront,
          id: l.id,
          title: l.title,
          thumb: l.thumbUrl,
          price: l.priceCents,
          currency: l.currency,
          views: l.views,
          favorites: l.favorites,
          quantity: l.quantity,
          state: l.state,
          url: l.url,
          description: l.description,
          tags: JSON.stringify(l.tags),
          sales: l.sales,
          now: new Date().toISOString(),
        })
      if (!prev || prev.price_cents !== l.priceCents) {
        const at = l.priceHistory.length ? l.priceHistory[l.priceHistory.length - 1].at : new Date().toISOString()
        this.db
          .prepare('INSERT INTO venture_price_history (storefront, listing_id, at, cents) VALUES (?, ?, ?, ?)')
          .run(storefront, l.id, at, l.priceCents)
      }
      this.db.prepare('DELETE FROM venture_listing_images WHERE storefront = ? AND listing_id = ?').run(storefront, l.id)
      l.images.forEach((url, i) =>
        this.db
          .prepare('INSERT INTO venture_listing_images (storefront, listing_id, position, url) VALUES (?, ?, ?, ?)')
          .run(storefront, l.id, i, url),
      )
    })()
  }

  private toRow(r: any): ListingRow {
    return {
      id: r.id,
      title: r.title,
      thumbUrl: r.thumb_url,
      priceCents: r.price_cents,
      currency: r.currency,
      views: r.views,
      favorites: r.favorites,
      quantity: r.quantity,
      state: r.state as ListingState,
      url: r.url,
    }
  }

  listingRows(storefront: string): ListingRow[] {
    return (this.db.prepare('SELECT * FROM venture_listings WHERE storefront = ?').all(storefront) as any[]).map((r) =>
      this.toRow(r),
    )
  }

  getListing(storefront: string, id: string): ListingDetail | null {
    const r = this.db.prepare('SELECT * FROM venture_listings WHERE storefront = ? AND id = ?').get(storefront, id) as any
    if (!r) return null
    const images = (
      this.db
        .prepare('SELECT url FROM venture_listing_images WHERE storefront = ? AND listing_id = ? ORDER BY position')
        .all(storefront, id) as Array<{ url: string }>
    ).map((x) => x.url)
    const priceHistory = this.db
      .prepare('SELECT at, cents FROM venture_price_history WHERE storefront = ? AND listing_id = ? ORDER BY at, rowid')
      .all(storefront, id) as Array<{ at: string; cents: number }>
    const sold = (
      this.db
        .prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM venture_order_items WHERE storefront = ? AND listing_id = ?')
        .get(storefront, id) as { n: number }
    ).n
    return {
      ...this.toRow(r),
      description: r.description,
      tags: JSON.parse(r.tags_json) as string[],
      images,
      priceHistory,
      sales: Math.max(r.sales, sold),
    }
  }

  // ---------- orders ----------

  hasOrder(storefront: string, receiptId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM venture_orders WHERE storefront = ? AND receipt_id = ?').get(storefront, receiptId)
  }

  upsertOrder(storefront: string, o: StoredOrder): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO venture_orders (storefront, receipt_id, placed_at, buyer_username, fees_cents, currency)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(storefront, receipt_id) DO UPDATE SET placed_at=excluded.placed_at, buyer_username=excluded.buyer_username, fees_cents=excluded.fees_cents, currency=excluded.currency`,
        )
        .run(storefront, o.receiptId, o.placedAt, o.buyerUsername, o.feesCents, o.currency)
      this.db.prepare('DELETE FROM venture_order_items WHERE storefront = ? AND receipt_id = ?').run(storefront, o.receiptId)
      o.items.forEach((it, i) =>
        this.db
          .prepare(
            'INSERT INTO venture_order_items (storefront, receipt_id, position, listing_id, title, quantity, price_cents) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(storefront, o.receiptId, i, it.listingId, it.title, it.quantity, it.priceCents),
      )
    })()
  }

  ordersBetween(storefront: string, fromUtc: string, toUtc: string): StoredOrder[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM venture_orders WHERE storefront = ? AND placed_at >= ? AND placed_at < ? ORDER BY placed_at DESC',
      )
      .all(storefront, fromUtc, toUtc) as any[]
    return rows.map((r) => ({
      receiptId: r.receipt_id,
      placedAt: r.placed_at,
      buyerUsername: r.buyer_username,
      feesCents: r.fees_cents,
      currency: r.currency,
      items: (
        this.db
          .prepare('SELECT * FROM venture_order_items WHERE storefront = ? AND receipt_id = ? ORDER BY position')
          .all(storefront, r.receipt_id) as any[]
      ).map((i) => ({ listingId: i.listing_id, title: i.title, quantity: i.quantity, priceCents: i.price_cents })),
    }))
  }

  // ---------- reviews ----------

  /** True when the review was not stored before. */
  upsertReview(storefront: string, r: ReviewRow): boolean {
    const had = this.db.prepare('SELECT 1 FROM venture_reviews WHERE storefront = ? AND id = ?').get(storefront, r.id)
    this.db
      .prepare(
        `INSERT INTO venture_reviews (storefront, id, listing_id, rating, text, at, buyer_username) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(storefront, id) DO UPDATE SET listing_id=excluded.listing_id, rating=excluded.rating, text=excluded.text, at=excluded.at, buyer_username=excluded.buyer_username`,
      )
      .run(storefront, r.id, r.listingId, r.rating, r.text, r.at, r.buyerUsername)
    return !had
  }

  reviewsLatest(storefront: string, limit: number): ReviewRow[] {
    return (
      this.db
        .prepare('SELECT * FROM venture_reviews WHERE storefront = ? ORDER BY at DESC LIMIT ?')
        .all(storefront, limit) as any[]
    ).map((r) => ({
      id: r.id,
      listingId: r.listing_id,
      rating: r.rating,
      text: r.text,
      at: r.at,
      buyerUsername: r.buyer_username,
      low: r.rating <= 3,
    }))
  }

  // ---------- ledger (fees) ----------

  addLedger(storefront: string, e: { id: string; receiptId: string | null; at: string; cents: number; kind: string }): void {
    this.db
      .prepare(
        `INSERT INTO venture_ledger (storefront, id, receipt_id, at, cents, kind) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(storefront, id) DO UPDATE SET receipt_id=excluded.receipt_id, at=excluded.at, cents=excluded.cents, kind=excluded.kind`,
      )
      .run(storefront, e.id, e.receiptId, e.at, e.cents, e.kind)
  }

  /** Fees Etsy took for one order, in cents (positive). */
  feesForReceipt(storefront: string, receiptId: string): number {
    const r = this.db
      .prepare("SELECT COALESCE(SUM(-cents), 0) AS n FROM venture_ledger WHERE storefront = ? AND receipt_id = ? AND kind = 'fee'")
      .get(storefront, receiptId) as { n: number }
    return r.n
  }

  /** Fees not tied to an order (listing fees and the like) inside a UTC range, in cents (positive). */
  unattributedFees(storefront: string, fromUtc: string, toUtc: string): number {
    const r = this.db
      .prepare(
        "SELECT COALESCE(SUM(-cents), 0) AS n FROM venture_ledger WHERE storefront = ? AND receipt_id IS NULL AND kind = 'fee' AND at >= ? AND at < ?",
      )
      .get(storefront, fromUtc, toUtc) as { n: number }
    return r.n
  }

  // ---------- notifications ----------

  /** False when the same key was already stored, so nothing is announced twice. */
  addNotification(n: Omit<VentureNotification, 'id' | 'read'>, dedupeKey: string): boolean {
    const r = this.db
      .prepare(
        `INSERT OR IGNORE INTO venture_notifications (storefront, dedupe_key, kind, title, detail, at, url) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(n.storefront, dedupeKey, n.kind, n.title, n.detail, n.at, n.url)
    return r.changes > 0
  }

  notifications(storefront: string): VentureNotification[] {
    return (
      this.db
        .prepare('SELECT * FROM venture_notifications WHERE storefront = ? ORDER BY at DESC, id DESC LIMIT 200')
        .all(storefront) as any[]
    ).map((r) => ({
      id: r.id,
      storefront: r.storefront,
      kind: r.kind,
      title: r.title,
      detail: r.detail,
      at: r.at,
      read: !!r.read,
      url: r.url,
    }))
  }

  markRead(ids: number[]): void {
    const st = this.db.prepare('UPDATE venture_notifications SET read = 1 WHERE id = ?')
    this.db.transaction(() => ids.forEach((i) => st.run(i)))()
  }

  unreadCount(storefront: string): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS n FROM venture_notifications WHERE storefront = ? AND read = 0').get(storefront) as {
        n: number
      }
    ).n
  }

  /** False when this email was already stored. */
  addMessage(storefront: string, m: { dedupeKey: string; sender: string; subject: string; snippet: string; at: string; url: string }): boolean {
    const r = this.db
      .prepare('INSERT OR IGNORE INTO venture_messages (storefront, dedupe_key, sender, subject, snippet, at, url) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(storefront, m.dedupeKey, m.sender, m.subject, m.snippet, m.at, m.url)
    return r.changes > 0
  }

  /** Removes everything cached for one storefront (used when sample data gives way to the real shop). */
  clearStorefront(storefront: string): void {
    this.db.transaction(() => {
      for (const t of [
        'venture_listings',
        'venture_listing_images',
        'venture_price_history',
        'venture_orders',
        'venture_order_items',
        'venture_reviews',
        'venture_ledger',
        'venture_messages',
        'venture_notifications',
      ])
        this.db.prepare(`DELETE FROM ${t} WHERE storefront = ?`).run(storefront)
      this.db.prepare("DELETE FROM venture_state WHERE storefront = ? AND key != 'demo_cleared'").run(storefront)
    })()
  }

  // ---------- state ----------

  setState(storefront: string, key: string, value: string | null): void {
    this.db
      .prepare(
        'INSERT INTO venture_state (storefront, key, value) VALUES (?, ?, ?) ON CONFLICT(storefront, key) DO UPDATE SET value = excluded.value',
      )
      .run(storefront, key, value)
  }

  getState(storefront: string, key: string): string | null {
    const r = this.db.prepare('SELECT value FROM venture_state WHERE storefront = ? AND key = ?').get(storefront, key) as
      | { value: string | null }
      | undefined
    return r?.value ?? null
  }
}
