import { readFileSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ROUTES } from '../src/shared/agentRoutes'
import { buildOpenApi } from '../src/shared/openapi'
import { HANDLERS } from '../src/main/agent/handlers'
import { makeAgentEnv } from './agentHelpers'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})
async function env(patch: Record<string, unknown> = {}) {
  const a = await makeAgentEnv(patch)
  closers.push(a.close)
  return a
}
const MIN = 60_000
const HOUR = 60 * MIN

describe('the API is safe by default', () => {
  it('is off in the default settings', async () => {
    const { DEFAULT_SETTINGS } = await import('../src/main/services/settings')
    expect(DEFAULT_SETTINGS.agentApiEnabled).toBe(false)
    expect(DEFAULT_SETTINGS.agentMaySchedule).toBe(false)
    expect(DEFAULT_SETTINGS.agentApiPort).toBe(47821)
  })

  it('does not listen when off, and listens on 127.0.0.1 only when on', async () => {
    const a = await env()
    expect(a.runtime.server.address()?.address).toBe('127.0.0.1')
    await a.runtime.server.stop()
    await expect(a.api('GET', '/v1/brands')).rejects.toThrow()
    expect(a.runtime.server.running).toBe(false)
  })

  it('rejects requests without the token, and with a wrong one', async () => {
    const a = await env()
    expect((await a.api('GET', '/v1/brands', undefined, null)).status).toBe(401)
    const wrong = await a.api('GET', '/v1/brands', undefined, 'elo_wrong')
    expect(wrong.status).toBe(401)
    expect(wrong.json.error.code).toBe('unauthorized')
    expect((await a.api('GET', '/v1/brands')).status).toBe(200)
    expect((await a.raw('GET', '/v1/brands', { headers: { Authorization: a.token } })).status).toBe(
      401,
    ) // no "Bearer"
  })

  it('answers 401 with a helpful message when no token exists yet', async () => {
    const a = await env()
    a.secrets.delete('agent.token')
    const r = await a.api('GET', '/v1/brands', undefined, 'anything')
    expect(r.status).toBe(401)
    expect(r.json.error.message).toContain('No token has been generated')
  })

  it('refuses browser requests (Origin header) and the wrong Host, even with a good token', async () => {
    const a = await env()
    const auth = { Authorization: `Bearer ${a.token}` }
    const origin = await a.raw('GET', '/v1/brands', {
      headers: { ...auth, Origin: 'https://evil.example' },
    })
    expect(origin.status).toBe(403)
    const host = await a.raw('GET', '/v1/brands', { headers: { ...auth, Host: 'evil.example' } })
    expect(host.status).toBe(403)
    const localhost = await a.raw('GET', '/v1/brands', {
      headers: { ...auth, Host: `localhost:${a.port}` },
    })
    expect(localhost.status).toBe(200)
  })

  it('a new token cancels the old one', async () => {
    const a = await env()
    const old = a.token
    const fresh = a.runtime.generateToken()
    expect(fresh).not.toBe(old)
    expect((await a.api('GET', '/v1/brands', undefined, old)).status).toBe(401)
    expect((await a.api('GET', '/v1/brands', undefined, fresh)).status).toBe(200)
    expect(a.runtime.status().tokenMasked).not.toContain(fresh.slice(4, 20))
  })

  it('has no way to delete, change accounts, credentials or settings', async () => {
    const a = await env()
    for (const [m, p] of [
      ['DELETE', '/v1/posts/1'],
      ['GET', '/v1/accounts'],
      ['POST', '/v1/accounts/1/disconnect'],
      ['POST', '/v1/settings'],
      ['POST', '/v1/credentials'],
      ['GET', '/v1/files'],
    ] as const) {
      const r = await a.api(m, p, m === 'GET' ? undefined : {})
      expect([404, 405]).toContain(r.status)
    }
  })

  it('every route has a handler, and every handler has a route', () => {
    expect(Object.keys(HANDLERS).sort()).toEqual(ROUTES.map((r) => r.id).sort())
  })

  it('docs/openapi.json matches the schemas (run npm run openapi when it does not)', () => {
    const committed = JSON.parse(
      readFileSync(join(__dirname, '..', 'docs', 'openapi.json'), 'utf8'),
    )
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApi())))
  })
})

