// Pipeline acceptance in the real app: a bot drops a finished video and its sidecar in a channel Inbox, ELO checks and
// schedules it, the Upcoming entry becomes "dropped", and a bad drop is rejected with .error.txt and .reason.json.
import { launch, makeVideos, shot, nav, invoke, sleep } from './lib.mjs'
import { createHash } from 'crypto'
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const [src] = makeVideos(join(tmpdir(), 'elo-vids'), ['pipeline_src.mp4'], 6)
const { app, page, media } = await launch()
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let failures = 0
const check = (ok, what, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}
const text = () => page.locator('main').innerText()
await sleep(1500)

await invoke(page, 'settings.set', { globalDryRun: true, agentMaySchedule: true, agentApiEnabled: false })
const brands = await invoke(page, 'brands.list')
const tp = brands.find((b) => b.slug === 'trash-panda')
check(!!tp, 'Trash Panda has the slug trash-panda')
const inbox = join(media, tp.name, 'Inbox')
mkdirSync(join(inbox, 'Rejected'), { recursive: true })

const idea = await invoke(page, 'upcoming.add', { channel: 'trash-panda', working_title: 'Pipeline test', premise: 'e2e' })
await invoke(page, 'upcoming.patch', 'trash-panda', idea.episode_id, { status: 'scripted' })
await invoke(page, 'upcoming.patch', 'trash-panda', idea.episode_id, { status: 'queued' })
await invoke(page, 'upcoming.patch', 'trash-panda', idea.episode_id, { status: 'rendering' })
await invoke(page, 'upcoming.patch', 'trash-panda', idea.episode_id, { status: 'needs-review' })

const drop = (id, over = {}, file = `${id}.mp4`) => {
  copyFileSync(src, join(inbox, file))
  const sum = createHash('sha256').update(readFileSync(join(inbox, file))).digest('hex')
  const sidecar = {
    schema_version: '1.0',
    channel: 'trash-panda',
    episode_id: id,
    title: `E2E ${id}`,
    description: 'An e2e drop #test',
    tags: ['e2e'],
    video_file: file,
    platforms: ['youtube', 'tiktok'],
    approval: { approved_by: 'Josh', approved_at: '2026-10-16T15:30:00-04:00' },
    checksum: { algo: 'sha256', value: sum },
    source_bot: 'grok-bot',
    preferred_slot: '2031-01-01T12:00:00-05:00',
    ...over,
  }
  writeFileSync(join(inbox, file.replace(/\.mp4$/, '.json')), JSON.stringify(sidecar))
  writeFileSync(join(inbox, file.replace(/\.mp4$/, '.ready')), '')
}
drop(idea.episode_id)
drop('trash-panda-2026-9998', { approval: undefined })
// The Inbox is read every 15 seconds.
let posts = []
for (let i = 0; i < 40 && posts.length < 1; i++) {
  await sleep(1500)
  posts = (await invoke(page, 'posts.list', {})).filter((p) => p.episodeRef === idea.episode_id)
}
check(posts.length === 1, 'the drop became a post', posts.map((p) => p.status).join())
check(posts[0]?.status === 'scheduled' && !!posts[0]?.scheduledAtUtc, 'and it was scheduled')
check(!String(posts[0]?.scheduledAtUtc).startsWith('2031'), 'preferred_slot was ignored')
check(posts[0]?.origin === 'inbox' && posts[0]?.sourceBot === 'grok-bot', 'it is marked as an Inbox post from grok-bot')
await sleep(1500)
const view = await invoke(page, 'upcoming.view')
const row = view.rows.find((r) => r.episode_id === idea.episode_id)
check(row?.status === 'dropped' && !!row?.drop_id, 'the Upcoming entry became dropped with the drop id', row?.status)
const rejected = existsSync(join(inbox, 'Rejected')) ? readdirSync(join(inbox, 'Rejected')) : []
check(rejected.some((f) => f.endsWith('.error.txt')) && rejected.some((f) => f.endsWith('.reason.json')), 'the bad drop was rejected with .error.txt and .reason.json', rejected.join(','))
const log = await invoke(page, 'pipeline.log', {})
check(log.some((d) => d.result === 'accepted' && d.sha256) && log.some((d) => d.result === 'rejected'), 'the drop log has both decisions')

await nav(page, 'Inbox')
await page.click('main button:has-text("Log")')
await sleep(800)
check((await text()).includes(idea.episode_id) && (await text()).includes('accepted'), 'the Inbox Log tab lists the drop')
await page.click('main button:has-text("Rejected")')
await sleep(600)
check((await text()).includes('trash-panda-2026-9998'), 'the Rejected tab lists the bad drop')
await shot(page, 'pipeline-inbox-rejected')
await nav(page, 'Upcoming')
await sleep(800)
check((await text()).includes('Dropped'), 'the Upcoming Board has a Dropped column')
await shot(page, 'pipeline-upcoming')
await nav(page, 'Queue')
check((await text()).includes(`E2E ${idea.episode_id}`), 'the Queue shows the scheduled video')

const issues = await invoke(page, 'pipeline.reconcileNow')
check(Array.isArray(issues), 'Reconcile now runs', `${issues.length} issue(s)`)
check(errors.length === 0, 'no uncaught page errors', errors.join(' | '))
await app.close()
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll pipeline checks passed')
process.exit(failures ? 1 : 0)
