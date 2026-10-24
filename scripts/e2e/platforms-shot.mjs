// A fresh app with the new platforms set up, then screenshots of the Calendar, Queue and Connections.
// Run: npm run build && node scripts/e2e/platforms-shot.mjs   (quit the real app first)
import { launch, makeVideos, shot, nav, invoke, sleep } from './lib.mjs'
import { tmpdir } from 'os'
import { join } from 'path'

const vids = makeVideos(join(tmpdir(), 'elo-vids'), ['pl_a.mp4'])
const { app, page } = await launch()
await sleep(1500)
const brands = await invoke(page, 'brands.list')
const b = brands[0]
await invoke(page, 'platforms.setSnapchat', b.id, 'mathofit')
const views = await invoke(page, 'platforms.views')
console.log(
  'snapchat view:',
  JSON.stringify(views.find((v) => v.brandId === b.id && v.platform === 'snapchat')),
)
const slots = await invoke(page, 'slots.next', b.id, 2)
await invoke(page, 'posts.create', {
  brandId: b.id,
  sourcePath: vids[0],
  title: 'Skip the $6 latte and become a millionaire',
  caption: 'Skip the latte. It adds up. #money',
  scheduledAtUtc: slots[0],
  targets: [
    { platform: 'youtube', aiFlag: false },
    { platform: 'instagram', aiFlag: false },
    { platform: 'snapchat', aiFlag: false },
  ],
  status: 'scheduled',
})
const connected = await invoke(page, 'platforms.connectedFor', b.id)
console.log('connected extras:', JSON.stringify(connected))
await nav(page, 'Calendar')
await sleep(1500)
await shot(page, 'platforms-calendar')
await nav(page, 'Queue')
await sleep(1000)
await shot(page, 'platforms-queue')
await nav(page, 'Channels')
await sleep(1200)
await page.getByText('More platforms: app keys').scrollIntoViewIfNeeded()
await shot(page, 'platforms-connections')
await app.close()
