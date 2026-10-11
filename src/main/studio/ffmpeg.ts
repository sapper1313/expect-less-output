import { execFile } from 'child_process'
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { promisify } from 'util'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

const run = promisify(execFile)

function unpacked(p: string): string {
  return p.replace('app.asar' + '/', 'app.asar.unpacked/')
}

/** The bundled ffmpeg, else one on the PATH. Never needs Homebrew when the app is installed. */
export function ffmpegBin(): string {
  const bundled = ffmpegStatic ? unpacked(ffmpegStatic as unknown as string) : ''
  return bundled && existsSync(bundled) ? bundled : 'ffmpeg'
}

export function ffprobeBin(): string {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    try {
      return unpacked(
        join(dirname(require.resolve('@ffprobe-installer/darwin-arm64/package.json')), 'ffprobe'),
      )
    } catch {
      // fall through
    }
  }
  return unpacked(ffprobeStatic.path)
}

export async function ffmpeg(
  args: string[],
  timeoutMs = 600_000,
): Promise<{ stdout: string; stderr: string }> {
  return run(ffmpegBin(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  })
}

export interface ProbeInfo {
  durationSeconds: number
  width: number
  height: number
  hasAudio: boolean
  videoCodec: string
}

export async function probe(path: string): Promise<ProbeInfo> {
  const { stdout } = await run(
    ffprobeBin(),
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { maxBuffer: 10 * 1024 * 1024 },
  )
  const data = JSON.parse(stdout) as { streams?: any[]; format?: { duration?: string } }
  const v = (data.streams ?? []).find((s) => s.codec_type === 'video')
  if (!v) throw new Error('This file has no video stream.')
  return {
    durationSeconds: Number(data.format?.duration ?? v.duration ?? 0),
    width: Number(v.width) || 0,
    height: Number(v.height) || 0,
    hasAudio: (data.streams ?? []).some((s) => s.codec_type === 'audio'),
    videoCodec: String(v.codec_name ?? ''),
  }
}

/**
 * A placeholder clip for mock mode: a moving test pattern with a tone. Pass black: true for a deliberately broken clip
 * (all black, no sound). Text is drawn when this ffmpeg has the drawtext filter.
 */
export async function makePlaceholderVideo(o: {
  out: string
  seconds: number
  width: number
  height: number
  text?: string
  black?: boolean
  audio?: boolean
}): Promise<void> {
  mkdirSync(dirname(o.out), { recursive: true })
  const base = o.black
    ? ['-f', 'lavfi', '-i', `color=c=black:s=${o.width}x${o.height}:d=${o.seconds}:r=24`]
    : ['-f', 'lavfi', '-i', `testsrc2=s=${o.width}x${o.height}:d=${o.seconds}:r=24`]
  const audio =
    o.audio === false
      ? []
      : [
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=330:duration=${o.seconds}`,
          '-c:a',
          'aac',
          '-shortest',
        ]
  const tail = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', String(o.seconds), o.out]
  if (o.text && !o.black) {
    const safe = o.text.replace(/[^A-Za-z0-9 .,:_-]/g, '').slice(0, 60)
    try {
      await ffmpeg([
        ...base,
        ...audio,
        '-vf',
        `drawtext=text='${safe}':fontcolor=white:fontsize=${Math.round(o.height / 24)}:x=(w-text_w)/2:y=(h-text_h)/2`,
        ...tail,
      ])
      return
    } catch {
      // This ffmpeg has no drawtext. Fall back to a plain clip.
    }
  }
  await ffmpeg([...base, ...audio, ...tail])
}

/** A solid colour JPEG, used for mock thumbnails. */
export async function makePlaceholderImage(
  out: string,
  width: number,
  height: number,
  color = '0xD9734E',
): Promise<void> {
  mkdirSync(dirname(out), { recursive: true })
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=${width}x${height}`,
    '-frames:v',
    '1',
    out,
  ])
}

/** Scales an image so its width is `width`. Used for the 320 pixel library preview. */
export async function scaleImage(input: string, out: string, width: number): Promise<void> {
  mkdirSync(dirname(out), { recursive: true })
  await ffmpeg(['-i', input, '-vf', `scale=${width}:-2`, '-q:v', '5', '-frames:v', '1', out])
}

