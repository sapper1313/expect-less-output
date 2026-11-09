import { withNetworkRetry } from '../network'
import { isNetworkError } from './errors'
import { createServer, type Server } from 'http'
import { randomBytes, randomUUID } from 'crypto'
import { CodeChallengeMethod } from 'google-auth-library'
import type { Db } from '../db'
import type { ActivityLog } from '../services/activity'
import type { SecretStore } from '../services/secrets'
import { mask } from '../services/secrets'
import { AdapterError } from '../adapters/types'
import {
  SCOPES,
  SECRET_CLIENT_ID,
  SECRET_CLIENT_SECRET,
  refreshTokenKey,
  type GoogleUrls,
} from './config'
import { makeOAuthClient, type TokenManager } from './tokens'
import type { YoutubeClient } from './youtubeClient'
import type { QuotaTracker } from './quota'
import type {
  Account,
  ConnectResult,
  GoogleCredentialsStatus,
  QuotaStatus,
  YoutubeChannel,
  YoutubeMode,
  YoutubeOption,
} from '@shared/types'

export interface YoutubeServiceDeps {
  db: Db
  secrets: SecretStore
  urls: GoogleUrls
  tokens: TokenManager
  client: YoutubeClient
  quota: QuotaTracker
  log: ActivityLog
  /** Opens the sign-in page in the owner's browser. */
  openBrowser: (url: string) => Promise<void>
  notifyReauth: (brandName: string) => void
  emit: () => void
  now?: () => number
  signInTimeoutMs?: number
}

interface Pending {
  brandId: number
  refreshToken: string
  channels: YoutubeChannel[]
  expires: number
}

/** Fallback when no channel is connected yet. YouTube's own list replaces it after the first connection. */
export const FALLBACK_CATEGORIES: YoutubeOption[] = [
  { id: '1', title: 'Film and Animation' },
  { id: '10', title: 'Music' },
  { id: '20', title: 'Gaming' },
  { id: '22', title: 'People and Blogs' },
  { id: '23', title: 'Comedy' },
  { id: '24', title: 'Entertainment' },
  { id: '25', title: 'News and Politics' },
  { id: '26', title: 'Howto and Style' },
  { id: '27', title: 'Education' },
  { id: '28', title: 'Science and Technology' },
]

const CATEGORY_CACHE_KEY = 'cache.youtubeCategories'
const PAGE_STYLE =
  'body{background:#2D2B28;color:#F2E8D5;font-family:-apple-system,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center;max-width:520px;padding:24px}h1{letter-spacing:.04em}p{color:#A8A090}'

