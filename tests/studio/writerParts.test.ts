import { describe, expect, it } from 'vitest'
import { ScriptQc } from '../../src/main/studio/agents/checkers'
import { QC_SCOPE, LENGTH_PRECEDENCE } from '../../src/main/studio/agents/prompts'
import { SeriesBible } from '../../src/shared/studio/bible'
import { HollowDraft } from '../../src/shared/studio/drafts'
import { RetryableError } from '../../src/main/studio/agents/framework'
import {
  PARTS_ABOVE_SCENES,
  SCENES_PER_PART,
  writeInParts,
} from '../../src/main/studio/agents/writer'

const outline = (n: number) => ({
  title: 'Acorn Math',
  idea: 'counting acorns',
  logline: 'The crew counts acorns.',
  life_lesson: 'Share.',
  math_lesson: 'Counting to ten.',
  runtime_target_seconds: 420,
  counted_objects: [{ name: 'acorns', quantity: 5, scenes: [4, 5] }],
  beats: Array.from({ length: n }, (_, i) => ({ n: i + 1, beat: `Beat ${i + 1}` })),
  youtube: { title: 'Acorn Math', description: 'A cozy episode.', tags: [] },
  thumbnail_brief: '',
  summary: 'The crew counts acorns.',
  tags: [],
  key_lines: ['One acorn, two acorns.'],
})

const scene = (n: number) => ({
  n,
  content_seconds: 10,
  generate_seconds: 10,
  setting: 'workshop',
  characters: [],
  action: `Action ${n}`,
  dialogue: [{ speaker: 'Fern', line: `Line ${n}` }],
  objects_in_frame: [],
  camera: '',
  transition_in: '',
  transition_out: '',
  grok_prompt: `Prompt ${n}`,
  extension_note: '',
})

/** A stand in for the gateway: the plan, then whatever scenes the test wants for each part. */
function fakeGateway(count: number, partScenes?: (from: number, to: number) => number[]) {
  const calls: Array<{ user: string; system: string; maxTokens: number }> = []
  return {
    calls,
    gateway: {
      async json(req: { user: string; system: string; maxTokens: number }) {
        calls.push(req)
        if (req.system.includes('Plan exactly')) return outline(count)
        const m = /Write only scenes (\d+) to (\d+)/.exec(req.user)!
        const from = Number(m[1])
        const to = Number(m[2])
        const ns =
          partScenes?.(from, to) ?? Array.from({ length: to - from + 1 }, (_, i) => from + i)
        return { scenes: ns.map(scene) }
      },
    },
  }
}

const run = (g: ReturnType<typeof fakeGateway>, count: number, feedback?: string[]) =>
  writeInParts({ gateway: g.gateway } as never, {
    base: { agent: 'Show Writer', brandId: 1, episodeId: 'e', taskId: 1 },
    system: 'You are the Show Writer.',
    userLines: ['Posting date: 2026-06-03.'],
    sceneCount: count,
    minSeconds: 420,
    feedback,
  })

