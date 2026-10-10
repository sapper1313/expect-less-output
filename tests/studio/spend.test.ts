import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { makeStudioEnv } from './helpers'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('keys', () => {
  it('saves, tests, replaces and removes keys, and never writes them to disk, logs or the database', async () => {
    const SECRET = 'xai-SUPERSECRETKEY-123456'
    const calls: string[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(String(url))
      const auth = (init?.headers as Record<string, string>)?.Authorization
      return auth === `Bearer ${SECRET}` ? json({ ok: true }) : json({ error: 'bad' }, 401)
    }) as unknown as typeof fetch
    const e = makeStudioEnv({ fetchImpl })
    const s = e.studio

    expect((await s.keyStatus()).find((k) => k.id === 'xai')?.state).toBe('not_set')
    await s.setKey('xai', SECRET)
    const st = (await s.keyStatus()).find((k) => k.id === 'xai')!
    expect(st.has).toBe(true)
    expect(st.masked).toMatch(/^\*+3456$/)
    expect(st.state).toBe('untested')

    // Mock mode makes no network call.
    expect((await s.testKey('xai')).message).toMatch(/Mock mode/)
    expect(calls).toEqual([])

    await s.setConfig({ mockMode: false })
    expect(await s.testKey('xai')).toMatchObject({ ok: true })
    expect((await s.keyStatus()).find((k) => k.id === 'xai')?.state).toBe('connected')

    await s.setKey('xai', 'wrong-key-0000')
    const bad = await s.testKey('xai')
    expect(bad.ok).toBe(false)
    expect(bad.message).toMatch(/refused/)
    expect((await s.keyStatus()).find((k) => k.id === 'xai')?.state).toBe('failed')

    await s.setKey('xai', SECRET)
    await s.setKey('anthropic', 'sk-ant-OTHERSECRET-999999')
    // grep: no secret anywhere on disk or in any table
    const raw = readFileSync(e.secretFile, 'utf8')
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain('OTHERSECRET')
    const dump = JSON.stringify([
      e.db.prepare('SELECT * FROM settings').all(),
      e.db.prepare('SELECT * FROM audit_log').all(),
      e.db.prepare('SELECT * FROM activity_log').all(),
      e.db.prepare('SELECT * FROM spend_ledger').all(),
    ])
    expect(dump).not.toContain(SECRET)
    expect(dump).not.toContain('OTHERSECRET')

    await s.removeKey('xai')
    expect((await s.keyStatus()).find((k) => k.id === 'xai')?.has).toBe(false)
  })
})

