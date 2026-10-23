import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import { promisify } from 'util'
import ffmpegStatic from 'ffmpeg-static'
import { parseLoudnorm, type Loudness } from '@shared/growth'
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

  /** Measures the loudness with ffmpeg's loudnorm filter (a read only pass). Null when ffmpeg cannot read the sound. */
  async loudness(path: string): Promise<Loudness | null> {
    try {
      const { stderr } = await run(
        this.ffmpeg,
        [
          '-hide_banner',
          '-nostats',
          '-i',
          path,
          '-af',
          'loudnorm=I=-14:TP=-1:LRA=11:print_format=json',
          '-f',
          'null',
          '-',
        ],
        { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 },
      )
      return parseLoudnorm(String(stderr))
    } catch {
      return null
    }
  }

  /** Writes a copy with the sound set to -14 LUFS. The picture is copied as it is. */
  async normalizeAudio(inPath: string, outPath: string): Promise<void> {
    await run(
      this.ffmpeg,
      [
        '-y',
        '-i',
        inPath,
        '-c:v',
        'copy',
        '-af',
        'loudnorm=I=-14:TP=-1:LRA=11',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        outPath,
      ],
      { maxBuffer: 10 * 1024 * 1024, timeout: 300_000 },
    )
  }

  /** Writes a smaller H.265 copy. The sound is copied as it is. */
  async archiveH265(inPath: string, outPath: string): Promise<void> {
    await run(
      this.ffmpeg,
      [
        '-y',
        '-i',
        inPath,
        '-c:v',
        'libx265',
        '-crf',
        '28',
        '-preset',
        'medium',
        '-tag:v',
        'hvc1',
        '-c:a',
        'copy',
        outPath,
      ],
      { maxBuffer: 10 * 1024 * 1024, timeout: 3_600_000 },
    )
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
