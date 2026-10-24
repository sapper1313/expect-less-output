// QA flows: schedule a post with the new pickers, reschedule it, edit it, change settings times, and make sure forms
// keep what you typed while the app reloads in the background.
import { DateTime } from 'luxon'
import { launch, makeVideos, shot, nav, invoke, sleep } from './lib.mjs'
import { tmpdir } from 'os'
import { join } from 'path'

const vids = makeVideos(join(tmpdir(), 'elo-vids'), ['flow_a.mp4', 'flow_b.mp4', 'flow_c.mp4'])
const { app, page } = await launch()
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let failures = 0
const check = (ok, what, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}
await app.evaluate(({ dialog }, files) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
}, vids)
await sleep(1500)

const eastern = (iso) => DateTime.fromISO(iso, { zone: 'utc' }).setZone('America/New_York')
const future = DateTime.now().setZone('America/New_York').plus({ days: 20 })
const dateStr = future.toFormat('yyyy-LL-dd')

/** Sets a DateTimeSelect by its label: date, then hour, minute and AM or PM. */
async function setWhen(label, date, hour12, minute, ampm) {
  await page.fill(`input[type=date][aria-label="${label}, date"]`, date)
  await page.selectOption(`select[aria-label="${label}, time, hour"]`, String(hour12))
  await page.selectOption(`select[aria-label="${label}, time, minute"]`, String(minute))
  await page.selectOption(`select[aria-label="${label}, time, AM or PM"]`, ampm)
}

// ---- 1. schedule one video with a custom time from the pickers
await nav(page, 'Schedule')
await page.click('button:has-text("Choose a video")')
await page.waitForSelector('input[placeholder*="itle"], input[aria-label*="itle"]', { timeout: 20000 }).catch(() => {})
await sleep(1500)
const sel = page.locator('main select').filter({ has: page.locator('option:has-text("Pick a different time")') })
if ((await sel.count()) > 0) await sel.first().selectOption('__custom')
await sleep(500)
await setWhen('Date and time in Eastern', dateStr, 7, 25, 'PM')
await sleep(500)
await shot(page, 'flow-schedule-custom-time')
await page.click('button:text-is("Save")')
await sleep(2500)
let posts = await invoke(page, 'posts.list', {})
const mine = posts.find((p) => p.status === 'scheduled')
check(!!mine, 'a post was scheduled from the Schedule screen')
if (mine) {
  const e = eastern(mine.scheduledAtUtc)
  check(e.toFormat('yyyy-LL-dd HH:mm') === `${dateStr} 19:25`, 'the picked date and 7:25 PM were saved in Eastern time', e.toFormat('yyyy-LL-dd HH:mm'))
}

// ---- 2. the Queue shows it and can reschedule it with the pickers
await nav(page, 'Queue')
await page.selectOption('select[aria-label="Status"]', 'upcoming').catch(() => {})
await sleep(800)
const box = page.locator('input[type=checkbox][aria-label^="Select"]').first()
await box.check()
const nd = future.plus({ days: 1 }).toFormat('yyyy-LL-dd')
await setWhen('New time in Eastern', nd, 9, 40, 'AM')
await page.click('button:has-text("Reschedule")')
await sleep(2500)
posts = await invoke(page, 'posts.list', {})
const moved = posts.find((p) => p.id === mine?.id)
check(!!moved && eastern(moved.scheduledAtUtc).toFormat('yyyy-LL-dd HH:mm') === `${nd} 09:40`, 'Queue reschedule with the pickers saved 9:40 AM', moved ? eastern(moved.scheduledAtUtc).toFormat('HH:mm') : 'missing')

// ---- 3. the post editor changes the time with the pickers
await page.locator('tbody tr').first().click()
await sleep(1200)
await page.selectOption('select[aria-label="When, time, minute"]', '5')
await page.selectOption('select[aria-label="When, time, AM or PM"]', 'PM')
await shot(page, 'flow-editor')
await page.click('[role=dialog] button:text-is("Save")')
await sleep(2500)
posts = await invoke(page, 'posts.list', {})
const edited = posts.find((p) => p.id === mine?.id)
check(!!edited && eastern(edited.scheduledAtUtc).toFormat('HH:mm') === '21:05', 'editing the time in the post editor saved 9:05 PM', edited ? eastern(edited.scheduledAtUtc).toFormat('HH:mm') : 'missing')

// ---- 4. Bulk: many videos, each row has date and time pickers
await nav(page, 'Schedule')
await page.click('button:has-text("Many videos")')
await page.click('button:has-text("Choose videos")')
await page.click('button:has-text("Assign slots")')
await page.waitForSelector('table tbody tr', { timeout: 30000 })
await sleep(600)
check((await page.locator('table tbody tr input[type=date]').count()) === 3, 'Bulk upload rows have a date picker each')
check((await page.locator('table tbody tr select[aria-label$="time, hour"]').count()) === 3, 'and hour, minute and AM/PM selectors each')
await shot(page, 'flow-bulk')

// ---- 5. settings times
await nav(page, 'Settings')
await page.click('main button:has-text("Alerts and backup")')
await sleep(600)
await page.selectOption('select[aria-label="Quiet hours start, hour"]', '11')
await page.selectOption('select[aria-label="Quiet hours start, AM or PM"]', 'PM')
await sleep(800)
check((await invoke(page, 'settings.get')).alertQuietStart.startsWith('23:'), 'quiet hours start saved as 11 PM')
await nav(page, 'Channels')
await page.click('main button:has-text("Studio settings per channel")')
await sleep(800)
await page.selectOption('select[aria-label="Production run time, hour"]', '6')
await sleep(1000)
const sb = await invoke(page, 'studio.brands')
const run = sb[0]?.config?.runTime
check(/^06:/.test(run ?? ''), 'the production run time saved from the selectors', String(run))

// ---- 6. forms keep your typing while the app reloads in the background
await nav(page, 'Channels')
await page.click('main button:has-text("Channel setup")')
await sleep(800)
const caption = page.locator('textarea').first()
await caption.fill('My template for {title} {hashtags}')
await invoke(page, 'settings.set', { theme: 'dark' })
await sleep(2500)
check((await page.locator('textarea').first().inputValue()) === 'My template for {title} {hashtags}', 'Defaults editor keeps your typing after a background reload')

await nav(page, 'Studio')
await page.click('main button:has-text("Bible")')
await sleep(1000)
const premise = page.locator('textarea').first()
await premise.fill('A premise I am still typing')
await invoke(page, 'settings.set', { theme: 'dark' })
await sleep(2500)
check((await page.locator('textarea').first().inputValue()) === 'A premise I am still typing', 'Bible keeps your typing after a background reload')

// ---- 7. an open slot on the calendar starts a post at that time
await nav(page, 'Calendar')
await sleep(1000)
const addBtn = page.locator('main button:has-text("Add a video")').first()
check((await addBtn.count()) > 0, 'the calendar shows an open slot with an Add a video button')
await addBtn.click()
await sleep(1200)
check((await page.locator('main').innerText()).toLowerCase().includes('choose a video'), 'clicking an open slot opens Schedule')

check(errors.length === 0, 'no uncaught page errors', errors.join(' | '))
await app.close()
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll flow checks passed')
process.exit(failures ? 1 : 0)
