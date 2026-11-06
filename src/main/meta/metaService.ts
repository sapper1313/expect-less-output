import { createServer, type Server } from 'http'
import { randomBytes } from 'crypto'
import type { Db } from '../db'
import type { ActivityLog } from '../services/activity'
import { mask, type SecretStore } from '../services/secrets'
import { AdapterError } from '../adapters/types'
import { bestMatch } from '@shared/similarity'
import { COPY } from '@shared/copy'
import type {
  Account,
  MetaCredentialsStatus,
  MetaPage,
  MetaStatus,
  MetaSuggestion,
} from '@shared/types'
import {
  EXPIRY_WARN_DAYS,
  META_CALLBACK_PATH,
  META_REQUIRED_SCOPES,
  META_SCOPES,
  META_SECRET_APP_ID,
  META_SECRET_APP_SECRET,
  META_SECRET_USER_TOKEN,
  pageTokenKey,
  type MetaUrls,
} from './config'
import { GraphClient, MetaApiError } from './graph'

export interface MetaServiceDeps {
  db: Db
  secrets: SecretStore
  urls: MetaUrls
  graph: GraphClient
  log: ActivityLog
  openBrowser: (url: string) => Promise<void>
  /** Shown as a macOS notification and a toast. */
  alert: (headline: string, detail: string) => void
  emit: () => void
  now?: () => number
  signInTimeoutMs?: number
}

const PAGE_STYLE =
  'body{background:#2D2B28;color:#F2E8D5;font-family:-apple-system,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center;max-width:520px;padding:24px}h1{letter-spacing:.04em}p{color:#A8A090}'
