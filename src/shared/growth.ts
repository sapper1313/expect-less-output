// Pure helpers for the growth features: staggered posting, caption morphing, best times, retention drops,
// viewer questions, topic rotation, loudness and search tags. No clock, no files, no network: the services call these.
import { DateTime } from 'luxon'
import type { Platform } from './platformLimits'

// ---------------------------------------------------------------- staggered posting

const STAGGER_ORDER: Platform[] = [
  'youtube',
  'instagram',
  'facebook',
  'tiktok',
  'x',
  'linkedin',
  'pinterest',
  'bluesky',
  'snapchat',
]

/** A small deterministic random number generator, so a post always gets the same offsets for the same seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Minutes after the slot each platform posts. The first platform in the order (YouTube when present) posts on the slot
 * and every next one waits a random gap of gapMin to gapMax minutes after the one before it.
 */
export function staggerOffsets(
  platforms: Platform[],
  seed: number,
  gapMin: number,
  gapMax: number,
): Partial<Record<Platform, number>> {
  const lo = Math.max(0, Math.floor(Math.min(gapMin, gapMax)))
  const hi = Math.max(lo, Math.floor(Math.max(gapMin, gapMax)))
  const rand = mulberry32(seed * 2654435761 + 12345)
  const out: Partial<Record<Platform, number>> = {}
  let at = 0
  let first = true
  for (const p of STAGGER_ORDER) {
    if (!platforms.includes(p)) continue
    if (!first) at += lo + Math.floor(rand() * (hi - lo + 1))
    out[p] = at
    first = false
  }
  return out
}

/** Minutes after the slot for Bluesky: one more gap after the last platform. */
export function blueskyOffset(
  lastOffset: number,
  seed: number,
  gapMin: number,
  gapMax: number,
): number {
  const lo = Math.max(0, Math.floor(Math.min(gapMin, gapMax)))
  const hi = Math.max(lo, Math.floor(Math.max(gapMin, gapMax)))
  const rand = mulberry32(seed * 2246822519 + 777)
  return lastOffset + lo + Math.floor(rand() * (hi - lo + 1))
}

// ---------------------------------------------------------------- caption morphing

export interface MorphInput {
  /** The description without the hashtag block, or with it. Hashtags inside are pulled out. */
  description: string
  tags?: string[]
}

const HASHTAG = /#([\p{L}\p{N}_]+)/gu

function cleanTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#/, '')
    .replace(/[^\p{L}\p{N}_]/gu, '')
}

/** The body text with hashtags removed, and the hashtags (in order, no repeats). */
export function splitHashtags(input: MorphInput): { body: string; tags: string[] } {
  const seen = new Set<string>()
  const tags: string[] = []
  const add = (raw: string) => {
    const t = cleanTag(raw)
    if (!t || seen.has(t.toLowerCase())) return
    seen.add(t.toLowerCase())
    tags.push(t)
  }
  for (const m of input.description.matchAll(HASHTAG)) add(m[1] ?? '')
  for (const t of input.tags ?? []) add(t)
  const body = input.description
    .replace(HASHTAG, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { body, tags }
}

function sentences(text: string): string[] {
  return (
    text
      .replace(/\s+/g, ' ')
      .trim()
      .match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []
  )
    .map((s) => s.trim())
    .filter(Boolean)
}

const hashLine = (tags: string[], max: number) =>
  tags
    .slice(0, max)
    .map((t) => `#${t}`)
    .join(' ')

/**
 * Rewrites one description for one platform.
 * - Facebook: no hashtags, clean paragraphs.
 * - Instagram: one sentence per line, a blank line, then up to 10 hashtags.
 * - TikTok: two short sentences at most, then up to 5 hashtags.
 * - YouTube: the full description, then up to 15 hashtags (YouTube shows the first three above the title).
 */
export function morphCaption(platform: Platform, input: MorphInput): string {
  const { body, tags } = splitHashtags(input)
  switch (platform) {
    case 'facebook':
      return body
    case 'instagram': {
      const lines = body.includes('\n')
        ? body
        : sentences(body).join(body.length > 140 ? '\n' : ' ')
      const text = lines.trim()
      const h = hashLine(tags, 10)
      return (h ? `${text}${text ? '\n\n' : ''}${h}` : text).slice(0, 2200)
    }
    case 'tiktok': {
      let text = sentences(body).slice(0, 2).join(' ')
      if (text.length > 160) text = `${text.slice(0, 157).trimEnd()}...`
      const h = hashLine(tags, 5)
      return (h ? `${text}${text ? ' ' : ''}${h}` : text).slice(0, 2200)
    }
    case 'bluesky': {
      // 300 characters in all, hashtags included.
      const h = hashLine(tags, 3)
      const room = 300 - (h ? h.length + 1 : 0)
      let text = ''
      for (const sentence of sentences(body)) {
        const next = text ? `${text} ${sentence}` : sentence
        if (next.length > room) break
        text = next
      }
      if (!text)
        text = body.slice(0, Math.max(0, room - 3)).trimEnd() + (body.length > room ? '...' : '')
      return (h ? `${text}${text ? ' ' : ''}${h}` : text).slice(0, 300)
    }
    case 'x': {
      // 280 characters in all, hashtags included.
      const h = hashLine(tags, 2)
      const room = 280 - (h ? h.length + 1 : 0)
      let text = ''
      for (const sentence of sentences(body)) {
        const next = text ? `${text} ${sentence}` : sentence
        if (next.length > room) break
        text = next
      }
      if (!text)
        text = body.slice(0, Math.max(0, room - 3)).trimEnd() + (body.length > room ? '...' : '')
      return (h ? `${text}${text ? ' ' : ''}${h}` : text).slice(0, 280)
    }
    case 'linkedin': {
      const h = hashLine(tags, 5)
      return (h ? `${body}${body ? '\n\n' : ''}${h}` : body).slice(0, 3000)
    }
    case 'pinterest':
      return body.slice(0, 800)
    case 'snapchat': {
      const h = hashLine(tags, 3)
      let text = sentences(body).slice(0, 2).join(' ')
      if (text.length > 200) text = `${text.slice(0, 197).trimEnd()}...`
      return (h ? `${text}${text ? ' ' : ''}${h}` : text).slice(0, 250)
    }
    case 'youtube': {
      const h = hashLine(tags, 15)
      return h ? `${body}${body ? '\n\n' : ''}${h}` : body
    }
  }
}

// ---------------------------------------------------------------- viewer questions

const QUESTION_START =
  /^(how|what|why|when|where|which|who|can|could|should|would|will|do|does|did|is|are|am|was|were|has|have)\b/i
const QUESTION_PHRASE =
  /\b(should i|can i|could i|how do i|how do you|how to|is it|what if|why do|why is)\b/i
const SPAM =
  /(https?:\/\/|www\.|\.com\b|subscribe|sub4sub|check out my|follow me|dm me|whatsapp|telegram|crypto|giveaway|promo ?code|click (the )?link)/i

/** Is this comment a real viewer question worth turning into an episode idea? */
export function isViewerQuestion(raw: string): boolean {
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length < 15 || text.length > 300) return false
  if (SPAM.test(text)) return false
  if (/(.)\1{5,}/.test(text)) return false
  const letters = (text.match(/\p{L}/gu) ?? []).length
  if (letters < text.length * 0.5) return false
  return text.includes('?') || QUESTION_START.test(text) || QUESTION_PHRASE.test(text)
}