describe('spend caps', () => {
  function xaiFetch() {
    return (async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/v1/videos/generations') && init?.method === 'POST') return json({ request_id: 'req-1' })
      return json({ status: 'pending' })
    }) as unknown as typeof fetch
  }

  it('a cap of 0.01 stops the first paid call, writes no ledger row, and alerts once', async () => {
    const e = makeStudioEnv({ fetchImpl: xaiFetch() })
    const s = e.studio
    await s.setKey('xai', 'xai-key-000000')
    await s.setConfig({ mockMode: false, globalCap: { value: 0.01, none: false } })
    const r = await s.cheapTest()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/Stopped: the global monthly cap reached/)
    expect(e.db.prepare('SELECT COUNT(*) AS n FROM spend_ledger').get()).toEqual({ n: 0 })
    expect(e.alerts.filter(([h]) => h === 'Spending stopped.')).toHaveLength(1)
    await s.cheapTest()
    expect(e.alerts.filter(([h]) => h === 'Spending stopped.')).toHaveLength(1) // one alert per cap per day
  })

  it('rejects caps above 9999 and non numbers; No spend cap switches enforcement off', async () => {
    const e = makeStudioEnv()
    const s = e.studio
    await expect(s.setConfig({ globalCap: { value: 10000, none: false } })).rejects.toThrow(/9999/)
    await expect(s.setConfig({ globalCap: { value: NaN, none: false } })).rejects.toThrow(/number/)
    await s.setConfig({ mockMode: false, globalCap: { value: 0.01, none: true } })
    expect(() => s.spend.check({ vendor: 'xai', dollars: 5, brandId: 1 })).not.toThrow()
    await s.setConfig({ globalCap: { value: 0.01, none: false } })
    expect(() => s.spend.check({ vendor: 'xai', dollars: 5, brandId: 1 })).toThrow(/Stopped/)
  })

  it('mock spend is recorded but never counts against a cap', async () => {
    const e = makeStudioEnv()
    const s = e.studio
    await s.setConfig({ globalCap: { value: 0.01, none: false } })
    const r = await s.cheapTest() // mock mode is on
    expect(r.ok).toBe(true)
    expect(r.mock).toBe(true)
    const rows = e.db.prepare('SELECT mock, purpose FROM spend_ledger').all()
    expect(rows).toEqual([{ mock: 1, purpose: 'cheap test' }])
    expect((await s.spendSummary()).total).toBe(0)
    expect((await s.spendSummary()).mockTotal).toBeGreaterThan(0)
  })

  it('announces 50, 80 and 100 percent once each, and resets next month', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 10, 16) })
    const s = e.studio
    await s.setConfig({ globalCap: { value: 10, none: false } })
    const pay = (dollars: number) =>
      s.spend.record({ vendor: 'xai', model: 'm', units: 1, unitKind: 'seconds', unitPrice: dollars, dollars, purpose: 'first take', mock: false })
    pay(5.5)
    pay(2.6)
    pay(2)
    pay(1)
    const pct = e.alerts.filter(([h]) => h.startsWith('Spend at')).map(([h]) => h)
    expect(pct).toEqual(['Spend at 50 percent.', 'Spend at 80 percent.', 'Spend at 100 percent.'])
    e.clock.ms = Date.UTC(2026, 6, 2, 16) // July
    expect((await s.spendSummary()).total).toBe(0)
    pay(6)
    expect(e.alerts.filter(([h]) => h === 'Spend at 50 percent.')).toHaveLength(2)
  })

  it('the AI text cap is separate and also checked before a text call', async () => {
    const fetchImpl = (async () => json({ content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 10, output_tokens: 5 } })) as unknown as typeof fetch
    const e = makeStudioEnv({ fetchImpl })
    const s = e.studio
    await s.setKey('anthropic', 'sk-ant-key-00000')
    await s.setConfig({ mockMode: false, aiTextCap: { value: 0.0001, none: false }, globalCap: { value: 500, none: false } })
    await expect(s.gateway.call({ agent: 'Test', system: 's', user: 'u', maxTokens: 4000 })).rejects.toThrow(/AI text cap/)
    await s.setConfig({ aiTextCap: { value: 5, none: false } })
    const res = await s.gateway.call({ agent: 'Test', system: 's', user: 'u', maxTokens: 100 })
    expect(res.inputTokens).toBe(10)
    const row = e.db.prepare("SELECT vendor, mock, dollars FROM spend_ledger WHERE purpose = 'text'").get() as { vendor: string; mock: number; dollars: number }
    expect(row.vendor).toBe('anthropic')
    expect(row.mock).toBe(0)
    expect(row.dollars).toBeGreaterThan(0)
  })

  it('a resumed job with the same request id is not ledgered twice', async () => {
    const e = makeStudioEnv()
    const row = { vendor: 'xai' as const, model: 'm', units: 3, unitKind: 'seconds' as const, unitPrice: 0.02, dollars: 0.06, requestId: 'req-9', purpose: 'first take', mock: false }
    expect(e.studio.spend.record(row)).not.toBeNull()
    expect(e.studio.spend.record(row)).toBeNull()
    expect(e.db.prepare('SELECT COUNT(*) AS n FROM spend_ledger').get()).toEqual({ n: 1 })
  })

  it('exports the ledger as CSV and shows the cadence what-if', async () => {
    const e = makeStudioEnv()
    const s = e.studio
    s.spend.record({ vendor: 'xai', model: 'm', units: 1, unitKind: 'seconds', unitPrice: 1, dollars: 1, purpose: 'first take', mock: true })
    const csv = await s.spendCsv()
    expect(csv.split('\n')[0]).toContain('timestamp_utc')
    expect(csv).toContain('mock')
    const b = (await s.brands()).find((x) => x.config.format === 'short')!
    const w = await s.cadenceWhatIf(b.brandId, 5)
    expect(w.proposed).toBeLessThan(w.current)
  })
})

