const clean = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** 0 to 1. Compares words, ignoring order, case and punctuation, with a bonus when one name contains the other. */
export function nameSimilarity(a: string, b: string): number {
  const x = clean(a)
  const y = clean(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const wx = new Set(x.split(' '))
  const wy = new Set(y.split(' '))
  let shared = 0
  for (const w of wx) if (wy.has(w)) shared++
  const jaccard = shared / (wx.size + wy.size - shared)
  const compact = (s: string) => s.replace(/ /g, '')
  const contains = compact(x).includes(compact(y)) || compact(y).includes(compact(x))
  return Math.min(1, jaccard + (contains ? 0.3 : 0))
}

/** Picks the best candidate for a name, or null when nothing is close enough. */
export function bestMatch<T>(
  name: string,
  candidates: T[],
  label: (c: T) => string,
  threshold = 0.34,
): T | null {
  let best: T | null = null
  let score = 0
  for (const c of candidates) {
    const s = nameSimilarity(name, label(c))
    if (s > score) {
      score = s
      best = c
    }
  }
  return score >= threshold ? best : null
}
