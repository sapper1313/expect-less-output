// Phase 5 end to end: alerts, health, pause, duplicate, search, preview, shortcuts, backup and restore.
// Alerts go to a log file instead of the real Messages app. Nothing here contacts any platform.
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launch, makeVideos, shot, nav, invoke, sleep } from './lib.mjs'

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a)
const alertLog = join(mkdtempSync(join(tmpdir(), 'elo-alertlog-')), 'imessages.log')
writeFileSync(alertLog, '')
process.env.ELO_FAKE_IMESSAGE_LOG = alertLog
const sent = () => readFileSync(alertLog, 'utf8').split('\n').filter(Boolean)
const vids = makeVideos(join(tmpdir(), 'elo-vids'), ['p5_a.mp4', 'p5_b.mp4'])
const dataDir = mkdtempSync(join(tmpdir(), 'elo-p5-data-'))
const mediaRoot = mkdtempSync(join(tmpdir(), 'elo-p5-media-'))
let { app, page } = await launch({ dataDir, mediaRoot })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await app.evaluate(({ dialog }, files) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
}, vids)

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

// 1. Alerts card and the test buttons
await nav(page, 'Settings')
await page.waitForSelector('text=Alerts (failures only)')
await page.getByRole('button', { name: 'Send test alert' }).click()
await page.waitForSelector('text=Sent (test log).')
log(
  'settings: iMessage number field =',
  await page.locator('input[placeholder="+18045551234"]').inputValue(),
)
log('test alert logged:', sent().length, 'line(s)')
await page.getByRole('button', { name: 'Send test notification' }).click()
await sleep(300)
await page.locator('text=Alerts (failures only)').scrollIntoViewIfNeeded()
await shot(page, 'p5e-alerts-card')

// 2. A forced failure sends exactly one message after the final retry
await invoke(page, 'settings.set', {
  dryRunFailPlatform: 'instagram',
  dryRunFailKind: 'transient',
  fastBackoff: true,
})
const when = new Date(Date.now() + 30_000).toISOString()
const p1 = await invoke(page, 'posts.create', {
  brandId: 1,
  sourcePath: vids[0],
  title: 'Fridge Math',
  caption: 'Math #trashpanda',
  scheduledAtUtc: when,
  status: 'scheduled',
  targets: [{ platform: 'instagram', aiFlag: false }],
})
const before = sent().length
await waitFor(
  async () => (await post(p1.id)).targets[0].status === 'failed',
  240000,
  'final failure',
)
await sleep(1500)
const after = sent().slice(before)
log('alerts after the final failure:', after.length)
after.forEach((l) => log('  ', l.split('\t')[1]))
await invoke(page, 'settings.set', { dryRunFailPlatform: null, fastBackoff: false })

// 3. Duplicate (from the editor), search, per-platform preview
await nav(page, 'Queue')
await page.selectOption('select[aria-label="Status"]', 'all')
await page.locator('tr:has-text("Fridge Math")').first().click()
await page.waitForSelector('text=What each platform will get')
await shot(page, 'p5e-editor-preview')
log('preview text shown:', (await page.locator('text=Math #trashpanda').count()) > 0)
await page.getByRole('button', { name: 'Duplicate' }).click()
await sleep(800)
const all = await invoke(page, 'posts.list', {})
log(
  'after duplicate:',
  all.length,
  'posts;',
  all
    .filter((p) => p.title === 'Fridge Math')
    .map((p) => `${p.id}:${p.status}`)
    .join(', '),
)
await page.fill('input[aria-label="Search"]', 'fridge')
await sleep(700)
log('search "fridge" rows:', await page.locator('tbody tr').count())
await page.fill('input[aria-label="Search"]', 'zzzz-nothing')
await sleep(700)
log(
  'search "zzzz-nothing" rows:',
  await page.locator('tbody tr').count(),
  '(empty message shown:',
  (await page.locator('text=Nothing in the queue').count()) > 0,
  ')',
)
await page.fill('input[aria-label="Search"]', '')

// 4. Keyboard shortcuts
const heading = async () => (await page.locator('h1').first().textContent())?.trim()
await page.keyboard.press('Meta+1')
await sleep(300)
const h1 = await heading()
await page.keyboard.press('Meta+2')
await sleep(300)
const h2 = await heading()
await page.keyboard.press('Meta+n')
await sleep(300)
const h3 = await heading()
await page.keyboard.press('Meta+Shift+n')
await sleep(300)
const h4 = await heading()
log('shortcuts: Cmd+1 =', h1, '| Cmd+2 =', h2, '| Cmd+N =', h3, '| Cmd+Shift+N =', h4)