const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${PAGE_STYLE}</style></head><body><div><h1>${title}</h1><p>${body}</p></div></body></html>`
const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  )
const DAY = 86_400_000

/** Whole days between now and a moment. Negative when it is already past. */
export function daysUntil(iso: string | null, nowMs: number): number | null {
  if (!iso) return null
  return Math.floor((new Date(iso).getTime() - nowMs) / DAY)
}

export class MetaService {
  private server: Server | null = null
  private cancelActive: (() => void) | null = null
  private healthTimer: NodeJS.Timeout | null = null

  constructor(private d: MetaServiceDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  // ---------- credentials ----------

  credentialsStatus(): MetaCredentialsStatus {
    const id = this.d.secrets.get(META_SECRET_APP_ID)
    const secret = this.d.secrets.get(META_SECRET_APP_SECRET)
    return {
      hasAppId: !!id,
      hasAppSecret: !!secret,
      appIdMasked: id ? mask(id) : '',
      appSecretMasked: secret ? mask(secret) : '',
    }
  }

  saveCredentials(appId: string, appSecret: string): MetaCredentialsStatus {
    const id = appId.trim()
    const secret = appSecret.trim()
    if (id && !/^\d{6,20}$/.test(id))
      throw new Error(
        'A Meta App ID is only numbers, about 15 digits. Copy it from App settings, then Basic.',
      )
    if (id) this.d.secrets.set(META_SECRET_APP_ID, id)
    if (secret) this.d.secrets.set(META_SECRET_APP_SECRET, secret)
    this.d.log.log('info', 'Meta credentials saved (encrypted).')
    return this.credentialsStatus()
  }

  private creds(): { id: string; secret: string } {
    const id = this.d.secrets.get(META_SECRET_APP_ID)
    const secret = this.d.secrets.get(META_SECRET_APP_SECRET)
    if (!id || !secret)
      throw new Error('Save the Meta App ID and App Secret first (Setup Channels, Connections tab, Meta).')
    return { id, secret }
  }

  private get redirectUri(): string {
    return `http://localhost:${this.d.urls.port}${META_CALLBACK_PATH}`
  }

  // ---------- sign in ----------

  async connect(): Promise<MetaStatus> {
    const { id, secret } = this.creds()
    // A new click replaces a sign-in that was left open.
    if (this.server) this.cancelActive?.()
    const state = randomBytes(16).toString('hex')

    await new Promise<void>((resolve, reject) => {
      let finished = false
      const servers: Server[] = []
      const finish = (fn: () => void) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        this.cancelActive = null
        for (const s of servers) {
          s.closeAllConnections?.()
          s.close()
        }
        this.server = null
        fn()
      }
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new Error(
                'The Meta sign-in timed out after 5 minutes. Click Connect Meta to try again.',
              ),
            ),
          ),
        this.d.signInTimeoutMs ?? 300_000,
      )
      this.cancelActive = () => finish(() => reject(new Error('Meta sign-in canceled.')))

      const handler: Parameters<typeof createServer>[1] = async (req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${this.d.urls.port}`)
        if (url.pathname !== META_CALLBACK_PATH) {
          res.writeHead(404).end()
          return
        }
        const send = (code: number, html: string) =>
          res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }).end(html)
        try {
          if (url.searchParams.get('state') !== state) {
            send(
              400,
              page(
                'Something is off.',
                'This sign-in did not start here. Close this tab and click Connect Meta again.',
              ),
            )
            return
          }
          const denied = url.searchParams.get('error')
          if (denied) {
            send(
              200,
              page(
                'Not connected.',
                `Meta said: ${esc(url.searchParams.get('error_description') ?? denied)}. Close this tab and try again.`,
              ),
            )
            finish(() =>
              reject(
                new Error(
                  denied === 'access_denied'
                    ? 'You did not approve access in the browser.'
                    : `Meta sign-in failed (${denied}).`,
                ),
              ),
            )
            return
          }
          const code = url.searchParams.get('code')
          if (!code) {
            send(400, page('Something is off.', 'Meta did not send a code.'))
            return
          }
          await this.completeSignIn(id, secret, code)
          send(200, page('Connected.', 'You can close this tab and return to Expect Less Output.'))
          finish(() => resolve())
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          send(200, page('Not connected.', esc(msg)))
          finish(() => reject(new Error(msg)))
        }
      }

      const first = createServer(handler)
      this.server = first
      servers.push(first)
      first.on('error', (e: NodeJS.ErrnoException) =>
        finish(() =>
          reject(
            e.code === 'EADDRINUSE'
              ? new Error(
                  `Port ${this.d.urls.port} is busy. Quit other copies of Expect Less Output and try again.`,
                )
              : e,
          ),
        ),
      )
      first.listen(this.d.urls.port, '127.0.0.1', async () => {
        // Browsers may reach "localhost" over IPv6, so listen there too when the Mac allows it.
        const second = createServer(handler)
        second.on('error', () => {})
        second.listen(this.d.urls.port, '::1', () => {
          servers.push(second)
        })
        try {
          const auth = new URL(this.d.urls.dialog)
          auth.searchParams.set('client_id', id)
          auth.searchParams.set('redirect_uri', this.redirectUri)
          auth.searchParams.set('state', state)
          auth.searchParams.set('response_type', 'code')
          auth.searchParams.set('scope', META_SCOPES.join(','))
          await this.d.openBrowser(auth.toString())
        } catch (e) {
          finish(() => reject(e))
        }
      })
    })
    return this.status()
  }

  cancelConnect(): void {
    this.cancelActive?.()
  }

  private async completeSignIn(appId: string, appSecret: string, code: string): Promise<void> {
    const g = this.d.graph
    // 1. code -> short lived user token
    const short = await g.get<{ access_token: string }>('/oauth/access_token', {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: this.redirectUri,
      code,
    })
    // 2. short lived -> long lived (about 60 days)
    const long = await g.get<{ access_token: string }>('/oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: short.access_token,
    })
    const token = long.access_token
    const dbg = await g.get<{
      data: {
        expires_at?: number
        data_access_expires_at?: number
        scopes?: string[]
        is_valid?: boolean
      }
    }>('/debug_token', { input_token: token }, token)
    const me = await g.get<{ id: string; name: string }>('/me', { fields: 'id,name' }, token)
    const accounts = await g.getAll<any>(
      '/me/accounts',
      {
        fields:
          'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}',
        limit: 100,
      },
      token,
    )
    if (accounts.length === 0) {
      throw new Error(
        'Meta did not list any Pages. On the Facebook screen choose your brand Pages, then try again.',
      )
    }
    const granted = (dbg.data.scopes ?? []).length
      ? (dbg.data.scopes as string[])
      : (
          await g.get<{ data: Array<{ permission: string; status: string }> }>(
            '/me/permissions',
            {},
            token,
          )
        ).data
          .filter((p) => p.status === 'granted')
          .map((p) => p.permission)

    const expires = unixToIso(dbg.data.expires_at)
    const dataExpires = unixToIso(dbg.data.data_access_expires_at)
    const nowIso = new Date(this.now()).toISOString()
    this.d.secrets.set(META_SECRET_USER_TOKEN, token)
    this.d.db.transaction(() => {
      this.d.db
        .prepare(
          `INSERT INTO meta_connection (id, user_id, user_name, status, token_expires_at, data_access_expires_at, granted_scopes, connected_at, last_alert_day)
           VALUES (1, ?, ?, 'connected', ?, ?, ?, ?, NULL)
           ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, user_name = excluded.user_name, status = 'connected',
             token_expires_at = excluded.token_expires_at, data_access_expires_at = excluded.data_access_expires_at,
             granted_scopes = excluded.granted_scopes, connected_at = excluded.connected_at, last_alert_day = NULL`,
        )
        .run(me.id, me.name, expires, dataExpires, granted.join(','), nowIso)
      const seen = new Set<string>()
      const up = this.d.db.prepare(
        `INSERT INTO meta_pages (page_id, name, picture_url, ig_id, ig_username, ig_picture_url, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(page_id) DO UPDATE SET name = excluded.name, picture_url = excluded.picture_url, ig_id = excluded.ig_id,
           ig_username = excluded.ig_username, ig_picture_url = excluded.ig_picture_url, updated_at = excluded.updated_at`,
      )
      for (const a of accounts) {
        seen.add(a.id)
        up.run(
          a.id,
          a.name,
          a.picture?.data?.url ?? null,
          a.instagram_business_account?.id ?? null,
          a.instagram_business_account?.username ?? null,
          a.instagram_business_account?.profile_picture_url ?? null,
          nowIso,
        )
        if (a.access_token) this.d.secrets.set(pageTokenKey(a.id), a.access_token)
      }
      for (const r of this.d.db.prepare('SELECT page_id FROM meta_pages').all() as Array<{
        page_id: string
      }>) {
        if (!seen.has(r.page_id)) {
          this.d.db.prepare('DELETE FROM meta_pages WHERE page_id = ?').run(r.page_id)
          this.d.secrets.delete(pageTokenKey(r.page_id))
        }
      }
      // A fresh login fixes any account that was waiting for one.
      this.d.db
        .prepare(
          "UPDATE accounts SET status = 'connected' WHERE platform IN ('facebook','instagram') AND mode != 'dry_run'",
        )
        .run()
    })()
    this.d.log.log('info', `Meta connected as ${me.name}. ${accounts.length} Page(s) found.`)
    this.d.emit()
  }

  // ---------- assignment ----------

  assign(brandId: number, pageId: string | null, igId: string | null): MetaStatus {
    const brand = this.d.db.prepare('SELECT name FROM brands WHERE id = ?').get(brandId) as
      { name: string } | undefined
    if (!brand) throw new Error('Brand not found.')
    const pages = this.d.db.prepare('SELECT * FROM meta_pages').all() as any[]
    const page = pageId ? pages.find((p) => p.page_id === pageId) : null
    if (pageId && !page) throw new Error('That Facebook Page is not in the list. Reconnect Meta.')
    const igPage = igId ? pages.find((p) => p.ig_id === igId) : null
    if (igId && !igPage)
      throw new Error('That Instagram account is not in the list. Reconnect Meta.')

    const clash = (platform: string, ext: string) =>
      this.d.db
        .prepare(
          'SELECT b.name FROM accounts a JOIN brands b ON b.id = a.brand_id WHERE a.platform = ? AND a.external_id = ? AND a.brand_id != ?',
        )
        .get(platform, ext, brandId) as { name: string } | undefined
    if (page && clash('facebook', page.page_id))
      throw new Error(`"${page.name}" is already used by ${clash('facebook', page.page_id)!.name}.`)
    if (igPage && clash('instagram', igPage.ig_id))
      throw new Error(
        `@${igPage.ig_username} is already used by ${clash('instagram', igPage.ig_id)!.name}.`,
      )

    const setReal = this.d.db.prepare(
      `UPDATE accounts SET external_id = ?, display_name = ?, avatar_url = ?, token_ref = ?, status = 'connected', mode = 'live', last_checked_at = ?
       WHERE brand_id = ? AND platform = ?`,
    )
    const setDry = this.d.db.prepare(
      `UPDATE accounts SET external_id = NULL, display_name = 'Dry run account', avatar_url = NULL, token_ref = NULL, status = 'connected', mode = 'dry_run', last_checked_at = NULL
       WHERE brand_id = ? AND platform = ?`,
    )
    const nowIso = new Date(this.now()).toISOString()
    this.d.db.transaction(() => {
      if (page)
        setReal.run(
          page.page_id,
          page.name,
          page.picture_url,
          pageTokenKey(page.page_id),
          nowIso,
          brandId,
          'facebook',
        )
      else setDry.run(brandId, 'facebook')
      if (igPage)
        setReal.run(
          igPage.ig_id,
          `@${igPage.ig_username}`,
          igPage.ig_picture_url,
          pageTokenKey(igPage.page_id),
          nowIso,
          brandId,
          'instagram',
        )
      else setDry.run(brandId, 'instagram')
    })()
    this.d.log.log(
      'info',
      `${brand.name}: Facebook ${page ? page.name : 'dry run'}, Instagram ${igPage ? '@' + igPage.ig_username : 'dry run'}.`,
    )
    this.d.emit()
    return this.status()
  }

  async disconnect(): Promise<void> {
    const token = this.d.secrets.get(META_SECRET_USER_TOKEN)
    if (token) {
      try {
        await this.d.graph.delete('/me/permissions', {}, token) // withdraw Expect Less Output's access at Meta
      } catch {
        // A courtesy. Local tokens are deleted either way.
      }
    }
    for (const r of this.d.db.prepare('SELECT page_id FROM meta_pages').all() as Array<{
      page_id: string
    }>) {
      this.d.secrets.delete(pageTokenKey(r.page_id))
    }
    this.d.secrets.delete(META_SECRET_USER_TOKEN)
    this.d.db.transaction(() => {
      this.d.db.prepare('DELETE FROM meta_pages').run()
      this.d.db.prepare('DELETE FROM meta_connection').run()
      this.d.db
        .prepare(
          `UPDATE accounts SET external_id = NULL, display_name = 'Dry run account', avatar_url = NULL, token_ref = NULL, status = 'connected', mode = 'dry_run', last_checked_at = NULL
           WHERE platform IN ('facebook','instagram')`,
        )
        .run()
    })()
    this.d.log.log(
      'info',
      'Meta disconnected. Facebook and Instagram are back to dry run placeholders.',
    )
    this.d.emit()
  }

  // ---------- status and expiry ----------

  status(): MetaStatus {
    const c = this.d.db.prepare('SELECT * FROM meta_connection WHERE id = 1').get() as any
    if (!c) {
      return {
        connected: false,
        userName: null,
        status: null,
        expiresAt: null,
        daysLeft: null,
        expiringSoon: false,
        missingPermissions: [],
        pages: [],
        suggestions: [],
      }
    }
    const nowMs = this.now()
    const dates = [c.token_expires_at, c.data_access_expires_at].filter(Boolean) as string[]
    const expiresAt = dates.sort()[0] ?? null
    const daysLeft = daysUntil(expiresAt, nowMs)
    const granted = String(c.granted_scopes || '')
      .split(',')
      .filter(Boolean)
    const pages = (
      this.d.db.prepare('SELECT * FROM meta_pages ORDER BY name').all() as any[]
    ).map<MetaPage>((p) => ({
      pageId: p.page_id,
      name: p.name,
      pictureUrl: p.picture_url,
      igId: p.ig_id,
      igUsername: p.ig_username,
      igPictureUrl: p.ig_picture_url,
      facebookBrandId: this.brandUsing('facebook', p.page_id),
      instagramBrandId: p.ig_id ? this.brandUsing('instagram', p.ig_id) : null,
    }))
    return {
      connected: true,
      userName: c.user_name,
      status: c.status,
      expiresAt,
      daysLeft,
      expiringSoon:
        c.status === 'needs_reauth' || (daysLeft !== null && daysLeft <= EXPIRY_WARN_DAYS),
      missingPermissions: granted.length
        ? META_REQUIRED_SCOPES.filter((s) => !granted.includes(s))
        : [],
      pages,
      suggestions: this.suggest(pages),
    }
  }

  private brandUsing(platform: string, externalId: string): number | null {
    return (
      (
        this.d.db
          .prepare('SELECT brand_id FROM accounts WHERE platform = ? AND external_id = ?')
          .get(platform, externalId) as { brand_id: number } | undefined
      )?.brand_id ?? null
    )
  }

  /** Pre-match every brand to the Page and Instagram account with the most similar name. */
  private suggest(pages: MetaPage[]): MetaSuggestion[] {
    const brands = this.d.db
      .prepare('SELECT id, name FROM brands WHERE archived = 0 ORDER BY id')
      .all() as Array<{ id: number; name: string }>
    return brands.map((b) => {
      const current = this.d.db
        .prepare(
          "SELECT platform, external_id FROM accounts WHERE brand_id = ? AND mode != 'dry_run'",
        )
        .all(b.id) as Array<{ platform: string; external_id: string }>
      const fb = current.find((a) => a.platform === 'facebook')?.external_id
      const ig = current.find((a) => a.platform === 'instagram')?.external_id
      const freePages = pages.filter(
        (p) => p.facebookBrandId === null || p.facebookBrandId === b.id,
      )
      const page = fb ?? bestMatch(b.name, freePages, (p) => p.name)?.pageId ?? null
      const freeIg = pages.filter(
        (p) => p.igId && (p.instagramBrandId === null || p.instagramBrandId === b.id),
      )
      const igMatch =
        ig ??
        bestMatch(b.name, freeIg, (p) => p.igUsername ?? '')?.igId ??
        freeIg.find((p) => p.pageId === page)?.igId ??
        null
      return { brandId: b.id, pageId: page, igId: igMatch }
    })
  }

  /**
   * Asks Meta how long the login still works, flags a dead login, and sends the 7 day warning (once a day).
   * Also called at start and every few hours.
   */
  async checkHealth(): Promise<MetaStatus> {
    const c = this.d.db.prepare('SELECT * FROM meta_connection WHERE id = 1').get() as any
    if (!c) return this.status()
    const token = this.d.secrets.get(META_SECRET_USER_TOKEN)
    if (token) {
      try {
        const dbg = await this.d.graph.get<{
          data: { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number }
        }>('/debug_token', { input_token: token }, token)
        if (dbg.data.is_valid === false) {
          this.markReauth('Meta says the saved login is no longer valid.')
        } else {
          this.d.db
            .prepare(
              'UPDATE meta_connection SET token_expires_at = ?, data_access_expires_at = ? WHERE id = 1',
            )
            .run(unixToIso(dbg.data.expires_at), unixToIso(dbg.data.data_access_expires_at))
          this.d.db
            .prepare(
              "UPDATE accounts SET last_checked_at = ? WHERE platform IN ('facebook','instagram') AND mode != 'dry_run'",
            )
            .run(new Date(this.now()).toISOString())
        }
      } catch (e) {
        if (e instanceof MetaApiError && e.needsReauth) this.markReauth(e.message)
        else this.d.log.log('warn', `Meta health check failed: ${(e as Error).message}`)
      }
    }
    this.warnIfExpiring()
    this.d.emit()
    return this.status()
  }

  /** Sends the "runs out soon" alert at most once per calendar day. */
  warnIfExpiring(): void {
    const st = this.status()
    if (!st.connected || !st.expiringSoon || st.status === 'needs_reauth') return
    const today = new Date(this.now()).toISOString().slice(0, 10)
    const row = this.d.db
      .prepare('SELECT last_alert_day FROM meta_connection WHERE id = 1')
      .get() as { last_alert_day: string | null }
    if (row.last_alert_day === today) return
    this.d.db.prepare('UPDATE meta_connection SET last_alert_day = ? WHERE id = 1').run(today)
    const left = st.daysLeft ?? 0
    const detail =
      left < 0
        ? 'The Meta login has expired. Click Reconnect Meta in Setup Channels, on the Connections tab.'
        : `The Meta login runs out in ${left} day${left === 1 ? '' : 's'}. Click Reconnect Meta in Setup Channels, on the Connections tab.`
    this.d.log.log('warn', detail)
    this.d.alert(COPY.metaExpiryHeadline, detail)
  }

  /** Called by the adapters when Meta rejects the saved login (error 190). */
  markReauth(reason: string): void {
    const c = this.d.db.prepare('SELECT status FROM meta_connection WHERE id = 1').get() as
      { status: string } | undefined
    if (!c || c.status === 'needs_reauth') return
    this.d.db.prepare("UPDATE meta_connection SET status = 'needs_reauth' WHERE id = 1").run()
    this.d.db
      .prepare(
        "UPDATE accounts SET status = 'needs_reauth' WHERE platform IN ('facebook','instagram') AND mode != 'dry_run'",
      )
      .run()
    this.d.log.log('error', `Meta sign-in needs renewing: ${reason}`)
    this.d.alert(COPY.metaReauthHeadline, 'Reconnect Meta in Setup Channels, on the Connections tab.')
    this.d.emit()
  }

  startHealthChecks(): void {
    setTimeout(() => void this.checkHealth(), 30_000)
    this.healthTimer = setInterval(() => void this.checkHealth(), 6 * 3_600_000)
  }

  stop(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.cancelActive?.()
  }

  /** The Page token for an account. Instagram uses the token of the Page it is linked to. */
  tokenForAccount(account: Account | null): string {
    let key: string | null = null
    if (account?.platform === 'facebook' && account.externalId)
      key = pageTokenKey(account.externalId)
    if (account?.platform === 'instagram' && account.externalId) {
      const p = this.d.db
        .prepare('SELECT page_id FROM meta_pages WHERE ig_id = ?')
        .get(account.externalId) as { page_id: string } | undefined
      if (p) key = pageTokenKey(p.page_id)
    }
    const t = key ? this.d.secrets.get(key) : null
    if (!t)
      throw new AdapterError(
        'The saved Meta login for this account is missing. Reconnect Meta in Setup Channels, on the Connections tab.',
        'permanent',
      )
    return t
  }

  /** Facebook allows 30 API published Reels per Page per 24 hours. */
  fbPublishesLast24h(pageId: string): number {
    const since = new Date(this.now() - DAY).toISOString()
    return (
      this.d.db
        .prepare('SELECT COUNT(*) AS n FROM meta_publishes WHERE page_id = ? AND ts_utc >= ?')
        .get(pageId, since) as { n: number }
    ).n
  }

  recordFbPublish(pageId: string): void {
    this.d.db
      .prepare('INSERT INTO meta_publishes (page_id, ts_utc) VALUES (?, ?)')
      .run(pageId, new Date(this.now()).toISOString())
  }
}

function unixToIso(v: number | undefined | null): string | null {
  return v && v > 0 ? new Date(v * 1000).toISOString() : null
}
