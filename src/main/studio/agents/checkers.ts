import { z } from 'zod'
import { checkClaims, extractClaims, type ClaimResult, type MathClaim } from '@shared/studio/mathEval'
import { checkCountedObjects, safetyScreen, type CountIssue } from '@shared/studio/hollowChecks'
import { lintValue } from '@shared/studio/lint'
import { isHollow, type HollowDraftData, type ShortDraftData } from '@shared/studio/drafts'
import type { SeriesBibleData } from '@shared/studio/bible'
import type { StudioConfigService } from '../configService'
import type { LlmGateway } from './llm'
import { STYLE_RULES, ctxLine } from './prompts'

type Draft = ShortDraftData | HollowDraftData

export interface CheckCtx {
  brandId: number
  brandName: string
  episodeId?: string
  taskId?: number
}

export interface Report {
  pass: boolean
  /** Plain fixes the Writer can act on. */
  fixes: string[]
}

const FixAnswer = z.object({ pass: z.boolean(), fixes: z.array(z.string()).default([]) })

function allText(d: Draft): string {
  if (isHollow(d))
    return [d.title, d.logline, d.life_lesson, d.math_lesson, ...d.scenes.flatMap((s) => [s.action, s.grok_prompt, ...s.dialogue.map((l) => l.line)])].join('\n')
  return [d.title, d.hook, d.script, ...d.clips.flatMap((c) => [c.prompt, ...c.dialogue])].join('\n')
}

// ---------------------------------------------------------------- Script QC

export interface ScriptQcReport extends Report {
  code: string[]
}

/** A checklist agent: code checks first (cheap and certain), then a language model check against the bible. */
export class ScriptQc {
  readonly name = 'Script QC'
  readonly role = 'Verifies a script against the series bible: voice, length, hook, banned phrases, dashes, policy, format.'
  constructor(private d: { cfg: StudioConfigService; gateway: LlmGateway; off?: () => boolean }) {}

  codeChecks(draft: Draft, bible: SeriesBibleData): string[] {
    const fixes: string[] = []
    const phrases = [...this.d.cfg.get().roboticPhrases, ...bible.bannedPhrases]
    for (const i of lintValue(draft, phrases)) fixes.push(`${i.path}: ${i.detail}`)
    if (isHollow(draft)) {
      const total = draft.scenes.reduce((n, s) => n + s.content_seconds, 0)
      if (total < bible.minSeconds || total > bible.maxSeconds)
        fixes.push(`The episode has ${total} seconds of content. It must be between ${bible.minSeconds} and ${bible.maxSeconds}.`)
      for (const s of draft.scenes) {
        if (s.generate_seconds < s.content_seconds) fixes.push(`Scene ${s.n} is generated at ${s.generate_seconds} seconds but needs ${s.content_seconds} seconds of content.`)
        if (s.generate_seconds > 15) fixes.push(`Scene ${s.n} is generated longer than 15 seconds.`)
      }
      const nums = draft.scenes.map((s) => s.n)
      if (nums.some((n, i) => n !== i + 1)) fixes.push('Scene numbers must run 1, 2, 3 in order.')
    } else {
      const total = draft.clips.reduce((n, c) => n + c.seconds, 0)
      if (total < bible.minSeconds || total > bible.maxSeconds)
        fixes.push(`The video is ${total} seconds long. It must be between ${bible.minSeconds} and ${bible.maxSeconds}.`)
      const first = draft.clips[0]
      const hookWords = draft.hook.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
      const firstText = `${first.prompt} ${first.dialogue.join(' ')}`.toLowerCase()
      if (hookWords.length && !hookWords.some((w) => firstText.includes(w)))
        fixes.push('The hook is not in the first clip. The first two seconds must carry the hook.')
    }
    return fixes
  }

  async run(draft: Draft, bible: SeriesBibleData, bibleMd: string, ctx: CheckCtx): Promise<ScriptQcReport> {
    if (this.d.off?.()) return { pass: true, fixes: [], code: [] }
    const code = this.codeChecks(draft, bible)
    if (code.length) return { pass: false, fixes: code, code }
    const ans = await this.d.gateway.json(
      {
        agent: this.name,
        brandId: ctx.brandId,
        episodeId: ctx.episodeId,
        taskId: ctx.taskId,
        system: `You are Script QC for "${ctx.brandName}". Check the script against the series bible below and these rules.\n${STYLE_RULES}\nAlso check: voice match, a clear hook, nothing that conflicts with platform policies, correct format. Answer only with JSON: {"pass": boolean, "fixes": ["plain fix", ...]}.\n\n${bibleMd}`,
        user: `${ctxLine({ task: 'script_qc', brand: ctx.brandName })}\n${JSON.stringify(draft)}`,
        maxTokens: 800,
      },
      FixAnswer,
    )
    return { pass: ans.pass && ans.fixes.length === 0, fixes: ans.fixes, code }
  }
}

// ---------------------------------------------------------------- Math Checker

export interface MathReport extends Report {
  claims: ClaimResult[]
  countIssues: CountIssue[]
  stepIssues: string[]
  warnings: string[]
}

const Extracted = z.object({
  claims: z.array(z.object({ text: z.string(), expression: z.string(), claimed: z.number() })).default([]),
  outdated: z.array(z.string()).default([]),
})

/**
 * Pulls every numeric claim out of the script and checks it by running code. A language model may help FIND
 * claims, but it never does the arithmetic. Hollow counted objects are checked against dialogue and prompts.
 */
export class MathChecker {
  readonly name = 'Math Checker'
  readonly role = 'Extracts every number, calculation, count and unit from a script and verifies them by executing code.'
  constructor(private d: { gateway: LlmGateway; off?: () => boolean }) {}