const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${PAGE_STYLE}</style></head><body><div><h1>${title}</h1><p>${body}</p></div></body></html>`

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  )

export class YoutubeService {
  private server: Server | null = null
  private cancelActive: (() => void) | null = null
  private pending = new Map<string, Pending>()
  private playlistCache = new Map<number, { at: number; items: YoutubeOption[] }>()
  private healthTimer: NodeJS.Timeout | null = null

  constructor(private d: YoutubeServiceDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  // ---------- credentials ----------

  credentialsStatus(): GoogleCredentialsStatus {
    const id = this.d.secrets.get(SECRET_CLIENT_ID)
    const secret = this.d.secrets.get(SECRET_CLIENT_SECRET)
    return {
      hasClientId: !!id,
      hasClientSecret: !!secret,
      clientIdMasked: id ? mask(id) : '',
      clientSecretMasked: secret ? mask(secret) : '',
    }
  }

  saveCredentials(clientId: string, clientSecret: string): GoogleCredentialsStatus {
    const id = clientId.trim()
    const secret = clientSecret.trim()
    if (id && !/\.apps\.googleusercontent\.com$/.test(id) && !this.d.urls.isFake) {
      throw new Error(
        'That does not look like a Google Client ID. It should end with .apps.googleusercontent.com',
      )
    }
    if (id) this.d.secrets.set(SECRET_CLIENT_ID, id)
    if (secret) this.d.secrets.set(SECRET_CLIENT_SECRET, secret)
    this.d.log.log('info', 'Google credentials saved (encrypted).')
    return this.credentialsStatus()
  }

  // ---------- accounts ----------

  private account(brandId: number): Account & { brandName: string } {
    const r = this.d.db
      .prepare(
        `SELECT a.*, b.name AS brand_name FROM accounts a JOIN brands b ON b.id = a.brand_id
         WHERE a.brand_id = ? AND a.platform = 'youtube'`,
      )
      .get(brandId) as any
    if (!r) throw new Error('That brand has no YouTube entry.')
    return {
      id: r.id,
      brandId: r.brand_id,
      platform: 'youtube',
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      externalId: r.external_id,
      status: r.status,
      mode: r.mode,
      lastCheckedAt: r.last_checked_at,
      brandName: r.brand_name,
    }
  }

  private asAccount(brandId: number): Account {
    const { brandName: _b, ...a } = this.account(brandId)
    void _b
    return a
  }

  // ---------- sign in ----------

  async connect(brandId: number): Promise<ConnectResult> {
    const acct = this.account(brandId)
    // Clicking Connect or Reconnect again means the owner wants a fresh sign-in. A sign-in left open by an earlier
    // click (a closed browser tab, a failed attempt) must never block it for the next five minutes.
    if (this.server) this.cancelActive?.()
    if (!this.d.secrets.has(SECRET_CLIENT_ID) || !this.d.secrets.has(SECRET_CLIENT_SECRET)) {
      throw new Error(
        'Save the Google Client ID and Client Secret first (Setup Channels, Connections tab, Google credentials).',
      )
    }
    const state = randomBytes(16).toString('hex')

    const result = await new Promise<ConnectResult>((resolve, reject) => {
      const server = createServer()
      this.server = server
      let finished = false
      const finish = (fn: () => void) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        this.cancelActive = null
        this.server = null
        server.closeAllConnections?.()
        server.close()
        fn()
      }
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new Error(
                'The YouTube sign-in timed out after 5 minutes. Click Connect YouTube to try again.',
              ),
            ),
          ),
        this.d.signInTimeoutMs ?? 300_000,
      )
      this.cancelActive = () => finish(() => reject(new Error('YouTube sign-in canceled.')))

      server.on('error', (e) => finish(() => reject(e)))
      server.listen(0, '127.0.0.1', async () => {
        try {
          const port = (server.address() as { port: number }).port
          const redirectUri = `http://127.0.0.1:${port}/callback`
          const oauth = makeOAuthClient(this.d.secrets, this.d.urls, redirectUri)
          const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync()
          const authUrl = oauth.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: SCOPES,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: CodeChallengeMethod.S256,
          })

          server.on('request', async (req, res) => {
            const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
            if (url.pathname !== '/callback') {
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
                    'This sign-in did not start here. Close this tab and click Connect YouTube again.',
                  ),
                )
                return
              }
              const err = url.searchParams.get('error')
              if (err) {
                send(
                  200,
                  page(
                    'Not connected.',
                    `Google said: ${escapeHtml(err)}. Close this tab and try again.`,
                  ),
                )
                finish(() =>
                  reject(
                    new Error(
                      err === 'access_denied'
                        ? 'You did not approve access in the browser.'
                        : `Google sign-in failed (${err}).`,
                    ),
                  ),
                )
                return
              }
              const code = url.searchParams.get('code')
              if (!code) {
                send(400, page('Something is off.', 'Google did not send a code.'))
                return
              }
              // The code can only be used once, but a failed connection never reached Google, so asking again is safe.
              const { tokens } = await withNetworkRetry(
                () => oauth.getToken({ code, codeVerifier }),
                isNetworkError,
              )
              if (!tokens.refresh_token) {
                throw new Error(
                  'Google did not give a long-lived sign-in. Remove "Expect Less Output" at myaccount.google.com/permissions, then connect again.',
                )
              }
              if (!tokens.access_token) throw new Error('Google did not return an access token.')
              const accessToken = tokens.access_token
              const channels = await withNetworkRetry(
                () => this.d.client.channelsForToken(accessToken),
                isNetworkError,
              )
              if (channels.length === 0)
                throw new Error(
                  'That Google account has no YouTube channel. Pick the right account and try again.',
                )
              send(
                200,
                page('Connected.', 'You can close this tab and return to Expect Less Output.'),
              )
              if (channels.length === 1) {
                finish(() => {
                  try {
                    resolve({
                      status: 'connected',
                      account: this.saveAccount(acct, channels[0], tokens.refresh_token as string),
                    })
                  } catch (e) {
                    reject(e)
                  }
                })
              } else {
                const sessionId = randomUUID()
                this.pending.set(sessionId, {
                  brandId,
                  refreshToken: tokens.refresh_token,
                  channels,
                  expires: this.now() + 600_000,
                })
                finish(() => resolve({ status: 'pick', sessionId, channels }))
              }
            } catch (e) {
              const msg = e instanceof AdapterError || e instanceof Error ? e.message : String(e)
              send(200, page('Not connected.', escapeHtml(msg)))
              finish(() => reject(new Error(msg)))
            }
          })

          await this.d.openBrowser(authUrl)
        } catch (e) {
          finish(() => reject(e))
        }
      })
    })
    return result
  }

  finishConnect(sessionId: string, channelId: string): ConnectResult {
    const p = this.pending.get(sessionId)
    this.pending.delete(sessionId)
    if (!p || p.expires < this.now())
      throw new Error('That channel choice expired. Click Connect YouTube again.')
    const channel = p.channels.find((c) => c.id === channelId)
    if (!channel) throw new Error('Pick one of the channels in the list.')
    return {
      status: 'connected',
      account: this.saveAccount(this.account(p.brandId), channel, p.refreshToken),
    }
  }

  cancelConnect(): void {
    this.cancelActive?.()
  }

  private saveAccount(
    acct: Account & { brandName: string },
    channel: YoutubeChannel,
    refreshToken: string,
  ): Account {
    const clash = this.d.db
      .prepare(
        "SELECT b.name FROM accounts a JOIN brands b ON b.id = a.brand_id WHERE a.platform = 'youtube' AND a.external_id = ? AND a.id != ?",
      )
      .get(channel.id, acct.id) as { name: string } | undefined
    if (clash)
      throw new Error(
        `The channel "${channel.title}" is already connected to ${clash.name}. Disconnect it there first.`,
      )
    const keepMode = ['manual_assist', 'test_private', 'auto'].includes(acct.mode)
    this.d.secrets.set(refreshTokenKey(acct.id), refreshToken)
    this.d.tokens.forget(acct.id)
    this.d.db
      .prepare(
        `UPDATE accounts SET external_id = ?, display_name = ?, avatar_url = ?, token_ref = ?, status = 'connected',
         mode = ?, last_checked_at = ?, token_expires_at = NULL WHERE id = ?`,
      )
      .run(
        channel.id,
        channel.title,
        channel.avatarUrl,
        refreshTokenKey(acct.id),
        keepMode ? acct.mode : 'manual_assist',
        new Date(this.now()).toISOString(),
        acct.id,
      )
    this.d.log.log('info', `YouTube connected: ${channel.title} is linked to ${acct.brandName}.`, {
      platform: 'youtube',
    })
    this.d.emit()
    return this.asAccount(acct.brandId)
  }

  async disconnect(brandId: number): Promise<void> {
    const acct = this.account(brandId)
    const token = this.d.secrets.get(refreshTokenKey(acct.id))
    if (token) {
      try {
        await makeOAuthClient(this.d.secrets, this.d.urls).revokeToken(token)
      } catch {
        // Revoking is a courtesy. The saved sign-in is deleted either way.
      }
    }
    this.d.secrets.delete(refreshTokenKey(acct.id))
    this.d.tokens.forget(acct.id)
    this.d.db
      .prepare(
        `UPDATE accounts SET external_id = NULL, display_name = 'Dry run account', avatar_url = NULL, token_ref = NULL,
         token_expires_at = NULL, status = 'connected', mode = 'dry_run', last_checked_at = NULL WHERE id = ?`,
      )
      .run(acct.id)
    this.playlistCache.delete(acct.id)
    this.d.log.log(
      'info',
      `YouTube disconnected from ${acct.brandName}. It is back to a dry run placeholder.`,
      { platform: 'youtube' },
    )
    this.d.emit()
  }

  setMode(brandId: number, mode: YoutubeMode): void {
    if (!['manual_assist', 'test_private', 'auto'].includes(mode))
      throw new Error('Unknown YouTube mode.')
    const acct = this.account(brandId)
    if (acct.mode === 'dry_run') throw new Error('Connect a YouTube channel first.')
    this.d.db.prepare('UPDATE accounts SET mode = ? WHERE id = ?').run(mode, acct.id)
    this.d.log.log('info', `YouTube mode for ${acct.brandName} is now ${mode.replace('_', ' ')}.`, {
      platform: 'youtube',
    })
    this.d.emit()
  }

  // ---------- info and health ----------

  quotaStatus(): QuotaStatus {
    return this.d.quota.status()
  }

  async categories(): Promise<YoutubeOption[]> {
    const row = this.d.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(CATEGORY_CACHE_KEY) as { value_json: string } | undefined
    if (row) {
      try {
        const cached = JSON.parse(row.value_json) as { items: YoutubeOption[] }
        if (cached.items?.length) return cached.items
      } catch {
        // fall through and fetch again
      }
    }
    const acct = this.d.db
      .prepare(
        "SELECT id FROM accounts WHERE platform = 'youtube' AND mode != 'dry_run' AND status = 'connected' LIMIT 1",
      )
      .get() as { id: number } | undefined
    if (!acct) return FALLBACK_CATEGORIES
    try {
      const items = await this.d.client.categories(acct.id)
      if (items.length) {
        this.d.db
          .prepare(
            'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
          )
          .run(
            CATEGORY_CACHE_KEY,
            JSON.stringify({ fetchedAt: new Date(this.now()).toISOString(), items }),
          )
        return items
      }
    } catch (e) {
      this.d.log.log('warn', `Could not fetch YouTube categories: ${(e as Error).message}`, {
        platform: 'youtube',
      })
    }
    return FALLBACK_CATEGORIES
  }

  async playlists(brandId: number): Promise<YoutubeOption[]> {
    const acct = this.account(brandId)
    if (acct.mode === 'dry_run' || acct.status !== 'connected') return []
    const hit = this.playlistCache.get(acct.id)
    if (hit && this.now() - hit.at < 300_000) return hit.items
    const items = await this.d.client.playlists(acct.id)
    this.playlistCache.set(acct.id, { at: this.now(), items })
    return items
  }

  /** One cheap channels.list per connected account. A dead sign-in flips the account to needs_reauth. */
  async checkHealth(force = true): Promise<void> {
    const rows = this.d.db
      .prepare(
        "SELECT a.id, a.last_checked_at, b.name FROM accounts a JOIN brands b ON b.id = a.brand_id WHERE a.platform = 'youtube' AND a.mode != 'dry_run' AND a.status = 'connected' AND b.archived = 0",
      )
      .all() as Array<{ id: number; last_checked_at: string | null; name: string }>
    for (const r of rows) {
      if (
        !force &&
        r.last_checked_at &&
        this.now() - new Date(r.last_checked_at).getTime() < 23 * 3_600_000
      )
        continue
      try {
        const channels = await this.d.client.myChannels(r.id)
        this.d.db
          .prepare('UPDATE accounts SET last_checked_at = ? WHERE id = ?')
          .run(new Date(this.now()).toISOString(), r.id)
        if (channels.length === 0)
          this.d.log.log('warn', `${r.name}: YouTube shows no channel for this sign-in.`, {
            platform: 'youtube',
          })
      } catch (e) {
        this.d.log.log('warn', `${r.name}: YouTube health check failed: ${(e as Error).message}`, {
          platform: 'youtube',
        })
      }
    }
    this.d.emit()
  }

  startHealthChecks(): void {
    setTimeout(() => void this.checkHealth(false), 30_000)
    this.healthTimer = setInterval(() => void this.checkHealth(false), 6 * 3_600_000)
  }

  stop(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.cancelActive?.()
  }
}
