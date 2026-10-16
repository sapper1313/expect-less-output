import { OAuth2Client } from 'google-auth-library'
import type { Db } from '../db'
import type { SecretStore } from '../services/secrets'
import { AdapterError } from '../adapters/types'
import { isNetworkError } from './errors'
import { describeNetworkError } from '../network'
import { SECRET_CLIENT_ID, SECRET_CLIENT_SECRET, refreshTokenKey, type GoogleUrls } from './config'

interface Cached {
  token: string
  expiresAt: number
}

export interface TokenDeps {
  db: Db
  secrets: SecretStore
  urls: GoogleUrls
  now?: () => number
  /** Called once when Google says the refresh token no longer works. */
  onNeedsReauth: (accountId: number, reason: string) => void
}

export function makeOAuthClient(
  secrets: SecretStore,
  urls: GoogleUrls,
  redirectUri?: string,
): OAuth2Client {
  const clientId = secrets.get(SECRET_CLIENT_ID)
  const clientSecret = secrets.get(SECRET_CLIENT_SECRET)
  if (!clientId || !clientSecret) {
    throw new AdapterError(
      'Google Client ID and Client Secret are not saved yet. Add them on the Connections screen.',
      'permanent',
    )
  }
  return new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri,
    endpoints: {
      oauth2AuthBaseUrl: urls.authBase,
      oauth2TokenUrl: urls.tokenUrl,
      oauth2RevokeUrl: urls.revokeUrl,
    },
  })
}

/** Hands out fresh access tokens. Refresh tokens live only in the encrypted secret store. */
export class TokenManager {
  private cache = new Map<number, Cached>()
  private inflight = new Map<number, Promise<string>>()

  constructor(private d: TokenDeps) {}

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  forget(accountId: number): void {
    this.cache.delete(accountId)
  }

  getAccessToken(accountId: number, forceRefresh = false): Promise<string> {
    const hit = this.cache.get(accountId)
    if (!forceRefresh && hit && hit.expiresAt - this.now() > 120_000)
      return Promise.resolve(hit.token)
    const pending = this.inflight.get(accountId)
    if (pending) return pending
    const p = this.refresh(accountId).finally(() => this.inflight.delete(accountId))
    this.inflight.set(accountId, p)
    return p
  }

  private async refresh(accountId: number): Promise<string> {
    const acct = this.d.db.prepare('SELECT status FROM accounts WHERE id = ?').get(accountId) as
      { status: string } | undefined
    if (!acct) throw new AdapterError('That YouTube connection no longer exists.', 'permanent')
    if (acct.status === 'needs_reauth')
      throw new AdapterError(
        'YouTube needs you to sign in again. Reconnect it on the Connections screen.',
        'permanent',
      )
    const refreshToken = this.d.secrets.get(refreshTokenKey(accountId))
    if (!refreshToken) {
      this.markReauth(accountId, 'No saved sign-in for this channel.')
      throw new AdapterError(
        'YouTube needs you to sign in again. Reconnect it on the Connections screen.',
        'permanent',
      )
    }
    const client = makeOAuthClient(this.d.secrets, this.d.urls)
    client.setCredentials({ refresh_token: refreshToken })
    try {
      const { credentials } = await client.refreshAccessToken()
      if (!credentials.access_token) throw new Error('Google returned no access token.')
      // Measure the lifetime against the real clock the library used, then apply it to our own clock.
      const lifetime = (credentials.expiry_date ?? Date.now() + 3_000_000) - Date.now()
      const expiresAt = this.now() + lifetime
      this.cache.set(accountId, { token: credentials.access_token, expiresAt })
      this.d.db
        .prepare('UPDATE accounts SET token_expires_at = ? WHERE id = ?')
        .run(new Date(expiresAt).toISOString(), accountId)
      return credentials.access_token
    } catch (err) {
      const e = err as {
        response?: { data?: { error?: string; error_description?: string } }
        message?: string
      }
      const code = e.response?.data?.error
      if (code === 'invalid_grant') {
        this.markReauth(
          accountId,
          e.response?.data?.error_description ?? 'Google no longer accepts the saved sign-in.',
        )
        throw new AdapterError(
          'YouTube needs you to sign in again. Reconnect it on the Connections screen.',
          'permanent',
        )
      }
      if (code === 'invalid_client' || code === 'unauthorized_client') {
        throw new AdapterError(
          'Google rejected the Client ID or Client Secret. Check them on the Connections screen.',
          'permanent',
        )
      }
      if (isNetworkError(err) || !code)
        throw new AdapterError(
          `Could not reach Google to refresh the sign-in: ${describeNetworkError(err)}`,
          'transient',
        )
      throw new AdapterError(`Google would not refresh the sign-in (${code}).`, 'transient')
    }
  }

  private markReauth(accountId: number, reason: string): void {
    this.cache.delete(accountId)
    this.d.db.prepare("UPDATE accounts SET status = 'needs_reauth' WHERE id = ?").run(accountId)
    this.d.onNeedsReauth(accountId, reason)
  }
}
