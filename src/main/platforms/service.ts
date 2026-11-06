import { randomBytes } from 'crypto'
import type { Db } from '../db'
import type { ActivityLog } from '../services/activity'
import { mask, type SecretStore } from '../services/secrets'
import { AdapterError } from '../adapters/types'
import {
  EXTRA_PLATFORMS,
  PLATFORM_LABELS,
  type ExtraPlatform,
  type Platform,
} from '@shared/platformLimits'
import type { ExtraAccountView, ExtraCredentialsStatus } from '@shared/types'
import {
  PlatformTokens,
  pkce,
  toStored,
  waitForCallback,
  type StoredTokens,
  type TokenGrant,
} from './oauth'
import { X_PORT, type XClient } from './x'
import { LI_PORT, type LinkedInClient } from './linkedin'
import { PIN_PORT, type PinterestClient } from './pinterest'

type OAuthPlatform = 'x' | 'linkedin' | 'pinterest'
const OAUTH: OAuthPlatform[] = ['x', 'linkedin', 'pinterest']
const PORTS: Record<OAuthPlatform, number> = { x: X_PORT, linkedin: LI_PORT, pinterest: PIN_PORT }
const REDIRECTS: Record<OAuthPlatform, string> = {
  x: `http://127.0.0.1:${X_PORT}/callback`,
  linkedin: `http://127.0.0.1:${LI_PORT}/callback`,
  pinterest: `http://127.0.0.1:${PIN_PORT}/callback`,
}
const idKey = (p: OAuthPlatform) => `${p}.client_id`
const secretKey = (p: OAuthPlatform) => `${p}.client_secret`
const WARN_MS = 7 * 86_400_000
const SOON_MS = 5 * 60_000

export interface PlatformServiceDeps {
  db: Db
  secrets: SecretStore
  log: ActivityLog
  clients: { x: XClient; linkedin: LinkedInClient; pinterest: PinterestClient }
  /** Handle and app password saved for a channel (Settings, Studio). Null from notReady means it can post. */
  bluesky: {
    notReady: (brandId: number) => string | null
    handle: (brandId: number) => string | null
  }
  openBrowser: (url: string) => Promise<void>
  alert: (headline: string, detail: string) => void
  emit: () => void
  now?: () => number
}

interface Row {
  id: number
  brand_id: number
  platform: string
  external_id: string | null
  display_name: string | null
  status: string
  mode: string
  token_expires_at: string | null
}

/**
 * Logins for Bluesky, X, LinkedIn and Pinterest. A channel only uses a platform when it has a connected login
 * here: with none, the platform is simply not part of that channel.
 */
export class PlatformService {
  private tokens: PlatformTokens
  private refreshing = new Map<number, Promise<string>>()
  private cancelSignIn: (() => void) | null = null