// ---------------------------------------------------------------- topic rotation

export interface TopicRun {
  /** Position in the list that was checked. */
  index: number
  topic: string
  count: number
}

/**
 * Runs of the same topic back to back in a list of posts in posting order. Only the last `window` posts are looked at.
 * A run of 2 or more is saturation.
 */
export function topicRuns(topics: Array<string | null>, window = 5, minRun = 2): TopicRun[] {
  const start = Math.max(0, topics.length - window)
  const recent = topics.slice(start)
  const out: TopicRun[] = []
  let i = 0
  while (i < recent.length) {
    const t = recent[i]
    let j = i
    while (j + 1 < recent.length && t && recent[j + 1] === t) j++
    if (t && j - i + 1 >= minRun) out.push({ index: start + i, topic: t, count: j - i + 1 })
    i = j + 1
  }
  return out
}

export function normalizeTopic(raw: string | null | undefined): string | null {
  const t = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_ -]+/g, '')
    .replace(/[\s-]+/g, '_')
  return t || null
}

// ---------------------------------------------------------------- best times

export interface TimedViews {
  postedAtUtc: string
  views: number
}

export interface BestTime {
  /** 1 = Monday ... 7 = Sunday */
  weekday: number
  hour: number
  label: string
  averageViews: number
  samples: number
}

const ZONE = 'America/New_York'

/**
 * The strongest weekday and hour (Eastern) by average views, from posts that already went out. A time with fewer than
 * minSamples posts is not trusted. Best-first, at most `top`.
 */
export function bestTimes(rows: TimedViews[], top = 3, minSamples = 2): BestTime[] {
  const buckets = new Map<string, { weekday: number; hour: number; sum: number; n: number }>()
  for (const r of rows) {
    const d = DateTime.fromISO(r.postedAtUtc, { zone: 'utc' }).setZone(ZONE)
    if (!d.isValid) continue
    const key = `${d.weekday}-${d.hour}`
    const b = buckets.get(key) ?? { weekday: d.weekday, hour: d.hour, sum: 0, n: 0 }
    b.sum += r.views
    b.n++
    buckets.set(key, b)
  }
  return [...buckets.values()]
    .filter((b) => b.n >= minSamples)
    .map((b) => ({
      weekday: b.weekday,
      hour: b.hour,
      label: DateTime.fromObject(
        { weekday: b.weekday as 1, hour: b.hour },
        { zone: ZONE },
      ).toFormat('cccc h a'),
      averageViews: Math.round(b.sum / b.n),
      samples: b.n,
    }))
    .sort((a, b) => b.averageViews - a.averageViews)
    .slice(0, top)
}

