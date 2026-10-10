import { randomBytes } from 'crypto'
import type { Db } from '../../db'
import type { SecretStore } from '../../services/secrets'
import { mask } from '../../services/secrets'
import type { StudioConfigService } from '../configService'
import { BlueskyClient } from './bluesky'
import { ThreadsClient } from './threads'

export const THREADS_APP_ID = 'threads.appId'
export const THREADS_APP_SECRET = 'threads.appSecret'
export const THREADS_CALLBACK_PREFIX = 'expectless://oauth/threads'
const META_KEY = 'studio.socialAccounts'
const SCOPES = ['threads_basic', 'threads_content_publish', 'threads_read_replies', 'threads_manage_replies', 'threads_manage_insights']

interface BrandMeta {
  threadsUserId?: string
  threadsUsername?: string
  threadsExpiry?: string
  threadsWarnDay?: string
  blueskyHandle?: string
  tests?: Record<string, { ok: boolean; message: string; at: string }>
}

export interface BrandSocialView {
  brandId: number
  brandName: string
  threads: { connected: boolean; username: string; expiresAt: string | null; state: 'not_set' | 'connected' | 'expiring' | 'failed'; message: string }
  bluesky: { handle: string; hasPassword: boolean; passwordMasked: string; state: 'not_set' | 'connected' | 'failed' | 'untested'; message: string }
}

export interface AccountsDeps {
  db: Db
  secrets: SecretStore
  cfg: StudioConfigService
  brandName: (id: number) => string
  brandIds: () => number[]
  fetchImpl?: typeof fetch
  openBrowser?: (url: string) => Promise<void>
  now?: () => number
  signInTimeoutMs?: number
}

/**
 * Threads and Bluesky accounts, one set per brand (each brand has its own). Tokens and app passwords are in the Keychain
 * store under the brand's id. Threads signs in through the Meta OAuth page with the Threads app id and secret.
 */
export class SocialAccounts {
  private threadsClients = new Map<number, ThreadsClient>()
  private blueskyClients = new Map<number, BlueskyClient>()
  private pending: { state: string; brandId: number; deliver: (code: string, state: string | null) => void; cancel: () => void } | null = null

  constructor(private d: AccountsDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }
  private f(): typeof fetch {
    return this.d.fetchImpl ?? fetch
  }

  // ---------- storage ----------

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
  private tokenKey = (id: number) => `threads.token.${id}`
  private pwKey = (id: number) => `bluesky.appPassword.${id}`

  threadsToken(brandId: number): string | null {
    return this.d.secrets.get(this.tokenKey(brandId))
  }
  hasThreads(brandId: number): boolean {
    return this.d.secrets.has(this.tokenKey(brandId))
  }
  threadsUserId(brandId: number): string | null {
    return this.meta(brandId).threadsUserId ?? null
  }
  setThreadsUserId(brandId: number, id: string) {
    this.setMeta(brandId, { threadsUserId: id })
  }
  threadsExpiry(brandId: number): string | null {
    return this.meta(brandId).threadsExpiry ?? null
  }
  setThreadsExpiry(brandId: number, iso: string) {
    this.setMeta(brandId, { threadsExpiry: iso })
  }
  warnedToday(brandId: number, day: string): boolean {
    return this.meta(brandId).threadsWarnDay === day
  }
  markWarned(brandId: number, day: string) {
    this.setMeta(brandId, { threadsWarnDay: day })
  }

  /** Saves a Threads token by hand (a fallback when the sign in page cannot be used). */
  setThreadsToken(brandId: number, token: string, expiresInSeconds = 60 * 86400) {
    this.d.secrets.set(this.tokenKey(brandId), token.trim())
    this.setMeta(brandId, { threadsExpiry: new Date(this.now() + expiresInSeconds * 1000).toISOString(), tests: { ...(this.meta(brandId).tests ?? {}), threads: undefined as never } })
  }
  disconnectThreads(brandId: number) {
    this.d.secrets.delete(this.tokenKey(brandId))
    this.setMeta(brandId, { threadsUserId: undefined, threadsUsername: undefined, threadsExpiry: undefined })
    this.threadsClients.delete(brandId)
  }

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