describe('reading', () => {
  it('lists brands with slots, defaults and connected platforms', async () => {
    const a = await env()
    a.env.db
      .prepare(
        "UPDATE accounts SET mode='auto', display_name='TP Channel' WHERE brand_id=1 AND platform='youtube'",
      )
      .run()
    a.env.settings.set({ pausedBrandIds: [2], inboxBrandIds: [1] })
    const r = await a.api('GET', '/v1/brands')
    expect(r.json.brands).toHaveLength(4)
    const tp = r.json.brands[0]
    expect(tp).toMatchObject({ name: 'Trash Panda', paused: false, inbox_enabled: true })
    expect(tp.slots).toContainEqual({ day_type: 'weekday', time_local: '08:00', enabled: true })
    expect(tp.defaults.caption_template).toBe('{title}\n\n{hashtags}')
    expect(tp.platforms.find((p: any) => p.platform === 'youtube')).toMatchObject({
      connected: true,
      mode: 'auto',
      account_name: 'TP Channel',
    })
    expect(tp.platforms.find((p: any) => p.platform === 'tiktok')).toMatchObject({
      connected: false,
      mode: 'dry_run',
    })
    expect(r.json.brands[1].paused).toBe(true)
  })

  it('returns the next open slots, skipping taken ones', async () => {
    const a = await env()
    const first = await a.api('GET', '/v1/slots/next-open?brand_id=1&count=3')
    expect(first.json.slots).toHaveLength(3)
    expect(first.json.slots[0].eastern).toMatch(/ET$/)
    expect(first.json.slots.map((s: any) => s.at)).toEqual(a.env.posts.nextSlots(1, 3))
    await a.env.makePost({
      whenMs: new Date(first.json.slots[0].at).getTime(),
      platforms: ['instagram'],
    })
    const second = await a.api('GET', '/v1/slots/next-open?brand_id=1&count=1')
    expect(second.json.slots[0].at).toBe(first.json.slots[1].at)
    expect((await a.api('GET', '/v1/slots/next-open?brand_id=99&count=1')).status).toBe(404)
    expect((await a.api('GET', '/v1/slots/next-open')).status).toBe(400)
  })

  it('health shows accounts, quota, scheduler and the agent rule', async () => {
    const a = await env()
    a.env.db
      .prepare(
        "UPDATE accounts SET mode='drafts', display_name='TT' WHERE brand_id=1 AND platform='tiktok'",
      )
      .run()
    const r = await a.api('GET', '/v1/health')
    expect(r.json).toMatchObject({
      app_version: '9.9.9',
      agents: { drafts_only: true },
      youtube_quota: { uploads_used: 2, uploads_limit: 100 },
    })
    expect(r.json.accounts).toEqual([
      {
        brand: 'Trash Panda',
        platform: 'tiktok',
        account: 'TT',
        status: 'connected',
        mode: 'drafts',
        last_checked_at: null,
        login_expires_at: null,
      },
    ])
    expect(r.json.scheduler).toMatchObject({ paused: false, pending_posts: 0, next_post: null })
  })

  it('serves the OpenAPI document to authorized callers', async () => {
    const a = await env()
    const r = await a.api('GET', '/v1/openapi.json')
    expect(r.json.openapi).toBe('3.0.3')
    expect(Object.keys(r.json.paths)).toContain('/v1/posts/{id}')
  })
})

