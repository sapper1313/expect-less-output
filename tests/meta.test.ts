import { afterEach, describe, expect, it } from 'vitest'
import { bestMatch, nameSimilarity } from '../src/shared/similarity'
import { classifyMetaError, MetaApiError } from '../src/main/meta/graph'
import { durationProblem } from '../src/shared/platformLimits'
import { META_SECRET_USER_TOKEN, pageTokenKey } from '../src/main/meta/config'
import { connectAndAssign, makeMetaEnv } from './metaHelpers'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})
async function env() {
  const m = await makeMetaEnv()
  closers.push(m.close)
  return m
}
const DAY = 86_400_000

describe('name matching', () => {
  it('pre-matches brands to Pages by name', () => {
    expect(nameSimilarity('Trash Panda', 'Trash Panda Money')).toBeGreaterThan(0.5)
    expect(nameSimilarity('Clock Out Early', 'clock-out early!')).toBe(1)
    expect(nameSimilarity('The Math of It', 'Banana Stand')).toBe(0)
    const pages = ['Banana Stand', 'Clock Out Early Official', 'Trash Panda Money']
    expect(bestMatch('Trash Panda', pages, (p) => p)).toBe('Trash Panda Money')
    expect(bestMatch('Teach Your Parents Tech', pages, (p) => p)).toBeNull()
  })
})

describe('Meta error classification', () => {
  it('maps codes to retry or stop', () => {
    const e = (code: number, extra: object = {}, status = 400) =>
      classifyMetaError(status, { error: { code, message: 'm', ...extra } })
    expect(e(190)).toMatchObject({ kind: 'permanent', needsReauth: true })
    expect(e(100, { error_subcode: 463, type: 'OAuthException' }).needsReauth).toBe(true)
    expect(e(4)).toMatchObject({ kind: 'transient' })
    expect(e(17)).toMatchObject({ kind: 'transient' })
    expect(e(2)).toMatchObject({ kind: 'transient' })
    expect(e(1, { is_transient: true })).toMatchObject({ kind: 'transient' })
    expect(e(9007, { error_subcode: 2207027 })).toMatchObject({ kind: 'transient' })
    expect(e(200)).toMatchObject({ kind: 'permanent' })
    expect(e(10).message).toContain('missing a permission')
    expect(e(368)).toMatchObject({ kind: 'permanent' })
    expect(e(100)).toMatchObject({ kind: 'permanent' })
    expect(classifyMetaError(503, null)).toMatchObject({ kind: 'transient' })
    expect(classifyMetaError(500, null)).toBeInstanceOf(MetaApiError)
  })
})

describe('duration limits', () => {
  it('blocks a 2 minute video for Facebook with a clear message and allows 3 to 90 seconds', () => {
    expect(durationProblem('facebook', 120)).toBe(
      'This video is 120.0 seconds. Facebook Reels must be 3 to 90 seconds. Trim the video or untick Facebook.',
    )
    expect(durationProblem('facebook', 2)).toContain('3 to 90 seconds')
    expect(durationProblem('facebook', 3)).toBeNull()
    expect(durationProblem('facebook', 90)).toBeNull()
    expect(durationProblem('instagram', 2)).toContain('3 seconds to 15 minutes')
    expect(durationProblem('instagram', 901)).toContain('15 minutes')
    expect(durationProblem('instagram', 120)).toBeNull()
  })
})