  // ---------- clients, one per brand ----------

  threadsFor(brandId: number): ThreadsClient {
    let c = this.threadsClients.get(brandId)
    if (!c) {
      c = new ThreadsClient(() => this.threadsToken(brandId), this.d.fetchImpl)
      this.threadsClients.set(brandId, c)
    }
    return c
  }
  blueskyFor(brandId: number): BlueskyClient {
    let c = this.blueskyClients.get(brandId)
    if (!c) {
      c = new BlueskyClient({ handle: () => this.blueskyHandle(brandId), password: () => this.d.secrets.get(this.pwKey(brandId)) }, this.d.fetchImpl, undefined, undefined, this.d.now)
      this.blueskyClients.set(brandId, c)
    }
    return c
  }

  /** Why a brand cannot post to a platform yet, or null when it can. */
  notReady(brandId: number, platform: 'threads' | 'bluesky'): string | null {
    const name = this.d.brandName(brandId)
    if (platform === 'threads') return this.hasThreads(brandId) ? null : `${name} has no Threads account connected. Connect it in Studio, Settings, Threads and Bluesky accounts.`
    return this.blueskyHandle(brandId) && this.d.secrets.has(this.pwKey(brandId)) ? null : `${name} has no Bluesky handle and app password saved. Add them in Studio, Settings, Threads and Bluesky accounts.`
  }

  // ---------- Threads sign in (OAuth) ----------

  private creds() {
    const id = this.d.secrets.get(THREADS_APP_ID)
    const secret = this.d.secrets.get(THREADS_APP_SECRET)
    if (!id || !secret) throw new Error('Save the Threads app ID and app secret first (Studio, Settings, Keys and connections).')
    return { id, secret, redirect: this.d.cfg.get().threadsRedirectUri }
  }

