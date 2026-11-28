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
  /** Runs right after Etsy connects, for example to send the drafts that were waiting. */
  afterConnect?: () => Promise<unknown>
  /** The mailbox that receives Etsy's "new message" emails. The password is never read back. */
  mail?: {
    save(c: { host: string; user: string; password: string; folder: string }): void
    status(): { configured: boolean; host: string; user: string; folder: string }
    test(): Promise<{ ok: boolean; found?: number; error?: string }>
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
    const first = this.d.store.getState('etsy', 'demo_cleared') !== '1'
    const r = await this.d.etsy.connect()
    // Sample data gives way to the real shop only the first time. A reconnect keeps everything that is real.
    if (first) {
      this.d.store.clearSampleData('etsy')
      this.d.store.setState('etsy', 'demo_cleared', '1')
    }
    await this.d.afterConnect?.().catch((e) => this.d.log?.('warn', `Sending waiting drafts failed: ${e instanceof Error ? e.message : 'unknown error'}`))
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

  saveMailbox(c: { host: string; user: string; password: string; folder: string }): void {
    const host = c.host.trim()
    const user = c.user.trim()
    const password = c.password.trim()
    if (!host || !user || !password) throw new Error('Enter the mail host, user and password.')
    if (!this.d.mail) throw new Error('Mailbox settings are not available.')
    this.d.mail.save({ host, user, password, folder: c.folder.trim() || 'INBOX' })
  }

  mailboxStatus(): { configured: boolean; host: string; user: string; folder: string } {
    return this.d.mail?.status() ?? { configured: false, host: '', user: '', folder: '' }
  }

  async testMailbox(): Promise<{ ok: boolean; found?: number; error?: string }> {
    return this.d.mail ? this.d.mail.test() : { ok: false, error: 'Mailbox settings are not available.' }
  }

  draftDefaults(): { taxonomyId: number | null; shippingProfileId: number | null } {
    const n = (k: string) => Number(this.d.store.getState('etsy', k)) || null
    return { taxonomyId: n('default_taxonomy_id'), shippingProfileId: n('default_shipping_profile_id') }
  }

  saveDraftDefaults(v: { taxonomyId: number | null; shippingProfileId: number | null }): void {
    for (const [key, value] of [['default_taxonomy_id', v.taxonomyId], ['default_shipping_profile_id', v.shippingProfileId]] as const) {
      if (value !== null && (!Number.isInteger(value) || value < 1)) throw new Error('Enter a whole number, or leave it empty.')
      this.d.store.setState('etsy', key, value === null ? null : String(value))
    }
  }

  /** Drafts waiting for the shop (or for a fix), with the reason one is stuck. */
  pendingDrafts(): Array<{ id: string; kind: 'create' | 'update'; title: string; error: string | null }> {
    return this.d.store.listPending('etsy').map((p) => ({
      id: p.targetId,
      kind: p.kind,
      title: String(p.payload?.title ?? '(no title change)'),
      error: p.lastError,
    }))
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
