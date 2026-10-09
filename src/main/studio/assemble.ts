import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { ffmpeg, hasFilter, probe } from './ffmpeg'

export interface Segment {
  path: string
  /** Seconds of this file to keep, from the start. Omit to keep all of it. */
  keepSeconds?: number
}

export interface AssembleInput {
  /** Opening first, outro last, if any. Clips in between. */
  segments: Segment[]
  out: string
  width: number
  height: number
  /** 0 for a plain cut. Hollow uses 0.3 to 0.5. */
  crossfade: number
  /** Target loudness. About -14 for shorts and -16 for Hollow. */
  lufs: number
  /** A .srt file to burn into the picture. Skipped quietly when this ffmpeg cannot do it. */
  burnSrt?: string
}

export interface AssembleResult {
  durationSeconds: number
  burned: boolean
}

/** Every piece is first made the same size, frame rate and sound format, so joining them can never go wrong. */
async function normalize(seg: Segment, out: string, w: number, h: number): Promise<number> {
  const info = await probe(seg.path)
  const keep = Math.min(seg.keepSeconds ?? info.durationSeconds, info.durationSeconds)
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p`
  const args = ['-i', seg.path]
  if (!info.hasAudio) args.push('-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`)
  args.push('-t', String(keep), '-vf', vf, '-map', '0:v:0', '-map', info.hasAudio ? '0:a:0' : '1:a:0', '-af', 'aresample=44100,aformat=channel_layouts=stereo', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-ar', '44100', '-shortest', out)
  await ffmpeg(args)
  return keep
}

export async function assemble(i: AssembleInput): Promise<AssembleResult> {
  if (!i.segments.length) throw new Error('There is nothing to assemble.')
  mkdirSync(dirname(i.out), { recursive: true })
  const dir = mkdtempSync(join(tmpdir(), 'elo-asm-'))
  try {
    const parts: string[] = []
    const lens: number[] = []
    for (let n = 0; n < i.segments.length; n++) {
      const p = join(dir, `seg-${n}.mp4`)
      lens.push(await normalize(i.segments[n], p, i.width, i.height))
      parts.push(p)
    }
    const joined = join(dir, 'joined.mp4')
    const xf = i.crossfade > 0 && parts.length > 1 ? Math.min(i.crossfade, ...lens.map((l) => l / 3)) : 0
    if (xf > 0) {
      const inputs = parts.flatMap((p) => ['-i', p])
      let v = '[0:v]'
      let a = '[0:a]'
      const filters: string[] = []
      let acc = lens[0]
      for (let n = 1; n < parts.length; n++) {
        const offset = (acc - xf).toFixed(3)
        filters.push(`${v}[${n}:v]xfade=transition=fade:duration=${xf}:offset=${offset}[v${n}]`)
        filters.push(`${a}[${n}:a]acrossfade=d=${xf}[a${n}]`)
        v = `[v${n}]`
        a = `[a${n}]`
        acc += lens[n] - xf
      }
      await ffmpeg([...inputs, '-filter_complex', filters.join(';'), '-map', v, '-map', a, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', joined])
    } else {
      const list = join(dir, 'list.txt')
      writeFileSync(list, parts.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join('\n'))
      await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined])
    }
    // One pass of loudness normalizing, and burned captions when asked and possible.
    let burned = false
    const vf: string[] = []
    if (i.burnSrt && (await hasFilter('subtitles'))) {
      vf.push(`subtitles='${i.burnSrt.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'")}'`)
      burned = true
    }
    const args = ['-i', joined, '-af', `loudnorm=I=${i.lufs}:TP=-1.5:LRA=11`]
    if (vf.length) args.push('-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p')
    else args.push('-c:v', 'copy')
    args.push('-c:a', 'aac', '-ar', '44100', '-movflags', '+faststart', i.out)
    try {
      await ffmpeg(args)
    } catch (e) {
      if (!burned) throw e
      // Burning failed on this ffmpeg. Fall back to a clean video and a sidecar file.
      burned = false
      await ffmpeg(['-i', joined, '-af', `loudnorm=I=${i.lufs}:TP=-1.5:LRA=11`, '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-movflags', '+faststart', i.out])
    }
    const info = await probe(i.out)
    return { durationSeconds: info.durationSeconds, burned }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
