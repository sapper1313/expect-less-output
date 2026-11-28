import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SecretStore } from '../src/main/services/secrets'
import { EtsyAuth, ETSY_SCOPES } from '../src/main/ventures/etsy/oauth'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CREDS = { keystring: 'KEYSTRING123', sharedSecret: 'SHAREDSECRET456' }
const fakeCrypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from('enc:' + s),
  decryptString: (b: Buffer) => b.toString().slice(4),
}
const newSecrets = () => new SecretStore(join(mkdtempSync(join(tmpdir(), 'elo-sec-')), 's.json'), fakeCrypto)
const tokenResp = (over: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ access_token: '777.ACCESSTOKEN', refresh_token: '777.REFRESHTOKEN', expires_in: 3600, token_type: 'Bearer', ...over }), { status: 200 })

function make(opts: { now?: () => number; fetch?: typeof fetch; credentials?: typeof CREDS | null } = {}) {
  const opened: string[] = []
  const secrets = newSecrets()
  const auth = new EtsyAuth({
    secrets,
    now: opts.now ?? (() => 1_000_000),
    openUrl: (u) => void opened.push(u),
    credentials: () => (opts.credentials === undefined ? CREDS : opts.credentials),
    redirectUri: 'http://127.0.0.1:38487/callback',
    fetch: opts.fetch,
  })
  return { auth, secrets, opened }
}

describe('EtsyAuth.begin', () => {
  it('builds an authorize URL with PKCE S256, the exact scopes and a state', () => {
    const { auth } = make()
    const b = auth.begin()
    const u = new URL(b.url)
    expect(u.origin + u.pathname).toBe('https://www.etsy.com/oauth/connect')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('scope')).toBe('listings_r listings_w transactions_r shops_r profile_r')
    expect(ETSY_SCOPES).toBe('listings_r listings_w transactions_r shops_r profile_r')
    expect(u.searchParams.get('client_id')).toBe('KEYSTRING123')
    expect(u.searchParams.get('state')).toBe(b.state)
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(b.url).not.toContain('SHAREDSECRET')
  })
  it('makes a verifier that hashes to the challenge', () => {
    const { auth } = make()
    const b = auth.begin()
    const challenge = new URL(b.url).searchParams.get('code_challenge')
    expect(b.verifier.length).toBeGreaterThanOrEqual(43)
    expect(createHash('sha256').update(b.verifier).digest('base64url')).toBe(challenge)
  })
  it('says so plainly when no keys are set up', () => {
    const { auth } = make({ credentials: null })
    expect(() => auth.begin()).toThrow('Etsy keys are not set up yet.')
  })
})

describe('EtsyAuth.finish', () => {
  const shopFetch = (async (url: string) =>
    String(url).includes('/oauth/token')
      ? tokenResp()
      : new Response(JSON.stringify({ shop_id: 55, shop_name: 'MyShop' }), { status: 200 })) as unknown as typeof fetch
  it('rejects a callback with the wrong state', async () => {
    const { auth } = make({ fetch: shopFetch })
    const b = auth.begin()
    await expect(b.finish(new URLSearchParams({ code: 'c', state: 'WRONG' }))).rejects.toThrow(/did not start here/)
  })
  it('stores tokens encrypted and reports the shop', async () => {
    const { auth, secrets } = make({ fetch: shopFetch })
    const b = auth.begin()
    const r = await b.finish(new URLSearchParams({ code: 'c', state: b.state }))
    expect(r).toEqual({ shopId: '55', shopName: 'MyShop' })
    expect(secrets.has('ventures.etsy.tokens')).toBe(true)
    const st = auth.status()
    expect(st.mode).toBe('connected')
    expect(st.shopName).toBe('MyShop')
    expect(JSON.stringify(st)).not.toContain('ACCESSTOKEN')
    expect(JSON.stringify(st)).not.toContain('REFRESHTOKEN')
  })
})

describe('EtsyAuth.accessToken', () => {
  const connected = async (now: { t: number }, calls: string[]) => {
    const f = (async (url: string, init: any) => {
      calls.push(String(init?.body ?? ''))
      if (String(url).includes('/oauth/token'))
        return String(init.body).includes('refresh_token')
          ? tokenResp({ access_token: '777.NEWACCESS', refresh_token: '777.NEWREFRESH' })
          : tokenResp()
      return new Response(JSON.stringify({ shop_id: 55, shop_name: 'MyShop' }), { status: 200 })
    }) as unknown as typeof fetch
    const h = make({ now: () => now.t, fetch: f })
    const b = h.auth.begin()
    await b.finish(new URLSearchParams({ code: 'c', state: b.state }))
    return h
  }
  it('uses the saved token while it is fresh', async () => {
    const now = { t: 1_000_000 }
    const calls: string[] = []
    const { auth } = await connected(now, calls)
    const before = calls.length
    expect(await auth.accessToken()).toBe('777.ACCESSTOKEN')
    expect(calls.length).toBe(before)
  })
  it('refreshes exactly once when under five minutes from expiry', async () => {
    const now = { t: 1_000_000 }
    const calls: string[] = []
    const { auth } = await connected(now, calls)
    const before = calls.filter((c) => c.includes('refresh_token')).length
    now.t += 3_600_000 - 60_000
    expect(await auth.accessToken()).toBe('777.NEWACCESS')
    expect(await auth.accessToken()).toBe('777.NEWACCESS')
    expect(calls.filter((c) => c.includes('refresh_token')).length - before).toBe(1)
  })
  it('goes to needs_reauth when the refresh fails and keeps secrets out of the error', async () => {
    const now = { t: 1_000_000 }
    const alerts: string[] = []
    const f = (async (url: string) =>
      String(url).includes('/oauth/token') && now.t > 1_000_000
        ? new Response('{"error":"invalid_grant SHAREDSECRET456 777.REFRESHTOKEN"}', { status: 400 })
        : String(url).includes('/oauth/token')
          ? tokenResp()
          : new Response(JSON.stringify({ shop_id: 55, shop_name: 'MyShop' }), { status: 200 })) as unknown as typeof fetch
    const secrets = newSecrets()
    const auth = new EtsyAuth({ secrets, now: () => now.t, openUrl: () => {}, credentials: () => CREDS, redirectUri: 'http://127.0.0.1:38487/callback', fetch: f, onReauth: () => void alerts.push('x') })
    const b = auth.begin()
    await b.finish(new URLSearchParams({ code: 'c', state: b.state }))
    now.t += 3_600_000
    const err = (await auth.accessToken().catch((e) => e)) as Error
    expect(err.message).toMatch(/sign in again/i)
    expect(err.message).not.toContain('SHAREDSECRET')
    expect(err.message).not.toContain('REFRESHTOKEN')
    expect(auth.status().mode).toBe('needs_reauth')
    expect(alerts).toHaveLength(1)
    await auth.accessToken().catch(() => {})
    expect(alerts).toHaveLength(1)
  })
  it('disconnect forgets everything', async () => {
    const now = { t: 1_000_000 }
    const { auth, secrets } = await connected(now, [])
    auth.disconnect()
    expect(secrets.has('ventures.etsy.tokens')).toBe(false)
    expect(auth.status().mode).toBe('not_connected')
  })
})
