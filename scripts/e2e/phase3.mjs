// Phase 3 end to end: the real app against a local fake Meta. Nothing here touches Meta.
import { startFakeMeta } from '../../tests/fakeMeta.ts'
import { launch, makeVideos, shot, nav, invoke, sleep } from './lib.mjs'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import ffmpegPath from 'ffmpeg-static'

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a)
const fake = await startFakeMeta()
fake.state.pages = [
  {
    id: 'P1',
    name: 'Trash Panda Money',
    token: 'page-token-P1',
    ig: { id: 'IG1', username: 'trashpanda' },
  },
  {
    id: 'P2',
    name: 'Clock Out Early',
    token: 'page-token-P2',
    ig: { id: 'IG2', username: 'clockoutearly' },
  },
  { id: 'P3', name: 'Some Other Page', token: 'page-token-P3' },
]
process.env.ELO_META_BASE = fake.base
process.env.ELO_META_PORT = String(53700 + Math.floor(Math.random() * 200))
process.env.ELO_TEST_NO_BROWSER = '1'
const vids = makeVideos(join(tmpdir(), 'elo-vids'), ['m_a.mp4', 'm_b.mp4'])
const longVid = join(tmpdir(), 'elo-vids', 'm_long.mp4')
if (!existsSync(longVid))
  execFileSync(
    ffmpegPath,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=360x640:rate=5',
      '-t',
      '100',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      longVid,
    ],
    { stdio: 'ignore' },
  )

const { app, page } = await launch()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
async function waitFor(fn, ms, label) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(1000)
  }
  throw new Error('timeout: ' + label)
}
const post = (id) => invoke(page, 'posts.get', id)

// 1. Credentials
await nav(page, 'Connections')
await page.fill('input[placeholder="15 digit number"]', fake.state.appId)
await page.fill('input[placeholder="App secret"]', fake.state.appSecret)
await page
  .locator('section:has(h2:text-is("Meta (Facebook Pages and Instagram)")) button:has-text("Save")')
  .first()
  .click()
await waitFor(
  async () => (await invoke(page, 'meta.credentialsStatus')).hasAppSecret,
  5000,
  'meta credentials',
)
const cs = await invoke(page, 'meta.credentialsStatus')
log(
  'credentials masked:',
  cs.appIdMasked,
  cs.appSecretMasked,
  '| raw leaked?',
  JSON.stringify(cs).includes(fake.state.appSecret),
)

// 2. Connect Meta
await page.click('button:has-text("Connect Meta")')
await waitFor(async () => (await invoke(page, 'meta.status')).connected, 20000, 'meta connected')
await sleep(800)
const st = await invoke(page, 'meta.status')
log(
  'pages found:',
  st.pages.map((p) => `${p.name}${p.igUsername ? ' + @' + p.igUsername : ''}`).join(' | '),
)
log('suggestions:', JSON.stringify(st.suggestions.slice(0, 2)))
await shot(page, 'p3e-assign')

// 3. Save the pre-matched rows for Trash Panda and Clock Out Early through the UI
for (const name of ['Trash Panda', 'Clock Out Early']) {
  await page.locator(`div.grid:has(> div:text-is("${name}")) button:has-text("Save")`).click()
  await sleep(600)
}
const a1 = await invoke(page, 'accounts.list', 1)
const a2 = await invoke(page, 'accounts.list', 2)
log(
  'brand 1:',
  a1
    .filter((a) => ['facebook', 'instagram'].includes(a.platform))
    .map((a) => `${a.platform}=${a.displayName}/${a.mode}`)
    .join(', '),
)
log(
  'brand 2:',
  a2
    .filter((a) => ['facebook', 'instagram'].includes(a.platform))
    .map((a) => `${a.platform}=${a.displayName}/${a.mode}`)
    .join(', '),
)
await shot(page, 'p3e-connections')

