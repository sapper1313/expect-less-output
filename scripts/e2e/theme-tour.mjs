// Takes a screenshot of every screen in each color theme. Run: node scripts/e2e/theme-tour.mjs [theme ...]
// Pictures go to $ELO_SHOTS (default: the temp folder). Needs a build: npm run build
import { launch, shot, nav, invoke, sleep } from './lib.mjs'

const themes = process.argv.slice(2).length ? process.argv.slice(2) : ['midnight', 'daylight']
const screens = [
  'Home', 'Manual Schedule', 'Inbox', 'Queue', 'Posted Videos', 'Analytics', 'Setup Channels',
  'Settings', 'Financial', 'AI Settings', 'AI Studio',
]
const { app, page } = await launch()
await sleep(2500)
for (const theme of themes) {
  await invoke(page, 'settings.set', { colorTheme: theme })
  await sleep(800)
  for (const s of screens) {
    await nav(page, s)
    await sleep(1500)
    await shot(page, `${theme}-${s.replace(/ /g, '-').toLowerCase()}`)
  }
  // A few sub tabs and the About page.
  await nav(page, 'Inbox')
  for (const t of ['Comments', 'Messages']) {
    await page.click(`button:has-text("${t}")`).catch(() => {})
    await sleep(900)
    await shot(page, `${theme}-inbox-${t.toLowerCase()}`)
  }
  await nav(page, 'Analytics')
  await page.click('button:has-text("By channel and platform")').catch(() => {})
  await sleep(900)
  await shot(page, `${theme}-analytics-accounts`)
  await page.click('button:has-text("About")').catch(() => {})
  await sleep(900)
  await shot(page, `${theme}-about`)
}
await app.close()
console.log('done')
