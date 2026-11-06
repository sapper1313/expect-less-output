// Saves a screenshot of each main screen in a fresh app. Run: node scripts/e2e/screens-shot.mjs
import { launch, shot, nav, sleep } from './lib.mjs'

const { app, page } = await launch()
await sleep(2500)
await shot(page, 'home')
for (const [label, file] of [
  ['Manual Schedule', 'manual-schedule'],
  ['Inbox', 'inbox'],
  ['Setup Channels', 'setup-channels'],
  ['Settings', 'settings'],
  ['Financial', 'financial'],
  ['AI Settings', 'ai-settings'],
  ['AI Studio', 'ai-studio'],
]) {
  await nav(page, label)
  await sleep(1500)
  await shot(page, file)
}
await app.close()