/** One frame from a video at `seconds`, as a JPEG. */
export async function extractFrame(
  video: string,
  seconds: number,
  out: string,
  width?: number,
): Promise<void> {
  mkdirSync(dirname(out), { recursive: true })
  const vf = width ? ['-vf', `scale=${width}:-2`] : []
  await ffmpeg([
    '-ss',
    String(Math.max(0, seconds)),
    '-i',
    video,
    ...vf,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    out,
  ])
}

/** Runs ffmpeg and returns its log (stderr), for the detect filters that print their findings there. */
async function ffmpegLog(args: string[]): Promise<string> {
  try {
    const r = await run(
      ffmpegBin(),
      ['-hide_banner', '-nostats', '-loglevel', 'info', '-y', ...args],
      { timeout: 300_000, maxBuffer: 20 * 1024 * 1024 },
    )
    return r.stderr
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? '')
  }
}

const sum = (log: string, re: RegExp) => [...log.matchAll(re)].reduce((n, m) => n + Number(m[1]), 0)

/** Seconds of black picture. */
export async function blackSeconds(path: string): Promise<number> {
  const log = await ffmpegLog([
    '-i',
    path,
    '-vf',
    'blackdetect=d=0.2:pix_th=0.10',
    '-an',
    '-f',
    'null',
    '-',
  ])
  return sum(log, /black_duration:([\d.]+)/g)
}

/** Seconds of frozen picture. */
export async function frozenSeconds(path: string): Promise<number> {
  const log = await ffmpegLog([
    '-i',
    path,
    '-vf',
    'freezedetect=n=-55dB:d=1',
    '-an',
    '-f',
    'null',
    '-',
  ])
  return sum(log, /freeze_duration:\s*([\d.]+)/g)
}

/** Seconds of silence (quieter than -35 dB for at least 1 second). */
export async function silentSeconds(path: string): Promise<number> {
  const log = await ffmpegLog([
    '-i',
    path,
    '-vn',
    '-af',
    'silencedetect=noise=-35dB:d=1',
    '-f',
    'null',
    '-',
  ])
  return sum(log, /silence_duration:\s*([\d.]+)/g)
}

/** Loudest sample in dB. 0 means the sound hits the ceiling (clipping). */
export async function peakDb(path: string): Promise<number | null> {
  const log = await ffmpegLog(['-i', path, '-vn', '-af', 'volumedetect', '-f', 'null', '-'])
  const m = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(log)
  return m ? Number(m[1]) : null
}

export async function extractWav(video: string, out: string): Promise<void> {
  mkdirSync(dirname(out), { recursive: true })
  await ffmpeg(['-i', video, '-vn', '-ar', '16000', '-ac', '1', out])
}

/** Evenly spaced frames as JPEG files. Returns their paths. */
export async function sampleFrames(
  video: string,
  count: number,
  dir: string,
  seconds: number,
): Promise<string[]> {
  mkdirSync(dir, { recursive: true })
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const p = join(dir, `frame-${i + 1}.jpg`)
    await extractFrame(video, ((i + 0.5) / count) * seconds, p, 512)
    out.push(p)
  }
  return out
}

/** Does this ffmpeg have a filter (for example drawtext or subtitles)? */
export async function hasFilter(name: string): Promise<boolean> {
  try {
    const r = await run(ffmpegBin(), ['-hide_banner', '-filters'])
    return new RegExp(`\\s${name}\\s`).test(r.stdout)
  } catch {
    return false
  }
}

/** Brightness mean and spread (contrast), and how busy the picture is, from a tiny grayscale copy. */
export async function grayStats(
  file: string,
): Promise<{ mean: number; std: number; edges: number }> {
  const { stdout } = await run(
    ffmpegBin(),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      'scale=64:36',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-',
    ],
    {
      encoding: 'buffer',
      maxBuffer: 1024 * 1024,
    },
  )
  const px = stdout as unknown as Buffer
  const n = px.length || 1
  let sum = 0
  for (const v of px) sum += v
  const mean = sum / n
  let varSum = 0
  let edge = 0
  for (let i = 0; i < px.length; i++) {
    varSum += (px[i] - mean) ** 2
    if (i % 64 !== 0) edge += Math.abs(px[i] - px[i - 1])
  }
  return { mean, std: Math.sqrt(varSum / n), edges: edge / n }
}