  constructor(private d: PlatformServiceDeps) {
    this.tokens = new PlatformTokens(d.secrets)
  }

  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }

  // ---------------------------------------------------------------- app keys

  credentialsStatus(platform: OAuthPlatform): ExtraCredentialsStatus {
    const id = this.d.secrets.get(idKey(platform))
    const secret = this.d.secrets.get(secretKey(platform))
    return {
      platform,
      hasClientId: !!id,
      hasClientSecret: !!secret,
      clientIdMasked: id ? mask(id) : '',
      clientSecretMasked: secret ? mask(secret) : '',
      redirectUri: REDIRECTS[platform],
    }
  }

  saveCredentials(
    platform: OAuthPlatform,
    clientId: string,
    clientSecret: string,
  ): ExtraCredentialsStatus {
    if (!OAUTH.includes(platform)) throw new Error(`${platform} does not use app keys.`)
    if (clientId.trim()) this.d.secrets.set(idKey(platform), clientId.trim())
    if (clientSecret.trim()) this.d.secrets.set(secretKey(platform), clientSecret.trim())
    this.d.log.log('info', `${PLATFORM_LABELS[platform]} app keys saved (encrypted).`)
    return this.credentialsStatus(platform)
  }

  private creds(platform: OAuthPlatform): { id: string; secret: string } {
    const id = this.d.secrets.get(idKey(platform))
    const secret = this.d.secrets.get(secretKey(platform))
    if (!id || !secret)
      throw new Error(
        `Save the ${PLATFORM_LABELS[platform]} Client ID and Client Secret first (Setup Channels, Connections tab, More platforms).`,
      )
    return { id, secret }
  }

  // ---------------------------------------------------------------- accounts

  private row(brandId: number, platform: Platform): Row | undefined {
    return this.d.db
      .prepare('SELECT * FROM accounts WHERE brand_id = ? AND platform = ?')
      .get(brandId, platform) as Row | undefined
  }

  private upsert(
    brandId: number,
    platform: Platform,
    v: {
      externalId?: string | null
      displayName?: string | null
      status?: string
      expiresAt?: number | null
    },
  ): number {
    const exp = v.expiresAt ? new Date(v.expiresAt).toISOString() : null
    this.d.db
      .prepare(
        `INSERT INTO accounts (brand_id, platform, external_id, display_name, status, mode, token_expires_at, last_checked_at)
         VALUES (@brand, @platform, @ext, @name, @status, 'live', @exp, @at)
         ON CONFLICT(brand_id, platform) DO UPDATE SET
           external_id = CASE WHEN @setExt THEN excluded.external_id ELSE accounts.external_id END,
           display_name = COALESCE(excluded.display_name, accounts.display_name),
           status = excluded.status, mode = 'live', token_expires_at = excluded.token_expires_at,
           last_checked_at = excluded.last_checked_at`,
      )
      .run({
        brand: brandId,
        platform,
        ext: v.externalId ?? null,
        name: v.displayName ?? null,
        status: v.status ?? 'connected',
        exp,
        at: new Date(this.now()).toISOString(),
        setExt: v.externalId !== undefined ? 1 : 0,
      })
    return (this.row(brandId, platform) as Row).id
  }

  private drop(brandId: number, platform: Platform): void {
    const r = this.row(brandId, platform)
    if (!r) return
    this.tokens.delete(platform, r.id)
    try {
      this.d.db.prepare('DELETE FROM accounts WHERE id = ?').run(r.id)
    } catch {
      // A post still points at it: keep the row but make it unusable, so nothing posts without a login.
      this.d.db
        .prepare(
          "UPDATE accounts SET status = 'needs_reauth', token_expires_at = NULL WHERE id = ?",
        )
        .run(r.id)
    }
  }

  /** Platforms (beyond the original four) that this channel has a working login for. */
  connected(brandId: number): ExtraPlatform[] {
    this.ensureBluesky(brandId)
    const rows = this.d.db
      .prepare(
        "SELECT platform FROM accounts WHERE brand_id = ? AND status = 'connected' AND mode != 'dry_run'",
      )
      .all(brandId) as Array<{ platform: string }>
    return EXTRA_PLATFORMS.filter((p) => rows.some((r) => r.platform === p))
  }

  /** Mirrors the Bluesky handle and app password saved in Settings into an account, so Bluesky behaves like the others. */
  ensureBluesky(brandId?: number): void {
    const ids =
      brandId !== undefined
        ? [brandId]
        : (this.d.db.prepare('SELECT id FROM brands').all() as Array<{ id: number }>).map(
            (b) => b.id,
          )
    for (const id of ids) {
      const ok = this.d.bluesky.notReady(id) === null
      const have = this.row(id, 'bluesky')
      if (ok) {
        const handle = this.d.bluesky.handle(id)
        if (!have || have.status !== 'connected' || have.display_name !== handle)
          this.upsert(id, 'bluesky', {
            externalId: handle,
            displayName: handle ? `@${handle}` : null,
          })
      } else if (have && have.status === 'connected') {
        this.drop(id, 'bluesky')
      }
    }
  }

  views(): ExtraAccountView[] {
    this.ensureBluesky()
    const brands = this.d.db
      .prepare('SELECT id, name FROM brands WHERE archived = 0 ORDER BY id')
      .all() as Array<{
      id: number
      name: string
    }>
    const out: ExtraAccountView[] = []
    for (const b of brands)
      for (const platform of EXTRA_PLATFORMS) {
        const r = this.row(b.id, platform)
        out.push({
          brandId: b.id,
          brandName: b.name,
          platform,
          state: !r ? 'not_set' : r.status === 'connected' ? 'connected' : 'needs_reauth',
          displayName: r?.display_name ?? null,
          externalId: r?.external_id ?? null,
          expiresAt: r?.token_expires_at ?? null,
        })
      }
    return out
  }

  // ---------------------------------------------------------------- sign in

  async connect(brandId: number, platform: OAuthPlatform): Promise<ExtraAccountView> {
    if (!OAUTH.includes(platform)) throw new Error(`${platform} does not sign in this way.`)
    const { id, secret } = this.creds(platform)
    this.cancelSignIn?.()
    const state = randomBytes(16).toString('hex')
    const { verifier, challenge } = pkce()
    const url =
      platform === 'x'
        ? this.d.clients.x.authUrl(id, state, challenge)
        : platform === 'linkedin'
          ? this.d.clients.linkedin.authUrl(id, state)
          : this.d.clients.pinterest.authUrl(id, state)
    const w = waitForCallback({
      port: PORTS[platform],
      state,
      onReady: () => this.d.openBrowser(url),
    })
    this.cancelSignIn = w.cancel
    let code: string
    try {
      code = await w.done
    } finally {
      this.cancelSignIn = null
    }
    let grant: TokenGrant
    let externalId: string | null = null
    let name: string
    if (platform === 'x') {
      grant = await this.d.clients.x.exchange(id, secret, code, verifier)
      const me = await this.d.clients.x.me(grant.accessToken)
      externalId = me.id
      name = `@${me.username}`
    } else if (platform === 'linkedin') {
      grant = await this.d.clients.linkedin.exchange(id, secret, code)
      const me = await this.d.clients.linkedin.me(grant.accessToken)
      externalId = me.id
      name = me.name
    } else {
      grant = await this.d.clients.pinterest.exchange(id, secret, code)
      const me = await this.d.clients.pinterest.me(grant.accessToken)
      name = `@${me.username}`
    }
    const t = toStored(grant, this.now())
    const accountId = this.upsert(brandId, platform, {
      // Pinterest keeps its board id in this field, so signing in again does not clear the chosen board.
      ...(platform === 'pinterest' ? {} : { externalId }),
      displayName: name,
      status: 'connected',
      expiresAt: t.expiresAt,
    })
    this.tokens.set(platform, accountId, t)
    this.d.log.log(
      'info',
      `${PLATFORM_LABELS[platform]} connected for brand ${brandId} as ${name}.`,
    )
    this.d.emit()
    return this.view(brandId, platform)
  }

  cancel(): void {
    this.cancelSignIn?.()
  }

  private view(brandId: number, platform: ExtraPlatform): ExtraAccountView {
    return this.views().find(
      (v) => v.brandId === brandId && v.platform === platform,
    ) as ExtraAccountView
  }

  disconnect(brandId: number, platform: ExtraPlatform): void {
    if (platform === 'bluesky')
      throw new Error(
        'Remove the Bluesky login in Settings, under the Studio tab, Bluesky accounts.',
      )
    this.drop(brandId, platform)
    this.d.emit()
  }

  async boards(brandId: number): Promise<Array<{ id: string; name: string }>> {
    const r = this.row(brandId, 'pinterest')
    if (!r) throw new Error('Connect Pinterest for this channel first.')
    return this.d.clients.pinterest.boards(await this.accessToken(r.id))
  }

  setBoard(brandId: number, boardId: string, boardName: string): ExtraAccountView {
    const r = this.row(brandId, 'pinterest')
    if (!r) throw new Error('Connect Pinterest for this channel first.')
    this.d.db
      .prepare('UPDATE accounts SET external_id = ?, display_name = ? WHERE id = ?')
      .run(
        boardId,
        boardName ? `${r.display_name?.split(' · ')[0] ?? ''} · ${boardName}` : r.display_name,
        r.id,
      )
    this.d.emit()
    return this.view(brandId, 'pinterest')
  }

  // ---------------------------------------------------------------- tokens

  /** A working access token for an account. A token near its end is refreshed first (X and Pinterest). */
  accessToken(accountId: number, force = false): Promise<string> {
    const running = this.refreshing.get(accountId)
    if (running) return running
    const p = this.resolveToken(accountId, force).finally(() => this.refreshing.delete(accountId))
    this.refreshing.set(accountId, p)
    return p
  }

  private async resolveToken(accountId: number, force: boolean): Promise<string> {
    const acct = this.d.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
      Row | undefined
    if (!acct) throw new AdapterError('That account is gone. Connect it again.', 'permanent')
    const platform = acct.platform as OAuthPlatform
    const t = this.tokens.get(platform, accountId)
    if (!t)
      throw new AdapterError(
        `${PLATFORM_LABELS[platform]} is not signed in for this channel. Connect it in Setup Channels, on the Connections tab.`,
        'permanent',
      )
    const due = force || (t.expiresAt !== null && t.expiresAt - this.now() < SOON_MS)
    if (!due) return t.accessToken
    if (!t.refreshToken) {
      if (t.expiresAt !== null && t.expiresAt <= this.now()) this.expired(acct, platform)
      return t.accessToken
    }
    const { id, secret } = this.creds(platform)
    try {
      const next =
        platform === 'x'
          ? await this.d.clients.x.refresh(id, secret, t.refreshToken)
          : platform === 'linkedin'
            ? await this.d.clients.linkedin.refresh(id, secret, t.refreshToken)
            : await this.d.clients.pinterest.refresh(id, secret, t.refreshToken)
      const merged: StoredTokens = {
        ...t,
        ...next,
        refreshToken: next.refreshToken ?? t.refreshToken,
      }
      this.tokens.set(platform, accountId, merged)
      this.d.db
        .prepare('UPDATE accounts SET token_expires_at = ? WHERE id = ?')
        .run(merged.expiresAt ? new Date(merged.expiresAt).toISOString() : null, accountId)
      return merged.accessToken
    } catch (e) {
      if (e instanceof AdapterError && e.kind === 'permanent') this.expired(acct, platform)
      throw e
    }
  }

  private expired(acct: Row, platform: OAuthPlatform) {
    this.d.db.prepare("UPDATE accounts SET status = 'needs_reauth' WHERE id = ?").run(acct.id)
    this.d.alert(
      `${PLATFORM_LABELS[platform]} needs you to sign in again`,
      `The saved ${PLATFORM_LABELS[platform]} login for ${this.brandName(acct.brand_id)} stopped working. Open Connections, More platforms, and press Connect.`,
    )
    this.d.emit()
  }

  private brandName(id: number): string {
    return (
      (
        this.d.db.prepare('SELECT name FROM brands WHERE id = ?').get(id) as
          { name: string } | undefined
      )?.name ?? `Channel ${id}`
    )
  }

  /** Once an hour: warns a week before a login that cannot refresh itself (LinkedIn) runs out. */
  checkHealth(): number {
    let n = 0
    const rows = this.d.db
      .prepare(
        "SELECT * FROM accounts WHERE platform IN ('x','linkedin','pinterest') AND status = 'connected'",
      )
      .all() as Row[]
    for (const a of rows) {
      const t = this.tokens.get(a.platform, a.id)
      if (!t) continue
      const end = t.refreshToken ? (t.refreshExpiresAt ?? null) : t.expiresAt
      if (end !== null && end !== undefined && end - this.now() < WARN_MS) {
        const key = `${a.platform}.warned.${a.id}.${new Date(end).toISOString().slice(0, 10)}`
        if (this.d.secrets.has(key)) continue
        this.d.secrets.set(key, '1')
        this.d.alert(
          `${PLATFORM_LABELS[a.platform as ExtraPlatform]} login ends soon`,
          `The ${PLATFORM_LABELS[a.platform as ExtraPlatform]} login for ${this.brandName(a.brand_id)} ends on ${new Date(end).toDateString()}. Press Connect again in Setup Channels, on the Connections tab before then.`,
        )
        n++
      }
    }
    return n
  }
}
