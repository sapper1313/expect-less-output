import { describe, expect, it } from 'vitest'
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

const run = (g: ReturnType<typeof fakeGateway>, count: number) =>
  writeInParts({ gateway: g.gateway } as never, {
    base: { agent: 'Show Writer', brandId: 1, episodeId: 'e', taskId: 1 },
    system: 'You are the Show Writer.',
    userLines: ['Posting date: 2026-06-03.'],
    sceneCount: count,
    minSeconds: 420,
  })

describe('long episodes are written in parts', () => {
  it('uses a small plan call and several scene calls instead of one huge answer', async () => {
    const g = fakeGateway(44)
    const draft = await run(g, 44)
    expect(draft.scenes).toHaveLength(44)
    expect(draft.scenes.map((s) => s.n)).toEqual(Array.from({ length: 44 }, (_, i) => i + 1))
    expect(draft.title).toBe('Acorn Math')
    expect(g.calls).toHaveLength(1 + Math.ceil(44 / SCENES_PER_PART))
    expect(Math.max(...g.calls.map((c) => c.maxTokens))).toBeLessThanOrEqual(16000)
    // each part sees the whole plan and the end of the part before it
    expect(g.calls[2].user).toContain('1. Beat 1')
    expect(g.calls[2].user).toContain('Action 12')
  })

  it('refuses a part that comes back short, so the writer tries again', async () => {
    const g = fakeGateway(30, (from, to) =>
      from === 13 ? [from] : Array.from({ length: to - from + 1 }, (_, i) => from + i),
    )
    await expect(run(g, 30)).rejects.toThrow(/1 of the 12 scenes/)
  })

  it('only kicks in above the scene limit', () => {
    expect(PARTS_ABOVE_SCENES).toBeLessThan(44)
    expect(Math.ceil(150 / 10) + 2).toBeLessThanOrEqual(PARTS_ABOVE_SCENES) // a 3 minute episode keeps the single call
  })
})
