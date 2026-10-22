// QA tour: opens every screen and every tab in a fresh app, fails on any crash or console error, checks the
// things fixed in this round (solid calendar pop-up, time pickers, forms keeping edits, one pause), and saves screenshots.
import { launch, makeVideos, shot, nav, invoke, sleep } from './lib.mjs'
import { tmpdir } from 'os'
import { join } from 'path'

const vids = makeVideos(join(tmpdir(), 'elo-vids'), ['tour_a.mp4'])
const { app, page } = await launch()
page.setDefaultTimeout(15000)
const errors = []
const consoleErrors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
let failures = 0
const check = (ok, what, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}
const text = () => page.locator('main').innerText()

await sleep(1500)

// ---- every screen from the left menu
const screens = ['Home', 'Upcoming', 'Schedule', 'Inbox', 'Calendar', 'Queue', 'Studio', 'Analytics', 'Channels', 'Settings', 'Activity Log']
for (const s of screens) {
  await nav(page, s)
  await sleep(700)
  const t = await text()
  check(t.trim().length > 40, `screen "${s}" has content`, `(${t.trim().length} chars)`)
  await shot(page, `tour-${s.replace(/\s+/g, '-').toLowerCase()}`)
}
check(
  (await page.locator('nav').innerText()).toLowerCase().includes('create and schedule'),
  'the menu is grouped by workflow',
)
check((await page.locator('nav button:has-text("Bulk Upload")').count()) === 0, 'Bulk Upload is not a separate menu item')
check((await page.locator('nav button:has-text("New Post")').count()) === 0, 'New Post is not a separate menu item')

// ---- Schedule has one tab for one video and one for many
await nav(page, 'Schedule')
for (const label of ['One video', 'Many videos', 'One video']) {
  await page.click(`button:has-text("${label}")`)
  await sleep(500)
  check((await text()).trim().length > 40, `Schedule tab "${label}" has content`)
}
await shot(page, 'tour-schedule-one')

// ---- tabs inside Studio, Channels, Settings, Analytics
const tabs = {
  Studio: ['Overview', 'Research', 'Bible', 'Library', 'Flagged', 'Publishing', 'Comments', 'Spend', "Director's Log"],
  Channels: ['Channel setup', 'Connections', 'Studio settings per channel'],
  Settings: ['General', 'Pipeline', 'Studio', 'AI models and Local AI', 'Alerts and backup', 'Agent API', 'Testing tools'],
  Analytics: ['Numbers', "What's working"],
  Inbox: ['Waiting', 'Held', 'Rejected', 'Log', 'Issues'],
  'Activity Log': ['Activity log', 'Audit log'],
}
for (const [screen, list] of Object.entries(tabs)) {
  await nav(page, screen)
  for (const tab of list) {
    const b = page.locator(`main button:has-text("${tab}")`).first()
    if ((await b.count()) === 0) {
      check(false, `${screen} tab "${tab}" exists`)
      continue
    }
    await b.click()
    await sleep(600)
    check((await text()).trim().length > 40, `${screen} > ${tab} has content`)
    await shot(page, `tour-${screen.toLowerCase()}-${tab.toLowerCase().replace(/[^a-z]+/g, '-')}`)
  }
}
check((await page.locator('main button:has-text("Insights")').count()) === 0, 'Studio has no separate Insights tab (it moved to Analytics)')

// ---- Studio tab order follows the work
await nav(page, 'Studio')
const order = await page.locator('main button').allInnerTexts()
const want = ['Overview', 'Research', 'Bible', 'Library', 'Flagged', 'Publishing', 'Comments', 'Spend']
const idx = want.map((w) => order.findIndex((o) => o.startsWith(w)))
check(idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])), 'Studio tabs are in workflow order')

// ---- the bot pipeline
await nav(page, 'Settings')
await page.click('main button:has-text("Pipeline")')
await sleep(500)
const claudeBox = page.locator('main label:has-text("Allow ELO to use the Claude API") input[type=checkbox]')
check((await claudeBox.count()) === 1 && !(await claudeBox.isChecked()), 'a new install starts with the Claude API switched off')
const prodBox = page.locator('main label:has-text("Let ELO write and produce episodes itself") input[type=checkbox]')
check((await prodBox.count()) === 1 && !(await prodBox.isChecked()), 'and Studio production switched off')
await shot(page, 'tour-settings-pipeline-full')
await nav(page, 'Studio')
await sleep(500)
check((await text()).includes('Writing and production are off'), 'the Studio shows the banner while production is off')
await nav(page, 'Channels')
await page.click('main button:has-text("Channel setup")')
await sleep(800)
check((await text()).includes('Pipeline rules'), 'Channel setup has the Pipeline rules card')
check((await page.locator('main input[value="trash-panda"]').count()) > 0, 'Channel setup shows the channel slug')
const idea = await invoke(page, 'upcoming.add', { channel: 'trash-panda', working_title: 'Tour idea: raccoon taxes', premise: 'He files on time' })
check(/^trash-panda-\d{4}-0101$/.test(idea.episode_id), 'adding an idea makes the next episode id', idea.episode_id)
await nav(page, 'Upcoming')
await sleep(900)
check((await text()).includes('Tour idea: raccoon taxes'), 'Upcoming Board shows the new idea')
await page.click('main button:has-text("Table")')
await sleep(500)
check((await text()).includes(idea.episode_id), 'Upcoming Table shows the episode id')
await shot(page, 'tour-upcoming-table')
await page.click('main button:has-text("Board")')
await sleep(300)
await nav(page, 'Activity Log')
await page.click('main button:has-text("Audit log")')
await sleep(700)
check((await text()).includes('upcoming.add'), 'the Audit log records the new Upcoming entry')
const nb = await page.locator('nav').innerText()
check(nb.includes('Inbox') && nb.includes('Upcoming') && nb.toLowerCase().includes('plan'), 'the menu has Plan, Upcoming and Inbox')

