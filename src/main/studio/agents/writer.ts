import { z, type ZodType } from 'zod'
import type { Db } from '../../db'
import {
  Draft,
  HollowDraft,
  HollowOutline,
  SceneBatch,
  ShortDraft,
  draftToPackage,
  isHollow,
  type HollowDraftData,
  type ShortDraftData,
} from '@shared/studio/drafts'
import type { StudioConfigService } from '../configService'
import type { BibleService } from '../bible'
import type { EpisodeLibrary } from '../library'
import type { Holidays } from '../holidays'
import type { RepetitionGuard } from '../repetition'
import { AgentDef, FlagNow, RetryableError } from './framework'
import type { LlmGateway } from './llm'
import { LENGTH_PRECEDENCE, STYLE_RULES, ctxLine } from './prompts'
import type { HollowSafetyChecker, MathChecker, ScriptQc } from './checkers'

const SHORT_SHAPE = `{"title":"","idea":"","hook":"the line said or shown in the first 2 seconds","script":"the full script","clips":[{"n":1,"seconds":15,"prompt":"a prompt for the video model","dialogue":["spoken line"]}],"caption":"","hashtags":["#tag"],"youtube":{"title":"","description":"","tags":[""]},"summary":"one or two sentences","tags":[""],"key_lines":["two or three of the most distinctive lines"]}
Every clip is 15 seconds or less. Several clips make a longer video.`

const HOLLOW_SHAPE = `{"title":"","idea":"","logline":"","life_lesson":"","math_lesson":"","runtime_target_seconds":180,"counted_objects":[{"name":"acorns","quantity":5,"scenes":[4,5,6]}],"scenes":[{"n":1,"content_seconds":10,"generate_seconds":10,"setting":"","characters":[""],"action":"","dialogue":[{"speaker":"","line":""}],"objects_in_frame":[""],"camera":"","transition_in":"","transition_out":"","grok_prompt":"a complete prompt for the video model","extension_note":""}],"youtube":{"title":"","description":"","tags":[""]},"thumbnail_brief":"","summary":"","tags":[""],"key_lines":[""]}
Scenes are numbered 1, 2, 3 in order. Each has 10 seconds of content. Use generate_seconds 15 only where a transition handle helps the next scene start smoothly. Counted objects must be written into the scene as natural props and kept in frame for the whole counting beat, with the exact quantity stated in the scene prompt, and counted aloud one number at a time in order. Keep every field short. Each grok_prompt is at most 90 words, every other scene field is one short sentence, and the whole answer must stay well under 15000 tokens.`

/** Episodes with more scenes than this are written in parts, so no single answer can run out of room. */
export const PARTS_ABOVE_SCENES = 20
export const SCENES_PER_PART = 10

const OUTLINE_SHAPE = `{"title":"","idea":"","logline":"","life_lesson":"","math_lesson":"","runtime_target_seconds":420,"counted_objects":[{"name":"acorns","quantity":5,"scenes":[4,5,6]}],"beats":[{"n":1,"beat":"one short sentence about what happens in this scene"}],"youtube":{"title":"","description":"","tags":[""]},"thumbnail_brief":"","summary":"","tags":[""],"key_lines":[""]}
There is one beat for every scene, numbered 1, 2, 3 in order. Counted objects name the scene numbers where they are counted. Keep every field short.`

const SCENE_SHAPE = `{"scenes":[{"n":1,"content_seconds":10,"generate_seconds":10,"setting":"","characters":[""],"action":"","dialogue":[{"speaker":"","line":""}],"objects_in_frame":[""],"camera":"","transition_in":"","transition_out":"","grok_prompt":"a complete prompt for the video model","extension_note":""}]}
Each scene has 10 seconds of content. Use generate_seconds 15 only where a transition handle helps the next scene start smoothly. Counted objects must be written into the scene as natural props and kept in frame for the whole counting beat, with the exact quantity stated in the scene prompt, and counted aloud one number at a time in order. Each grok_prompt is at most 90 words and every other field is one short sentence.`

const Ideas = z.object({ ideas: z.array(z.string()).default([]) })

export interface WriterDeps {
  db: Db
  cfg: StudioConfigService
  bible: BibleService
  library: EpisodeLibrary
  holidays: Holidays
  gateway: LlmGateway
  repetition: RepetitionGuard
  scriptQc: ScriptQc
  math: MathChecker
  safety: HollowSafetyChecker
  brandName: (id: number) => string
  /** Hints on what worked, filled in by the Analytics agent in a later phase. */
  hints?: (brandId: number) => string[]
}

const Input = z.object({ slotDate: z.string(), episodeId: z.string().optional() })
const Output = z.object({ episodeId: z.string(), status: z.string(), attempts: z.number() })