// 4. Early handoff to Facebook (scheduled 2h50m out, inside the 3 hour window)
const when1 = new Date(Date.now() + (2 * 60 + 50) * 60_000).toISOString()
const p1 = await invoke(page, 'posts.create', {
  brandId: 1,
  sourcePath: vids[0],
  title: 'Handoff Test',
  caption: 'Early #trashpanda',
  scheduledAtUtc: when1,
  status: 'scheduled',
  targets: [{ platform: 'facebook', aiFlag: false }],
})
await waitFor(
  async () => (await post(p1.id)).targets[0].status === 'handed_off',
  90000,
  'facebook handoff',
)
const v1 = Object.values(fake.state.fbVideos)[0]
log(
  'facebook handoff: video_state',
  v1.finishParams.video_state,
  '| scheduled_publish_time ok?',
  Number(v1.finishParams.scheduled_publish_time) === Math.floor(new Date(when1).getTime() / 1000),
  '| bytes',
  v1.bytes,
  '/',
  v1.fileSize,
)

// 5. Facebook + Instagram at the scheduled time, with the AI flag (brand 2)
const when2 = new Date(Date.now() + 40_000).toISOString()
const p2 = await invoke(page, 'posts.create', {
  brandId: 2,
  sourcePath: vids[1],
  title: 'Both Reels',
  caption: 'Hello #clockout',
  scheduledAtUtc: when2,
  status: 'scheduled',
  targets: [
    { platform: 'facebook', aiFlag: true },
    { platform: 'instagram', aiFlag: true },
  ],
})
const fbVideosBefore = Object.keys(fake.state.fbVideos).length
await waitFor(
  async () => Object.keys(fake.state.fbVideos).length > fbVideosBefore,
  120000,
  'facebook publish started',
)
const v2 = Object.values(fake.state.fbVideos).at(-1)
v2.published = true // Facebook finishes processing
await waitFor(async () => (await post(p2.id)).status === 'posted', 180000, 'both posted')
const done = await post(p2.id)
log(
  'both posted:',
  done.targets
    .map((t) => `${t.platform}:${t.status} ${t.externalUrl} checklist=${t.checklist}`)
    .join(' || '),
)
log('file moved:', done.videoPath)
const c = Object.values(fake.state.igContainers)[0]
log('instagram container params:', JSON.stringify(c.params))
await nav(page, 'Queue')
await page.selectOption('select[aria-label="Status"]', 'all')
await page.click('tr:has-text("Both Reels")')
await page.waitForSelector('text=Add AI label in app')
await shot(page, 'p3e-ai-checklist')
await page.click('button:has-text("Done")')
await sleep(500)
log(
  'checklist cleared:',
  (await post(p2.id)).targets.every((t) => !t.checklist),
)
await page.keyboard.press('Escape')

// 6. A 100 second video must be blocked for Facebook
try {
  await invoke(page, 'posts.create', {
    brandId: 1,
    sourcePath: longVid,
    title: 'Too Long',
    caption: '',
    scheduledAtUtc: new Date(Date.now() + 5 * 3600_000).toISOString(),
    status: 'scheduled',
    targets: [{ platform: 'facebook', aiFlag: false }],
  })
  log('LONG VIDEO WAS NOT BLOCKED')
} catch (e) {
  log(
    'long video blocked:',
    String(e.message).replace(/^Error invoking remote method '[^']+': Error: /, ''),
  )
}

// 7. Token expiry warning: 5 days left
fake.state.expiresAt = Math.floor(Date.now() / 1000) + 5 * 86400
await invoke(page, 'meta.checkHealth')
await nav(page, 'Connections')
await sleep(800)
const st2 = await invoke(page, 'meta.status')
log('expiry:', st2.daysLeft, 'days left | expiringSoon', st2.expiringSoon)
await shot(page, 'p3e-expiry')

// 8. Dead login
fake.state.invalidToken = true
await invoke(page, 'meta.checkHealth')
await sleep(600)
log(
  'after rejected login: meta status =',
  (await invoke(page, 'meta.status')).status,
  '| brand 1 instagram =',
  (await invoke(page, 'accounts.list', 1)).find((a) => a.platform === 'instagram').status,
)
await shot(page, 'p3e-needs-reauth')
log('page errors:', JSON.stringify(errors))
await app.close()
await fake.close()
