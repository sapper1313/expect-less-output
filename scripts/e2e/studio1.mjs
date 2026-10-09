// Phase 1 smoke run: opens every Studio tab in the built app, uses the studio API, and checks for page errors.
import { launch, shot, nav, invoke } from './lib.mjs'

const { app, page } = await launch()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.waitForTimeout(1500)
const ov = await invoke(page, 'studio.overview')
console.log('mock mode:', ov.mockMode, 'brands:', ov.brands.map((b) => b.name).join(' | '))
await nav(page, 'Studio')
await shot(page, 's1-overview')
for (const tab of ['Bible', 'Library', 'Publishing', 'Spend', "Director's Log", 'Flagged', 'Settings', 'Local AI']) {
  await page.locator('main').getByRole('button', { name: tab, exact: true }).click()
  await page.waitForTimeout(500)
  await shot(page, 's1-' + tab.toLowerCase().replace(/[^a-z]/g, ''))
}
const r = await invoke(page, 'studio.cheapTest')
console.log('cheap test (mock):', JSON.stringify(r))
await nav(page, 'Calendar')
await page.waitForTimeout(800)
await shot(page, 's1-calendar')
console.log('page errors:', errors)
await app.close()
if (errors.length) process.exit(1)
