import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SecretStore } from '../src/main/services/secrets'
import { SECRET_CLIENT_ID, SECRET_CLIENT_SECRET, googleUrls } from '../src/main/google/config'
import { QuotaTracker } from '../src/main/google/quota'
import { TokenManager } from '../src/main/google/tokens'
import { YoutubeClient } from '../src/main/google/youtubeClient'
import { YoutubeService } from '../src/main/google/youtubeService'
import { startFakeGoogle, type FakeGoogle } from './fakeGoogle'
import { makeEnv } from './helpers'

export const fakeCrypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from('enc:' + s),
  decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
}

/** A full YouTube stack (service, tokens, client) talking to the local fake Google server. */
export async function makeGoogleEnv(opts: { signInTimeoutMs?: number } = {}) {
  const fake: FakeGoogle = await startFakeGoogle()
  const env = makeEnv()
  const secrets = new SecretStore(
    join(mkdtempSync(join(tmpdir(), 'elo-sec-')), 'secrets.bin'),
    fakeCrypto,
  )
  secrets.set(SECRET_CLIENT_ID, fake.state.clientId)
  secrets.set(SECRET_CLIENT_SECRET, fake.state.clientSecret)
  const urls = googleUrls({ ELO_GOOGLE_BASE: fake.base } as NodeJS.ProcessEnv)
  const warnings: string[] = []
  const reauth: number[] = []
  const quota = new QuotaTracker(
    env.db,
    () => env.clock.ms,
    (b, used, limit) => warnings.push(`${b}:${used}/${limit}`),
  )
  const tokens = new TokenManager({
    db: env.db,
    secrets,
    urls,
    now: () => env.clock.ms,
    onNeedsReauth: (id) => reauth.push(id),
  })
  const client = new YoutubeClient(tokens, urls, quota)
  const browserPages: string[] = []
  const service = new YoutubeService({
    db: env.db,
    secrets,
    urls,
    tokens,
    client,
    quota,
    log: env.log,
    emit: () => {},
    notifyReauth: () => {},
    now: () => env.clock.ms,
    signInTimeoutMs: opts.signInTimeoutMs,
    // The "browser": follow the fake sign-in redirect and keep the final page for the test to read.
    openBrowser: async (url) => {
      void fetch(url).then(async (r) => browserPages.push(await r.text()))
    },
  })
  return {
    fake,
    env,
    secrets,
    urls,
    quota,
    tokens,
    client,
    service,
    warnings,
    reauth,
    browserPages,
    close: () => fake.close(),
  }
}

/** Connects brand 1 to the fake channel and returns its account row. */
export async function connectBrand(g: Awaited<ReturnType<typeof makeGoogleEnv>>, brandId = 1) {
  const r = await g.service.connect(brandId)
  if (r.status !== 'connected') throw new Error('expected a single channel')
  return r.account
}
