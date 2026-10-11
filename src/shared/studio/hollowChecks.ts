import { numbersIn, wordToNumber } from './mathEval'
import type { CountedObject, Scene } from './types'

export interface CountIssue {
  kind:
    | 'missing_scene'
    | 'not_in_prompt'
    | 'quantity_not_stated'
    | 'wrong_quantity'
    | 'dialogue_total'
    | 'dialogue_gap'
  object: string
  scene?: number
  message: string
  /** What to change, in plain words, for the Writer. */
  correction: string
}

const stem = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .trim()
    .replace(/(es|s)$/, '')

function mentions(text: string, name: string): boolean {
  const n = stem(name)
  return (n.length > 0 && stem(text).includes(n)) || text.toLowerCase().includes(name.toLowerCase())
}

/** Numbers written right before an object name, such as "nine acorns" or "9 shiny acorns". Nearest number wins. */
function quantitiesBefore(text: string, name: string): number[] {
  const base = stem(name).split(' ').filter(Boolean)
  if (!base.length) return []
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? []
  const out: number[] = []
  for (let i = 0; i + base.length <= words.length; i++) {
    const hit = base.every((b, k) => stem(words[i + k]) === b || words[i + k] === b)
    if (!hit) continue
    for (let back = 1; back <= 3 && i - back >= 0; back++) {
      const n = wordToNumber(words[i - back])
      if (n !== null) {
        out.push(n)
        break
      }
    }
  }
  return out
}

/**
 * Checks counted objects with plain code. Every counted object must be in the scenes it names, in frame and in
 * the prompt, with the exact quantity written, and the counting dialogue must reach exactly that quantity.
 */
export function checkCountedObjects(objects: CountedObject[], scenes: Scene[]): CountIssue[] {
  const issues: CountIssue[] = []
  const byN = new Map(scenes.map((s) => [s.n, s]))
  for (const o of objects) {
    const inScenes: Scene[] = []
    for (const n of o.scenes) {
      const s = byN.get(n)
      if (!s) {
        issues.push({
          kind: 'missing_scene',
          object: o.name,
          scene: n,
          message: `${o.name} is counted in scene ${n}, but there is no scene ${n}.`,
          correction: `Make scene ${n} exist or change the scene numbers for ${o.name}.`,
        })
        continue
      }
      inScenes.push(s)
      const frame = `${s.grok_prompt} ${s.objects_in_frame.join(' ')} ${s.action}`
      if (!mentions(frame, o.name))
        issues.push({
          kind: 'not_in_prompt',
          object: o.name,
          scene: n,
          message: `Scene ${n} counts ${o.name} but they are not in its prompt or objects in frame.`,
          correction: `Write the ${o.name} into scene ${n} as natural props and keep them in frame for the whole counting beat.`,
        })
      for (const q of quantitiesBefore(`${s.grok_prompt} ${s.action}`, o.name))
        if (q !== o.quantity)
          issues.push({
            kind: 'wrong_quantity',
            object: o.name,
            scene: n,
            message: `Scene ${n} shows ${q} ${o.name} but the total is ${o.quantity}.`,
            correction: `Change scene ${n} so it shows exactly ${o.quantity} ${o.name}.`,
          })
    }
    if (
      inScenes.length &&
      !inScenes.some((s) =>
        quantitiesBefore(`${s.grok_prompt} ${s.action}`, o.name).includes(o.quantity),
      )
    )
      issues.push({
        kind: 'quantity_not_stated',
        object: o.name,
        message: `No prompt states the exact quantity of ${o.name} (${o.quantity}).`,
        correction: `State "exactly ${o.quantity} ${o.name}" in the scene prompt where they are counted.`,
      })
    // Counting dialogue: all numbers spoken in those scenes, in order.
    const spoken = inScenes.flatMap((s) => s.dialogue.flatMap((d) => numbersIn(d.line)))
    if (spoken.length >= 3) {
      const max = Math.max(...spoken)
      if (max !== o.quantity)
        issues.push({
          kind: 'dialogue_total',
          object: o.name,
          message: `The crew counts up to ${max} but there are ${o.quantity} ${o.name}.`,
          correction: `Make the counting end at ${o.quantity}, or change the quantity of ${o.name} to ${max} everywhere.`,
        })
      const seen = new Set(spoken)
      for (let i = 1; i <= max; i++)
        if (!seen.has(i)) {
          issues.push({
            kind: 'dialogue_gap',
            object: o.name,
            message: `The counting skips ${i}.`,
            correction: `Say every number from 1 to ${o.quantity} in order while the ${o.name} are on screen.`,
          })
          break
        }
    }
  }
  return issues
}

/** Words that must never appear in a made for kids script or prompt. A plain screen that runs before the language model check. */
const FRIGHT = [
  'blood',
  'bloody',
  'gore',
  'gun',
  'knife',
  'sword',
  'weapon',
  'kill',
  'killed',
  'murder',
  'dead',
  'death',
  'die',
  'dying',
  'corpse',
  'ghost',
  'zombie',
  'demon',
  'devil',
  'monster',
  'scary',
  'terrifying',
  'terrified',
  'horror',
  'nightmare',
  'creepy',
  'scream',
  'screaming',
  'explosion',
  'bomb',
  'drunk',
  'beer',
  'wine',
  'cigarette',
  'smoking',
  'drug',
  'hate',
  'stupid',
  'idiot',
  'shut up',
  'damn',
  'hell',
]
const BRANDS = [
  'disney',
  'pixar',
  'nintendo',
  'pokemon',
  'mickey',
  'paw patrol',
  'cocomelon',
  'bluey',
  'coca-cola',
  'mcdonald',
  'lego',
  'youtube kids',
]

export interface SafetyHit {
  where: string
  word: string
  kind: 'frightening' | 'brand'
}

export function safetyScreen(parts: Array<{ where: string; text: string }>): SafetyHit[] {
  const hits: SafetyHit[] = []
  for (const p of parts) {
    const t = ` ${p.text.toLowerCase().replace(/[^a-z0-9' -]/g, ' ')} `
    for (const w of FRIGHT)
      if (t.includes(` ${w} `) || (w.length > 4 && t.includes(` ${w}s `)))
        hits.push({ where: p.where, word: w, kind: 'frightening' })
    for (const b of BRANDS)
      if (t.includes(` ${b} `) || t.includes(b))
        hits.push({ where: p.where, word: b, kind: 'brand' })
  }
  return hits
}
