import { createHash, randomBytes } from 'crypto'
import type { Db } from '../db'
import type { ActivityLog } from '../services/activity'
import { mask, type SecretStore } from '../services/secrets'
import type { SettingsService } from '../services/settings'
import { AdapterError } from '../adapters/types'
import { COPY } from '@shared/copy'
import type { Account, TikTokCreatorInfo, TikTokCredentialsStatus, TikTokMode } from '@shared/types'
import {
  APP_CALLBACK_PREFIX,
  DEFAULT_REDIRECT_URI,
  SCOPES_BASE,
  SCOPE_PUBLISH,
  TT_SECRET_KEY,
  TT_SECRET_REDIRECT,
  TT_SECRET_SECRET,
  ttTokensKey,
  type TikTokUrls,
} from './config'
import { TikTokApiError, type TikTokClient, type TikTokTokens } from './client'

export interface TikTokServiceDeps {
  db: Db
  secrets: SecretStore
  settings: SettingsService
  urls: TikTokUrls
  client: TikTokClient
  log: ActivityLog
  openBrowser: (url: string) => Promise<void>
  alert: (headline: string, detail: string) => void
  emit: () => void
  now?: () => number
  signInTimeoutMs?: number
}

interface PendingSignIn {
  state: string
  verifier: string
  brandId: number
  deliver: (code: string, state: string | null) => void
  cancel: () => void
}

const HOUR = 3_600_000

export class TikTokService {
  private pending: PendingSignIn | null = null
  private refreshing = new Map<number, Promise<TikTokTokens>>()
  private creatorCache = new Map<number, { at: number; info: TikTokCreatorInfo }>()
  private healthTimer: NodeJS.Timeout | null = null

  constructor(private d: TikTokServiceDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  // ---------- credentials ----------

  credentialsStatus(): TikTokCredentialsStatus {
    const key = this.d.secrets.get(TT_SECRET_KEY)
    const secret = this.d.secrets.get(TT_SECRET_SECRET)
    return {
      hasClientKey: !!key,
      hasClientSecret: !!secret,
      clientKeyMasked: key ? mask(key) : '',
      clientSecretMasked: secret ? mask(secret) : '',
      redirectUri: this.d.secrets.get(TT_SECRET_REDIRECT) ?? DEFAULT_REDIRECT_URI,
      requestPublishScope: this.d.settings.get().tiktokRequestPublishScope,
    }
  }

  saveCredentials(
    clientKey: string,
    clientSecret: string,
    redirectUri: string,
    requestPublishScope: boolean,
  ): TikTokCredentialsStatus {
    const uri = redirectUri.trim() || DEFAULT_REDIRECT_URI
    if (!/^https?:\/\//i.test(uri)) throw new Error('The Redirect URI must start with https://')
    if (clientKey.trim()) this.d.secrets.set(TT_SECRET_KEY, clientKey.trim())
    if (clientSecret.trim()) this.d.secrets.set(TT_SECRET_SECRET, clientSecret.trim())
    this.d.secrets.set(TT_SECRET_REDIRECT, uri)
    this.d.settings.set({ tiktokRequestPublishScope: requestPublishScope })
    this.d.log.log('info', 'TikTok credentials saved (encrypted).')
    return this.credentialsStatus()
  }

  private creds(): { key: string; secret: string; redirect: string } {
    const key = this.d.secrets.get(TT_SECRET_KEY)
    const secret = this.d.secrets.get(TT_SECRET_SECRET)
    if (!key || !secret)
      throw new Error(
        'Save the TikTok Client Key and Client Secret first (Connections screen, TikTok).',
      )
    return { key, secret, redirect: this.d.secrets.get(TT_SECRET_REDIRECT) ?? DEFAULT_REDIRECT_URI }
  }

  // ---------- accounts ----------

  private account(brandId: number): Account & { brandName: string } {
    const r = this.d.db
      .prepare(
        `SELECT a.*, b.name AS brand_name FROM accounts a JOIN brands b ON b.id = a.brand_id WHERE a.brand_id = ? AND a.platform = 'tiktok'`,
      )
      .get(brandId) as any
    if (!r) throw new Error('That brand has no TikTok entry.')
    return {
      id: r.id,
      brandId: r.brand_id,
      platform: 'tiktok',
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      externalId: r.external_id,
      status: r.status,
      mode: r.mode,
      lastCheckedAt: r.last_checked_at,
      brandName: r.brand_name,
    }
  }

  private plain(brandId: number): Account {
    const { brandName: _b, ...a } = this.account(brandId)
    void _b
    return a
  }

  // ---------- sign in ----------

  /** Opens TikTok login. Finishes when the bounce page hands the code back (expectless:// link) or the owner pastes it. */
  async connect(brandId: number): Promise<Account> {
    const acct = this.account(brandId)
    const { key, secret, redirect } = this.creds()
    if (this.pending)
      throw new Error(
        'A TikTok sign-in is already open. Finish it in your browser or cancel it first.',
      )
    const state = randomBytes(16).toString('hex')
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const scopes = [
      ...SCOPES_BASE,
      ...(this.d.settings.get().tiktokRequestPublishScope ? [SCOPE_PUBLISH] : []),
    ]
    const url = new URL(this.d.urls.authorize)
    url.searchParams.set('client_key', key)
    url.searchParams.set('scope', scopes.join(','))
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', redirect)
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')

    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          done(() =>
            reject(
              new Error(
                'The TikTok sign-in timed out after 5 minutes. Click Connect TikTok to try again.',
              ),
            ),
          ),
        this.d.signInTimeoutMs ?? 300_000,
      )
      const done = (fn: () => void) => {
        clearTimeout(timer)
        this.pending = null
        fn()
      }
      this.pending = {
        state,
        verifier,
        brandId,
        deliver: (c, s) => {
          if (s !== null && s !== state)
            return done(() =>
              reject(
                new Error('This TikTok sign-in did not start here. Click Connect TikTok again.'),
              ),
            )
          done(() => resolve(c))
        },
        cancel: () => done(() => reject(new Error('TikTok sign-in canceled.'))),
      }
      this.d.openBrowser(url.toString()).catch((e) => done(() => reject(e)))
    })

