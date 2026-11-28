import { describe, expect, it } from 'vitest'
import { handlePhoneRequest, phonePage, type PhoneProvider } from '../src/main/agent/phone'

const calls: string[] = []
const provider: PhoneProvider = {
  token: () => 'secret123',
  look: () => 'ocean',
  snapshot: async () => ({ kind: 'snapshot' }),
  refresh: async () => ({ kind: 'refreshed' }),
  week: async (n) => ({ kind: 'week', n }),
  tiles: async () => ({ kind: 'tiles' }),
}
const req = (url: string, over: Record<string, unknown> = {}) => ({
  method: 'GET',
  url,
  headers: { host: '100.72.251.21:47821' },
  port: 47821,
  ...over,
})
const ok = (h: string) => h === '100.72.251.21:47821'

describe('phone page', () => {
  it('serves the Home page in the chosen theme only with the right secret', async () => {
    const r = await handlePhoneRequest(provider, req('/m/secret123/'), ok)
    expect(r!.status).toBe(200)
    expect(r!.type).toContain('text/html')
    expect(r!.body).toContain('data-look="ocean"')
    expect(r!.body).toContain('Channel totals, all platforms')
    expect(r!.body).toContain('viewport-fit=cover')
    const bad = await handlePhoneRequest(provider, req('/m/wrong/'), ok)
    expect(bad!.status).toBe(404)
    expect(bad!.body).not.toContain('Channel totals')
  })
  it('is read only and answers the data files', async () => {
    expect((await handlePhoneRequest(provider, req('/m/secret123/', { method: 'POST' }), ok))!.status).toBe(405)
    expect(JSON.parse((await handlePhoneRequest(provider, req('/m/secret123/snapshot.json'), ok))!.body as string)).toEqual({ kind: 'snapshot' })
    expect(JSON.parse((await handlePhoneRequest(provider, req('/m/secret123/snapshot.json?force=1'), ok))!.body as string)).toEqual({ kind: 'refreshed' })
    expect(JSON.parse((await handlePhoneRequest(provider, req('/m/secret123/week.json?offset=2'), ok))!.body as string)).toEqual({ kind: 'week', n: 2 })
    expect(JSON.parse((await handlePhoneRequest(provider, req('/m/secret123/tiles.json'), ok))!.body as string)).toEqual({ kind: 'tiles' })
    expect((await handlePhoneRequest(provider, req('/m/secret123/other'), ok))!.status).toBe(404)
  })
  it('refuses a strange Host header, ignores other paths and falls back to Midnight', async () => {
    expect((await handlePhoneRequest(provider, req('/m/secret123/', { headers: { host: 'evil.example:47821' } }), ok))!.status).toBe(403)
    expect(await handlePhoneRequest(provider, req('/v1/sync'), ok)).toBeNull()
    expect(phonePage('nonsense')).toContain('data-look="midnight"')
    void calls
  })
})
