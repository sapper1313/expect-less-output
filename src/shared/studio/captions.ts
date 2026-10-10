import type { EpisodePackage } from './types'

export interface Chapter {
  /** Seconds from the start of the video. */
  start: number
  title: string
}

export interface Cue {
  start: number
  end: number
  text: string
}

export const LANGUAGES: Array<[string, string]> = [
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['hi', 'Hindi'],
  ['ar', 'Arabic'],
  ['zh', 'Chinese'],
]

export const sceneStarts = (pkg: Pick<EpisodePackage, 'scenes'>): number[] => {
  let t = 0
  return pkg.scenes.map((s) => {
    const at = t
    t += s.content_seconds
    return at
  })
}

/** When each spoken line appears. Lines are spread over their scene, because the exact timing is only known to the video. */
export function buildCues(pkg: Pick<EpisodePackage, 'scenes'>, offset = 0): Cue[] {
  const starts = sceneStarts(pkg)
  const cues: Cue[] = []
  pkg.scenes.forEach((s, i) => {
    const lines = s.dialogue.map((d) => d.line.trim()).filter(Boolean)
    if (!lines.length) return
    const slot = s.content_seconds / lines.length
    lines.forEach((text, j) => {
      const start = offset + starts[i] + j * slot
      cues.push({ start, end: start + Math.min(slot - 0.1, Math.max(1.4, text.length * 0.07)), text })
    })
  })
  return cues
}

const stamp = (sec: number) => {
  const ms = Math.round(sec * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(s)},${p(ms % 1000, 3)}`
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(Math.max(c.end, c.start + 0.5))}\n${c.text}\n`).join('\n')
}

/** Groups scenes into chapters of at least `minSeconds`. YouTube needs 3 or more, the first at 0:00, each 10 seconds or longer. */
export function chapterGroups(pkg: Pick<EpisodePackage, 'scenes'>, minSeconds = 20): Array<{ start: number; scenes: number[] }> {
  const starts = sceneStarts(pkg)
  const total = pkg.scenes.reduce((n, s) => n + s.content_seconds, 0)
  if (total < 60) return []
  const target = Math.max(3, Math.min(10, Math.round(total / 35)))
  const want = total / target
  const groups: Array<{ start: number; scenes: number[] }> = []
  pkg.scenes.forEach((_s, i) => {
    const last = groups[groups.length - 1]
    const lastLen = last ? starts[i] - last.start : 0
    if (!last || lastLen >= Math.max(minSeconds, want)) groups.push({ start: starts[i], scenes: [i] })
    else last.scenes.push(i)
  })
  // A short tail joins the chapter before it.
  if (groups.length > 1 && total - groups[groups.length - 1].start < 10) groups.pop()
  return groups.length >= 3 ? groups : []
}

export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

export const chaptersText = (chapters: Chapter[]) => chapters.map((c) => `${mmss(c.start)} ${c.title}`).join('\n')