// 5. Pause one brand
const w2 = new Date(Date.now() + 25_000).toISOString()
const pa = await invoke(page, 'posts.create', {
  brandId: 1,
  sourcePath: vids[1],
  title: 'Paused One',
  caption: '',
  scheduledAtUtc: w2,
  status: 'scheduled',
  targets: [{ platform: 'tiktok', aiFlag: false }],
})
const pb = await invoke(page, 'posts.create', {
  brandId: 2,
  sourcePath: vids[1],
  title: 'Not Paused',
  caption: '',
  scheduledAtUtc: w2,
  status: 'scheduled',
  targets: [{ platform: 'tiktok', aiFlag: false }],
})
await nav(page, 'Brands')
await page.getByRole('checkbox', { name: 'Pause this brand' }).click()
await waitFor(
  async () => (await invoke(page, 'settings.get')).pausedBrandIds.includes(1),
  5000,
  'brand paused',
)
await sleep(300)
await shot(page, 'p5e-brand-pause')
await waitFor(async () => (await post(pb.id)).status === 'posted', 150000, 'other brand posts')
log(
  'brand 2 post:',
  (await post(pb.id)).status,
  '| brand 1 (paused) post:',
  (await post(pa.id)).status,
)
await page.getByRole('checkbox', { name: 'Pause this brand' }).click()
await waitFor(
  async () => !(await invoke(page, 'settings.get')).pausedBrandIds.includes(1),
  5000,
  'brand resumed',
)
await waitFor(
  async () => (await post(pa.id)).status === 'posted',
  90000,
  'resumed brand posts late',
)
log('after resume, brand 1 post:', (await post(pa.id)).status)

// 6. Health panel with real-looking accounts (written straight into the database)
{
  const db = new Database(join(dataDir, 'elo.sqlite'))
  db.prepare(
    "UPDATE accounts SET mode='auto', display_name='Trash Panda Channel', last_checked_at=? WHERE brand_id=1 AND platform='youtube'",
  ).run(new Date().toISOString())
  db.prepare(
    "UPDATE accounts SET mode='drafts', status='needs_reauth', display_name='TP TikTok' WHERE brand_id=1 AND platform='tiktok'",
  ).run()
  db.close()
}
await nav(page, 'Connections')
await sleep(900)
await shot(page, 'p5e-health')
log('health rows:', await page.locator('section:has(h2:text-is("Health")) tbody tr').count())

// 7. Backup, then restore into a brand new data folder
await app.evaluate(
  ({ dialog }, out) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: out })
  },
  join(dataDir, 'backup.zip'),
)
await nav(page, 'Settings')
await page.getByRole('button', { name: 'Export backup' }).click()
await waitFor(async () => existsSync(join(dataDir, 'backup.zip')), 15000, 'backup file')
log('backup written:', existsSync(join(dataDir, 'backup.zip')))
await shot(page, 'p5e-backup-done')
await app.close()

const newData = mkdtempSync(join(tmpdir(), 'elo-p5-new-data-'))
const newRoot = join(mkdtempSync(join(tmpdir(), 'elo-p5-new-media-')), 'Expect Less Output')
;({ app, page } = await launch({
  dataDir: newData,
  mediaRoot: join(mkdtempSync(join(tmpdir(), 'elo-tmp-media-')), 'x'),
}))
page.on('pageerror', (e) => errors.push(e.message))
await app.evaluate(
  ({ dialog }, args) => {
    dialog.showOpenDialog = async (opts) => ({
      canceled: false,
      filePaths: [opts?.properties?.includes('openDirectory') ? args.root : args.zip],
    })
  },
  { zip: join(dataDir, 'backup.zip'), root: newRoot },
)
await nav(page, 'Settings')
await page.getByRole('button', { name: 'Restore from backup' }).click()
await page.waitForSelector('text=You will need to reconnect')
await shot(page, 'p5e-restore-preview')
await page
  .locator('section:has(h2:text-is("Backup and restore")) button:has-text("Choose")')
  .click()
await sleep(400)
// the app restarts itself after a restore; here the test restarts it by hand
await page.getByRole('button', { name: 'Restore and restart' }).first().click()
await page.getByRole('dialog').getByRole('button', { name: 'Restore and restart' }).click()
await sleep(2500)
await app.close().catch(() => {})
;({ app, page } = await launch({ dataDir: newData, mediaRoot: newRoot }))
page.on('pageerror', (e) => errors.push(e.message))
await sleep(1500)
const s2 = await invoke(page, 'settings.get')
const posts2 = await invoke(page, 'posts.list', {})
const accts2 = await invoke(page, 'accounts.list')
const rep = await invoke(page, 'backup.report')
log('restored media root =', s2.mediaRoot === newRoot ? 'the new folder' : s2.mediaRoot)
log(
  'restored posts:',
  posts2.length,
  '| accounts needing reconnect:',
  accts2
    .filter((a) => a.status === 'needs_reauth')
    .map((a) => `${a.brandId}/${a.platform}`)
    .join(', '),
)
log('report lists:', rep?.accountsToReconnect.map((a) => `${a.brandName} ${a.platform}`).join(', '))
log('secrets file in new data folder?', existsSync(join(newData, 'secrets.bin')))
await shot(page, 'p5e-restored-banner')
await page.getByRole('button', { name: 'Dismiss' }).click()
await sleep(400)
log('banner dismissed:', (await page.locator('text=Restored from backup').count()) === 0)
log('page errors:', JSON.stringify(errors))
await app.close()
