import { mkdtempSync, symlinkSync, writeFileSync } from 'fs'
import { request } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentRuntime } from '../src/main/agent/runtime'
import { buildHealth } from '../src/main/agent/health'
import type { AgentServices } from '../src/main/agent/core'
import { StatsService } from '../src/main/stats/service'
import { SecretStore } from '../src/main/services/secrets'
import { fakeCrypto } from './googleHelpers'
import { makeEnv } from './helpers'
import { makeStudioEnv } from './studio/helpers'

/** The real agent server on a random port, over the same services the app uses. */
export async function makeAgentEnv(
  patch: Record<string, unknown> = {},
  opts: { studio?: boolean } = {},
) {
  // The Studio adds its own brand (Wonder Hollow), so it is only built when a test needs it.
  const env = (opts.studio ? makeStudioEnv() : makeEnv()) as ReturnType<typeof makeStudioEnv>
  env.settings.set({ agentApiEnabled: true, agentApiPort: 0, ...patch } as never)
  const secrets = new SecretStore(join(mkdtempSync(join(tmpdir(), 'elo-ag-')), 's.bin'), fakeCrypto)
  const services: AgentServices = {
    settings: env.settings,
    brands: env.brands,
    posts: env.posts,
    scheduler: env.scheduler,
    log: env.log,
    appVersion: '9.9.9',
    ...(opts.studio ? { studio: () => env.studio, episodes: () => env.studio.episodes } : {}),
    stats: new StatsService({
      db: env.db,
      log: env.log,
      emit: () => {},
      providers: {},
      now: () => env.clock.ms,
    }),
    now: () => env.clock.ms,
    health: () =>
      buildHealth({
        db: env.db,
        scheduler: env.scheduler,
        settings: env.settings,
        version: '9.9.9',
        quota: () => ({
          dayPt: 'x',
          uploads: { used: 2, limit: 100 },
          other: { used: 5, limit: 10000 },
          warn: false,
        }),
        metaExpiresAt: () => null,
        tiktokExpiresAt: () => null,
      }),
  }
  const runtime = new AgentRuntime(services, secrets, env.settings, { scriptPath: '/tmp/none.mjs' })
  await runtime.server.start(0)
  const token = runtime.generateToken()
  const port = runtime.server.address()!.port
  const base = `http://127.0.0.1:${port}`

  /** A request with full control over the headers, for the safety tests. */
  const raw = (
    method: string,
    path: string,
    opts: { headers?: Record<string, string>; body?: unknown } = {},
  ) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => {
      const data = opts.body === undefined ? undefined : JSON.stringify(opts.body)
      const req = request(
        {
          host: '127.0.0.1',
          port,
          method,
          path,
          headers: {
            ...(data
              ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
              : {}),
            ...opts.headers,
          },
        },
        (res) => {
          let text = ''
          res.on('data', (c) => (text += c))
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null }),
          )
        },
      )
      req.on('error', reject)
      if (data) req.write(data)
      req.end()
    })
  const api = (method: string, path: string, body?: unknown, tokenOverride?: string | null) =>
    raw(method, path, {
      headers: tokenOverride === null ? {} : { Authorization: `Bearer ${tokenOverride ?? token}` },
      body,
    })

  const video = (name = 'clip.mp4') => {
    const p = join(mkdtempSync(join(tmpdir(), 'elo-agvid-')), name)
    writeFileSync(p, 'fake video bytes')
    return p
  }
  const link = (target: string) => {
    const p = join(mkdtempSync(join(tmpdir(), 'elo-aglink-')), 'link.mp4')
    symlinkSync(target, p)
    return p
  }
  return {
    env,
    services,
    runtime,
    secrets,
    token,
    port,
    base,
    raw,
    api,
    video,
    link,
    close: () => runtime.server.stop(),
  }
}
