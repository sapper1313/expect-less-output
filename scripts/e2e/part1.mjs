// Acceptance part 1: bulk upload slots, calendar views, colors, drag to reschedule.
import { DateTime } from 'luxon'
import { launch, makeVideos, shot, nav, invoke, sleep } from './lib.mjs'
import { tmpdir } from 'os'
import { join } from 'path'

const vids = makeVideos(join(tmpdir(), 'elo-vids'), [
  'clip_10.mp4',
  'clip_2.mp4',
  'clip_1.mp4',
  'clip_3.mp4',
  'clip_4.mp4',
])
const { app, page, data, media } = await launch()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
console.log('data', data, '\nmedia', media)

// Stub the native file dialog so the test can "choose" files.
await app.evaluate(({ dialog }, files) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
}, vids)

await nav(page, 'Bulk Upload')
await page.click('button:has-text("Choose videos")')
await page.click('button:has-text("Assign slots")')
await page.waitForSelector('table tbody tr', { timeout: 30000 })
await sleep(500)
await shot(page, 'p1-bulk-grid')

const rows = await page.$$eval('table tbody tr', (trs) =>
  trs.map((tr) => ({
    file: tr.querySelector('.break-all')?.textContent,
    title: tr.querySelectorAll('input')[0]?.value,
    when: tr.querySelector('input[type=datetime-local]')?.value,
  })),
)
console.log(rows)

// Verify slots independently: Eastern wall clock, in order, weekday 08:00/17:00, weekend 10:00/18:00, in the future.
const now = DateTime.now().setZone('America/New_York')
let ok = rows.length === 5
let prev = now
for (const r of rows) {
  const dt = DateTime.fromFormat(r.when, "yyyy-LL-dd'T'HH:mm", { zone: 'America/New_York' })
  const allowed = dt.weekday >= 6 ? ['10:00', '18:00'] : ['08:00', '17:00']
  if (!dt.isValid || dt <= prev || !allowed.includes(dt.toFormat('HH:mm'))) ok = false
  prev = dt
}
const order = rows.map((r) => r.file)
const natural = ['clip_1.mp4', 'clip_2.mp4', 'clip_3.mp4', 'clip_4.mp4', 'clip_10.mp4']
console.log('natural filename order ok:', JSON.stringify(order) === JSON.stringify(natural))
console.log('5 correct Eastern slots:', ok)

await page.click('button:has-text("Fine.")')
await page.waitForSelector('.fc', { timeout: 15000 })
await sleep(800)
await shot(page, 'p1-calendar-month')

// First scheduled slot may be next month: jump to its month if the grid shows nothing.
const posts = await invoke(page, 'posts.list', {})
console.log('posts created:', posts.length, 'statuses', [...new Set(posts.map((p) => p.status))])
console.log('files in Queue:', posts.map((p) => p.videoPath).join(', '))

// Calendar: add events for other brands so colors show
const brands = await invoke(page, 'brands.list')
for (const [i, b] of brands.slice(1).entries()) {
  const when = (await invoke(page, 'slots.next', b.id, 2))[i % 2]
  await invoke(page, 'posts.create', {
    brandId: b.id,
    sourcePath: vids[i],
    title: `${b.name} clip`,
    caption: 'c',
    scheduledAtUtc: when,
    status: 'scheduled',
    targets: [
      { platform: 'youtube', aiFlag: false },
      { platform: 'tiktok', aiFlag: false },
    ],
  })
}
await nav(page, 'Calendar')
await sleep(800)
await shot(page, 'p1-calendar-all-brands')
await page.selectOption('select[aria-label="Brand"]', String(brands[0].id))
await sleep(500)
await shot(page, 'p1-calendar-one-brand')
await page.selectOption('select[aria-label="Brand"]', 'all')
await page.click('button.fc-timeGridWeek-button')
await sleep(800)
await shot(page, 'p1-calendar-week')
await page.click('button.fc-dayGridMonth-button')
await sleep(600)

// Drag the first event to a different day cell and confirm.
const ev = page.locator('.fc-event').first()
await ev.waitFor()
const before = await invoke(page, 'posts.list', {})
const target = before.find((p) => p.title === undefined)
const evBox = await ev.boundingBox()
const cells = await page.$$('.fc-daygrid-day')
let dest = null
for (const c of cells) {
  const b = await c.boundingBox()
  if (
    b &&
    b.y > evBox.y + 5 &&
    b.y < evBox.y + 200 &&
    Math.abs(b.x - evBox.x) < 160 &&
    !(await c.$('.fc-event'))
  ) {
    dest = b
    break
  }
}
if (!dest) {
  for (const c of cells) {
    const b = await c.boundingBox()
    if (b && Math.abs(b.y - evBox.y) < 10 && b.x > evBox.x + 20 && !(await c.$('.fc-event'))) {
      dest = b
      break
    }
  }
}
console.log('drag from', evBox, 'to', dest)
const evId = await ev.evaluate((el) => el.textContent)
await page.mouse.move(evBox.x + 30, evBox.y + 8)
await page.mouse.down()
await page.mouse.move(evBox.x + 40, evBox.y + 30, { steps: 5 })
await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 15 })
await page.mouse.up()
await page.waitForSelector('[role=dialog]:has-text("Move this post")', { timeout: 5000 })
await shot(page, 'p1-drag-confirm')
await page.click('[role=dialog] button:has-text("Move it")')
await sleep(1000)
const after = await invoke(page, 'posts.list', {})
const changed = after.filter((p) =>
  before.find((q) => q.id === p.id && q.scheduledAtUtc !== p.scheduledAtUtc),
)
console.log(
  'drag rescheduled posts:',
  changed.map((p) => `${p.title}: ${p.scheduledAtUtc}`),
)
console.log('page errors:', errors)
await shot(page, 'p1-after-drag')
await app.close()
