// Launches the built .app and checks that it boots, seeds brands, inspects a video and shows a tray-ready scheduler.
import { launch, makeVideos, shot, invoke } from './lib.mjs'
import { tmpdir } from 'os'
import { join } from 'path'
const vids = makeVideos(join(tmpdir(), 'elo-vids'), ['clip_1.mp4'])
const exe = join(
  process.cwd(),
  'release/mac-arm64/Expect Less Output.app/Contents/MacOS/Expect Less Output',
)
const { app, page } = await launch({ executablePath: exe })
const brands = await invoke(page, 'brands.list')
const info = await invoke(page, 'media.inspect', vids[0])
const st = await invoke(page, 'scheduler.status')
console.log('brands', brands.map((b) => b.name).join(' | '))
console.log(
  'inspect',
  info.meta.width + 'x' + info.meta.height,
  info.meta.videoCodec,
  'poster',
  !!info.posterUrl,
)
console.log('scheduler running', st.running)
const img = await page.evaluate(
  (u) =>
    new Promise((res) => {
      const i = new Image()
      i.onload = () => res('loaded ' + i.naturalWidth + 'x' + i.naturalHeight)
      i.onerror = () => res('error')
      i.src = u
    }),
  info.posterUrl,
)
console.log('poster image', img)
await shot(page, 'packaged')
await app.close()
