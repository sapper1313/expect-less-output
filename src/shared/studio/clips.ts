import type { EpisodePackage } from './types'
import { sceneStarts } from './captions'

export interface ClipWindow {
  /** Seconds in the script, from the start of the video. */
  start: number
  seconds: number
  sceneIndexes: number[]
  /** How many spoken lines the window holds. More talk usually makes a better short. */
  lines: number
}

/**
 * The best stretches of a long video to cut into shorts: runs of whole scenes between `min` and `max` seconds,
 * ranked by how much is said, never overlapping, and never starting in the opening scene or ending on the goodbye.
 */
export function bestWindows(
  pkg: Pick<EpisodePackage, 'scenes'>,
  count: number,
  min = 20,
  max = 50,
): ClipWindow[] {
  const starts = sceneStarts(pkg)
  const sc = pkg.scenes
  const cands: ClipWindow[] = []
  for (let i = 1; i < sc.length - 1; i++) {
    let seconds = 0
    const idx: number[] = []
    for (let j = i; j < sc.length - 1; j++) {
      seconds += sc[j].content_seconds
      idx.push(j)
      if (seconds > max) break
      if (seconds >= min)
        cands.push({
          start: starts[i],
          seconds,
          sceneIndexes: [...idx],
          lines: idx.reduce((n, k) => n + sc[k].dialogue.length, 0),
        })
    }
  }
  cands.sort((a, b) => b.lines / b.seconds - a.lines / a.seconds || b.lines - a.lines)
  const out: ClipWindow[] = []
  for (const c of cands) {
    if (out.length >= count) break
    if (out.every((o) => c.start >= o.start + o.seconds || c.start + c.seconds <= o.start))
      out.push(c)
  }
  return out.sort((a, b) => a.start - b.start)
}
