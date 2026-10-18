import { describe, expect, it } from 'vitest'
import { tailscaleAddress } from '../src/main/agent/runtime'
import { handleAgentRequest } from '../src/main/agent/server'
import { makeAgentEnv } from './agentHelpers'

describe('Tailscale listening', () => {
  it('finds a Tailscale address in 100.64.0.0/10 and ignores others', () => {
    const iface = (address: string) => [{ address, family: 'IPv4', internal: false } as never]
    expect(tailscaleAddress({ utun4: iface('100.101.5.9'), en0: iface('192.168.1.5') })).toBe(
      '100.101.5.9',
    )
    expect(
      tailscaleAddress({
        en0: iface('192.168.1.5'),
        lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as never],
      }),
    ).toBeNull()
    expect(tailscaleAddress({ a: iface('100.200.1.1') })).toBeNull()
  })

  it('accepts the Tailscale Host and .ts.net names, and still refuses other hosts', async () => {
    const a = await makeAgentEnv()
    const services = {
      settings: a.env.settings,
      brands: a.env.brands,
      posts: a.env.posts,
      scheduler: a.env.scheduler,
      log: a.env.log,
      appVersion: 't',
      health: () => null,
    } as never
    const call = (host: string, hostOk?: (h: string) => boolean) =>
      handleAgentRequest(
        services,
        () => 'tok',
        {
          method: 'GET',
          url: '/v1/openapi.json',
          headers: { host, authorization: 'Bearer tok' },
          body: '',
          port: 47821,
        },
        () => {},
        hostOk,
      )
    const ok = (h: string) => h === '100.1.2.3:47821' || /\.ts\.net:\d+$/.test(h)
    expect((await call('100.1.2.3:47821', ok)).status).toBe(200)
    expect((await call('mac.tail1234.ts.net:47821', ok)).status).toBe(200)
    expect((await call('evil.example.com:47821', ok)).status).toBe(403)
    expect((await call('100.1.2.3:47821')).status).toBe(403)
    await a.close()
  })
})
