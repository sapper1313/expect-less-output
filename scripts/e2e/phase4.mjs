// Phase 4 end to end: the real app against a local fake TikTok. Nothing here touches TikTok.
import { DateTime } from 'luxon'
import { startFakeTikTok } from '../../tests/fakeTikTok.ts'
import { launch, makeVideos, shot, nav, invoke, sleep } from './lib.mjs'
import { tmpdir } from 'os'
import { join } from 'path'

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a)
const fake = await startFakeTikTok()
process.env.ELO_TIKTOK_BASE = fake.base
process.env.ELO_TEST_NO_BROWSER = '1'
const vids = makeVideos(join(tmpdir(), 'elo-vids'), ['tt_a.mp4', 'tt_b.mp4', 'tt_c.mp4'])
const { app, page } = await launch()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await app.evaluate(({ dialog }, files) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files[0]] })
}, vids.slice(2))

async function waitFor(fn, ms, label) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(500)
  }
  throw new Error('timeout: ' + label)
}
const post = (id) => invoke(page, 'posts.get', id)
const tt = async (brandId) =>
  (await invoke(page, 'accounts.list', brandId)).find((a) => a.platform === 'tiktok')
const lastCode = () => app.evaluate(() => globalThis.__ttLast ?? null)
const section = (name) => page.locator(`section:has(h2:text-is("${name}"))`)

// 1. Credentials
await nav(page, 'Connections')
await section('TikTok credentials')
  .locator('input[placeholder="Client key"]')
  .fill(fake.state.clientKey)
await section('TikTok credentials')
  .locator('input[placeholder="Client secret"]')
  .fill(fake.state.clientSecret)
await section('TikTok credentials').locator('button:has-text("Save")').click()
await waitFor(
  async () => (await invoke(page, 'tiktok.credentialsStatus')).hasClientSecret,
  5000,
  'credentials saved',
)
const cs = await invoke(page, 'tiktok.credentialsStatus')
log(
  'credentials masked:',
  cs.clientKeyMasked,
  cs.clientSecretMasked,
  '| redirect',
  cs.redirectUri,
  '| raw leaked?',
  JSON.stringify(cs).includes(fake.state.clientSecret),
)

// 2. Connect brand 1 through the expectless:// link (the bounce page)
await section('Trash Panda').locator('button:has-text("Connect TikTok")').click()
const first = await waitFor(lastCode, 10000, 'authorize url fetched')
await app.evaluate(
  ({ app }, url) => app.emit('open-url', { preventDefault() {} }, url),
  `expectless://oauth/tiktok?code=${encodeURIComponent(first.code)}&state=${first.state}`,
)
await waitFor(async () => (await tt(1)).mode === 'drafts', 15000, 'brand 1 connected')
log('brand 1 TikTok:', JSON.stringify(await tt(1)))

// 3. Connect brand 2 with the Paste code fallback
fake.state.user = { ...fake.state.user, open_id: 'OPEN2', display_name: 'Clock Out TikTok' }
await app.evaluate(() => {
  globalThis.__ttLast = null
})
await section('Clock Out Early').locator('button:has-text("Connect TikTok")').click()
const second = await waitFor(lastCode, 10000, 'second authorize')
await section('Clock Out Early').locator('input[placeholder="Paste code"]').fill(second.code)
await shot(page, 'p4e-paste-code')
await section('Clock Out Early').locator('button:has-text("Use this code")').click()
await waitFor(async () => (await tt(2)).mode === 'drafts', 15000, 'brand 2 connected')
log('brand 2 TikTok (paste code):', (await tt(2)).displayName, (await tt(2)).status)
await sleep(600)
await shot(page, 'p4e-connections')

// 4. Drafts mode: upload to inbox, then needs_action
const when1 = new Date(Date.now() + 40_000).toISOString()
const p1 = await invoke(page, 'posts.create', {
  brandId: 1,
  sourcePath: vids[0],
  title: 'Draft Test',
  caption: 'Draft #trashpanda',
  scheduledAtUtc: when1,
  status: 'scheduled',
  targets: [{ platform: 'tiktok', aiFlag: true }],
})
await waitFor(
  async () => (await post(p1.id)).targets[0].status === 'needs_action',
  150000,
  'draft needs_action',
)
const ini = fake.state.inits[0]
log(
  'drafts: init mode',
  ini.mode,
  '| post_info sent?',
  ini.body.post_info !== undefined,
  '| upload complete',
  Object.values(fake.state.uploads)[0].complete,
)
await nav(page, 'Queue')
await page.selectOption('select[aria-label="Status"]', 'all')
await page.click('tr:has-text("Draft Test")')
await page.waitForSelector('text=Waiting for you')
await shot(page, 'p4e-draft-waiting')
await page.click('button:has-text("Mark as posted")')
await waitFor(async () => (await post(p1.id)).status === 'posted', 8000, 'mark as posted')
log('after Mark as posted:', (await post(p1.id)).status, (await post(p1.id)).videoPath)
await page.keyboard.press('Escape')

// 5. Switch brand 1 to Direct post through the UI (after confirming the audit)
await invoke(page, 'tiktok.saveCredentials', '', '', cs.redirectUri, true)
await nav(page, 'Connections')
await section('Trash Panda').locator('select').selectOption('direct')
await page.waitForSelector('[role=dialog]:has-text("Switch to Direct post")')
await shot(page, 'p4e-direct-confirm')
await page.click('button:has-text("Yes, it is approved")')
await waitFor(async () => (await tt(1)).mode === 'direct', 8000, 'direct mode')
log('brand 1 mode:', (await tt(1)).mode)