    const tokens = await this.d.client.exchangeCode(
      { clientKey: key, clientSecret: secret, code, redirectUri: redirect, codeVerifier: verifier },
      this.now(),
    )
    if (!tokens.scope.split(',').includes('video.upload')) {
      throw new Error(
        'TikTok did not grant the video.upload permission. Click Connect TikTok again and approve everything.',
      )
    }
    const user = await this.d.client.userInfo(tokens.accessToken)
    return this.saveAccount(acct, tokens, user)
  }

  /** The expectless://oauth/tiktok link from the bounce page. Returns true when it was a TikTok callback. */
  handleOpenUrl(raw: string): boolean {
    if (!raw.startsWith(APP_CALLBACK_PREFIX)) return false
    const u = new URL(raw)
    const err = u.searchParams.get('error')
    const code = u.searchParams.get('code')
    if (!this.pending) {
      this.d.log.log(
        'warn',
        'A TikTok return link arrived but no sign-in was waiting. Click Connect TikTok first.',
      )
      return true
    }
    if (err) this.pending.cancel()
    else if (code) this.pending.deliver(code, u.searchParams.get('state'))
    return true
  }

  /** The "Paste code" fallback. */
  submitCode(code: string): void {
    if (!this.pending)
      throw new Error(
        'No TikTok sign-in is waiting. Click Connect TikTok first, then paste the code.',
      )
    let c = code.trim()
    if (!c) throw new Error('Paste the code from the website page first.')
    if (/^https?:\/\/|^expectless:\/\//i.test(c)) {
      const q = new URL(c).searchParams.get('code')
      if (q) c = q
    }
    try {
      c = decodeURIComponent(c)
    } catch {
      // already plain
    }
    this.pending.deliver(c, null)
  }

  cancelConnect(): void {
    this.pending?.cancel()
  }

  private saveAccount(
    acct: Account & { brandName: string },
    tokens: TikTokTokens,
    user: { openId: string; displayName: string; avatarUrl: string | null },
  ): Account {
    const clash = this.d.db
      .prepare(
        "SELECT b.name FROM accounts a JOIN brands b ON b.id = a.brand_id WHERE a.platform = 'tiktok' AND a.external_id = ? AND a.id != ?",
      )
      .get(user.openId, acct.id) as { name: string } | undefined
    if (clash)
      throw new Error(
        `"${user.displayName}" is already connected to ${clash.name}. Disconnect it there first.`,
      )
    this.d.secrets.set(ttTokensKey(acct.id), JSON.stringify(tokens))
    const keep = acct.mode === 'drafts' || acct.mode === 'direct'
    this.d.db
      .prepare(
        `UPDATE accounts SET external_id = ?, display_name = ?, avatar_url = ?, token_ref = ?, status = 'connected', mode = ?, last_checked_at = ?, token_expires_at = ? WHERE id = ?`,
      )
      .run(
        user.openId,
        user.displayName,
        user.avatarUrl,
        ttTokensKey(acct.id),
        keep ? acct.mode : 'drafts',
        new Date(this.now()).toISOString(),
        new Date(tokens.accessExpiresAt).toISOString(),
        acct.id,
      )
    this.creatorCache.delete(acct.id)
    this.d.log.log(
      'info',
      `TikTok connected: ${user.displayName} is linked to ${acct.brandName}.`,
      { platform: 'tiktok' },
    )
    this.d.emit()
    return this.plain(acct.brandId)
  }

  async disconnect(brandId: number): Promise<void> {
    const acct = this.account(brandId)
    const tokens = this.readTokens(acct.id)
    if (tokens) {
      try {
        const { key, secret } = this.creds()
        await this.d.client.revoke({
          clientKey: key,
          clientSecret: secret,
          token: tokens.accessToken,
        })
      } catch {
        // A courtesy. The saved login is deleted either way.
      }
    }
    this.d.secrets.delete(ttTokensKey(acct.id))
    this.creatorCache.delete(acct.id)
    this.d.db
      .prepare(
        `UPDATE accounts SET external_id = NULL, display_name = 'Dry run account', avatar_url = NULL, token_ref = NULL, token_expires_at = NULL, status = 'connected', mode = 'dry_run', last_checked_at = NULL WHERE id = ?`,
      )
      .run(acct.id)
    this.d.log.log(
      'info',
      `TikTok disconnected from ${acct.brandName}. It is back to a dry run placeholder.`,
      { platform: 'tiktok' },
    )
    this.d.emit()
  }

  /** Direct post can only be chosen after the owner confirms TikTok approved the audit. */
  setMode(brandId: number, mode: TikTokMode, auditApproved = false): void {
    if (mode !== 'drafts' && mode !== 'direct') throw new Error('Unknown TikTok mode.')
    const acct = this.account(brandId)
    if (acct.mode === 'dry_run') throw new Error('Connect a TikTok account first.')
    if (mode === 'direct') {
      if (!auditApproved)
        throw new Error(
          'Direct post needs TikTok to approve the audit first. Confirm that it did, then switch.',
        )
      if (!this.d.settings.get().tiktokRequestPublishScope) {
        throw new Error(
          'Turn on "Also ask for video.publish" in the TikTok credentials, then reconnect this account, before using Direct post.',
        )
      }
    }
    this.d.db.prepare('UPDATE accounts SET mode = ? WHERE id = ?').run(mode, acct.id)
    this.creatorCache.delete(acct.id)
    this.d.log.log(
      'info',
      `TikTok mode for ${acct.brandName} is now ${mode === 'drafts' ? 'Drafts' : 'Direct post'}.`,
      { platform: 'tiktok' },
    )
    this.d.emit()
  }

  // ---------- tokens ----------

  private readTokens(accountId: number): TikTokTokens | null {
    const raw = this.d.secrets.get(ttTokensKey(accountId))
    if (!raw) return null
    try {
      return JSON.parse(raw) as TikTokTokens
    } catch {
      return null
    }
  }

  /** A working access token. Refreshes one hour before it expires, or right away when forced. */
  async accessToken(accountId: number, force = false): Promise<string> {
    const status = (
      this.d.db.prepare('SELECT status FROM accounts WHERE id = ?').get(accountId) as
        { status: string } | undefined
    )?.status
    if (!status) throw new AdapterError('That TikTok connection no longer exists.', 'permanent')
    if (status === 'needs_reauth')
      throw new AdapterError(
        'TikTok needs you to sign in again. Reconnect it on the Connections screen.',
        'permanent',
      )
    const t = this.readTokens(accountId)
    if (!t) {
      this.markReauth(accountId, 'No saved TikTok login.')
      throw new AdapterError(
        'TikTok needs you to sign in again. Reconnect it on the Connections screen.',
        'permanent',
      )
    }
    if (!force && t.accessExpiresAt - this.now() > HOUR) return t.accessToken
    let p = this.refreshing.get(accountId)
    if (!p) {
      p = this.refresh(accountId, t).finally(() => this.refreshing.delete(accountId))
      this.refreshing.set(accountId, p)
    }
    return (await p).accessToken
  }

  private async refresh(accountId: number, t: TikTokTokens): Promise<TikTokTokens> {
    const { key, secret } = this.creds()
    if (t.refreshExpiresAt <= this.now()) {
      this.markReauth(accountId, 'The saved TikTok login expired.')
      throw new AdapterError(
        'TikTok needs you to sign in again. Reconnect it on the Connections screen.',
        'permanent',
      )
    }
    try {
      const next = await this.d.client.refresh(
        { clientKey: key, clientSecret: secret, refreshToken: t.refreshToken },
        this.now(),
      )
      const merged = { ...next, openId: next.openId || t.openId }
      this.d.secrets.set(ttTokensKey(accountId), JSON.stringify(merged))
      this.d.db
        .prepare('UPDATE accounts SET token_expires_at = ? WHERE id = ?')
        .run(new Date(merged.accessExpiresAt).toISOString(), accountId)
      return merged
    } catch (err) {
      if (err instanceof TikTokApiError && err.code === 'invalid_grant') {
        this.markReauth(accountId, err.message)
        throw new AdapterError(
          'TikTok needs you to sign in again. Reconnect it on the Connections screen.',
          'permanent',
        )
      }
      throw err
    }
  }

  private markReauth(accountId: number, reason: string): void {
    const a = this.d.db
      .prepare(
        'SELECT a.status, b.name FROM accounts a JOIN brands b ON b.id = a.brand_id WHERE a.id = ?',
      )
      .get(accountId) as { status: string; name: string } | undefined
    if (!a || a.status === 'needs_reauth') return
    this.d.db.prepare("UPDATE accounts SET status = 'needs_reauth' WHERE id = ?").run(accountId)
    this.d.log.log('error', `TikTok sign-in expired for ${a.name}: ${reason}`, {
      platform: 'tiktok',
    })
    this.d.alert(
      COPY.tiktokReauthHeadline,
      `${a.name}: reconnect TikTok on the Connections screen.`,
    )
    this.d.emit()
  }

  // ---------- creator info and health ----------

  /** What this account allows right now. Cached for 5 minutes unless `refresh` is set. */
  async creatorInfo(brandId: number, refresh = false): Promise<TikTokCreatorInfo> {
    const acct = this.account(brandId)
    if (acct.mode === 'dry_run') throw new Error('Connect a TikTok account first.')
    const hit = this.creatorCache.get(acct.id)
    if (!refresh && hit && this.now() - hit.at < 300_000) return hit.info
    const info = await this.fresh(acct.id)
    return info
  }

  /** Always asks TikTok. Used right before publishing. */
  async fresh(accountId: number): Promise<TikTokCreatorInfo> {
    let token = await this.accessToken(accountId)
    let info: TikTokCreatorInfo
    try {
      info = await this.d.client.creatorInfo(token)
    } catch (err) {
      if (err instanceof TikTokApiError && err.needsRefresh) {
        token = await this.accessToken(accountId, true)
        info = await this.d.client.creatorInfo(token)
      } else throw err
    }
    this.creatorCache.set(accountId, { at: this.now(), info })
    return info
  }

  async checkHealth(): Promise<void> {
    const rows = this.d.db
      .prepare(
        "SELECT a.id, b.name FROM accounts a JOIN brands b ON b.id = a.brand_id WHERE a.platform = 'tiktok' AND a.mode != 'dry_run' AND a.status = 'connected'",
      )
      .all() as Array<{ id: number; name: string }>
    for (const r of rows) {
      try {
        await this.accessToken(r.id)
        this.d.db
          .prepare('UPDATE accounts SET last_checked_at = ? WHERE id = ?')
          .run(new Date(this.now()).toISOString(), r.id)
      } catch (e) {
        this.d.log.log('warn', `${r.name}: TikTok health check failed: ${(e as Error).message}`, {
          platform: 'tiktok',
        })
      }
    }
    this.d.emit()
  }

  startHealthChecks(): void {
    setTimeout(() => void this.checkHealth(), 45_000)
    this.healthTimer = setInterval(() => void this.checkHealth(), 6 * HOUR)
  }

  stop(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.pending?.cancel()
  }
}
