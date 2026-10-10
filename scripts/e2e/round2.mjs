// Round two smoke run: Home, search, calendar pop-up, Channels, Settings tabs, Research, Bible channel switch, models.
import { launch, shot, nav, invoke } from './lib.mjs'

const { app, page } = await launch()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
await page.waitForTimeout(1500)
const brands = await invoke(page, 'studio.brands')
for (const b of brands.slice(0, 2)) await invoke(page, 'studio.writeNow', b.brandId)
await page.waitForTimeout(4000)

// Home
await nav(page, 'Home')
await page.waitForTimeout(800)
await shot(page, 'r2-home')
const scrolled = await page.evaluate(async () => {
  const el = document.querySelector('.glass-stage')
  el.scrollTo(0, 400)
  await new Promise((r) => setTimeout(r, 200))
  return { top: el.scrollTop, can: el.scrollHeight > el.clientHeight }
})
console.log('home scroll:', JSON.stringify(scrolled))
await page.evaluate(() => document.querySelector('.glass-stage').scrollTo(0, 0))

// Search
await page.keyboard.press('Meta+k')
await page.waitForTimeout(300)
await page.keyboard.type('spend caps')
await page.waitForTimeout(500)
await shot(page, 'r2-search')
const hits = await page.locator('[role=dialog], .glass').locator('button:has-text("Settings: Studio")').count()
console.log('search shows the settings page:', hits > 0)
await page.keyboard.press('Escape')

// Calendar
await nav(page, 'Calendar')
await page.waitForTimeout(800)
const ev = page.locator('.fc-event').first()
if (await ev.count()) {
  await ev.click()
  await page.waitForTimeout(500)
  await shot(page, 'r2-calendar-popup')
  await page.keyboard.press('Escape')
}

// Channels and Settings tabs
await nav(page, 'Channels')
for (const t of ['Channel setup', 'Connections', 'Studio settings per channel']) {
  await page.locator('main').getByRole('button', { name: t, exact: true }).click()
  await page.waitForTimeout(500)
  await shot(page, 'r2-channels-' + t.toLowerCase().replace(/[^a-z]/g, ''))
}
await nav(page, 'Settings')
for (const t of ['General', 'Studio', 'AI models and Local AI', 'Alerts and backup', 'Agent API', 'Testing tools']) {
  await page.locator('main').getByRole('button', { name: t, exact: true }).click()
  await page.waitForTimeout(700)
  await shot(page, 'r2-settings-' + t.toLowerCase().replace(/[^a-z]/g, ''))
}

// Studio: Research, Bible channel switch
await nav(page, 'Studio')
await page.locator('main').getByRole('button', { name: 'Research', exact: true }).click()
await page.waitForTimeout(500)
await shot(page, 'r2-research')
await page.locator('main').getByRole('button', { name: 'Bible', exact: true }).click()
await page.waitForTimeout(800)
const premiseOf = async () => page.locator('textarea').first().inputValue()
const first = await premiseOf()
const sel = page.locator('main select').first()
const opts = await sel.locator('option').allTextContents()
await sel.selectOption({ index: 1 })
await page.waitForTimeout(1200)
const second = await premiseOf()
console.log('bible switched channel:', opts.length > 1 ? first !== second : 'only one channel')
await page.waitForTimeout(6000)
const kept = await premiseOf()
console.log('bible stays after 6s of background refresh:', kept === second)

// API checks
const mo = await invoke(page, 'studio.modelOptions')
console.log('models:', mo.options.map((o) => o.id).join(', '))
const sum = await invoke(page, 'home.summary')
console.log('home stages:', sum.stages.map((s) => `${s.key}=${s.count}`).join(' '))
console.log('search api:', (await invoke(page, 'search.query', 'bible')).length > 0)
console.log('page errors:', errors)
await app.close()
if (errors.length) process.exit(1)