// 6. The Direct Post screen
await nav(page, 'New Post')
await page.click('button:has-text("Choose a video")')
await page.waitForSelector('img[alt="Poster frame"]', { timeout: 20000 })
for (const label of ['YouTube', 'Facebook', 'Instagram'])
  await page.locator(`label:has-text("${label}") input`).first().uncheck()
await page.waitForSelector('[data-testid=tiktok-section]', { timeout: 15000 })
await sleep(500)
await shot(page, 'p4e-direct-screen')
const fineDisabled = await page.locator('button:has-text("Fine.")').isDisabled()
const privacyValue = await page.locator('select[aria-label="Who can view this video"]').inputValue()
const options = await page
  .locator('select[aria-label="Who can view this video"] option')
  .allTextContents()
log(
  'direct screen: privacy default =',
  JSON.stringify(privacyValue),
  '| options =',
  JSON.stringify(options),
  '| Fine disabled at start =',
  fineDisabled,
)
const toggles = await page
  .locator('[data-testid=tiktok-section] input[type=checkbox]')
  .evaluateAll((els) => els.map((e) => ({ checked: e.checked, disabled: e.disabled })))
log('checkbox states (comment, duet, stitch, commercial, consent):', JSON.stringify(toggles))
log(
  'nickname shown:',
  (await page.locator('text=Post to TikTok as Trash Panda TikTok').count()) > 0,
)

// commercial disclosure rules
const cb = (name) => page.getByRole('checkbox', { name, exact: true })
const consent = () => page.getByRole('checkbox', { name: /By posting, you agree/ })
await cb('Disclose commercial content').check()
await shot(page, 'p4e-commercial-empty')
await cb('Branded content').check()
await page.selectOption('select[aria-label="Who can view this video"]', 'PUBLIC_TO_EVERYONE')
await sleep(300)
await shot(page, 'p4e-branded-consent')
const brandedSelfOnlyDisabled = await page
  .locator('select[aria-label="Who can view this video"] option[value=SELF_ONLY]')
  .evaluate((el) => el.disabled)
log(
  'branded content: Only me disabled =',
  brandedSelfOnlyDisabled,
  '| consent text mentions Branded Content Policy =',
  (await page.locator('text=Branded Content Policy').count()) > 0,
)
await cb('Branded content').uncheck()
await cb('Your brand').check()
await cb('Disclose commercial content').uncheck()

// finish the form with a private post due in 1 minute
await page.selectOption('select[aria-label="Who can view this video"]', 'SELF_ONLY')
await cb('Comment').check()
await consent().check()
await page.selectOption('select:has(option:has-text("Pick a different time"))', '__custom')
const eastern = DateTime.now()
  .setZone('America/New_York')
  .plus({ minutes: 1 })
  .toFormat("yyyy-LL-dd'T'HH:mm")
await page.fill('input[type=datetime-local]', eastern)
await sleep(300)
log('Fine enabled after choices:', !(await page.locator('button:has-text("Fine.")').isDisabled()))
await shot(page, 'p4e-direct-ready')
await page.click('button:has-text("Fine.")')
await waitFor(
  async () =>
    (await invoke(page, 'posts.list', {})).some(
      (p) => p.title.length && p.targets.some((t) => t.settings?.tiktok),
    ),
  8000,
  'direct post created',
)
const dp = (await invoke(page, 'posts.list', {})).find((p) =>
  p.targets.some((t) => t.settings?.tiktok),
)
log(
  'saved TikTok settings:',
  JSON.stringify(dp.targets.find((t) => t.platform === 'tiktok').settings.tiktok),
)
await waitFor(async () => (await post(dp.id)).status === 'posted', 180000, 'direct post completed')
const dinit = fake.state.inits.find((i) => i.mode === 'direct')
log('direct post_info sent:', JSON.stringify(dinit.body.post_info))
log('direct result:', (await post(dp.id)).targets.find((t) => t.platform === 'tiktok').externalUrl)

// 7. Demo mode
await page.keyboard.press('Meta+Shift+D')
await page.waitForSelector('text=Demo mode. This shows the real TikTok screens')
await shot(page, 'p4e-demo-1')
await page.click('button:has-text("Next")')
await page.click('button:has-text("Next")')
await page.selectOption('select[aria-label="Who can view this video"]', 'MUTUAL_FOLLOW_FRIENDS')
await consent().check()
await shot(page, 'p4e-demo-3')
await page.click('button:has-text("Next")')
const before = fake.state.inits.length
await page.click('button:has-text("Fine.")')
await page.waitForSelector('text=Demo only: nothing was sent.', { timeout: 8000 })
await shot(page, 'p4e-demo-4')
log('demo sent anything to TikTok?', fake.state.inits.length !== before)
await page.click('button:has-text("Leave demo")')

// 8. Dead login
fake.state.accessTokens.clear()
fake.state.refreshInvalid = true
await invoke(page, 'tiktok.creatorInfo', 1, true).catch((e) =>
  log(
    'creator info after dead login:',
    String(e.message).replace(/^Error invoking remote method '[^']+': Error: /, ''),
  ),
)
await sleep(600)
log('after dead login: brand 1 status =', (await tt(1)).status)
await nav(page, 'Connections')
await sleep(500)
await shot(page, 'p4e-needs-reauth')
log('page errors:', JSON.stringify(errors))
await app.close()
await fake.close()
