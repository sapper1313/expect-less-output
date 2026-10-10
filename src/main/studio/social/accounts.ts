import type { Db } from '../../db'
import type { SecretStore } from '../../services/secrets'
import { mask } from '../../services/secrets'
import { BlueskyClient } from './bluesky'

const META_KEY = 'studio.socialAccounts'

interface BrandMeta {
  blueskyHandle?: string
  tests?: Record<string, { ok: boolean; message: string; at: string }>
}

export interface BrandSocialView {
  brandId: number
  brandName: string
  bluesky: { handle: string; hasPassword: boolean; passwordMasked: string; state: 'not_set' | 'connected' | 'failed' | 'untested'; message: string }
}

export interface AccountsDeps {
  db: Db
  secrets: SecretStore
  brandName: (id: number) => string
  brandIds: () => number[]
  fetchImpl?: typeof fetch
  now?: () => number
}

/** Bluesky accounts, one per brand (each brand has its own). The app password is in the Keychain store under the brand's id. */
export class SocialAccounts {
  private blueskyClients = new Map<number, BlueskyClient>()

  constructor(private d: AccountsDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  private all(): Record<string, BrandMeta> {
    const r = this.d.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(META_KEY) as { value_json: string } | undefined
    try {
      return r ? (JSON.parse(r.value_json) as Record<string, BrandMeta>) : {}
    } catch {
      return {}
    }
  }
  meta(brandId: number): BrandMeta {
    return this.all()[String(brandId)] ?? {}
  }
  private setMeta(brandId: number, patch: Partial<BrandMeta>) {
    const all = this.all()
    all[String(brandId)] = { ...(all[String(brandId)] ?? {}), ...patch }
    this.d.db
      .prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
      .run(META_KEY, JSON.stringify(all))
  }
  private pwKey = (id: number) => `bluesky.appPassword.${id}`

  blueskyHandle(brandId: number): string | null {
    return this.meta(brandId).blueskyHandle ?? null
  }
  saveBluesky(brandId: number, handle: string, password: string) {
    if (!handle.trim()) throw new Error('Type the Bluesky handle, for example name.bsky.social.')
    this.setMeta(brandId, { blueskyHandle: handle.trim().replace(/^@/, '') })
    if (password.trim()) this.d.secrets.set(this.pwKey(brandId), password.trim())
    this.blueskyClients.delete(brandId)
  }
  removeBluesky(brandId: number) {
    this.d.secrets.delete(this.pwKey(brandId))
    this.setMeta(brandId, { blueskyHandle: undefined })
    this.blueskyClients.delete(brandId)
  }

  blueskyFor(brandId: number): BlueskyClient {
    let c = this.blueskyClients.get(brandId)
    if (!c) {
      c = new BlueskyClient({ handle: () => this.blueskyHandle(brandId), password: () => this.d.secrets.get(this.pwKey(brandId)) }, this.d.fetchImpl, undefined, undefined, this.d.now)
      this.blueskyClients.set(brandId, c)
    }
    return c
  }

  /** Why a brand cannot post to Bluesky yet, or null when it can. */
  notReady(brandId: number): string | null {
    return this.blueskyHandle(brandId) && this.d.secrets.has(this.pwKey(brandId)) ? null : `${this.d.brandName(brandId)} has no Bluesky handle and app password saved. Add them in Studio, Settings, Bluesky accounts.`
  }

  async testBluesky(brandId: number): Promise<{ ok: boolean; message: string }> {
    try {
      const msg = await this.blueskyFor(brandId).test()
      this.setMeta(brandId, { tests: { bluesky: { ok: true, message: msg, at: new Date(this.now()).toISOString() } } })
      return { ok: true, message: msg }
    } catch (e) {
      this.blueskyClients.delete(brandId)
      this.setMeta(brandId, { tests: { bluesky: { ok: false, message: (e as Error).message, at: new Date(this.now()).toISOString() } } })
      return { ok: false, message: (e as Error).message }
    }
  }

  status(): BrandSocialView[] {
    return this.d.brandIds().map((brandId) => {
      const m = this.meta(brandId)
      const bt = m.tests?.bluesky
      const pw = this.d.secrets.get(this.pwKey(brandId))
      return {
        brandId,
        brandName: this.d.brandName(brandId),
        bluesky: {
          handle: m.blueskyHandle ?? '',
          hasPassword: !!pw,
          passwordMasked: pw ? mask(pw) : '',
          state: !pw || !m.blueskyHandle ? 'not_set' : !bt ? 'untested' : bt.ok ? 'connected' : 'failed',
          message: bt?.message ?? '',
        },
      }
    })
  }
}