// ---- time pickers instead of typing
await nav(page, 'Channels')
await page.click('main button:has-text("Channel setup")')
await sleep(800)
const hourSelect = page.locator('select[aria-label$="time, hour"]').first()
check((await hourSelect.count()) > 0, 'posting slots use hour, minute and AM/PM selectors')
check((await page.locator('input[type="time"]').count()) === 0, 'no typed time inputs remain on Channel setup')

// ---- a form keeps your edit while the app reloads in the background
const before = await hourSelect.inputValue()
const next = before === '9' ? '10' : '9'
await hourSelect.selectOption(next)
await invoke(page, 'settings.set', { theme: 'dark' }) // fires the "changed" event that reloads data
await sleep(2500)
check((await page.locator('select[aria-label$="time, hour"]').first().inputValue()) === next, 'slot edit survives a background reload')
await shot(page, 'tour-slot-edit')

// ---- one pause per brand
const brands = await invoke(page, 'brands.list')
const first = brands[0]
await page.locator('label:has-text("Pause this brand") input[type=checkbox]').first().click()
await sleep(1500)
const st = await invoke(page, 'settings.get')
const sb = await invoke(page, 'studio.brands')
check(st.pausedBrandIds.includes(first.id), 'pausing on Channel setup pauses the scheduler for that brand')
check(sb.find((b) => b.brandId === first.id)?.config.paused === true, 'and the Studio for that brand')
await page.locator('label:has-text("Pause this brand") input[type=checkbox]').first().click()
await sleep(1500)
check(!(await invoke(page, 'settings.get')).pausedBrandIds.includes(first.id), 'resuming on Channel setup resumes it')
await page.click('main button:has-text("Studio settings per channel")')
await sleep(800)
check((await page.locator('main label:has-text("Pause this brand")').count()) === 0, 'Studio settings per channel has no second pause switch')

// ---- calendar: one list, with the open slots from the channel settings
await invoke(page, 'settings.set', { agentApiEnabled: false })
const when = new Date(Date.now() + 3 * 86_400_000)
when.setUTCHours(15, 0, 0, 0)
await invoke(page, 'posts.create', {
  brandId: first.id,
  sourcePath: vids[0],
  title: 'Tour post 1',
  caption: 'x',
  scheduledAtUtc: when.toISOString(),
  targets: [{ platform: 'youtube', aiFlag: false }],
  status: 'draft',
})
await nav(page, 'Calendar')
await sleep(1200)
const cal = await text()
check(cal.includes('has no videos scheduled'), 'the Calendar shows open slots as "<channel> has no videos scheduled"')
check(cal.includes('Tour post 1') || cal.toLowerCase().includes('today'), 'the Calendar list shows days with posts')
check((await page.locator('.fc-view-harness').count()) === 0, 'the old calendar grid is gone')
check((await page.locator('main button:has-text("Month")').count()) === 0, 'there are no Month and Week buttons')
await page.selectOption('select[aria-label="Status"]', 'open')
await sleep(500)
check(!(await text()).includes('Tour post 1'), 'Open slots only hides the posts')
await shot(page, 'tour-calendar-list')
check((await page.locator('main button:has-text("New post")').count()) > 0, 'the calendar has a New post button')

// ---- Home checklist and numbers
await nav(page, 'Home')
await sleep(900)
check((await text()).includes('Get set up'), 'Home shows the setup checklist for a new install')

// ---- Analytics export
await nav(page, 'Analytics')
check((await page.locator('main button:has-text("Export CSV")').count()) > 0, 'Analytics has Export CSV')
await nav(page, 'Queue')
check((await page.locator('main button:has-text("Export CSV")').count()) > 0, 'Queue has Export CSV')

// ---- basics: every button has a name, every image has alt text
for (const s of screens) {
  await nav(page, s)
  await sleep(300)
  const unnamed = await page.$$eval('button', (bs) => bs.filter((b) => !(b.innerText || b.getAttribute('aria-label') || b.title || '').trim()).length)
  check(unnamed === 0, `"${s}": every button has a name`, unnamed ? `(${unnamed} without)` : '')
  const noAlt = await page.$$eval('img', (is) => is.filter((i) => i.getAttribute('alt') === null).length)
  check(noAlt === 0, `"${s}": every image has alt text`, noAlt ? `(${noAlt} without)` : '')
}

check(errors.length === 0, 'no uncaught page errors', errors.join(' | '))
const bad = consoleErrors.filter((c) => !/Autofill|DevTools|Download the React/.test(c))
check(bad.length === 0, 'no console errors', bad.slice(0, 3).join(' | '))
await app.close()
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll tour checks passed')
process.exit(failures ? 1 : 0)