/** True when a call failed because the answer did not fit in its limit. */
const isCutOff = (e: unknown) => e instanceof Error && /cut off/i.test(e.message)

/**
 * Writes a long episode in parts: a plan with one beat per scene, then the scenes ten at a time. Every part is
 * its own small answer, so a 7 minute episode with 45 scenes cannot be cut off the way one huge answer can. A part
 * that still runs out of room is split in half and written again, so one long scene never costs the whole episode.
 */
export async function writeInParts(
  d: WriterDeps,
  args: {
    base: Record<string, unknown>
    system: string
    userLines: string[]
    sceneCount: number
    minSeconds: number
    /** Problems from the last try. Every part must apply them, not only the plan. */
    feedback?: string[]
  },
): Promise<HollowDraftData> {
  const { base, system, userLines, sceneCount } = args
  const fixes = args.feedback ?? []
  let outline: z.infer<typeof HollowOutline> | null = null
  for (const maxTokens of [20000, 32000]) {
    try {
      outline = await d.gateway.json(
        {
          ...base,
          system: `${system}\nAnswer only with JSON in this shape:\n${OUTLINE_SHAPE}\nPlan exactly ${sceneCount} scenes, so the content adds up to more than ${args.minSeconds} seconds. Each beat is at most 20 words.`,
          user: userLines.join('\n'),
          maxTokens,
        } as never,
        HollowOutline,
      )
      break
    } catch (e) {
      if (!isCutOff(e) || maxTokens === 32000) throw e
    }
  }
  if (!outline) throw new RetryableError('The writer could not plan the episode.')
  const plan = outline
  const beats = [...plan.beats].sort((a, b) => a.n - b.n).map((b, i) => ({ ...b, n: i + 1 }))
  const planText = beats.map((b) => `${b.n}. ${b.beat}`).join('\n')

  type Scene = HollowDraftData['scenes'][number]
  /** Scenes from..to, split in half if the answer is cut off. */
  const writePart = async (
    from: number,
    to: number,
    before: Scene | undefined,
  ): Promise<Scene[]> => {
    try {
      const part = await d.gateway.json(
        {
          ...base,
          system: `${system}\nYou are writing part of one episode. The plan below is fixed. Answer only with JSON in this shape:\n${SCENE_SHAPE}`,
          user: [
            `Episode: ${plan.title}. ${plan.logline}`,
            `Life lesson: ${plan.life_lesson}. Math lesson: ${plan.math_lesson}.`,
            `Counted objects: ${JSON.stringify(plan.counted_objects)}`,
            `The whole plan:\n${planText}`,
            before
              ? `The scene just before this part (number ${before.n}) ends like this: ${before.action} ${before.dialogue.map((l) => `${l.speaker}: ${l.line}`).join(' ')}`
              : '',
            fixes.length
              ? `Fix these problems from the last try wherever they fall in your scenes:\n${fixes.map((f) => `- ${f}`).join('\n')}`
              : '',
            `Write only scenes ${from} to ${to}, numbered ${from} to ${to}, exactly one scene for each beat.`,
          ]
            .filter(Boolean)
            .join('\n'),
          maxTokens: 20000,
        } as never,
        SceneBatch,
      )
      const got = part.scenes.filter((sc) => sc.n >= from && sc.n <= to).sort((a, b) => a.n - b.n)
      if (got.length < to - from + 1)
        throw new RetryableError(
          `The writer returned ${got.length} of the ${to - from + 1} scenes asked for (scenes ${from} to ${to}).`,
        )
      return got
    } catch (e) {
      if (!isCutOff(e) || to - from < 1) throw e
      const mid = Math.floor((from + to) / 2)
      const first = await writePart(from, mid, before)
      const second = await writePart(mid + 1, to, first[first.length - 1])
      return [...first, ...second]
    }
  }

  const scenes: Scene[] = []
  for (let from = 1; from <= beats.length; from += SCENES_PER_PART) {
    const to = Math.min(beats.length, from + SCENES_PER_PART - 1)
    scenes.push(...(await writePart(from, to, scenes[scenes.length - 1])))
  }
  // The plan's beats are not part of the finished draft (the schema drops them).
  return HollowDraft.parse({ ...plan, scenes })
}

