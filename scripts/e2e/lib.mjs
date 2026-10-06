import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import ffmpegPath from 'ffmpeg-static'

export const ROOT = resolve(new URL('../..', import.meta.url).pathname)
export const SHOTS = process.env.ELO_SHOTS ?? join(tmpdir(), 'elo-shots')
mkdirSync(SHOTS, { recursive: true })

export function makeVideos(dir, names, seconds = 4) {
  mkdirSync(dir, { recursive: true })
  return names.map((n, i) => {
    const out = join(dir, n)
    if (!existsSync(out)) {
      execFileSync(
        ffmpegPath,
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          `testsrc2=size=1080x1920:rate=30`,
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=${300 + i * 80}`,
          '-t',
          String(seconds),
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-shortest',
          out,
        ],
        { stdio: 'ignore' },
      )
    }
    return out
  })
}

export async function launch({ dataDir, mediaRoot, executablePath } = {}) {
  const data = dataDir ?? mkdtempSync(join(tmpdir(), 'elo-data-'))
  const media = mediaRoot ?? mkdtempSync(join(tmpdir(), 'elo-media-'))
  const env = { ...process.env, ELO_DATA_DIR: data, ELO_MEDIA_ROOT: media }
  const app = await electron.launch(
    executablePath ? { executablePath, env } : { args: [ROOT], cwd: ROOT, env },
  )
  const page = await app.firstWindow()
  apps.set(page, app)
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('nav button')
  await page.bringToFront()
  await page.setViewportSize({ width: 1280, height: 860 })
  return { app, page, data, media }
}

export const invoke = (page, name, ...args) =>
  page.evaluate(([n, a]) => window.elo.invoke(n, ...a), [name, args])
const apps = new WeakMap()
export const shot = async (page, name) => {
  const path = join(SHOTS, `${name}.png`)
  try {
    await page.screenshot({ path, timeout: 6000 })
  } catch {
    // Electron sometimes stalls page.screenshot when the window is covered. Capture from inside instead.
    const b64 = await apps
      .get(page)
      .evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
          .toPNG()
          .toString('base64'),
      )
    writeFileSync(path, Buffer.from(b64, 'base64'))
  }
}
export const nav = async (page, label) => {
  await page.click(`nav button:has-text("${label}")`)
  await page.waitForTimeout(400)
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
