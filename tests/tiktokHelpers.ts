import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SecretStore } from '../src/main/services/secrets'
import { TikTokClient } from '../src/main/tiktok/client'
import { TikTokService } from '../src/main/tiktok/service'
import { tiktokUrls } from '../src/main/tiktok/config'
import { TikTokAdapter } from '../src/main/adapters/tiktok'
import { DryRunAdapter } from '../src/main/adapters/dryRun'
import type { PlatformAdapter } from '../src/main/adapters/types'
import type { Platform } from '../src/shared/types'
import { PLATFORMS } from '../src/shared/platformLimits'
import { startFakeTikTok } from './fakeTikTok'
import { fakeCrypto } from './googleHelpers'
import { makeEnv } from './helpers'

/** The TikTok stack (service, client, adapter, scheduler) against the local fake TikTok server. */
export async function makeTikTokEnv() {
  const fake = await startFakeTikTok()
  const urls = tiktokUrls({ ELO_TIKTOK_BASE: fake.base } as NodeJS.ProcessEnv)
  const secrets = new SecretStore(
    join(mkdtempSync(join(tmpdir(), 'elo-ttsec-')), 'secrets.bin'),
    fakeCrypto,
  )
  const client = new TikTokClient({ urls, sleep: async () => {} })
  const alerts: string[][] = []
  const notes: string[][] = []
  const holder: { env: ReturnType<typeof makeEnv> | null } = { env: null }
  const service = new TikTokService({
    db: null as never,
    secrets,
    settings: null as never,
    urls,
    client,
    log: null as never,
    emit: () => {},
    alert: (h, d) => alerts.push([h, d]),
    now: () => holder.env!.clock.ms,
    signInTimeoutMs: 3000,
    // The "browser": follow the authorize URL like the bounce page would, then hand the code to the app.
    openBrowser: async (url) => {
      const r = await fetch(url, { redirect: 'manual' })
      const back = new URL(r.headers.get('location') as string)
      const app = new URL('expectless://oauth/tiktok')
      app.searchParams.set('code', back.searchParams.get('code') as string)
      app.searchParams.set('state', back.searchParams.get('state') as string)
      setTimeout(() => service.handleOpenUrl(app.toString()), 5)
    },
  })
  const adapter = new TikTokAdapter({
    client,
    accessToken: (id, force) => service.accessToken(id, force),
    freshCreator: (id) => service.fresh(id),
    host: {
      notify: (t, b) => notes.push([t, b]),
      log: (level, message, ctx) => holder.env!.log.log(level, message, { postId: ctx.postId }),
    },
  })
  const dry = Object.fromEntries(
    PLATFORMS.map((p) => [
      p,
      new DryRunAdapter(p, {
        getSettings: () => holder.env!.settings.get(),
        sleep: async () => {},
      }),
    ]),
  ) as unknown as Record<Platform, PlatformAdapter>
  const env = makeEnv(Date.UTC(2026, 5, 1, 12, 0, 0), {
    adapterFor: (platform, account) =>
      platform === 'tiktok' && account && account.mode !== 'dry_run' ? adapter : dry[platform],
  })
  holder.env = env
  const inner = service as unknown as { d: { db: unknown; log: unknown; settings: unknown } }
  inner.d.db = env.db
  inner.d.log = env.log
  inner.d.settings = env.settings
  service.saveCredentials(
    fake.state.clientKey,
    fake.state.clientSecret,
    'https://example.test/oauth/tiktok/',
    false,
  )
  return { fake, env, secrets, service, client, adapter, alerts, notes, close: () => fake.close() }
}

export async function connectTikTok(t: Awaited<ReturnType<typeof makeTikTokEnv>>, brandId = 1) {
  return t.service.connect(brandId)
}