describe('connect Meta', () => {
  it('logs in once, makes a long lived token, lists Pages with their Instagram accounts, and stores tokens encrypted', async () => {
    const m = await env()
    m.fake.state.pages.push({
      id: 'P2',
      name: 'Clock Out Early',
      token: 'page-token-P2',
      ig: { id: 'IG2', username: 'clockoutearly' },
    })
    m.fake.state.pages.push({ id: 'P3', name: 'No Instagram Page', token: 'page-token-P3' })
    m.fake.state.accountsPageSize = 1 // forces paging
    const st = await m.service.connect()
    expect(st.connected).toBe(true)
    expect(st.userName).toBe('Test Owner')
    expect(st.pages.map((p) => p.name)).toEqual([
      'Clock Out Early',
      'No Instagram Page',
      'Trash Panda Money',
    ])
    expect(st.pages.find((p) => p.pageId === 'P1')).toMatchObject({
      igId: 'IG1',
      igUsername: 'trashpanda',
    })
    expect(st.pages.find((p) => p.pageId === 'P3')!.igId).toBeNull()
    expect(m.fake.state.requests.some((r) => r.params.grant_type === 'fb_exchange_token')).toBe(
      true,
    )
    expect(m.secrets.has(META_SECRET_USER_TOKEN)).toBe(true)
    expect(m.secrets.has(pageTokenKey('P2'))).toBe(true)
    expect(JSON.stringify(m.secrets.status([META_SECRET_USER_TOKEN]))).not.toContain('long-')
    await new Promise((r) => setTimeout(r, 50))
    expect(m.browserPages[0]).toContain('Connected.')
    expect(m.browserPages[0]).toContain('You can close this tab and return to Expect Less Output.')
    expect(st.missingPermissions).toEqual([])
    expect(st.daysLeft).not.toBeNull()
  })

  it('suggests the matching Page and Instagram for each brand', async () => {
    const m = await env()
    m.fake.state.pages.push({
      id: 'P2',
      name: 'Clock Out Early',
      token: 't2',
      ig: { id: 'IG2', username: 'clockoutearly' },
    })
    const st = await m.service.connect()
    expect(st.suggestions.find((s) => s.brandId === 1)).toMatchObject({ pageId: 'P1', igId: 'IG1' })
    expect(st.suggestions.find((s) => s.brandId === 2)).toMatchObject({ pageId: 'P2', igId: 'IG2' })
    expect(st.suggestions.find((s) => s.brandId === 3)).toMatchObject({ pageId: null })
  })

  it('assigns Pages and Instagram accounts to brands and makes those accounts live', async () => {
    const m = await env()
    const st = await connectAndAssign(m, 1)
    const fb = m.env.db
      .prepare("SELECT * FROM accounts WHERE brand_id = 1 AND platform = 'facebook'")
      .get() as any
    const ig = m.env.db
      .prepare("SELECT * FROM accounts WHERE brand_id = 1 AND platform = 'instagram'")
      .get() as any
    expect(fb).toMatchObject({
      external_id: 'P1',
      display_name: 'Trash Panda Money',
      mode: 'live',
      status: 'connected',
      token_ref: 'meta.page.P1',
    })
    expect(ig).toMatchObject({
      external_id: 'IG1',
      display_name: '@trashpanda',
      mode: 'live',
      token_ref: 'meta.page.P1',
    })
    expect(st.pages[0].facebookBrandId).toBe(1)
    // another brand cannot take the same Page
    expect(() => m.service.assign(2, 'P1', null)).toThrow(/already used by Trash Panda/)
    // un-assigning goes back to a dry run placeholder
    m.service.assign(1, null, null)
    expect(
      (
        m.env.db
          .prepare("SELECT mode FROM accounts WHERE brand_id = 1 AND platform = 'facebook'")
          .get() as any
      ).mode,
    ).toBe('dry_run')
  })

  it('reports missing permissions and empty Page lists clearly', async () => {
    const m = await env()
    m.fake.state.scopes = ['pages_show_list', 'instagram_basic']
    const st = await m.service.connect()
    expect(st.missingPermissions).toEqual(
      expect.arrayContaining(['pages_manage_posts', 'instagram_content_publish']),
    )
    const m2 = await env()
    m2.fake.state.pages = []
    await expect(m2.service.connect()).rejects.toThrow(/did not list any Pages/)
  })

  it('explains bad credentials, a missing App ID and cancel', async () => {
    const m = await env()
    m.fake.state.appSecret = 'something-else'
    await expect(m.service.connect()).rejects.toThrow(/client secret/i)
    expect(() => m.service.saveCredentials('abc', 'x')).toThrow(/only numbers/)
    const m3 = await env()
    m3.service['d'].openBrowser = async () => {}
    const p = m3.service.connect()
    setTimeout(() => m3.service.cancelConnect(), 100)
    await expect(p).rejects.toThrow(/canceled/)
  })

  it('stores App ID and Secret encrypted, shown masked', async () => {
    const m = await env()
    const st = m.service.saveCredentials('999888777666555', 'topsecretmetavalue')
    expect(st.hasAppId && st.hasAppSecret).toBe(true)
    expect(JSON.stringify(st)).not.toContain('topsecret')
    expect(st.appSecretMasked.endsWith('alue')).toBe(true)
  })

  it('disconnect withdraws access, deletes tokens and returns accounts to dry run', async () => {
    const m = await env()
    await connectAndAssign(m, 1)
    await m.service.disconnect()
    expect(m.fake.state.revokedPermissions).toBe(1)
    expect(m.secrets.has(META_SECRET_USER_TOKEN)).toBe(false)
    expect(m.secrets.has(pageTokenKey('P1'))).toBe(false)
    expect(m.service.status().connected).toBe(false)
    expect(
      (
        m.env.db
          .prepare("SELECT mode FROM accounts WHERE brand_id = 1 AND platform = 'instagram'")
          .get() as any
      ).mode,
    ).toBe('dry_run')
  })
})

