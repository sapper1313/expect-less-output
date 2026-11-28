import type {
  DashboardSummary,
  ListingDetail,
  ListingQuery,
  ListingRow,
  OrderRow,
  RangePreset,
  ReviewRow,
  StorefrontInfo,
  VentureNotification,
  VentureProvider,
  VentureRange,
} from '@shared/ventures'
import type { VentureRegistry } from './registry'
import type { VentureStore } from './store'
import { resolveRange } from './metrics'

export interface VenturesDeps {
  registry: VentureRegistry
  store: VentureStore
  now: () => number
  /** One syncer per storefront that has a real shop behind it. Mock storefronts have none. */
  syncers: Record<string, { run(): Promise<unknown> }>
  /** The Etsy login. Absent in tests that do not need it. */
  etsy?: {
    connect(): Promise<{ shopId: string; shopName: string }>
    disconnect(): void
    saveKeys(keystring: string, sharedSecret: string): void
    hasKeys(): boolean
  }
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
}

/** The one place the screens, the phone page and the agent API read ELS Ventures from. */
export class VenturesService {
  constructor(private d: VenturesDeps) {}

  private p(id: string): VentureProvider {
    const p = this.d.registry.get(id)
    if (!p) throw new Error('Unknown storefront.')
    return p
  }

  storefronts(): StorefrontInfo[] {
    return this.d.registry.list().map(({ id, label }) => {
      const p = this.p(id)
      return { id, label, unread: p.unread(), mode: p.status().mode }
    })
  }

  status(id: string) {
    return this.p(id).status()
  }

  dashboard(id: string, preset: RangePreset, custom?: VentureRange): DashboardSummary {
    return this.p(id).dashboard(resolveRange(preset, this.d.now(), custom))
  }

  listings(id: string, q: ListingQuery): ListingRow[] {
    return this.p(id).listings(q)
  }

  listing(id: string, listingId: string): ListingDetail | null {
    return this.p(id).listing(listingId)
  }

  orders(id: string, preset: RangePreset, custom?: VentureRange): OrderRow[] {
    return this.p(id).orders(resolveRange(preset, this.d.now(), custom))
  }

  reviews(id: string, limit: number): ReviewRow[] {
    return this.p(id).reviews(Math.max(1, Math.min(200, limit)))
  }

  notifications(id: string): VentureNotification[] {
    return this.p(id).notifications()
  }

  /** Only marks notifications that belong to this storefront. */
  markRead(id: string, ids: number[]): void {
    const own = new Set(this.p(id).notifications().map((n) => n.id))
    this.d.store.markRead(ids.filter((i) => own.has(i)))
  }

  unreadTotal(): number {
    return this.storefronts().reduce((n, s) => n + s.unread, 0)
  }

  async syncNow(id: string): Promise<void> {
    this.p(id)
    await this.d.syncers[id]?.run()
  }

  /** Runs the Etsy sign-in. Sample data gives way to the real shop, and the first sync starts in the background. */
  async connectEtsy(): Promise<{ shopName: string }> {
    if (!this.d.etsy) throw new Error('Etsy keys are not set up yet.')
    const r = await this.d.etsy.connect()
    this.d.store.clearStorefront('etsy')
    this.d.store.setState('etsy', 'demo_cleared', '1')
    this.d.log?.('info', `Etsy connected: ${r.shopName}.`)
    void this.syncNow('etsy').catch((e) => this.d.log?.('warn', `First Etsy sync failed: ${e instanceof Error ? e.message : 'unknown error'}`))
    return { shopName: r.shopName }
  }

  disconnectEtsy(): void {
    this.d.etsy?.disconnect()
    this.d.log?.('info', 'Etsy disconnected.')
  }

  saveEtsyKeys(keystring: string, sharedSecret: string): void {
    const k = keystring.trim()
    const s = sharedSecret.trim()
    if (!k || !s) throw new Error('Enter both the keystring and the shared secret.')
    if (!this.d.etsy) throw new Error('Etsy is not available.')
    this.d.etsy.saveKeys(k, s)
  }

  etsyKeysSet(): boolean {
    return !!this.d.etsy?.hasKeys()
  }

  /** Every storefront with a real shop connected. One failing never stops the others. */
  async syncAll(): Promise<void> {
    for (const s of this.storefronts()) {
      if (s.mode !== 'connected') continue
      try {
        await this.syncNow(s.id)
      } catch (e) {
        this.d.log?.('warn', `${s.label} sync failed: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    }
  }
}
