import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { SecretStore } from '../../services/secrets'
import type { ConnectionStatus } from '@shared/ventures'

export const ETSY_SCOPES = 'listings_r listings_w transactions_r shops_r profile_r'
export const ETSY_TOKENS_KEY = 'ventures.etsy.tokens'
export const ETSY_KEYSTRING_KEY = 'ventures.etsy.keystring'
export const ETSY_SECRET_KEY = 'ventures.etsy.sharedSecret'
/** Etsy only accepts a redirect address that is registered on the app, so this one is fixed. */
export const DEFAULT_REDIRECT = 'http://127.0.0.1:38487/callback'

const AUTHORIZE = 'https://www.etsy.com/oauth/connect'
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token'
const REFRESH_MARGIN_MS = 5 * 60_000

interface Stored {
  access: string
  refresh: string
  expiresAt: number
  userId: string
  shopId: string
  shopName: string
  reauth?: boolean
}

export interface EtsyAuthDeps {
  secrets: SecretStore
  now: () => number
  openUrl: (url: string) => void
  /** Keystring and shared secret, from the environment or saved settings. Never logged. */
  credentials: () => { keystring: string; sharedSecret: string } | null
  redirectUri?: string
  fetch?: typeof fetch
  /** Called once when Etsy stops accepting the saved login. */
  onReauth?: () => void
}

/** Where the keys come from: environment first, then what the owner saved in ELO. */
export function etsyCredentials(secrets: SecretStore) {
  return () => {
    const keystring = process.env['ETSY_API_KEYSTRING'] || secrets.get(ETSY_KEYSTRING_KEY) || ''
    const sharedSecret = process.env['ETSY_SHARED_SECRET'] || secrets.get(ETSY_SECRET_KEY) || ''
    return keystring && sharedSecret ? { keystring, sharedSecret } : null
  }
}

