// Phase 2 end to end: the real app against a local fake Google. Nothing here touches Google.
import { startFakeGoogle } from '../../tests/fakeGoogle.ts'
import { launch, makeVideos, shot, nav, invoke, sleep } from './lib.mjs'
import { tmpdir } from 'os'
import { join } from 'path'

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a)
const fake = await startFakeGoogle()
process.env.ELO_GOOGLE_BASE = fake.base
process.env.ELO_TEST_NO_BROWSER = '1'
const vids = makeVideos(join(tmpdir(), 'elo-vids'), ['yt_a.mp4', 'yt_b.mp4'])
const { app, page } = await launch()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await app.evaluate(({ shell }) => {
  globalThis.__opened = []
  shell.openExternal = async (u) => { globalThis.__opened.push(u) }
})

async function waitFor(fn, ms, label) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(1000)
  }
  throw new Error('timeout: ' + label)
}

// 1. Credentials
await nav(page, 'Connections')
await page.fill('input[placeholder*="apps.googleusercontent"]', fake.state.clientId)
await page.fill('input[type=password]', fake.state.clientSecret)
await page.click('button:has-text("Save")')
await waitFor(async () => (await invoke(page, 'youtube.credentialsStatus')).hasClientSecret, 5000, 'credentials saved')
const st = await invoke(page, 'youtube.credentialsStatus')
log('credentials masked:', st.clientIdMasked, st.clientSecretMasked, '| raw leaked?', JSON.stringify(st).includes(fake.state.clientSecret))
await sleep(500)
await shot(page, 'p2e-credentials')

// 2. Connect Trash Panda (one channel)
await page.click('section:has(h2:text-is("Trash Panda")) >> button:has-text("Connect YouTube")')
await waitFor(async () => (await invoke(page, 'accounts.list', 1)).find((a) => a.platform === 'youtube' && a.mode !== 'dry_run'), 15000, 'connect brand 1')
log('brand 1 account:', JSON.stringify((await invoke(page, 'accounts.list', 1)).find((a) => a.platform === 'youtube')))

// 3. Connect Clock Out Early (two channels, picker)
fake.state.channels = [{ id: 'UC_A', title: 'Clock Out Early Main' }, { id: 'UC_B', title: 'Clock Out Early Clips' }]
await page.click('section:has(h2:text-is("Clock Out Early")) >> button:has-text("Connect YouTube")')
await page.waitForSelector('[role=dialog]:has-text("Pick the channel")', { timeout: 15000 })
await shot(page, 'p2e-picker')
await page.click('[role=dialog] label:has-text("Clips")')
await page.click('[role=dialog] button:has-text("Use this channel")')
await waitFor(async () => (await invoke(page, 'accounts.list', 2)).find((a) => a.platform === 'youtube' && a.externalId === 'UC_B'), 8000, 'brand 2 channel picked')
await sleep(600)
await shot(page, 'p2e-connections')

// 4. Test private upload (brand 1) with the AI flag on
await invoke(page, 'youtube.setMode', 1, 'test_private')
const when1 = new Date(Date.now() + 40_000).toISOString()
const p1 = await invoke(page, 'posts.create', { brandId: 1, sourcePath: vids[0], title: 'Private Test', caption: 'Testing #trashpanda #funny', scheduledAtUtc: when1, status: 'scheduled', targets: [{ platform: 'youtube', aiFlag: true }] })
log('test_private post due', when1)
await waitFor(async () => (await invoke(page, 'posts.get', p1.id)).status === 'posted', 120000, 'test private upload')
const up = fake.state.uploads[0]
log('fake received upload: privacy', up.metadata.status.privacyStatus, '| containsSyntheticMedia', up.metadata.status.containsSyntheticMedia, '| publishAt', up.metadata.status.publishAt, '| tags', JSON.stringify(up.metadata.snippet.tags), '| bytes', up.bytes, '| complete', up.complete)
const t1 = (await invoke(page, 'posts.get', p1.id)).targets[0]
log('target:', t1.status, t1.externalUrl, 'attempts', t1.attempts)

// 5. Manual assist (brand 2)
const when2 = new Date(Date.now() + 40_000).toISOString()
const p2 = await invoke(page, 'posts.create', { brandId: 2, sourcePath: vids[1], title: 'Manual One', caption: 'Hand posted #clockout', scheduledAtUtc: when2, status: 'scheduled', targets: [{ platform: 'youtube', aiFlag: false }] })
await waitFor(async () => (await invoke(page, 'posts.get', p2.id)).targets[0].status === 'needs_action', 120000, 'manual assist')
const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
const opened = await app.evaluate(() => globalThis.__opened)
log('clipboard:', JSON.stringify(clip), '| opened:', JSON.stringify(opened), '| uploads still', fake.state.uploads.length)
await nav(page, 'Queue')
await page.selectOption('select[aria-label="Status"]', 'all')
await page.click('tr:has-text("Manual One")')
await page.waitForSelector('text=Waiting for you')
await shot(page, 'p2e-manual-assist')
await page.fill('input[placeholder*="Video link"]', 'https://youtube.com/shorts/handmade')
await page.click('button:has-text("Mark as posted")')
await waitFor(async () => (await invoke(page, 'posts.get', p2.id)).status === 'posted', 8000, 'mark as posted')
const done = await invoke(page, 'posts.get', p2.id)
log('after Mark as posted:', done.status, done.targets[0].externalUrl, done.videoPath)

// 6. Token death
await page.keyboard.press('Escape') // close the post editor so the menu is clickable
await page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 5000 }).catch(() => {})
fake.state.accessTokens.clear()
fake.state.refreshInvalid = true
await invoke(page, 'youtube.checkHealth')
await nav(page, 'Connections')
await sleep(800)
const accts = await invoke(page, 'accounts.list', 1)
log('after dead token, account status:', accts.find((a) => a.platform === 'youtube').status)
await shot(page, 'p2e-needs-reauth')
const logs = await invoke(page, 'log.list', { level: 'error', limit: 5 })
log('error log:', logs.map((l) => l.message).join(' || '))
log('page errors:', JSON.stringify(errors))
await app.close()
await fake.close()