describe('long episodes are written in parts', () => {
  it('uses a small plan call and several scene calls instead of one huge answer', async () => {
    const g = fakeGateway(44)
    const draft = await run(g, 44)
    expect(draft.scenes).toHaveLength(44)
    expect(draft.scenes.map((s) => s.n)).toEqual(Array.from({ length: 44 }, (_, i) => i + 1))
    expect(draft.title).toBe('Acorn Math')
    expect(g.calls).toHaveLength(1 + Math.ceil(44 / SCENES_PER_PART))
    expect(Math.max(...g.calls.map((c) => c.maxTokens))).toBeLessThanOrEqual(20000)
    // each part sees the whole plan and the end of the part before it
    expect(g.calls[2].user).toContain('1. Beat 1')
    expect(g.calls[2].user).toContain(`Action ${SCENES_PER_PART}`)
  })

  it('refuses a part that comes back short, so the writer tries again', async () => {
    const g = fakeGateway(30, (from, to) =>
      from === SCENES_PER_PART + 1
        ? [from]
        : Array.from({ length: to - from + 1 }, (_, i) => from + i),
    )
    await expect(run(g, 30)).rejects.toThrow(new RegExp(`1 of the ${SCENES_PER_PART} scenes`))
  })

  it('splits a part in half when its answer is cut off, instead of failing the episode', async () => {
    const g = fakeGateway(20)
    const real = g.gateway.json.bind(g.gateway)
    // any part of more than 4 scenes runs out of room
    g.gateway.json = async (req) => {
      const m = /Write only scenes (\d+) to (\d+)/.exec(req.user)
      if (m && Number(m[2]) - Number(m[1]) + 1 > 4)
        throw new RetryableError(
          'The answer was cut off because it was too long. It will be tried again.',
        )
      return real(req)
    }
    const draft = await run(g, 20)
    expect(draft.scenes.map((s) => s.n)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    const sizes = g.calls
      .map((c) => /Write only scenes (\d+) to (\d+)/.exec(c.user))
      .filter(Boolean)
      .map((m) => Number(m![2]) - Number(m![1]) + 1)
    expect(Math.min(...sizes)).toBeLessThanOrEqual(4)
  })

  it('writes the plan again with more room when it is cut off', async () => {
    const g = fakeGateway(12)
    const real = g.gateway.json.bind(g.gateway)
    let planCalls = 0
    g.gateway.json = async (req) => {
      if (req.system.includes('Plan exactly')) {
        planCalls++
        if (req.maxTokens < 32000)
          throw new RetryableError(
            'The answer was cut off because it was too long. It will be tried again.',
          )
      }
      return real(req)
    }
    const draft = await run(g, 12)
    expect(planCalls).toBe(2)
    expect(draft.scenes).toHaveLength(12)
  })

  it('only kicks in above the scene limit', () => {
    expect(PARTS_ABOVE_SCENES).toBeLessThan(44)
    expect(Math.ceil(150 / 10) + 2).toBeLessThanOrEqual(PARTS_ABOVE_SCENES) // a 3 minute episode keeps the single call
  })
})

describe('feedback and QC scope', () => {
  it('every part of a rewrite sees the problems from the last try', async () => {
    const g = fakeGateway(24)
    await run(g, 24, ['Rewrite scenes 4 and 5 so Biscuit does not go out alone at dusk.'])
    const parts = g.calls.filter((c) => c.user.includes('Write only scenes'))
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(p.user).toContain('does not go out alone at dusk')
  })

  it('Script QC is told the bible decides length and that it checks the script only', async () => {
    let system = ''
    const gateway = {
      async json(req: { system: string }) {
        system = req.system
        return { pass: true, fixes: [] }
      },
    }
    const qc = new ScriptQc({
      cfg: { get: () => ({ roboticPhrases: [] }) } as never,
      gateway: gateway as never,
    })
    const draft = HollowDraft.parse({
      title: 'T',
      idea: 'i',
      logline: 'l',
      life_lesson: 'l',
      math_lesson: 'm',
      runtime_target_seconds: 420,
      scenes: Array.from({ length: 44 }, (_, i) => ({
        n: i + 1,
        content_seconds: 10,
        generate_seconds: 10,
        setting: 's',
        action: 'a',
        grok_prompt: 'p',
      })),
      youtube: { title: 't', description: 'd' },
      summary: 's',
    })
    const bible = SeriesBible.parse({ minSeconds: 420, maxSeconds: 570 })
    const r = await qc.run(draft, bible, '# bible', {
      brandId: 1,
      brandName: 'B',
      episodeId: 'e',
      taskId: 1,
    } as never)
    expect(r.pass).toBe(true)
    expect(system).toContain(QC_SCOPE)
    expect(QC_SCOPE).toContain(LENGTH_PRECEDENCE)
    expect(QC_SCOPE).toMatch(/Never ask for the episode to be regrouped/)
    expect(QC_SCOPE).toMatch(/COUNT PLAN/)
  })
})