const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${text}</p></body>`

/** Etsy OAuth 2.0 with PKCE, plus saving and refreshing the login. Tokens live encrypted in the secret store. */
export class EtsyAuth {
  private refreshing: Promise<string> | null = null
  private server: Server | null = null
  constructor(private d: EtsyAuthDeps) {}

  private f = (...a: Parameters<typeof fetch>) => (this.d.fetch ?? fetch)(...a)
  private get redirect() {
    return this.d.redirectUri ?? DEFAULT_REDIRECT
  }

  private load(): Stored | null {
    const raw = this.d.secrets.get(ETSY_TOKENS_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as Stored
    } catch {
      return null
    }
  }
  private save(s: Stored) {
    this.d.secrets.set(ETSY_TOKENS_KEY, JSON.stringify(s))
  }

  /** Step one: the address to open, plus a `finish` that takes what Etsy sends back. */
  begin(): { url: string; state: string; verifier: string; finish: (q: URLSearchParams) => Promise<{ shopId: string; shopName: string }> } {
    const creds = this.d.credentials()
    if (!creds) throw new Error('Etsy keys are not set up yet.')
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(16).toString('hex')
    const u = new URL(AUTHORIZE)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('client_id', creds.keystring)
    u.searchParams.set('redirect_uri', this.redirect)
    u.searchParams.set('scope', ETSY_SCOPES)
    u.searchParams.set('state', state)
    u.searchParams.set('code_challenge', challenge)
    u.searchParams.set('code_challenge_method', 'S256')
    return {
      url: u.toString(),
      state,
      verifier,
      finish: async (q) => {
        if (q.get('state') !== state)
          throw new Error('This sign-in did not start here. Click Connect Etsy again.')
        if (q.get('error')) throw new Error('Etsy sign-in was canceled.')
        const code = q.get('code')
        if (!code) throw new Error('Etsy did not send a sign-in code. Click Connect Etsy again.')
        const t = await this.tokenCall({ grant_type: 'authorization_code', client_id: creds.keystring, redirect_uri: this.redirect, code, code_verifier: verifier })
        const userId = t.access_token.split('.')[0]
        const shop = await this.f(`https://api.etsy.com/v3/application/users/${userId}/shops`, {
          headers: { 'x-api-key': `${creds.keystring}:${creds.sharedSecret}`, Authorization: `Bearer ${t.access_token}` },
        })
        if (!shop.ok) throw new Error('Signed in, but ELO could not find your Etsy shop.')
        const sj = (await shop.json()) as { shop_id: number; shop_name: string }
        this.save({
          access: t.access_token,
          refresh: t.refresh_token,
          expiresAt: this.d.now() + t.expires_in * 1000,
          userId,
          shopId: String(sj.shop_id),
          shopName: sj.shop_name,
        })
        return { shopId: String(sj.shop_id), shopName: sj.shop_name }
      },
    }
  }

  private async tokenCall(body: Record<string, string>) {
    const res = await this.f(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    })
    // The response text is never put in an error: it can echo secrets.
    if (!res.ok) throw new Error(`Etsy refused the sign-in (${res.status}).`)
    return (await res.json()) as { access_token: string; refresh_token: string; expires_in: number }
  }

  /** Opens the browser and waits for Etsy to send the owner back to the loopback address. */
  async connect(): Promise<{ shopId: string; shopName: string }> {
    this.server?.close()
    const b = this.begin()
    const port = Number(new URL(this.redirect).port)
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', this.redirect)
        if (url.pathname !== new URL(this.redirect).pathname) return void res.writeHead(404).end()
        b.finish(url.searchParams).then(
          (r) => {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Etsy is connected.', 'You can close this tab and go back to ELO.'))
            done(() => resolve(r))
          },
          (e: Error) => {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Something is off.', e.message))
            done(() => reject(e))
          },
        )
      })
      this.server = server
      const timer = setTimeout(() => done(() => reject(new Error('The Etsy sign-in timed out after 5 minutes. Click Connect Etsy to try again.'))), 300_000)
      const done = (fn: () => void) => {
        clearTimeout(timer)
        server.closeAllConnections?.()
        server.close()
        this.server = null
        fn()
      }
      server.on('error', (e) => done(() => reject(e)))
      server.listen(port, '127.0.0.1', () => this.d.openUrl(b.url))
    })
  }

  /** A token that works right now. Refreshes once when it is within five minutes of running out. */
  async accessToken(): Promise<string> {
    const s = this.load()
    if (!s) throw new Error('Etsy is not connected.')
    if (s.reauth) throw new Error('Etsy needs you to sign in again.')
    if (s.expiresAt - this.d.now() > REFRESH_MARGIN_MS) return s.access
    this.refreshing ??= this.refresh(s).finally(() => (this.refreshing = null))
    return this.refreshing
  }

  private async refresh(s: Stored): Promise<string> {
    const creds = this.d.credentials()
    try {
      if (!creds) throw new Error('keys')
      const t = await this.tokenCall({ grant_type: 'refresh_token', client_id: creds.keystring, refresh_token: s.refresh })
      this.save({ ...s, access: t.access_token, refresh: t.refresh_token, expiresAt: this.d.now() + t.expires_in * 1000 })
      return t.access_token
    } catch {
      this.save({ ...s, reauth: true })
      this.d.onReauth?.()
      throw new Error('Etsy needs you to sign in again.')
    }
  }

  shopId(): string | null {
    return this.load()?.shopId ?? null
  }

  status(): ConnectionStatus {
    const s = this.load()
    if (!s) return { mode: 'not_connected', shopName: null, lastSyncAt: null, expiresAt: null }
    return {
      mode: s.reauth ? 'needs_reauth' : 'connected',
      shopName: s.shopName,
      lastSyncAt: null,
      expiresAt: new Date(s.expiresAt).toISOString(),
    }
  }

  disconnect(): void {
    this.d.secrets.delete(ETSY_TOKENS_KEY)
  }
}