  /** Opens the Threads sign in page for one brand's account. Finishes when the return link arrives or the owner pastes the code. */
  async connectThreads(brandId: number): Promise<{ username: string }> {
    const { id, secret, redirect } = this.creds()
    if (this.pending) throw new Error('A Threads sign in is already open. Finish it in your browser or cancel it first.')
    if (!this.d.openBrowser) throw new Error('This build cannot open the browser.')
    const state = randomBytes(16).toString('hex')
    const url = new URL('https://threads.net/oauth/authorize')
    url.searchParams.set('client_id', id)
    url.searchParams.set('redirect_uri', redirect)
    url.searchParams.set('scope', SCOPES.join(','))
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', state)
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => done(() => reject(new Error('The Threads sign in timed out after 5 minutes. Try again.'))), this.d.signInTimeoutMs ?? 300_000)
      const done = (fn: () => void) => {
        clearTimeout(timer)
        this.pending = null
        fn()
      }
      this.pending = {
        state,
        brandId,
        deliver: (c, s) => (s !== null && s !== state ? done(() => reject(new Error('This Threads sign in did not start here. Try again.'))) : done(() => resolve(c))),
        cancel: () => done(() => reject(new Error('Threads sign in canceled.'))),
      }
      this.d.openBrowser!(url.toString()).catch((e) => done(() => reject(e)))
    })
    // 1. code for a short lived token, 2. short lived for a 60 day token
    const form = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'authorization_code', redirect_uri: redirect, code })
    const r1 = await this.f()('https://graph.threads.net/oauth/access_token', { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) })
    if (!r1.ok) throw new Error(`Threads did not accept the sign in (HTTP ${r1.status}). ${(await r1.text()).slice(0, 200)}`)
    const short = (await r1.json()) as { access_token: string; user_id?: string | number }
    const q = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: secret, access_token: short.access_token })
    const r2 = await this.f()(`https://graph.threads.net/access_token?${q}`, { signal: AbortSignal.timeout(30_000) })
    if (!r2.ok) throw new Error(`Threads would not make a 60 day token (HTTP ${r2.status}). ${(await r2.text()).slice(0, 200)}`)
    const long = (await r2.json()) as { access_token: string; expires_in: number }
    this.d.secrets.set(this.tokenKey(brandId), long.access_token)
    this.threadsClients.delete(brandId)
    this.setMeta(brandId, { threadsUserId: short.user_id !== undefined ? String(short.user_id) : undefined, threadsExpiry: new Date(this.now() + long.expires_in * 1000).toISOString() })
    const me = await this.threadsFor(brandId).me()
    this.setMeta(brandId, { threadsUserId: me.id, threadsUsername: me.username })
    return { username: me.username }
  }

  /** The expectless://oauth/threads link from the website bounce page. */
  handleOpenUrl(raw: string): boolean {
    if (!raw.startsWith(THREADS_CALLBACK_PREFIX)) return false
    const u = new URL(raw)
    if (!this.pending) return true
    if (u.searchParams.get('error')) this.pending.cancel()
    else if (u.searchParams.get('code')) this.pending.deliver(u.searchParams.get('code') as string, u.searchParams.get('state'))
    return true
  }

  /** The fallback: paste the code, or the whole address from the browser after you approve. */
  submitCode(raw: string): void {
    if (!this.pending) throw new Error('No Threads sign in is waiting. Press Connect Threads first, then paste the code.')
    let c = raw.trim()
    if (/^https?:\/\/|^expectless:\/\//i.test(c)) {
      const q = new URL(c).searchParams.get('code')
      if (q) c = q
    }
    c = decodeURIComponent(c).replace(/#_$/, '')
    if (!c) throw new Error('Paste the code, or the whole address, from the browser.')
    this.pending.deliver(c, null)
  }

  cancelConnect(): void {
    this.pending?.cancel()
  }

  // ---------- tests and status ----------

  private remember(brandId: number, which: 'threads' | 'bluesky', ok: boolean, message: string) {
    this.setMeta(brandId, { tests: { ...(this.meta(brandId).tests ?? {}), [which]: { ok, message, at: new Date(this.now()).toISOString() } } })
  }

  async testThreads(brandId: number): Promise<{ ok: boolean; message: string }> {
    try {
      const me = await this.threadsFor(brandId).me()
      this.setMeta(brandId, { threadsUserId: me.id, threadsUsername: me.username })
      this.remember(brandId, 'threads', true, `Connected as ${me.username}.`)
      return { ok: true, message: `Connected as ${me.username}.` }
    } catch (e) {
      this.remember(brandId, 'threads', false, (e as Error).message)
      return { ok: false, message: (e as Error).message }
    }
  }

  async testBluesky(brandId: number): Promise<{ ok: boolean; message: string }> {
    try {
      const msg = await this.blueskyFor(brandId).test()
      this.remember(brandId, 'bluesky', true, msg)
      return { ok: true, message: msg }
    } catch (e) {
      this.blueskyClients.delete(brandId)
      this.remember(brandId, 'bluesky', false, (e as Error).message)
      return { ok: false, message: (e as Error).message }
    }
  }

  /** Refreshes one brand's 60 day Threads token and remembers the new expiry. */
  async refreshThreads(brandId: number): Promise<{ ok: boolean; message: string }> {
    try {
      const r = await this.threadsFor(brandId).refresh()
      this.d.secrets.set(this.tokenKey(brandId), r.token)
      this.setMeta(brandId, { threadsExpiry: new Date(this.now() + r.expiresInSeconds * 1000).toISOString() })
      return { ok: true, message: `Threads token refreshed. It now lasts ${Math.round(r.expiresInSeconds / 86400)} days.` }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }

  status(): BrandSocialView[] {
    return this.d.brandIds().map((brandId) => {
      const m = this.meta(brandId)
      const tt = m.tests?.threads
      const bt = m.tests?.bluesky
      const has = this.hasThreads(brandId)
      const days = m.threadsExpiry ? (Date.parse(m.threadsExpiry) - this.now()) / 86_400_000 : null
      const pw = this.d.secrets.get(this.pwKey(brandId))
      return {
        brandId,
        brandName: this.d.brandName(brandId),
        threads: {
          connected: has,
          username: m.threadsUsername ?? '',
          expiresAt: m.threadsExpiry ?? null,
          state: !has ? 'not_set' : days !== null && days <= 7 ? 'expiring' : tt && !tt.ok ? 'failed' : 'connected',
          message: tt?.message ?? '',
        },
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
