import { z } from 'zod'
import type { Db } from '../../db'
import { lintValue } from '@shared/studio/lint'
import { DEFAULT_PLATFORM_CAPS, capKeyFor, hashtagCount, limitProblem, type PlatformCap } from '@shared/studio/platformCaps'
import type { StudioConfigService } from '../configService'
import type { BibleService } from '../bible'

export const PlatformTextsSchema = z.object({
  youtube: z.object({ title: z.string(), description: z.string(), tags: z.array(z.string()).default([]) }).optional(),
  instagram: z.object({ caption: z.string() }).optional(),
  facebook: z.object({ caption: z.string() }).optional(),
  tiktok: z.object({ caption: z.string() }).optional(),
  threads: z.object({ text: z.string() }).optional(),
  bluesky: z.object({ text: z.string() }).optional(),
})
export type PlatformTexts = z.infer<typeof PlatformTextsSchema>

export interface PlatformVerdict {
  ok: boolean
  skipped: boolean
  reason: string | null
  /** How the AI label is carried: the platform API, a plain line in the text, or not needed. */
  disclosure: 'api' | 'text' | 'none'
}

export interface ComplianceReport {
  pass: boolean
  platforms: Record<string, PlatformVerdict>
  texts: PlatformTexts
  /** Problems the Publisher must fix by rewriting. Empty when everything passed. */
  violations: string[]
  kids: { required: boolean; applied: boolean }
  log: string[]
}

export const DISCLOSURE_LINE = 'Made with AI.'

export interface ComplianceInput {
  episodeId: string
  brandId: number
  isShort: boolean
  platforms: string[]
  texts: PlatformTexts
  video: { durationSeconds: number; width: number; height: number; sizeBytes: number }
  /** TikTok account mode, since only Direct Post can set the AI flag by API. */
  tiktokMode?: string | null
}

const mainText = (t: PlatformTexts, p: string): string | null => {
  const v = (t as Record<string, { caption?: string; text?: string; description?: string } | undefined>)[p]
  return v ? (v.caption ?? v.text ?? v.description ?? null) : null
}

const setText = (t: PlatformTexts, p: string, text: string) => {
  const v = (t as Record<string, Record<string, unknown> | undefined>)[p]
  if (!v) return
  if (p === 'youtube') v.description = text
  else if ('caption' in v) v.caption = text
  else v.text = text
}

/**
 * Compliance runs before anything is scheduled. It applies the AI disclosure for each platform, the made for kids
 * designation, the platform length and size limits, and the writing lint. If a platform's API has no label field, a plain
 * disclosure line goes in the text and the choice is logged. A limit problem skips that platform only.
 */
export class Compliance {
  readonly name = 'Compliance'
  readonly role = 'Applies AI disclosure and made for kids rules, checks platform limits and banned content, and lints the writing before anything is scheduled.'

  constructor(private d: { db: Db; cfg: StudioConfigService; bible: BibleService }) {}

  cap(platform: string, isShort: boolean): PlatformCap | null {
    const key = capKeyFor(platform, isShort)
    if (!key) return null
    const over = this.d.cfg.get().platformCaps[key] as Partial<PlatformCap> | undefined
    return { ...DEFAULT_PLATFORM_CAPS[key], ...(over ?? {}) }
  }

  run(i: ComplianceInput): ComplianceReport {
    const brand = this.d.cfg.getBrand(i.brandId)
    const texts: PlatformTexts = JSON.parse(JSON.stringify(i.texts))
    const platforms: Record<string, PlatformVerdict> = {}
    const violations: string[] = []
    const log: string[] = []

    // made for kids: the YouTube designation must match the brand
    const kids = { required: brand.madeForKids, applied: false }
    if (brand.madeForKids) {
      const r = this.d.db.prepare('UPDATE brand_defaults SET youtube_made_for_kids = 1, ai_flag_youtube = ? WHERE brand_id = ? AND youtube_made_for_kids = 0').run(brand.aiDisclosure ? 1 : 0, i.brandId)
      kids.applied = r.changes > 0
      log.push(`Made for kids: ${kids.applied ? 'switched the YouTube designation on' : 'already on'}.`)
    }

    const phrases = [...this.d.cfg.get().roboticPhrases, ...this.d.bible.get(i.brandId).bible.bannedPhrases]
    for (const p of i.platforms) {
      const cap = this.cap(p, i.isShort)
      if (!cap) {
        platforms[p] = { ok: false, skipped: true, reason: `No limits are known for ${p}.`, disclosure: 'none' }
        continue
      }
      // 1. does the video fit?
      const bad = limitProblem(cap, i.video)
      if (bad) {
        platforms[p] = { ok: false, skipped: true, reason: bad, disclosure: 'none' }
        log.push(`${cap.label}: skipped. ${bad}`)
        continue
      }
      // 2. disclosure
      let disclosure: PlatformVerdict['disclosure'] = 'none'
      if (brand.aiDisclosure) {
        const api = p === 'youtube' || p === 'instagram' || (p === 'tiktok' && i.tiktokMode === 'direct')
        disclosure = api ? 'api' : 'text'
        if (!api) {
          const cur = mainText(texts, p)
          if (cur !== null && !cur.includes(DISCLOSURE_LINE)) {
            const room = cap.textMax - DISCLOSURE_LINE.length - 2
            const body = cur.length > room ? cur.slice(0, room).replace(/\s+\S*$/, '') : cur
            setText(texts, p, `${body}\n\n${DISCLOSURE_LINE}`)
          }
          log.push(`${cap.label}: no API label, so the disclosure line was added to the text.`)
        } else log.push(`${cap.label}: AI label set through the platform.`)
      }
      // 3. text limits
      const t = mainText(texts, p)
      const verdict: PlatformVerdict = { ok: true, skipped: false, reason: null, disclosure }
      if (t !== null) {
        if (t.length > cap.textMax) {
          verdict.ok = false
          violations.push(`${cap.label}: the text is ${t.length} characters. The limit is ${cap.textMax}. Shorten it.`)
        }
        const tags = hashtagCount(t)
        if (cap.hashtagsMax !== null && tags > cap.hashtagsMax) {
          verdict.ok = false
          violations.push(`${cap.label}: ${tags} hashtags. The limit is ${cap.hashtagsMax}.`)
        }
      }
      const yt = texts.youtube
      if (p === 'youtube' && yt) {
        if (cap.titleMax && yt.title.length > cap.titleMax) {
          verdict.ok = false
          violations.push(`YouTube: the title is ${yt.title.length} characters. The limit is ${cap.titleMax}.`)
        }
        if (/[<>]/.test(yt.title)) {
          verdict.ok = false
          violations.push('YouTube: the title cannot contain < or >.')
        }
      }
      // 4. banned content and humanized writing
      const own = (texts as Record<string, unknown>)[p]
      for (const issue of lintValue(own, phrases, p)) {
        verdict.ok = false
        violations.push(`${cap.label}: ${issue.path.replace(`${p}.`, '')} ${issue.detail}`)
      }
      platforms[p] = verdict
    }
    return { pass: violations.length === 0, platforms, texts, violations, kids, log }
  }
}