describe('token expiry warning (mocked date)', () => {
  const setExpiry = (m: Awaited<ReturnType<typeof env>>, inDays: number) => {
    m.fake.state.expiresAt = Math.floor((m.env.clock.ms + inDays * DAY) / 1000)
  }

  it('is quiet with plenty of time, then warns at 7 days, once a day', async () => {
    const m = await env()
    setExpiry(m, 59)
    await m.service.connect()
    await m.service.checkHealth()
    expect(m.service.status()).toMatchObject({ daysLeft: 59, expiringSoon: false })
    expect(m.alerts).toHaveLength(0)

    m.env.clock.ms += 52 * DAY // 7 days left
    await m.service.checkHealth()
    expect(m.service.status()).toMatchObject({ daysLeft: 7, expiringSoon: true })
    expect(m.alerts).toHaveLength(1)
    expect(m.alerts[0][0]).toBe('Meta sign-in runs out soon.')
    expect(m.alerts[0][1]).toContain('7 days')
    expect(m.alerts[0][1]).toContain('Reconnect Meta')

    await m.service.checkHealth() // same day: no second alert
    expect(m.alerts).toHaveLength(1)

    m.env.clock.ms += DAY // next day
    await m.service.checkHealth()
    expect(m.alerts).toHaveLength(2)
    expect(m.alerts[1][1]).toContain('6 days')
  })

  it('says it has expired once the date is past', async () => {
    const m = await env()
    setExpiry(m, 30)
    await m.service.connect()
    m.env.clock.ms += 31 * DAY
    m.service.warnIfExpiring()
    expect(m.service.status().expiringSoon).toBe(true)
    expect(m.alerts[0][1]).toContain('expired')
  })

  it('uses the earlier of the login and data access dates', async () => {
    const m = await env()
    m.fake.state.expiresAt = Math.floor((m.env.clock.ms + 60 * DAY) / 1000)
    m.fake.state.dataAccessExpiresAt = Math.floor((m.env.clock.ms + 5 * DAY) / 1000)
    await m.service.connect()
    expect(m.service.status().daysLeft).toBe(5)
  })

  it('flags every Meta account when the login is rejected (error 190), with one alert', async () => {
    const m = await env()
    await connectAndAssign(m, 1)
    m.fake.state.invalidToken = true
    await m.service.checkHealth()
    expect(m.service.status().status).toBe('needs_reauth')
    expect(
      (
        m.env.db
          .prepare("SELECT status FROM accounts WHERE brand_id = 1 AND platform = 'instagram'")
          .get() as any
      ).status,
    ).toBe('needs_reauth')
    expect(m.alerts.filter((a) => a[0] === 'Meta needs you to sign in again.')).toHaveLength(1)
    await m.service.checkHealth()
    expect(m.alerts.filter((a) => a[0] === 'Meta needs you to sign in again.')).toHaveLength(1)
    // a fresh login fixes it
    m.fake.state.invalidToken = false
    await m.service.connect()
    expect(
      (
        m.env.db
          .prepare("SELECT status FROM accounts WHERE brand_id = 1 AND platform = 'instagram'")
          .get() as any
      ).status,
    ).toBe('connected')
  })
})

describe('Meta error detail', () => {
  it('reads the upload host reply and never hides an empty one', () => {
    const upload = classifyMetaError(400, { debug_info: { message: 'The video codec is not supported', type: 'ProcessingFailedError', retriable: false } })
    expect(upload.message).toContain('The video codec is not supported')
    expect(upload.message).toContain('ProcessingFailedError')
    expect(classifyMetaError(400, { error: { code: 100, error_data: { details: 'Caption is too long' } } }).message).toContain('Caption is too long')
    expect(classifyMetaError(400, { unexpected: 'shape' } as never).message).toContain('"unexpected":"shape"')
    expect(classifyMetaError(400, null).message).toContain('Meta sent no message at all (HTTP 400)')
  })
})

