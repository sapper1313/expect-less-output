// Opens the Dashboard in a fresh app and saves a screenshot. Run: node scripts/e2e/dashboard-shot.mjs
import { launch, shot, nav, sleep } from './lib.mjs'

const { app, page } = await launch()
await sleep(1500)
await nav(page, 'Dashboard')
await sleep(3000)
await shot(page, 'dashboard')
await app.close()
