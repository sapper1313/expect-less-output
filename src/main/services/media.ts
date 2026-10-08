import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import { promisify } from 'util'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { validateVideo, type VideoMeta } from '@shared/platformLimits'
import type { MediaInspection } from '@shared/types'

const run = promisify(execFile)

function unpacked(p: string | null): string {
  if (!p) throw new Error('Bundled video tool is missing.')
  return p.replace('app.asar' + '/', 'app.asar.unpacked/')
}

/**
 * ffprobe-static ships an Intel binary in its arm64 folder, which makes macOS warn that Intel support is ending.
 * On Apple silicon use the real arm64 build from @ffprobe-installer instead.
 */
function ffprobePath(): string {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    try {
      return join(
        dirname(require.resolve('@ffprobe-installer/darwin-arm64/package.json')),
        'ffprobe',
      )
    } catch {
      // fall back to the generic one
    }
  }
  return ffprobeStatic.path
}

export class MediaService {
  private ffprobe = unpacked(ffprobePath())
  private ffmpeg = unpacked(ffmpegStatic as unknown as string)

  constructor(private postersDir: string) {
    mkdirSync(postersDir, { recursive: true })
  }

  async probe(path: string): Promise<VideoMeta> {
    const { stdout } = await run(
      this.ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      { maxBuffer: 10 * 1024 * 1024 },
    )
    return parseProbe(JSON.parse(stdout), statSync(path).size)
  }

  /** Extracts one frame as a small JPEG. Returns the file name inside the posters folder. */
  async poster(path: string, durationSeconds: number): Promise<string | null> {
    const st = statSync(path)
    const id = createHash('sha1')
      .update(`${path}|${st.size}|${st.mtimeMs}`)
      .digest('hex')
      .slice(0, 16)
    const name = `${id}.jpg`
    const out = join(this.postersDir, name)
    if (existsSync(out)) return name
    const at = Math.max(0, Math.min(1, durationSeconds / 3))
    try {
      await run(this.ffmpeg, [
        '-y',
        '-ss',
        String(at),
        '-i',
        path,
        '-frames:v',
        '1',
        '-vf',
        'scale=360:-2',
        '-q:v',
        '4',
        out,
      ])
      return existsSync(out) ? name : null
    } catch {
      return null
    }
  }

  async inspect(path: string): Promise<MediaInspection> {
    const meta = await this.probe(path)
    const poster = await this.poster(path, meta.durationSeconds)
    return {
      sourcePath: path,
      fileName: basename(path),
      meta,
      posterUrl: poster ? `elo-media://poster/${poster}` : null,
      warnings: validateVideo(meta, basename(path)),
    }
  }
}

export function parseProbe(data: any, sizeBytes: number): VideoMeta {
  const streams: any[] = data.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video')
  const a = streams.find((s) => s.codec_type === 'audio')
  if (!v) throw new Error('This file has no video stream.')
  let width = Number(v.width) || 0
  let height = Number(v.height) || 0
  const rotation = Number(
    v.tags?.rotate ?? v.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? 0,
  )
  if (Math.abs(rotation) === 90 || Math.abs(rotation) === 270) [width, height] = [height, width]
  const [num, den] = String(v.avg_frame_rate ?? '0/1')
    .split('/')
    .map(Number)
  return {
    durationSeconds: Number(data.format?.duration ?? v.duration ?? 0),
    width,
    height,
    videoCodec: String(v.codec_name ?? 'unknown'),
    audioCodec: a ? String(a.codec_name) : null,
    sizeBytes,
    fps: den ? Math.round((num / den) * 100) / 100 : 0,
    container: String(data.format?.format_name ?? ''),
  }
}
