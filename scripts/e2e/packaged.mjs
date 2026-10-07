// Launches the built .app with a throwaway data folder and checks that every phase is in it.
import { launch, shot, nav, invoke } from './lib.mjs'
import { join } from 'path'
const exe = join(
  process.cwd(),
  'release/mac-arm64/Expect Less Output.app/Contents/MacOS/Expect Less Output',
)
const { app, page } = await launch({ executablePath: exe })
const info = await invoke(page, 'app.info')
console.log('version', info.version)
await nav(page, 'Connections')
await page.waitForTimeout(800)
const titles = await page.locator('section h2').allTextContents()
console.log('Connections cards:', titles.join(' | '))
console.log(
  'Meta connect button:',
  await page
    .locator('section:has(h2:text-is("Meta (Facebook Pages and Instagram)")) input')
    .count(),
  'input fields',
)
console.log(
  'TikTok connect buttons:',
  await page.locator('button:has-text("Connect TikTok")').count(),
  '| YouTube:',
  await page.locator('button:has-text("Connect YouTube")').count(),
)
const migs = await invoke(page, 'brands.list')
console.log('brands', migs.length)
await shot(page, 'packaged-connections')
await app.close()