  async run(draft: Draft, opts: { counted: boolean; steps: boolean }, ctx: CheckCtx): Promise<MathReport> {
    if (this.d.off?.()) return { pass: true, fixes: [], claims: [], countIssues: [], stepIssues: [], warnings: ['The Math Checker is switched off.'] }
    const text = allText(draft)
    const found: MathClaim[] = extractClaims(text)
    const warnings: string[] = []
    let outdated: string[] = []
    try {
      const ex = await this.d.gateway.json(
        {
          agent: this.name,
          brandId: ctx.brandId,
          episodeId: ctx.episodeId,
          taskId: ctx.taskId,
          system:
            'You find numeric claims in a script. For each calculation or total stated, give the sentence, an arithmetic expression using only numbers and + - * / ^ ( ), and the claimed result. Do NOT compute anything yourself. If the script gives steps for a phone or computer, list menus or features that may be outdated. Answer only with JSON: {"claims":[{"text":"","expression":"","claimed":0}],"outdated":["..."]}.',
          user: `${ctxLine({ task: 'math_extract', brand: ctx.brandName })}\n${text}`,
          maxTokens: 1200,
        },
        Extracted,
        { lint: false },
      )
      for (const c of ex.claims) if (!found.some((f) => f.expression.replace(/\s/g, '') === c.expression.replace(/\s/g, ''))) found.push(c)
      outdated = ex.outdated
    } catch (e) {
      warnings.push(`The claim finder could not run (${(e as Error).message}). Only pattern based checks were used.`)
    }
    const claims = checkClaims(found)
    const fixes: string[] = []
    for (const c of claims) {
      if (!c.ok) fixes.push(c.error ? `Could not check "${c.text}": ${c.error}` : `"${c.text}" is wrong. ${c.expression} is ${c.actual}, not ${c.claimed}. Use ${c.actual}.`)
    }
    let countIssues: CountIssue[] = []
    if (opts.counted && isHollow(draft)) {
      countIssues = checkCountedObjects(draft.counted_objects, draft.scenes)
      for (const i of countIssues) fixes.push(i.correction)
    }
    const stepIssues: string[] = []
    if (opts.steps && !isHollow(draft)) {
      const nums = [...draft.script.matchAll(/\bstep\s+(\d+)/gi)].map((m) => Number(m[1]))
      if (nums.length) {
        nums.forEach((n, i) => {
          if (n !== i + 1) stepIssues.push(`Steps must run in order. Step ${n} came where step ${i + 1} should be.`)
        })
      }
      for (const o of outdated) warnings.push(`May be outdated: ${o}`)
    }
    for (const s of stepIssues) fixes.push(s)
    return { pass: fixes.length === 0, fixes, claims, countIssues, stepIssues, warnings }
  }
}

// ---------------------------------------------------------------- Hollow Safety Checker

export interface SafetyReport extends Report {
  hits: Array<{ where: string; word: string; kind: string }>
}

const SafetyAnswer = z.object({ pass: z.boolean(), issues: z.array(z.object({ where: z.string().default(''), problem: z.string(), fix: z.string() })).default([]) })

/** For made for kids brands: a plain code screen first, then a language model check for tone, behavior and clarity. */
export class HollowSafetyChecker {
  readonly name = 'Hollow Safety Checker'
  readonly role = 'Checks made for kids scripts and prompts: age appropriate, nothing frightening, no unsafe behavior, no real people or brands, positive tone, clear lesson.'
  constructor(private d: { gateway: LlmGateway; off?: () => boolean }) {}

  async run(draft: Draft, bibleMd: string, ctx: CheckCtx): Promise<SafetyReport> {
    if (this.d.off?.()) return { pass: true, fixes: [], hits: [] }
    const parts = isHollow(draft)
      ? [
          { where: 'title', text: draft.title },
          { where: 'logline', text: draft.logline },
          ...draft.scenes.flatMap((s) => [
            { where: `scene ${s.n} action`, text: s.action },
            { where: `scene ${s.n} prompt`, text: s.grok_prompt },
            ...s.dialogue.map((l) => ({ where: `scene ${s.n} dialogue`, text: l.line })),
          ]),
        ]
      : [{ where: 'script', text: draft.script }, ...draft.clips.map((c) => ({ where: `clip ${c.n}`, text: c.prompt }))]
    const hits = safetyScreen(parts)
    if (hits.length)
      return {
        pass: false,
        hits,
        fixes: hits.slice(0, 8).map((h) => `Remove "${h.word}" from ${h.where}. ${h.kind === 'brand' ? 'No real brands.' : 'Nothing frightening or unsafe for children.'}`),
      }
    const ans = await this.d.gateway.json(
      {
        agent: this.name,
        brandId: ctx.brandId,
        episodeId: ctx.episodeId,
        taskId: ctx.taskId,
        system: `You are the Safety Checker for a made for kids show. Fail anything frightening, violent, mature, unsafe to imitate, with real people or real brands, product placement, bad language, a negative tone, or an unclear lesson. Answer only with JSON: {"pass": boolean, "issues": [{"where": "", "problem": "", "fix": ""}]}.\n\n${bibleMd}`,
        user: `${ctxLine({ task: 'safety', brand: ctx.brandName })}\n${JSON.stringify(draft)}`,
        maxTokens: 800,
      },
      SafetyAnswer,
    )
    return { pass: ans.pass && ans.issues.length === 0, hits: [], fixes: ans.issues.map((i) => `${i.where}: ${i.problem}. ${i.fix}`) }
  }
}
