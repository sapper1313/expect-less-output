/** Pure helpers for Video QC: comparing speech, reading model answers, and building caption files. */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim()

/** How much of the scripted words were heard, 0 to 1. Order is ignored so small slips do not fail a clip. */
export function speechSimilarity(scripted: string, heard: string): number {
  const want = norm(scripted).split(' ').filter(Boolean)
  if (!want.length) return 1
  const got = new Map<string, number>()
  for (const w of norm(heard).split(' ').filter(Boolean)) got.set(w, (got.get(w) ?? 0) + 1)
  let hit = 0
  for (const w of want) {
    const n = got.get(w) ?? 0
    if (n > 0) {
      hit++
      got.set(w, n - 1)
    }
  }
  return hit / want.length
}

export interface Segment {
  start: number
  end: number
  text: string
}

const toSec = (t: string) => {
  const [h, m, s] = t.replace(',', '.').split(':')
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}

/** Reads whisper.cpp style output lines such as "[00:00:00.000 --> 00:00:02.500]  Hello there". */
export function parseSegments(output: string): Segment[] {
  const out: Segment[] = []
  for (const m of output.matchAll(/\[(\d+:\d+:\d+[.,]\d+)\s*-->\s*(\d+:\d+:\d+[.,]\d+)\]\s*(.+)/g))
    out.push({ start: toSec(m[1]), end: toSec(m[2]), text: m[3].trim() })
  return out
}

const stamp = (sec: number) => {
  const ms = Math.round(sec * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}

export function buildSrt(segments: Segment[]): string {
  return segments.map((s, i) => `${i + 1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.text}\n`).join('\n')
}

/** Captions from the scripted lines when no timed transcript exists. Time is shared out by word count over each clip. */
export function segmentsFromScript(clips: Array<{ seconds: number; lines: string[] }>): Segment[] {
  const out: Segment[] = []
  let t = 0
  for (const c of clips) {
    const words = c.lines.reduce((n, l) => n + l.split(/\s+/).filter(Boolean).length, 0) || 1
    let at = t
    for (const line of c.lines) {
      const share = (line.split(/\s+/).filter(Boolean).length / words) * c.seconds
      out.push({ start: at, end: at + share, text: line })
      at += share
    }
    t += c.seconds
  }
  return out
}

export interface VisionVerdict {
  /** Problems the model was highly confident about. Low confidence answers never fail a clip. */
  issues: string[]
  ignored: string[]
}

/**
 * Small local models are weak at counting and fine detail. The prompt asks for lines like
 * "ISSUE: extra fingers CONFIDENCE: HIGH". Only HIGH confidence issues count; the rest pass.
 */
export function parseVision(answer: string): VisionVerdict {
  const issues: string[] = []
  const ignored: string[] = []
  for (const line of answer.split('\n')) {
    const m = /issue:\s*(.+)/i.exec(line)
    if (!m) continue
    if (/confidence:\s*high/i.test(line)) issues.push(m[1].replace(/confidence:\s*high/i, '').trim())
    else ignored.push(m[1].replace(/confidence:\s*\w+/i, '').trim())
  }
  return { issues, ignored }
}

export const VISION_PROMPT = (scene: string) =>
  `You check frames from an AI generated video. The scene should match: "${scene}". Look for: wrong or missing characters, deformed bodies or faces, glitches, stray text, watermarks, and a scene that does not match. For every problem write one line like "ISSUE: <problem> CONFIDENCE: HIGH" or "CONFIDENCE: LOW". If there are no problems write "OK". Do not guess at counts of small objects.`