describe('creating posts', () => {
  const body = (a: Awaited<ReturnType<typeof env>>, extra: Record<string, unknown> = {}) => ({
    brand_id: 1,
    file_path: a.video(),
    ...extra,
  })

  it('creates a draft by default, with defaults filled in, and copies the video', async () => {
    const a = await env()
    const file = a.video('my_cool-clip.mp4')
    const r = await a.api('POST', '/v1/posts', { brand_id: 1, file_path: file })
    expect(r.status).toBe(201)
    expect(r.json).toMatchObject({
      brand_id: 1,
      status: 'draft',
      title: 'My Cool Clip',
      scheduled_at: null,
      file_name: 'my_cool-clip.mp4',
    })
    expect(r.json.targets.map((t: any) => t.platform).sort()).toEqual([
      'facebook',
      'instagram',
      'tiktok',
      'youtube',
    ])
    expect(a.env.library.resolve(a.env.posts.get(r.json.id)!.videoPath)).toContain('/Queue/')
    expect(readFileSync(file, 'utf8')).toBe('fake video bytes') // original untouched
    expect(
      a.env.log
        .list({ limit: 5 })
        .some((l) => l.message.includes('Agent (api): created draft post "My Cool Clip"')),
    ).toBe(true)
  })

  it('honors title, caption, platforms, overrides, AI flags, TikTok choices and cover frame', async () => {
    const a = await env()
    const r = await a.api(
      'POST',
      '/v1/posts',
      body(a, {
        title: 'Fridge Math',
        caption: 'Do the math',
        platforms: ['instagram', 'tiktok'],
        caption_overrides: { instagram: 'IG only' },
        ai_flags: { instagram: true },
        thumb_offset_ms: 1500,
        tiktok: { privacy: 'SELF_ONLY', allow_comment: true },
      }),
    )
    expect(r.status).toBe(201)
    expect(r.json.targets.map((t: any) => [t.platform, t.caption_override, t.ai_flag])).toEqual([
      ['instagram', 'IG only', true],
      ['tiktok', null, false],
    ])
    const saved = a.env.posts.get(r.json.id)!
    expect(saved.targets.find((t) => t.platform === 'instagram')!.settings.thumbOffsetMs).toBe(1500)
    expect(saved.targets.find((t) => t.platform === 'tiktok')!.settings.tiktok).toMatchObject({
      privacy: 'SELF_ONLY',
      allowComment: true,
      consent: false,
    })
  })

  describe('drafts only (the default)', () => {
    it('refuses status scheduled with 403 drafts_only and creates nothing', async () => {
      const a = await env()
      const r = await a.api(
        'POST',
        '/v1/posts',
        body(a, {
          status: 'scheduled',
          scheduled_at: new Date(a.env.clock.ms + HOUR).toISOString(),
        }),
      )
      expect(r.status).toBe(403)
      expect(r.json.error.code).toBe('drafts_only')
      expect(r.json.error.message).toContain('limited to drafts')
      expect(a.env.posts.list()).toHaveLength(0)
    })

    it('refuses next_slot true with 403 drafts_only, never silently making a draft', async () => {
      const a = await env()
      const r = await a.api('POST', '/v1/posts', body(a, { next_slot: true }))
      expect(r.status).toBe(403)
      expect(r.json.error.code).toBe('drafts_only')
      expect(a.env.posts.list()).toHaveLength(0)
      const both = await a.api(
        'POST',
        '/v1/posts',
        body(a, { status: 'scheduled', next_slot: true }),
      )
      expect(both.status).toBe(403)
    })

    it('still allows a draft that carries a proposed time', async () => {
      const a = await env()
      const at = new Date(a.env.clock.ms + 3 * HOUR).toISOString()
      const r = await a.api('POST', '/v1/posts', body(a, { scheduled_at: at }))
      expect(r.status).toBe(201)
      expect(r.json).toMatchObject({ status: 'draft', scheduled_at: at })
    })

    it('does not let an agent schedule by editing a draft or touch a scheduled post', async () => {
      const a = await env()
      const draft = (await a.api('POST', '/v1/posts', body(a))).json
      const at = new Date(a.env.clock.ms + 3 * HOUR).toISOString()
      const r = await a.api('PATCH', `/v1/posts/${draft.id}`, {
        status: 'scheduled',
        scheduled_at: at,
      })
      expect(r.status).toBe(403)
      expect(r.json.error.code).toBe('drafts_only')
      expect(a.env.posts.get(draft.id)!.status).toBe('draft')
      const owner = await a.env.makePost({
        whenMs: a.env.clock.ms + HOUR,
        platforms: ['instagram'],
      })
      const edit = await a.api('PATCH', `/v1/posts/${owner.id}`, { title: 'Hijack' })
      expect(edit.status).toBe(403)
      expect(a.env.posts.get(owner.id)!.title).toBe('Test Clip')
    })
  })

  describe('agents may schedule', () => {
    it('next_slot true lands in the correct slot and shows on the calendar', async () => {
      const a = await env({ agentMaySchedule: true })
      const expected = a.env.posts.nextSlots(1, 2)
      const r1 = await a.api('POST', '/v1/posts', body(a, { next_slot: true, status: 'scheduled' }))
      expect(r1.status).toBe(201)
      expect(r1.json).toMatchObject({ status: 'scheduled', scheduled_at: expected[0] })
      const r2 = await a.api('POST', '/v1/posts', body(a, { next_slot: true, status: 'scheduled' }))
      expect(r2.json.scheduled_at).toBe(expected[1]) // the first slot is taken now
      const cal = await a.api(
        'GET',
        `/v1/calendar?brand_id=1&from=${encodeURIComponent('2026-05-01T00:00:00Z')}&to=${encodeURIComponent('2026-12-31T00:00:00Z')}`,
      )
      expect(cal.json.events.map((e: any) => e.start)).toEqual([expected[0], expected[1]])
      expect(cal.json.events[0]).toMatchObject({ brand_name: 'Trash Panda', status: 'scheduled' })
      expect(a.env.posts.get(r1.json.id)!.scheduledAtUtc).toBe(expected[0])
    })

    it('accepts an explicit time in any zone and stores UTC', async () => {
      const a = await env({ agentMaySchedule: true })
      const r = await a.api(
        'POST',
        '/v1/posts',
        body(a, { status: 'scheduled', scheduled_at: '2026-07-01T17:00:00-04:00' }),
      )
      expect(r.json.scheduled_at).toBe('2026-07-01T21:00:00.000Z')
      expect(r.json.scheduled_at_eastern).toBe('Wed Jul 1, 5:00 PM ET')
    })

    it('rejects times without a zone, and past times', async () => {
      const a = await env({ agentMaySchedule: true })
      const naive = await a.api(
        'POST',
        '/v1/posts',
        body(a, { status: 'scheduled', scheduled_at: '2026-07-01T17:00:00' }),
      )
      expect(naive.status).toBe(400)
      expect(JSON.stringify(naive.json.error.details)).toContain('with a zone')
      const past = await a.api(
        'POST',
        '/v1/posts',
        body(a, { status: 'scheduled', scheduled_at: '2020-01-01T00:00:00Z' }),
      )
      expect(past.status).toBe(400)
      expect(past.json.error.message).toContain('in the past')
    })

    it('warns when a brand already has many posts that day, and PATCH can schedule a draft', async () => {
      const a = await env({ agentMaySchedule: true })
      const at = new Date(a.env.clock.ms + 2 * HOUR).toISOString()
      let last: any
      for (let i = 0; i < 5; i++)
        last = await a.api('POST', '/v1/posts', body(a, { status: 'scheduled', scheduled_at: at }))
      expect(last.json.warnings[0]).toContain('already has 4 or more posts that day')
      const draft = (await a.api('POST', '/v1/posts', body(a))).json
      const ok = await a.api('PATCH', `/v1/posts/${draft.id}`, {
        status: 'scheduled',
        scheduled_at: at,
        title: 'Now Scheduled',
      })
      expect(ok.status).toBe(200)
      expect(ok.json).toMatchObject({ status: 'scheduled', title: 'Now Scheduled' })
    })

    it('a scheduled status without any time is a validation error', async () => {
      const a = await env({ agentMaySchedule: true })
      const r = await a.api('POST', '/v1/posts', body(a, { status: 'scheduled' }))
      expect(r.status).toBe(400)
      expect(r.json.error.code).toBe('validation')
    })
  })

  describe('bad input', () => {
    it('rejects unknown fields, bad platforms, bad brands, and non-JSON', async () => {
      const a = await env()
      const unknown = await a.api('POST', '/v1/posts', body(a, { surprise: true }))
      expect(unknown.status).toBe(400)
      expect(unknown.json.error.code).toBe('validation')
      expect((await a.api('POST', '/v1/posts', body(a, { platforms: ['myspace'] }))).status).toBe(
        400,
      )
      expect((await a.api('POST', '/v1/posts', body(a, { brand_id: 99 }))).json.error.code).toBe(
        'not_found',
      )
      const text = await a.raw('POST', '/v1/posts', {
        headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'text/plain' },
        body: 'hi',
      })
      expect(text.status).toBe(400)
    })

    it('rejects relative paths, missing files, symlinks and non-video files', async () => {
      const a = await env()
      const code = async (file_path: string) =>
        (await a.api('POST', '/v1/posts', { brand_id: 1, file_path })).json.error.message as string
      expect(await code('clip.mp4')).toContain('absolute path')
      expect(await code('/nope/missing.mp4')).toContain('No file exists')
      expect(await code(a.video('notes.txt'))).toContain('.mp4 or .mov')
      expect(await code(a.link(a.video()))).toContain('symlink')
      expect(a.env.posts.list()).toHaveLength(0)
    })

    it('rejects a platform that is not connected for the brand and one needing sign in', async () => {
      const a = await env()
      a.env.db
        .prepare(
          "UPDATE accounts SET mode='live', status='needs_reauth' WHERE brand_id=1 AND platform='facebook'",
        )
        .run()
      const r = await a.api('POST', '/v1/posts', body(a, { platforms: ['facebook'] }))
      expect(r.status).toBe(400)
      expect(r.json.error.message).toContain('needs the owner to sign in again')
    })
  })
})

