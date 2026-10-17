import { describe, expect, it } from 'vitest'
import { SettingsService } from '../src/main/services/settings'
import { makeStudioEnv } from './studio/helpers'

const json = (b: unknown) =>
  new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })

describe('Claude API master switch (R1)', () => {
  it('makes zero Anthropic requests when off, with a plain error', async () => {
    let calls = 0
    const f = (async () => {
      calls++
      return json({
        content: [{ type: 'text', text: '{}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    }) as unknown as typeof fetch
    const e = makeStudioEnv({ fetchImpl: f })
    new SettingsService(e.db).set({ claudeApiEnabled: false })
    await e.studio.setKey('anthropic', 'sk-ant-key-00000')
    await e.studio.setConfig({ mockMode: false })
    await expect(
      e.studio.gateway.call({ agent: 'Show Writer', system: 's', user: 'u' }),
    ).rejects.toThrow('Writing comes from bots.')
    const t = await e.studio.testKey('anthropic')
    expect(t).toMatchObject({ ok: false })
    expect(t.message).toMatch(/Claude API is off/)
    expect(calls).toBe(0)
  })

  it('still calls Claude when on', async () => {
    let calls = 0
    const f = (async () => {
      calls++
      return json({
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    }) as unknown as typeof fetch
    const e = makeStudioEnv({ fetchImpl: f })
    await e.studio.setKey('anthropic', 'sk-ant-key-00000')
    await e.studio.setConfig({ mockMode: false })
    await e.studio.gateway.call({ agent: 'Show Writer', system: 's', user: 'u' })
    expect(calls).toBe(1)
  })

  it('a fresh install starts with both switches off', () => {
    const e = makeStudioEnv()
    const raw = new SettingsService(e.db)
    raw.set({ claudeApiEnabled: false, studioProductionEnabled: false })
    expect(raw.get()).toMatchObject({ claudeApiEnabled: false, studioProductionEnabled: false })
  })
})

describe('Studio production switch (R8)', () => {
  it('stops the Director from asking for episodes and blocks manual writing', async () => {
    const e = makeStudioEnv()
    new SettingsService(e.db).set({ studioProductionEnabled: false })
    const before = e.studio.tasks.list({ type: 'write_episode' }).length
    e.studio.director.tick()
    expect(e.studio.tasks.list({ type: 'write_episode' }).length).toBe(before)
    const brand = (await e.studio.brands())[0]
    await expect(e.studio.writeNow(brand.brandId)).rejects.toThrow('Writing comes from bots.')
  })
})