/** One Show Writer instance per brand: the same module, loaded with that brand's bible on every call. */
export function makeWriterAgent(
  d: WriterDeps,
): AgentDef<z.infer<typeof Input>, z.infer<typeof Output>> {
  return {
    name: 'Show Writer',
    taskType: 'write_episode',
    role: 'Writes the idea, script and video prompts for one episode, in the voice of the brand series bible.',
    input: Input,
    output: Output,
    tools: ['bible', 'episodes', 'holidays', 'ideas'],
    paid: true,
    async run(ctx, input) {
      const brandId = ctx.task.brandId
      if (!brandId) throw new FlagNow('A writing task has no brand.')
      const brandName = d.brandName(brandId)
      const brand = d.cfg.getBrand(brandId)
      const cap = d.cfg.get().retryCap
      const { bible } = d.bible.get(brandId)
      const bibleMd = d.bible.markdown(brandId)
      const long = brand.format === 'long'
      const catchphrases = bible.characters.flatMap((c) => c.catchphrases)

      // The episode exists from the first moment, so the runway counts it and a resumed task reuses it.
      let episodeId =
        input.episodeId ??
        d.library
          .list({ brandId, limit: 500 })
          .find(
            (e) =>
              e.slotDate === input.slotDate && ['Idea', 'Written', 'Checking'].includes(e.status),
          )?.id
      if (!episodeId) {
        const n =
          d.library.list({ brandId, limit: 5000 }).filter((e) => e.origin === 'studio').length + 1
        episodeId = d.library.create(
          brandId,
          {
            series: brandName,
            episode_number: n,
            title: 'Writing in progress',
            logline: '',
            runtime_target_seconds: 0,
            counted_objects: [],
            scenes: [],
            youtube: {
              title: '',
              description: '',
              tags: [],
              made_for_kids: brand.madeForKids,
              ai_disclosure: brand.aiDisclosure,
            },
            tags: [],
            summary: '',
          },
          { status: 'Idea', slotDate: input.slotDate },
        ).id
        ctx.tasks.setPayload(ctx.task.id, { ...ctx.task.payload, episodeId })
      }
      ctx.tasks.setEpisode(ctx.task.id, episodeId)
      ctx.audit('episode', { episodeId, slotDate: input.slotDate })

      // Ideas bank: use one, and refill when it runs low.
      const idea = d.bible.ideas(brandId)[0]
      if (idea) d.bible.markIdeaUsed(idea.id)
      if (d.bible.ideas(brandId).length < 5) {
        try {
          const r = await d.gateway.json(
            {
              agent: 'Show Writer',
              brandId,
              episodeId,
              taskId: ctx.task.id,
              system: `You are the Show Writer for "${brandName}". Give ten fresh episode ideas as one line each. ${STYLE_RULES}\nAnswer only with JSON: {"ideas":["..."]}\n\n${bibleMd}`,
              user: `${ctxLine({ task: 'ideas', brand: brandName, round: d.bible.ideas(brandId, true).length })}\nRecent titles: ${d.library
                .list({ brandId, limit: 30 })
                .map((e) => e.title)
                .join('; ')}`,
              maxTokens: 3000,
            },
            Ideas,
          )
          d.bible.addIdeas(brandId, r.ideas)
        } catch {
          // A failed refill never blocks writing an episode.
        }
      }

      const recent = d.library.list({ brandId, limit: 12 }).filter((e) => e.id !== episodeId)
      const events = brand.holidayTieIns
        ? d.holidays.upcoming(21).map((h) => `${h.date}: ${h.name}`)
        : []
      const hints = d.hints?.(brandId) ?? []
      const feedback: string[] = []
      let lastReason = 'The script did not pass its checks.'
      const checks = {
        math: brand.mathCheck,
        steps: brand.stepsCheck,
        kidSafety: brand.madeForKids,
      }

      for (let attempt = 0; attempt < cap; attempt++) {
        const userLines = [
          ctxLine({
            task: 'write',
            brand: brandName,
            format: brand.format,
            slotDate: input.slotDate,
            attempt,
            feedback,
            minSeconds: bible.minSeconds,
            maxSeconds: bible.maxSeconds,
            catchphrases,
            checks,
          }),
          `Posting date: ${input.slotDate}.`,
          idea ? `Use this idea if it fits: ${idea.text}` : '',
          events.length
            ? `Upcoming days you may tie in if it fits the bible: ${events.join('; ')}`
            : '',
          recent.length
            ? `Recent episodes (do not repeat them):\n${recent.map((e) => `- ${e.title}: ${e.summary}`).join('\n')}`
            : '',
          hints.length ? `What is working lately: ${hints.join(' ')}` : '',
          ctx.task.payload.note
            ? `The owner asked for this change: ${String(ctx.task.payload.note)}`
            : '',
          feedback.length
            ? `Fix these problems from the last try:\n${feedback.map((f) => `- ${f}`).join('\n')}`
            : '',
        ].filter(Boolean)
        const sceneCount = Math.ceil(bible.minSeconds / 10) + 2
        const inParts = long && sceneCount > PARTS_ABOVE_SCENES
        const baseSystem = `You are the Show Writer for "${brandName}". Follow the series bible exactly. Write the whole episode.\n${STYLE_RULES}\n${LENGTH_PRECEDENCE}`
        const draft = inParts
          ? await writeInParts(d, {
              base: { agent: 'Show Writer', brandId, episodeId, taskId: ctx.task.id },
              system: `${baseSystem}\n\n${bibleMd}`,
              userLines,
              sceneCount,
              minSeconds: bible.minSeconds,
              feedback: [...feedback],
            })
          : await d.gateway.json(
              {
                agent: 'Show Writer',
                brandId,
                episodeId,
                taskId: ctx.task.id,
                system: `${baseSystem}\n${long ? 'Answer only with JSON in this shape:\n' + HOLLOW_SHAPE + `\nWrite at least ${Math.ceil(bible.minSeconds / 10) + 1} scenes so the content adds up to more than ${bible.minSeconds} seconds. Count them before you answer.` : 'Answer only with JSON in this shape:\n' + SHORT_SHAPE}\n\n${bibleMd}`,
                user: userLines.join('\n'),
                maxTokens: long ? 32000 : 10000,
              },
              (long ? HollowDraft : ShortDraft) as ZodType<ShortDraftData | HollowDraftData>,
            )
        feedback.length = 0
        const parsed: ShortDraftData | HollowDraftData = Draft.parse(draft)
        const cand = {
          title: parsed.title,
          idea: parsed.idea,
          hook: isHollow(parsed) ? undefined : parsed.hook,
          summary: parsed.summary,
          keyLines: parsed.key_lines,
        }
        const check = { brandId, brandName, episodeId, taskId: ctx.task.id }

        // 1. repetition guard
        const rep = await d.repetition.check(brandId, cand, { episodeId, taskId: ctx.task.id })
        if (!rep.ok) {
          ctx.audit('too_similar', { attempt, similarTo: rep.similarTo, via: rep.via })
          feedback.push(rep.reason ?? 'Too similar to an earlier episode. Pick a different idea.')
          lastReason = rep.reason ?? lastReason
          continue
        }
        // Save as Written so the work is never lost, then check.
        const pkg = draftToPackage(
          brandName,
          d.library.get(episodeId).number,
          parsed,
          brand.madeForKids,
          brand.aiDisclosure,
        )
        const existing = d.library.getPackage(episodeId)
        if (existing) d.library.savePackage(episodeId, { ...existing, ...pkg })
        d.library.setStatus(episodeId, 'Checking', `Attempt ${attempt + 1}`)

        // 2. script QC
        const qc = await d.scriptQc.run(parsed, bible, bibleMd, check)
        if (!qc.pass) {
          ctx.audit('script_qc_failed', { attempt, fixes: qc.fixes })
          feedback.push(...qc.fixes)
          lastReason = `Script QC: ${qc.fixes[0] ?? 'failed'}`
          continue
        }
        // 3. math checker
        let math: unknown = null
        const counted = isHollow(parsed) && parsed.counted_objects.length > 0
        if (checks.math || checks.steps || counted) {
          const m = await d.math.run(parsed, { counted, steps: checks.steps }, check)
          math = m
          if (!m.pass) {
            ctx.audit('math_failed', { attempt, fixes: m.fixes })
            feedback.push(...m.fixes)
            lastReason = `Math Checker: ${m.fixes[0] ?? 'failed'}`
            continue
          }
        }
        // 4. made for kids safety
        let safety: unknown = null
        if (checks.kidSafety) {
          const s = await d.safety.run(parsed, bibleMd, check)
          safety = s
          if (!s.pass) {
            ctx.audit('safety_failed', { attempt, fixes: s.fixes })
            feedback.push(...s.fixes)
            lastReason = `Safety check: ${s.fixes[0] ?? 'failed'}`
            continue
          }
        }

        // Passed everything.
        const saved = d.library.getPackage(episodeId)
        if (saved)
          d.library.savePackage(episodeId, {
            ...saved,
            qc_report: qc,
            math_report: math ?? undefined,
            safety_report: safety ?? undefined,
          })
        d.library.setFields(episodeId, {
          keyText: rep.keyText,
          embeddingJson: rep.embedding ? JSON.stringify(rep.embedding) : null,
        })
        d.library.setStatus(
          episodeId,
          'Ready for production',
          `Passed every check on attempt ${attempt + 1}.`,
        )
        ctx.audit('ready', { episodeId, attempts: attempt + 1, via: rep.via })
        return { episodeId, status: 'Ready for production', attempts: attempt + 1 }
      }
      throw new FlagNow(
        `The Writer could not get this script through its checks after ${cap} tries. Last problem: ${lastReason}`,
      )
    },
  }
}
