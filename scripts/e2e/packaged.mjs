// Launches the built .app with a throwaway data folder and checks that every phase is in it.
// Also checks the launch at login setting round trip, and puts it back the way it was.
import { launch, shot, nav, invoke, sleep } from './lib.mjs'
import { join } from 'path'
const exe = join(
  process.cwd(),
  'release/mac-arm64/Expect Less Output.app/Contents/MacOS/Expect Less Output',
)
const { app, page } = await launch({ executablePath: exe })
const info = await invoke(page, 'app.info')
console.log('version', info.version)
await nav(page, 'Channels')
await page.click('main button:has-text("Connections")')
await sleep(800)
console.log('Connections cards:', (await page.locator('section h2').allTextContents()).join(' | '))
await nav(page, 'Settings')
await sleep(500)
console.log('Settings cards:', (await page.locator('section h2').allTextContents()).join(' | '))
await page.click('main button:has-text("Alerts and backup")')
await sleep(500)
console.log(
  'Backup buttons:',
  await page.getByRole('button', { name: 'Export backup' }).count(),
  await page.getByRole('button', { name: 'Restore from backup' }).count(),
)

const read = () => app.evaluate(({ app }) => app.getLoginItemSettings().openAtLogin)
const before = await read()
try {
  await invoke(page, 'settings.set', { launchAtLogin: true })
  await sleep(500)
  console.log('launch at login after turning it on:', await read())
  const log = await invoke(page, 'log.list', { level: 'warn', limit: 5 })
  console.log('warnings:', log.map((l) => l.message).join(' || ') || 'none')
} finally {
  await invoke(page, 'settings.set', { launchAtLogin: before })
  await sleep(500)
  console.log('launch at login put back to:', await read(), '(was', before + ')')
}
await shot(page, 'packaged-settings')
await nav(page, 'Analytics')
await sleep(800)
console.log(
  'Stats screen:',
  (await page.locator('main, body').first().innerText()).slice(0, 160).replace(/\n/g, ' | '),
)
const sum = await invoke(page, 'stats.brandSummary', null, '7d')
console.log('stats.brandSummary posts:', sum.posts, 'platforms:', sum.platforms.length)
await shot(page, 'packaged-stats')
await app.close()
