// Dead sign-in path only: connect a brand, let Google reject the saved login, check needs_reauth and the alert.
import { startFakeGoogle } from '../../tests/fakeGoogle.ts'
import { launch, shot, nav, invoke, sleep } from './lib.mjs'

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a)
const fake = await startFakeGoogle()
process.env.ELO_GOOGLE_BASE = fake.base
process.env.ELO_TEST_NO_BROWSER = '1'
const { app, page } = await launch()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const toasts = []
await page.exposeFunction('__toast', (t) => toasts.push(t))
await page.evaluate(() => window.elo.on((e) => e.type === 'toast' && window.__toast(e.toast)))

await invoke(page, 'youtube.saveCredentials', fake.state.clientId, fake.state.clientSecret)
const r = await invoke(page, 'youtube.connect', 1)
log('connected:', r.status, r.account?.displayName, 'status', r.account?.status)
await invoke(page, 'youtube.setMode', 1, 'auto')

// Healthy check first
await invoke(page, 'youtube.checkHealth')
log('healthy status:', (await invoke(page, 'accounts.list', 1)).find((a) => a.platform === 'youtube').status)

// Now Google forgets the access token and rejects the refresh token.
fake.state.accessTokens.clear()
fake.state.refreshInvalid = true
await invoke(page, 'youtube.checkHealth')
await sleep(500)
const acct = (await invoke(page, 'accounts.list', 1)).find((a) => a.platform === 'youtube')
log('after dead token: status =', acct.status, '| mode =', acct.mode)
const errs = await invoke(page, 'log.list', { level: 'error', limit: 5 })
log('error log:', errs.map((l) => l.message).join(' || '))
log('toasts:', JSON.stringify(toasts))

// A post due now must fail clearly, not retry or upload.
const { makeVideos } = await import('./lib.mjs')
const { tmpdir } = await import('os')
const { join } = await import('path')
const [vid] = makeVideos(join(tmpdir(), 'elo-vids'), ['yt_a.mp4'])
const p = await invoke(page, 'posts.create', { brandId: 1, sourcePath: vid, title: 'Dead Token Post', caption: 'x', scheduledAtUtc: new Date(Date.now() + 10_000).toISOString(), status: 'scheduled', targets: [{ platform: 'youtube', aiFlag: false }] })
for (let i = 0; i < 60; i++) {
  const t = (await invoke(page, 'posts.get', p.id)).targets[0]
  if (t.status === 'failed') {
    log('post target:', t.status, '| attempts', t.attempts, '| error:', t.lastError)
    break
  }
  await sleep(2000)
}
log('uploads sent to Google:', fake.state.uploads.length)

await nav(page, 'Connections')
await sleep(800)
await shot(page, 'p2e-needs-reauth')
log('screenshot saved, page errors:', JSON.stringify(errors))
await app.close()
await fake.close()
