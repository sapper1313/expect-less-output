// Acceptance part 2: real scheduler runs. Dry run success, forced failure with retries, window close.
import Database from 'better-sqlite3'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { launch, makeVideos, shot, nav, invoke, sleep } from './lib.mjs'

const vids = makeVideos(join(tmpdir(), 'elo-vids'), ['dry_a.mp4', 'dry_b.mp4'])
const { app, page, data, media } = await launch()
const db = new Database(join(data, 'elo.sqlite'), { readonly: true })
const q = (sql, ...a) => db.prepare(sql).all(...a)
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a)
await app.evaluate(({ dialog }) => {}, null)

// ---------- A: dry-run success two minutes out ----------
const whenA = new Date(Date.now() + 2 * 60_000).toISOString()
const a = await invoke(page, 'posts.create', {
  brandId: 1,
  sourcePath: vids[0],
  title: 'Dry Run A',
  caption: 'hello',
  scheduledAtUtc: whenA,
  status: 'scheduled',
  targets: ['youtube', 'facebook', 'instagram', 'tiktok'].map((p) => ({
    platform: p,
    aiFlag: false,
  })),
})
log('A scheduled for', whenA, 'file', a.videoPath)
let doneA = null
const deadline = Date.now() + 6 * 60_000
while (Date.now() < deadline) {
  const row = q('SELECT status, video_path FROM posts WHERE id = ?', a.id)[0]
  const tg = q('SELECT platform, status FROM post_targets WHERE post_id = ?', a.id)
  if (Date.now() % 20000 < 1500)
    log('A status', row.status, tg.map((t) => `${t.platform}:${t.status}`).join(' '))
  if (row.status === 'posted') {
    doneA = { row, tg }
    break
  }
  await sleep(1000)
}
if (doneA) {
  await sleep(400)
  await shot(page, 'p2-toast-success')
  const abs = join(media, doneA.row.video_path)
  log('A RESULT: posted. targets', doneA.tg.map((t) => `${t.platform}:${t.status}`).join(' '))
  log(
    'A video_path',
    doneA.row.video_path,
    'exists',
    existsSync(abs),
    'queue still has file?',
    existsSync(join(media, 'Trash Panda', 'Queue', 'dry_a.mp4')),
  )
} else log('A RESULT: DID NOT COMPLETE')

// ---------- B: forced failure, short backoff, window closed ----------
await invoke(page, 'settings.set', {
  fastBackoff: true,
  dryRunFailPlatform: 'instagram',
  dryRunFailKind: 'transient',
})
const whenB = new Date(Date.now() + 45_000).toISOString()
const b = await invoke(page, 'posts.create', {
  brandId: 2,
  sourcePath: vids[1],
  title: 'Fridge Math',
  caption: 'x',
  scheduledAtUtc: whenB,
  status: 'scheduled',
  targets: [
    { platform: 'instagram', aiFlag: false },
    { platform: 'tiktok', aiFlag: false },
  ],
})
log('B scheduled for', whenB)
// Close the window. The scheduler must keep running from the menu bar.
const state = await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.close()
  return {
    visible: w.isVisible(),
    destroyed: w.isDestroyed(),
    windows: BrowserWindow.getAllWindows().length,
  }
})
log('after close: visible', state.visible, 'destroyed', state.destroyed, 'windows', state.windows)
let doneB = null
const deadlineB = Date.now() + 6 * 60_000
while (Date.now() < deadlineB) {
  const row = q('SELECT status FROM posts WHERE id = ?', b.id)[0]
  const t = q(
    'SELECT platform, status, attempts, last_error, next_attempt_at_utc FROM post_targets WHERE post_id = ?',
    b.id,
  )
  if (row.status === 'failed' || row.status === 'partial') {
    doneB = { row, t }
    break
  }
  await sleep(2000)
}
log('B RESULT', JSON.stringify(doneB))
const attempts = q(
  "SELECT message FROM activity_log WHERE post_id = ? AND platform = 'instagram' ORDER BY id",
  b.id,
).map((r) => r.message)
attempts.forEach((m) => log('  log:', m))
log('B file stayed in Queue:', existsSync(join(media, 'Clock Out Early', 'Queue', 'dry_b.mp4')))
const alive = await app.evaluate(({ BrowserWindow }) => ({
  windows: BrowserWindow.getAllWindows().length,
}))
log('app still running with window closed:', JSON.stringify(alive))

// Reopen and capture the failure screen.
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.show()
  w.focus()
})
await sleep(800)
await invoke(page, 'settings.set', { dryRunFailPlatform: null, fastBackoff: false })
await nav(page, 'Queue')
await page.selectOption('select[aria-label="Status"]', 'all')
await sleep(500)
await shot(page, 'p2-queue-failed')
await page.click('tr:has-text("Fridge Math")')
await sleep(600)
await shot(page, 'p2-failure-editor')
await shot(page, 'p2-failure-editor2')
await nav(page, 'Activity Log').catch(() => {})
await app.close()
