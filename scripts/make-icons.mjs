// Builds the app icon (.icns) and the menu bar template image from docs/brand.
import sharp from 'sharp'
import { execFileSync } from 'child_process'
import { mkdirSync, rmSync, copyFileSync } from 'fs'

const dark = 'docs/brand/elo_icon_1024_dark.png'
const clear = 'docs/brand/elo_icon_1024_transparent.png'
mkdirSync('resources', { recursive: true })
mkdirSync('build', { recursive: true })

// App icon
const set = 'build/icon.iconset'
rmSync(set, { recursive: true, force: true })
mkdirSync(set)
const sizes = [16, 32, 128, 256, 512]
for (const s of sizes) {
  await sharp(dark).resize(s, s).png().toFile(`${set}/icon_${s}x${s}.png`)
  await sharp(dark)
    .resize(s * 2, s * 2)
    .png()
    .toFile(`${set}/icon_${s}x${s}@2x.png`)
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', 'build/icon.icns'])
rmSync(set, { recursive: true, force: true })
copyFileSync('build/icon.icns', 'resources/icon.icns')
await sharp(dark).resize(512, 512).png().toFile('resources/icon.png')

// Menu bar template: simple machine silhouette (hopper on a box with a screen and a conveyor).
// The detailed art does not read at menu bar size, so this is drawn by hand.
const svg = (
  size,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 36 36">
  <path d="M8 3 H24 L20 12 H12 Z"/>
  <path fill-rule="evenodd" d="M4 14 H24 V30 H4 Z M8 17 H18 V25 H8 Z"/>
  <path d="M24 24 H33 V28 H24 Z"/>
  <rect x="28" y="28" width="2" height="4"/>
  <rect x="21" y="30" width="2" height="3"/>
  <rect x="5" y="30" width="2" height="3"/>
</svg>`
await sharp(Buffer.from(svg(18)))
  .png()
  .toFile('resources/trayTemplate.png')
await sharp(Buffer.from(svg(36)))
  .resize(36, 36)
  .png()
  .toFile('resources/trayTemplate@2x.png')
console.log('icons done')

// Logos for the UI, trimmed and shrunk so the app stays light.
mkdirSync('src/renderer/src/assets', { recursive: true })
await sharp('docs/brand/ExpectLessOutput-wide-noBG.png')
  .trim({ threshold: 5 })
  .resize({ width: 560 })
  .png()
  .toFile('src/renderer/src/assets/logo-wide.png')
await sharp('docs/brand/ExpectLessOutput--color.jpg')
  .resize({ width: 720 })
  .jpeg({ quality: 88 })
  .toFile('src/renderer/src/assets/logo-stacked.jpg')
await sharp('docs/brand/ExpectLessOutput-wide-color.jpg')
  .resize({ width: 1100 })
  .jpeg({ quality: 88 })
  .toFile('src/renderer/src/assets/logo-banner.jpg')
console.log('logos done')