/** Fonts a thumbnail can use on this Mac. */
export function findFont(preferred: string): string | null {
  const list = [
    preferred,
    '/System/Library/Fonts/Supplemental/Impact.ttf',
    '/System/Library/Fonts/Supplemental/Arial Black.ttf',
    '/Library/Fonts/Arial Black.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  ]
  return list.find((f) => f && existsSync(f)) ?? null
}

/** Background image scaled to cover the size, with a bold headline. Text is wrapped and kept inside a safe box. */
export async function composeThumbnail(o: {
  background: string
  out: string
  width: number
  height: number
  headline: string
  font: string | null
  /** Keep the text inside the centered square so a square crop of a tall cover still shows it. */
  centerSafe?: boolean
}): Promise<{ textDrawn: boolean }> {
  mkdirSync(dirname(o.out), { recursive: true })
  const base = `scale=${o.width}:${o.height}:force_original_aspect_ratio=increase,crop=${o.width}:${o.height}`
  const words = o.headline.trim().split(/\s+/).filter(Boolean)
  if (!o.font || !words.length) {
    await ffmpeg(['-i', o.background, '-vf', base, '-frames:v', '1', '-q:v', '3', o.out])
    return { textDrawn: false }
  }
  const lines: string[] = []
  let cur = ''
  const maxChars = o.centerSafe ? 12 : 16
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) {
      lines.push(cur)
      cur = w
    } else cur = (cur + ' ' + w).trim()
  }
  if (cur) lines.push(cur)
  const textFile = `${o.out}.txt`
  writeFileSync(textFile, lines.join('\n'))
  const size = Math.round((o.centerSafe ? o.width : o.height) / (o.centerSafe ? 7 : 6.5))
  const y = o.centerSafe ? '(h-text_h)/2' : 'h-text_h-h*0.08'
  const vf = `${base},drawtext=fontfile='${o.font.replaceAll("'", '')}':textfile='${textFile.replaceAll("'", '')}':fontsize=${size}:fontcolor=white:borderw=${Math.max(4, Math.round(size / 12))}:bordercolor=black:line_spacing=${Math.round(size / 8)}:x=(w-text_w)/2:y=${y}`
  try {
    await ffmpeg(['-i', o.background, '-vf', vf, '-frames:v', '1', '-q:v', '3', o.out])
    return { textDrawn: true }
  } catch {
    await ffmpeg(['-i', o.background, '-vf', base, '-frames:v', '1', '-q:v', '3', o.out])
    return { textDrawn: false }
  } finally {
    rmSync(textFile, { force: true })
  }
}

/** Re-encodes a JPEG smaller and smaller until it fits. */
export async function fitJpeg(file: string, maxBytes: number): Promise<void> {
  for (const q of [3, 5, 8, 12, 18, 25]) {
    if (statSync(file).size <= maxBytes) return
    const tmp = `${file}.tmp.jpg`
    await ffmpeg(['-i', file, '-q:v', String(q), '-frames:v', '1', tmp])
    renameSync(tmp, file)
  }
}

/** A short video made of one image, used as the opening frame of a Short. */
export async function stillVideo(
  image: string,
  seconds: number,
  width: number,
  height: number,
  out: string,
): Promise<void> {
  mkdirSync(dirname(out), { recursive: true })
  await ffmpeg([
    '-loop',
    '1',
    '-i',
    image,
    '-t',
    String(seconds),
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=24,format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    out,
  ])
}

/** The most striking moment of a video (contrast and detail), in milliseconds. Used for cover frames. */
export async function bestFrameMs(video: string, seconds: number, tmpDir: string): Promise<number> {
  mkdirSync(tmpDir, { recursive: true })
  let best = { ms: Math.round(seconds * 300), score: -1 }
  for (let i = 1; i <= 8; i++) {
    const t = seconds * (0.1 + (0.8 * (i - 1)) / 7)
    const f = join(tmpDir, `bf-${i}.jpg`)
    try {
      await extractFrame(video, t, f, 160)
      const g = await grayStats(f)
      const score = g.std + g.edges * 0.5
      if (score > best.score) best = { ms: Math.round(t * 1000), score }
    } catch {
      // a frame that cannot be read is skipped
    }
  }
  return best.ms
}