// ---------------------------------------------------------------- retention drops

export interface CurvePoint {
  /** 0 to 1 of the video's length. */
  t: number
  /** 0 to 1 of the viewers still watching. */
  watch: number
}

export interface SteepDrop {
  atSeconds: number
  /** Points of audience lost, 0 to 100. */
  lostPct: number
  fromPct: number
  toPct: number
}

/**
 * The steepest fall in the audience curve after the opening moments. Returns null when nothing falls by at least
 * minLostPct points.
 */
export function steepestDrop(
  curve: CurvePoint[],
  durationSeconds: number,
  minLostPct = 8,
): SteepDrop | null {
  const pts = [...curve].sort((a, b) => a.t - b.t)
  let best: SteepDrop | null = null
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as CurvePoint
    const b = pts[i] as CurvePoint
    if (b.t < 0.08) continue
    const lost = (a.watch - b.watch) * 100
    if (lost >= minLostPct && (!best || lost > best.lostPct))
      best = {
        atSeconds: Math.round(a.t * durationSeconds),
        lostPct: Math.round(lost * 10) / 10,
        fromPct: Math.round(a.watch * 100),
        toPct: Math.round(b.watch * 100),
      }
  }
  return best
}

export function learningLine(channel: string, episodeId: string, d: SteepDrop): string {
  const m = Math.floor(d.atSeconds / 60)
  const s = String(d.atSeconds % 60).padStart(2, '0')
  return `${channel} ${episodeId}: lost ${d.lostPct} points of viewers (${d.fromPct}% to ${d.toPct}%) around ${m}:${s}. Put a camera cut, a new visual or a new beat there.`
}

// ---------------------------------------------------------------- velocity

/** Mean and standard deviation of a list of numbers. */
export function meanStd(xs: number[]): { mean: number; std: number } {
  if (!xs.length) return { mean: 0, std: 0 }
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const std = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
  return { mean, std }
}

/** Is a view count at this hour more than `sigmas` standard deviations under the channel's usual? Needs 3+ past posts. */
export function slowStart(views: number, past: number[], sigmas = 2): boolean {
  if (past.length < 3) return false
  const { mean, std } = meanStd(past)
  if (mean <= 0) return false
  const floor = std > 0 ? mean - sigmas * std : mean * 0.4
  return views < floor
}

// ---------------------------------------------------------------- loudness

export interface Loudness {
  integratedLufs: number
  truePeakDb: number
  rangeLu: number
}

/** Reads the JSON block that ffmpeg's loudnorm filter prints at the end of its output. */
export function parseLoudnorm(output: string): Loudness | null {
  const start = output.lastIndexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const j = JSON.parse(output.slice(start, end + 1)) as Record<string, string>
    const i = Number(j['input_i'])
    const tp = Number(j['input_tp'])
    const lra = Number(j['input_lra'])
    if (![i, tp, lra].every(Number.isFinite)) return null
    return { integratedLufs: i, truePeakDb: tp, rangeLu: lra }
  } catch {
    return null
  }
}

export const TARGET_LUFS = -14

/** A plain sentence about how loud the video is, or null when it is fine (within 2 LU and not clipping). */
export function loudnessProblem(l: Loudness): string | null {
  if (l.truePeakDb > -0.5)
    return `Audio peaks at ${l.truePeakDb.toFixed(1)} dB, so it may clip on phones. Aim for -1 dB or lower.`
  const off = l.integratedLufs - TARGET_LUFS
  if (off < -4)
    return `Audio is quiet (${l.integratedLufs.toFixed(1)} LUFS). Aim for about -14 LUFS.`
  if (off > 2) return `Audio is loud (${l.integratedLufs.toFixed(1)} LUFS). Aim for about -14 LUFS.`
  return null
}

// ---------------------------------------------------------------- search tags

/** Pulls the suggestion phrases out of a Google or YouTube autocomplete answer: ["query", ["a", "b", ...]]. */
export function parseSuggestions(json: unknown): string[] {
  if (!Array.isArray(json) || !Array.isArray(json[1])) return []
  return (json[1] as unknown[])
    .map((x) => (typeof x === 'string' ? x : Array.isArray(x) ? String(x[0] ?? '') : ''))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Adds search phrases to a YouTube tag list without repeats. YouTube allows 500 characters of tags in total, so this
 * stops before that, and never goes over `maxTags`.
 */
export function mergeSearchTags(existing: string[], phrases: string[], maxTags = 30): string[] {
  const out = [...existing]
  const have = new Set(out.map((t) => t.toLowerCase()))
  let chars = out.reduce((n, t) => n + t.length + (t.includes(' ') ? 4 : 1), 0)
  for (const p of phrases) {
    const t = p.replace(/[<>]/g, '').trim()
    if (!t || have.has(t.toLowerCase()) || out.length >= maxTags) continue
    const cost = t.length + (t.includes(' ') ? 4 : 1)
    if (chars + cost > 480) break
    have.add(t.toLowerCase())
    out.push(t)
    chars += cost
  }
  return out
}