describe('managing posts', () => {
  const make = async (a: Awaited<ReturnType<typeof env>>) =>
    (await a.api('POST', '/v1/posts', { brand_id: 1, file_path: a.video() })).json

  it('lists with filters, gets one, and 404s on a missing one', async () => {
    const a = await env()
    const d = await make(a)
    await a.env.makePost({
      brandId: 2,
      whenMs: a.env.clock.ms + HOUR,
      platforms: ['instagram'],
      title: 'Other Brand',
    })
    expect((await a.api('GET', '/v1/posts')).json.posts).toHaveLength(2)
    expect((await a.api('GET', '/v1/posts?brand_id=1')).json.posts.map((p: any) => p.id)).toEqual([
      d.id,
    ])
    expect(
      (await a.api('GET', '/v1/posts?status=scheduled')).json.posts.map((p: any) => p.title),
    ).toEqual(['Other Brand'])
    expect((await a.api('GET', '/v1/posts?search=other')).json.posts).toHaveLength(1)
    expect((await a.api('GET', '/v1/posts?status=nonsense')).status).toBe(400)
    expect((await a.api('GET', `/v1/posts/${d.id}`)).json.id).toBe(d.id)
    expect((await a.api('GET', '/v1/posts/9999')).status).toBe(404)
    expect((await a.api('GET', '/v1/posts/abc')).status).toBe(400)
  })

  it('patches a draft: title, caption, platforms, overrides, flags', async () => {
    const a = await env()
    const d = await make(a)
    const r = await a.api('PATCH', `/v1/posts/${d.id}`, {
      title: 'New',
      caption: 'C',
      platforms: ['tiktok', 'instagram'],
      caption_overrides: { tiktok: 'TT text' },
      ai_flags: { instagram: true },
    })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ title: 'New', caption: 'C' })
    expect(
      r.json.targets.map((t: any) => [t.platform, t.caption_override, t.ai_flag]).sort(),
    ).toEqual([
      ['instagram', null, true],
      ['tiktok', 'TT text', false],
    ])
    expect((await a.api('PATCH', `/v1/posts/${d.id}`, {})).status).toBe(400)
    expect((await a.api('PATCH', '/v1/posts/9999', { title: 'x' })).status).toBe(404)
  })

  it('cancels a post (nothing is deleted) and refuses to cancel twice or a posted one', async () => {
    const a = await env()
    const d = await make(a)
    const c = await a.api('POST', `/v1/posts/${d.id}/cancel`, {})
    expect(c.status).toBe(200)
    expect(c.json.status).toBe('canceled')
    expect(a.env.library.resolve(a.env.posts.get(d.id)!.videoPath)).toBeTruthy()
    expect((await a.api('POST', `/v1/posts/${d.id}/cancel`, {})).status).toBe(409)
    a.env.db.prepare("UPDATE posts SET status='posted' WHERE id = ?").run(d.id)
    expect((await a.api('POST', `/v1/posts/${d.id}/cancel`, {})).status).toBe(409)
  })

  it('retries failed platforms, and says when nothing failed', async () => {
    const a = await env()
    a.env.settings.set({ dryRunFailPlatform: 'instagram', dryRunFailKind: 'permanent' })
    const p = await a.env.makePost({ whenMs: a.env.clock.ms + MIN, platforms: ['instagram'] })
    expect((await a.api('POST', `/v1/posts/${p.id}/retry`, {})).status).toBe(409)
    a.env.clock.ms += 2 * MIN
    await a.env.scheduler.tick()
    expect(a.env.posts.get(p.id)!.status).toBe('failed')
    a.env.settings.set({ dryRunFailPlatform: null })
    const r = await a.api('POST', `/v1/posts/${p.id}/retry`, {})
    expect(r.status).toBe(200)
    expect(r.json.retried_targets).toHaveLength(1)
    await a.env.scheduler.idle()
    expect(a.env.posts.get(p.id)!.status).toBe('posted')
  })

  it('reads the activity log with a since filter', async () => {
    const a = await env()
    const before = new Date(Date.now() + 60_000).toISOString()
    await make(a)
    const all = await a.api('GET', '/v1/activity')
    expect(
      all.json.entries.some((e: any) => e.message.includes('Agent (api): created draft')),
    ).toBe(true)
    expect(
      (await a.api('GET', `/v1/activity?since=${encodeURIComponent(before)}`)).json.entries,
    ).toEqual([])
    expect((await a.api('GET', '/v1/activity?since=yesterday')).status).toBe(400)
  })
})
