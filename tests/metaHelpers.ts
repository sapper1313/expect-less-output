import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SecretStore } from '../src/main/services/secrets'
import { META_SECRET_APP_ID, META_SECRET_APP_SECRET, metaUrls } from '../src/main/meta/config'
import { GraphClient } from '../src/main/meta/graph'
import { MetaService } from '../src/main/meta/metaService'
import { FacebookAdapter } from '../src/main/adapters/facebook'
import { InstagramAdapter } from '../src/main/adapters/instagram'
import { DryRunAdapter } from '../src/main/adapters/dryRun'
import type { PlatformAdapter } from '../src/main/adapters/types'
import type { Account, Platform } from '../src/shared/types'
import { PLATFORMS } from '../src/shared/platformLimits'
import { startFakeMeta } from './fakeMeta'
import { fakeCrypto } from './googleHelpers'
import { makeEnv } from './helpers'

let nextPort = 54100 + Math.floor(Math.random() * 400)

/** The Meta stack (service, graph client, adapters, scheduler) against the local fake Meta server. */
export async function makeMetaEnv(
  opts: {
    media?: Parameters<typeof makeEnv>[1] extends infer O
      ? O extends { media?: infer M }
        ? M
        : never
      : never
  } = {},
) {
  const fake = await startFakeMeta()
  const port = nextPort++
  const urls = metaUrls({
    ELO_META_BASE: fake.base,
    ELO_META_PORT: String(port),
  } as NodeJS.ProcessEnv)
  const secrets = new SecretStore(
    join(mkdtempSync(join(tmpdir(), 'elo-msec-')), 'secrets.bin'),
    fakeCrypto,
  )
  secrets.set(META_SECRET_APP_ID, fake.state.appId)
  secrets.set(META_SECRET_APP_SECRET, fake.state.appSecret)
  const graph = new GraphClient({ urls, sleep: async () => {} })

  const alerts: string[][] = []
  const notes: string[][] = []
  const holder: { env: ReturnType<typeof makeEnv> | null } = { env: null }
  const browserPages: string[] = []
  const service = new MetaService({
    db: null as never,
    secrets,
    urls,
    graph,
    log: null as never,
    emit: () => {},
    alert: (h, d) => alerts.push([h, d]),
    now: () => holder.env!.clock.ms,
    signInTimeoutMs: 3000,
    openBrowser: async (url) => {
      void fetch(url).then(async (r) => browserPages.push(await r.text()))
    },
  })
  const host = {
    notify: (t: string, b: string) => notes.push([t, b]),
    authFailed: (r: string) => service.markReauth(r),
    tokenFor: (a: Account | null) => service.tokenForAccount(a),
    log: (level: 'info' | 'warn' | 'error', message: string, ctx: { postId: number }) =>
      holder.env!.log.log(level, message, { postId: ctx.postId }),
  }
  const fb = new FacebookAdapter({
    graph,
    urls,
    host,
    publishesLast24h: (id) => service.fbPublishesLast24h(id),
    recordPublish: (id) => service.recordFbPublish(id),
  })
  const ig = new InstagramAdapter({
    graph,
    urls,
    host,
    brandDefaults: (id) => holder.env!.brands.getDefaults(id),
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
    media: opts.media ?? null,
    adapterFor: (platform, account) => {
      if (account && account.mode !== 'dry_run') {
        if (platform === 'facebook') return fb
        if (platform === 'instagram') return ig
      }
      return dry[platform]
    },
  })
  holder.env = env
  fake.state.nowMs = () => env.clock.ms
  // The service was built before the env existed, so hand it the real db and log now.
  ;(service as unknown as { d: { db: unknown; log: unknown } }).d.db = env.db
  ;(service as unknown as { d: { db: unknown; log: unknown } }).d.log = env.log
  return {
    fake,
    env,
    secrets,
    urls,
    service,
    alerts,
    notes,
    browserPages,
    close: () => fake.close(),
  }
}

/** Connects Meta and assigns brand 1 to the fake Page and Instagram account. */
export async function connectAndAssign(m: Awaited<ReturnType<typeof makeMetaEnv>>, brandId = 1) {
  await m.service.connect()
  const st = m.service.status()
  const sug = st.suggestions.find((s) => s.brandId === brandId)!
  return m.service.assign(brandId, st.pages[0].pageId, st.pages[0].igId ?? sug.igId)
}
