// Screenshots of the per platform schedule: the Setup Channels grid, Manual Schedule and the Edit post window.
// Run: node scripts/e2e/schedule-tour.mjs   (needs npm run build first). Pictures go to $ELO_SHOTS.
import { launch, shot, nav, invoke, sleep, makeVideos } from './lib.mjs'
import { join } from 'path'
import { tmpdir } from 'os'

const { app, page, media } = await launch()
await sleep(2500)
const videos = makeVideos(join(tmpdir(), 'elo-sched-vids'), ['a.mp4', 'b.mp4'], 4)
const brands = await invoke(page, 'brands.list', false)
const b = brands[0]
await invoke(page, 'brands.setPlatformSlots', b.id, [
  ...['youtube', 'instagram', 'facebook', 'tiktok'].flatMap((platform, i) => [
    { platform, kind: 'short', dayType: 'weekday', timeLocal: ['19:30', '18:00', '19:30', '20:00'][i], enabled: true },
    { platform, kind: 'short', dayType: 'weekend', timeLocal: ['10:00', '11:00', '10:00', '12:00'][i], enabled: true },
  ]),
  { platform: 'instagram', kind: 'short', dayType: 'weekday', timeLocal: '21:00', enabled: true },
])
await nav(page, 'Setup Channels')
await sleep(1500)
await shot(page, 'sched-1-grid')
await page.locator('text=Posting schedule (Eastern time)').first().evaluate((el) => el.scrollIntoView({ block: 'start' }))
await sleep(700)
await shot(page, 'sched-2-grid-scrolled')
const post = await invoke(page, 'posts.create', {
  brandId: b.id, sourcePath: videos[0], title: 'Schedule test', caption: 'x', scheduledAtUtc: null, status: 'draft',
  targets: ['youtube', 'instagram', 'tiktok'].map((platform) => ({ platform, aiFlag: false })),
})
await nav(page, 'Manual Schedule')
await sleep(1200)
await shot(page, 'sched-3-manual')
await nav(page, 'Queue')
await sleep(1200)
await shot(page, 'sched-4-queue')
await page.click('text=Schedule test').catch(() => {})
await sleep(1500)
await shot(page, 'sched-5-edit')
await app.close()
console.log('done', post.id, media)
