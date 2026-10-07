// Phase 5 backup and restore end to end (the part that needs the app to restart itself).
import Database from 'better-sqlite3'
import { execSync } from 'child_process'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launch, makeVideos, shot, nav, invoke, sleep } from './lib.mjs'

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a)
const vids = makeVideos(join(tmpdir(), 'elo-vids'), ['p5_a.mp4'])
const dataDir = mkdtempSync(join(tmpdir(), 'elo-p5r-data-'))
const mediaRoot = mkdtempSync(join(tmpdir(), 'elo-p5r-media-'))
let { app, page } = await launch({ dataDir, mediaRoot })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
async function waitFor(fn, ms, label) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(500)
  }
  throw new Error('timeout: ' + label)
}
// A scheduled post and two connected-looking accounts to carry across
await invoke(page, 'posts.create', {
  brandId: 1,
  sourcePath: vids[0],
  title: 'Move Me',
  caption: 'c',
  scheduledAtUtc: new Date(Date.now() + 5 * 3600_000).toISOString(),
  status: 'scheduled',
  targets: [{ platform: 'tiktok', aiFlag: false }],
})
await invoke(page, 'settings.set', { missedGraceMinutes: 77 })
{
  const db = new Database(join(dataDir, 'elo.sqlite'))
  db.prepare(
    "UPDATE accounts SET mode='auto', display_name='Trash Panda Channel' WHERE brand_id=1 AND platform='youtube'",
  ).run()
  db.prepare(
    "UPDATE accounts SET mode='drafts', display_name='TP TikTok' WHERE brand_id=1 AND platform='tiktok'",
  ).run()
  db.close()
}
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
// The app restarted itself after the restore. Stop that copy so the test can look at the result.
try {
  execSync('pkill -f "node_modules/electron/dist/Electron.app"')
} catch {}
await sleep(1500)
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