describe('Bluesky accounts', () => {
  it('each brand has its own account, with its own state and its own secret', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 3, 12) })
    const s = e.studio
    const before = await s.socialAccountList()
    expect(before.length).toBe(5)
    expect(before.every((b) => b.bluesky.state === 'not_set')).toBe(true)
    await s.saveBluesky(2, '@panda.bsky.social', 'app-pass-1')
    await s.saveBluesky(3, 'sarah.bsky.social', 'app-pass-2')
    const list = await s.socialAccountList()
    expect(list[1].bluesky).toMatchObject({ handle: 'panda.bsky.social', hasPassword: true, state: 'untested' })
    expect(list[2].bluesky.handle).toBe('sarah.bsky.social')
    expect(e.secrets.get('bluesky.appPassword.2')).toBe('app-pass-1')
    expect(e.secrets.get('bluesky.appPassword.3')).toBe('app-pass-2')
    expect(JSON.stringify(e.db.prepare('SELECT * FROM settings').all())).not.toContain('app-pass')
    expect(s.socialAccounts.notReady(2)).toBeNull()
    expect(s.socialAccounts.notReady(4)).toMatch(/no Bluesky handle/)
    await s.removeBluesky(2)
    expect((await s.socialAccountList())[1].bluesky.state).toBe('not_set')
  })
})

describe('structured model answers', () => {
  it('asks for the answer as a filled in form (tool use), so it is always valid JSON, and treats a cut off answer as a retry', async () => {
    const { z } = await import('zod')
    const bodies: Array<Record<string, any>> = []
    let cut = false
    const f = (async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string))
      return json({
        content: [{ type: 'tool_use', name: 'submit_answer', input: { line: 'He said "hi", then left' } }],
        stop_reason: cut ? 'max_tokens' : 'tool_use',
        usage: { input_tokens: 5, output_tokens: 5 },
      })
    }) as unknown as typeof fetch
    const e = makeStudioEnv({ fetchImpl: f })
    await e.studio.setKey('anthropic', 'sk-ant-key-00000')
    await e.studio.setConfig({ mockMode: false })
    const out = await e.studio.gateway.json({ agent: 'Test', system: 's', user: 'u' }, z.object({ line: z.string(), n: z.number().default(1) }))
    expect(out).toEqual({ line: 'He said "hi", then left', n: 1 })
    expect(bodies[0].tool_choice).toEqual({ type: 'auto' })
    expect(bodies[0].system).toContain('submit_answer')
    expect(bodies[0].tools[0].input_schema).toMatchObject({ type: 'object', properties: { line: { type: 'string' } } })
    expect(bodies[0].tools[0].input_schema.$schema).toBeUndefined()
    cut = true
    await expect(e.studio.gateway.json({ agent: 'Test', system: 's', user: 'u' }, z.object({ line: z.string() }))).rejects.toThrow(/cut off/)
  })

  it('falls back to plain JSON text when a model refuses tools', async () => {
    const { z } = await import('zod')
    let n = 0
    const f = (async (_u: string, init?: RequestInit) => {
      n++
      const b = JSON.parse(init!.body as string)
      if (b.tools) return json({ type: 'error', error: { type: 'invalid_request_error', message: 'tools are not supported for this model.' } }, 400)
      return json({ content: [{ type: 'text', text: '{"line":"ok"}' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } })
    }) as unknown as typeof fetch
    const e = makeStudioEnv({ fetchImpl: f })
    await e.studio.setKey('anthropic', 'sk-ant-key-00000')
    await e.studio.setConfig({ mockMode: false })
    expect(await e.studio.gateway.json({ agent: 'Test', system: 's', user: 'u' }, z.object({ line: z.string() }))).toEqual({ line: 'ok' })
    expect(n).toBe(2)
  })
})
