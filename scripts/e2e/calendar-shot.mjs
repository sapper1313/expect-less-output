// Opens the Calendar in a fresh app with a few posts and saves a screenshot. Run: node scripts/e2e/calendar-shot.mjs
import { launch, makeVideos, shot, nav, invoke, sleep } from './lib.mjs'
import { tmpdir } from 'os'
import { join } from 'path'

const vids = makeVideos(join(tmpdir(), 'elo-vids'), ['cal_a.mp4'])
const { app, page } = await launch()
await sleep(1500)
const brands = await invoke(page, 'brands.list')
const slots = await invoke(page, 'slots.next', brands[0].id, 3)
for (const [i, when] of slots.slice(0, 2).entries())
  await invoke(page, 'posts.create', {
    brandId: brands[i % 2].id,
    sourcePath: vids[0],
    title: i ? 'Phone text too tiny? Make it bigger in 3 taps' : 'Your wifi went out... Ask for an outage bill credit',
    caption: 'x',
    scheduledAtUtc: when,
    targets: [{ platform: 'youtube', aiFlag: false }, { platform: 'instagram', aiFlag: false }],
    status: 'scheduled',
  })
await invoke(page, 'studio.setBrand', brands[1].id, { clipPostDays: [2, 4], clipTime: '12:00' })
await nav(page, 'Calendar')
await sleep(1500)
await shot(page, 'calendar-list')
await app.close()
