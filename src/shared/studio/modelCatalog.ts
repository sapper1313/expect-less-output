import { LOCAL_MODEL_PREFIX } from './pricing'

export interface ModelOption {
  /** What is stored. Claude models use their API name. Local ones start with ollama: */
  id: string
  label: string
  kind: 'claude' | 'local'
  inPerM: number
  outPerM: number
  /** Plain words: what this model is good for. */
  bestFor: string
  /** Plain words: what to avoid it for. */
  avoid: string
}

export const CLAUDE_GUIDE: Record<string, { label: string; bestFor: string; avoid: string }> = {
  'claude-haiku-5-5': {
    label: 'Claude Haiku 5.5',
    bestFor: 'Quick checking and formatting: script checks, math checks, thumbnail text, publishing text, comment replies.',
    avoid: 'Long creative writing where the voice matters.',
  },
  'claude-sonnet-5-5': {
    label: 'Claude Sonnet 5.5',
    bestFor: 'Writing episodes in the right voice and anything that needs good judgment, including the kids safety check.',
    avoid: 'Nothing, but it costs more than Haiku for simple jobs.',
  },
  'claude-opus-5-5': {
    label: 'Claude Opus 5.5',
    bestFor: 'The hardest jobs and tricky rewrites, when Sonnet keeps missing.',
    avoid: 'Everyday work. It costs the most.',
  },
}

/** A short, honest note based only on the name of a local model (its size and kind). */
export function localGuide(name: string): { bestFor: string; avoid: string } | null {
  const n = name.toLowerCase()
  if (/embed|nomic|bge|minilm|e5-|gte-/.test(n)) return null
  if (/llava|vision|-vl|moondream|minicpm-v|bakllava/.test(n))
    return { bestFor: 'Looking at pictures (video frame checks). Used by the video checker on the Local AI page.', avoid: 'Writing text for the agents.' }
  const size = Number(/(\d+(?:\.\d+)?)b\b/.exec(n)?.[1] ?? '0')
  if (size && size <= 4)
    return { bestFor: 'Very small jobs: title and caption suggestions, hashtags.', avoid: 'Checks and writing. It misses too much.' }
  if (size && size <= 10)
    return { bestFor: 'Free help with suggestions, comment replies, thumbnail text and idea lists.', avoid: 'Script checks on long episodes, and the kids safety check.' }
  if (size && size <= 40)
    return { bestFor: 'Free everyday work: suggestions, comments, publishing text, simple checks.', avoid: 'Long Hollow scripts. It may lose track and is slower.' }
  return { bestFor: 'Free and strong, if the machine can run it.', avoid: 'Slow machines. Watch the time per answer.' }
}

export function buildModelOptions(
  prices: Record<string, { inPerM: number; outPerM: number }>,
  fallback: { inPerM: number; outPerM: number },
  localNames: string[],
): ModelOption[] {
  const ids = Array.from(new Set([...Object.keys(CLAUDE_GUIDE), ...Object.keys(prices)]))
  const claude = ids.map((id) => {
    const g = CLAUDE_GUIDE[id]
    const p = prices[id] ?? fallback
    return { id, label: g?.label ?? id, kind: 'claude' as const, inPerM: p.inPerM, outPerM: p.outPerM, bestFor: g?.bestFor ?? 'A custom model you added to the price table.', avoid: g?.avoid ?? '' }
  })
  const local = localNames.flatMap((name) => {
    const g = localGuide(name)
    return g ? [{ id: LOCAL_MODEL_PREFIX + name, label: `${name} (on your Ollama)`, kind: 'local' as const, inPerM: 0, outPerM: 0, bestFor: g.bestFor, avoid: g.avoid }] : []
  })
  return [...claude, ...local]
}
