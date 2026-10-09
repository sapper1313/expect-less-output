import { execFile } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
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
      return unpacked(join(dirname(require.resolve('@ffprobe-installer/darwin-arm64/package.json')), 'ffprobe'))
    } catch {
      // fall through
    }
  }
  return unpacked(ffprobeStatic.path)
}

export async function ffmpeg(args: string[], timeoutMs = 600_000): Promise<{ stdout: string; stderr: string }> {
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

/** A solid colour clip with a tone, used by mock mode. Text is drawn when this ffmpeg has the drawtext filter. */
export async function makePlaceholderVideo(o: {
  out: string
  seconds: number
  width: number
  height: number
  text?: string
  color?: string
  audio?: boolean
}): Promise<void> {
  mkdirSync(dirname(o.out), { recursive: true })
  const base = [
    '-f',
    'lavfi',
    '-i',
    `color=c=${o.color ?? '0x2D2B28'}:s=${o.width}x${o.height}:d=${o.seconds}:r=24`,
  ]
  const audio =
    o.audio === false
      ? []
      : ['-f', 'lavfi', '-i', `sine=frequency=330:duration=${o.seconds}`, '-c:a', 'aac', '-shortest']
  const tail = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', String(o.seconds), o.out]
  if (o.text) {
    const safe = o.text.replace(/[^A-Za-z0-9 .,:_-]/g, '').slice(0, 60)
    try {
      await ffmpeg([...base, ...audio, '-vf', `drawtext=text='${safe}':fontcolor=white:fontsize=${Math.round(o.height / 24)}:x=(w-text_w)/2:y=(h-text_h)/2`, ...tail])
      return
    } catch {
      // This ffmpeg has no drawtext. Fall back to a plain clip.
    }
  }
  await ffmpeg([...base, ...audio, ...tail])
}

/** A solid colour JPEG, used for mock thumbnails. */
export async function makePlaceholderImage(out: string, width: number, height: number, color = '0xD9734E'): Promise<void> {
  mkdirSync(dirname(out), { recursive: true })
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=${color}:s=${width}x${height}`, '-frames:v', '1', out])
}

/** Scales an image so its width is `width`. Used for the 320 pixel library preview. */
export async function scaleImage(input: string, out: string, width: number): Promise<void> {
  mkdirSync(dirname(out), { recursive: true })
  await ffmpeg(['-i', input, '-vf', `scale=${width}:-2`, '-q:v', '5', '-frames:v', '1', out])
}

/** One frame from a video at `seconds`, as a JPEG. */
export async function extractFrame(video: string, seconds: number, out: string, width?: number): Promise<void> {
  mkdirSync(dirname(out), { recursive: true })
  const vf = width ? ['-vf', `scale=${width}:-2`] : []
  await ffmpeg(['-ss', String(Math.max(0, seconds)), '-i', video, ...vf, '-frames:v', '1', '-q:v', '3', out])
}
