import { existsSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MockLlm } from '../../src/main/studio/agents/llm'
import { registerMockResponders } from '../../src/main/studio/agents/mockResponders'
import { readCtx } from '../../src/main/studio/agents/prompts'
import { lintValue } from '../../src/shared/studio/lint'
import { DEFAULT_STUDIO_CONFIG } from '../../src/shared/studio/config'
import { checkClaims, evaluate, extractClaims } from '../../src/shared/studio/mathEval'
import { checkCountedObjects } from '../../src/shared/studio/hollowChecks'
import { hollowId, makeStudioEnv } from './helpers'

const base = new MockLlm()
registerMockResponders(base)
/** The standard canned answer for a writer call, for tests that tweak it. */
async function canned(req: Parameters<MockLlm['complete']>[0]) {
  return JSON.parse((await base.complete(req)).text)
}
const brandIdOf = (e: ReturnType<typeof makeStudioEnv>, like: string) =>
  (e.db.prepare('SELECT id FROM brands WHERE name LIKE ?').get(like) as { id: number }).id

async function write(e: ReturnType<typeof makeStudioEnv>, brandId: number, slotDate: string) {
  const t = e.studio.tasks.create({ type: 'write_episode', brandId, payload: { slotDate } })
  await e.studio.runner.runUntilIdle()
  return e.studio.tasks.get(t.id)!
}

describe('Writers, bible and lint', () => {
  it('every brand writes a mock script that passes lint, and its bible loads', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 10) })
    const s = e.studio
    for (const b of s.cfg.listBrandConfigs()) {
      const md = s.bibles.markdown(b.brandId)
      expect(md).toContain('# Series bible')
      expect(md.length).toBeGreaterThan(40)
      const task = await write(e, b.brandId, '2026-06-03')
      expect(task.status, `${b.name}: ${task.error}`).toBe('done')
      const row = s.episodes.get((task.result as { episodeId: string }).episodeId)
      expect(row.status).toBe('Ready for production')
      const pkg = s.episodes.getPackage(row.id)!
      expect(lintValue(pkg, DEFAULT_STUDIO_CONFIG.roboticPhrases)).toEqual([])
      expect(pkg.qc_report).toBeTruthy()
    }
    // the preloaded Clock Out Early facts survive
    const coe = brandIdOf(e, 'Clock Out Early%')
    const bible = s.bibles.get(coe).bible
    expect(bible.characters[0].catchphrases).toEqual(['Fine.', 'Task adequate.', 'Could not post. Probably for the best.'])
    // Hollow bible carries the rules from the brief
    const hollow = s.bibles.markdown(hollowId(e))
    expect(hollow).toMatch(/life lesson/)
    expect(hollow).toMatch(/Hollow logo/)
    expect(hollow).toMatch(/No credits/)
    expect(hollow).toMatch(/natural props/)
  })

  it('the Math of It and Teach Your Parents Tech get math claims checked, and Hollow counts verified, in the saved reports', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 10) })
    const t = await write(e, brandIdOf(e, 'The Math of It%'), '2026-06-03')
    const pkg = e.studio.episodes.getPackage((t.result as { episodeId: string }).episodeId)!
    const rep = pkg.math_report as { claims: Array<{ expression: string; ok: boolean }> }
    expect(rep.claims.some((c) => c.expression.includes('7 x 8') && c.ok)).toBe(true)
    const h = await write(e, hollowId(e), '2026-06-05')
    const hp = e.studio.episodes.getPackage((h.result as { episodeId: string }).episodeId)!
    expect(hp.scenes).toHaveLength(18)
    expect(hp.counted_objects[0].quantity).toBeGreaterThanOrEqual(3)
    expect((hp.math_report as { countIssues: unknown[] }).countIssues).toEqual([])
    expect(hp.safety_report).toBeTruthy()
  })

  it('imported skills reach the Writer on every call, and the series bible exports to Markdown', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 10) })
    const id = brandIdOf(e, 'Trash Panda%')
    await e.studio.importSkill(id, 'panda-character.md', 'Rocket the panda never uses the word "trash" twice in a row.')
    await write(e, id, '2026-06-03')
    const call = e.studio.mockLlm.calls.find((c) => c.agent === 'Show Writer' && readCtx(c.user).task === 'write')!
    expect(call.system).toContain('Rocket the panda')
    expect(await e.studio.exportBible(id)).toContain('## Skill: panda-character.md')
  })

  it('upcoming holidays reach the Writer and the toggle turns tie-ins off', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 9, 20, 10) })
    const id = brandIdOf(e, 'Trash Panda%')
    expect((await e.studio.holidays('2026-10-20', '2026-11-12')).map((h) => h.name)).toEqual(expect.arrayContaining(['Halloween', 'Veterans Day']))
    expect((await e.studio.holidays()).length).toBeGreaterThan(40) // seeded 18 months ahead
    await write(e, id, '2026-10-22')
    const first = e.studio.mockLlm.calls.find((c) => readCtx(c.user).task === 'write')!
    expect(first.user).toContain('Halloween')
    e.studio.mockLlm.calls.length = 0
    await e.studio.setBrand(id, { holidayTieIns: false })
    await write(e, id, '2026-10-25')
    expect(e.studio.mockLlm.calls.find((c) => readCtx(c.user).task === 'write')!.user).not.toContain('Halloween')
  })

  it('the Writer refills the ideas bank when it is low', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 10) })
    const id = brandIdOf(e, 'Trash Panda%')
    expect(await e.studio.ideas(id)).toHaveLength(0)
    await write(e, id, '2026-06-03')
    expect((await e.studio.ideas(id)).length).toBeGreaterThanOrEqual(5)
  })
})

describe('Repetition guard', () => {
  it('rejects a deliberately duplicated idea and the Writer revises', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 10) })
    const s = e.studio
    const id = brandIdOf(e, 'Trash Panda%')
    const first = await write(e, id, '2026-06-03')
    expect(first.status).toBe('done')
    const original = s.episodes.getPackage((first.result as { episodeId: string }).episodeId)!
    // The second episode's first try is a copy of the first one.
    const dup = await canned({ agent: 'Show Writer', model: 'm', maxTokens: 1, system: '', user: `CTX ${JSON.stringify({ task: 'write', brand: 'Trash Panda', format: 'short', slotDate: '2026-06-03', attempt: 0, minSeconds: 15, maxSeconds: 60 })}` })
    s.mockLlm.respond('Show Writer', (req) => {
      const c = readCtx(req.user)
      if (c.task !== 'write') return { ideas: ['a', 'b', 'c', 'd', 'e', 'f'] }
      if (c.attempt === 0) return dup
      return revised
    })
    const revised = await canned({ agent: 'Show Writer', model: 'm', maxTokens: 1, system: '', user: `CTX ${JSON.stringify({ task: 'write', brand: 'Trash Panda', format: 'short', slotDate: '2026-06-20', attempt: 5, minSeconds: 15, maxSeconds: 60 })}` })
    expect(revised.title).not.toBe(original.title)
    expect(dup.title).toBe(original.title)
    const second = await write(e, id, '2026-06-06')
    expect(second.status, second.error ?? '').toBe('done')
    const log = s.audit.list({ agent: 'Show Writer' })
    expect(log.some((x) => x.action === 'too_similar')).toBe(true)
    const calls = s.mockLlm.calls.filter((c) => readCtx(c.user).task === 'write')
    expect(calls[calls.length - 1].user).toMatch(/Too similar to episode/)
    const p2 = s.episodes.getPackage((second.result as { episodeId: string }).episodeId)!
    expect(p2.title).not.toBe(original.title)
  })

  it('uses the keyword check plus a text agent comparison when the local model is unreachable', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 10) })
    const s = e.studio
    s.cfg.set({ local: { ...s.cfg.get().local, ollamaHost: 'http://127.0.0.1:9' } })
    const id = brandIdOf(e, 'Trash Panda%')
    await write(e, id, '2026-06-03')
    s.mockLlm.respond('Repetition Guard', () => ({ similar: true, to: 'x-1', reason: 'same idea in other words' }))
    const r = await s.repetition.check(id, { title: 'Another title entirely', idea: 'zebra quantum pasta', summary: 'unrelated words only', keyLines: [] })
    expect(r.ok).toBe(false)
    expect(r.via).toBe('keyword+agent')
    expect(s.audit.list({ agent: 'Local AI' }).some((a) => a.action === 'fallback_keyword_repetition_check')).toBe(true)
  })
})

describe('Math Checker catches errors by running code', () => {
  it('evaluates arithmetic safely and extracts claims from text', () => {
    expect(evaluate('7 x 8')).toBe(56)
    expect(evaluate('2 + 3 * (4 - 1) ^ 2')).toBe(29)
    expect(evaluate('-3 + 5')).toBe(2)
    expect(evaluate('max(3, 9, 4) / 3')).toBe(3)
    expect(evaluate('1,200 / 4')).toBe(300)
    expect(() => evaluate('process.exit(1)')).toThrow()
    expect(() => evaluate('2 +')).toThrow()
    const claims = checkClaims(extractClaims('So 12 x 12 = 144 but 9 + 8 = 18, and 20% of 50 is 10.'))
    expect(claims.map((c) => c.ok)).toEqual([true, false, true])
    expect(claims[1].actual).toBe(17)
  })

  it('flags a planted wrong total in a script, even when the model lies about its own arithmetic', async () => {
    const e = makeStudioEnv()
    const s = e.studio
    s.mockLlm.respond('Math Checker', () => ({ claims: [{ text: 'twelve squared is 140', expression: '12*12', claimed: 140 }], outdated: [] }))
    const draft = { ...(await canned({ agent: 'Show Writer', model: 'm', maxTokens: 1, system: '', user: `CTX ${JSON.stringify({ task: 'write', brand: 'X', format: 'short', slotDate: '2026-06-03', attempt: 0, minSeconds: 15, maxSeconds: 60 })}` })) }
    draft.script = 'Here is a trick. 7 x 8 = 54. Done.'
    const r = await s.math.run(draft, { counted: false, steps: false }, { brandId: 1, brandName: 'X' })
    expect(r.pass).toBe(false)
    expect(r.fixes.join(' ')).toMatch(/7 x 8 = 54" is wrong. 7 x 8 is 56/)
    expect(r.fixes.join(' ')).toMatch(/12\*12 is 144, not 140/)
  })

  it('flags a mismatched counted object quantity in a Hollow package', async () => {
    const e = makeStudioEnv()
    const draft = await canned({ agent: 'Show Writer', model: 'm', maxTokens: 1, system: '', user: `CTX ${JSON.stringify({ task: 'write', brand: 'H', format: 'long', slotDate: '2026-06-05', attempt: 0, minSeconds: 150, maxSeconds: 210 })}` })
    expect(checkCountedObjects(draft.counted_objects, draft.scenes)).toEqual([])
    // The counting reaches 9 but the total says 10.
    const wrongTotal = { ...draft, counted_objects: [{ ...draft.counted_objects[0], quantity: 10 }] }
    const issues = checkCountedObjects(wrongTotal.counted_objects, wrongTotal.scenes)
    expect(issues.map((i) => i.kind)).toEqual(expect.arrayContaining(['dialogue_total', 'wrong_quantity']))
    // A scene prompt that shows a different number than the total.
    const obj = draft.counted_objects[0]
    const sc = JSON.parse(JSON.stringify(draft.scenes))
    sc[3].grok_prompt = sc[3].grok_prompt.replace(/exactly \w+/, 'exactly two')
    sc[3].action = sc[3].action.replace(/exactly \w+/, 'exactly two')
    expect(checkCountedObjects([obj], sc).map((i) => i.kind)).toEqual(expect.arrayContaining(['wrong_quantity', 'quantity_not_stated']))
    // An object that is not in the prompt at all.
    sc[4].grok_prompt = 'A friendly scene.'
    sc[4].action = 'Nothing special.'
    sc[4].objects_in_frame = []
    expect(checkCountedObjects([obj], sc).some((i) => i.kind === 'not_in_prompt')).toBe(true)
    // Through the full checker with a Writer revising the mistake.
    const s = e.studio
    const r = await s.math.run(wrongTotal, { counted: true, steps: false }, { brandId: hollowId(e), brandName: 'H' })
    expect(r.pass).toBe(false)
    expect(r.fixes.length).toBeGreaterThan(0)
  })

  it('checks that steps run in order for Teach Your Parents Tech', async () => {
    const e = makeStudioEnv()
    const draft = { ...(await canned({ agent: 'Show Writer', model: 'm', maxTokens: 1, system: '', user: `CTX ${JSON.stringify({ task: 'write', brand: 'T', format: 'short', slotDate: '2026-06-03', attempt: 0, minSeconds: 15, maxSeconds: 60 })}` })) }
    draft.script = 'Step 1: open settings. Step 3: tap it. Step 2: done.'
    const r = await e.studio.math.run(draft, { counted: false, steps: true }, { brandId: 1, brandName: 'T' })
    expect(r.pass).toBe(false)
    expect(r.stepIssues.length).toBeGreaterThan(0)
  })
})

describe('Hollow Safety Checker', () => {
  async function scary(e: ReturnType<typeof makeStudioEnv>) {
    const draft = await canned({ agent: 'Show Writer', model: 'm', maxTokens: 1, system: '', user: `CTX ${JSON.stringify({ task: 'write', brand: 'H', format: 'long', slotDate: '2026-06-05', attempt: 0, minSeconds: 150, maxSeconds: 210 })}` })
    draft.scenes[8].grok_prompt = 'A dark scary monster jumps out of the shadows with a knife and everyone screams.'
    void e
    return draft
  }

  it('rejects a planted frightening scene', async () => {
    const e = makeStudioEnv()
    const draft = await scary(e)
    const r = await e.studio.safety.run(draft, 'bible', { brandId: hollowId(e), brandName: 'H' })
    expect(r.pass).toBe(false)
    expect(r.hits.map((h) => h.word)).toEqual(expect.arrayContaining(['monster', 'knife', 'scary']))
    expect(r.hits[0].where).toBe('scene 9 prompt')
  })

  it('after the retry cap a script that keeps failing is Flagged, with the episode Flagged and the owner told', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 10) })
    const s = e.studio
    const draft = await scary(e)
    s.mockLlm.respond('Show Writer', (req) => (readCtx(req.user).task === 'write' ? draft : { ideas: ['a', 'b', 'c', 'd', 'e', 'f'] }))
    const t = await write(e, hollowId(e), '2026-06-05')
    expect(t.status).toBe('flagged')
    expect(t.error).toMatch(/Safety check/)
    const ep = s.episodes.list({ brandId: hollowId(e) })[0]
    expect(ep.status).toBe('Flagged')
    expect(e.alerts.some(([h]) => h === 'Something needs a look.')).toBe(true)
    // the Director does not keep asking again for the parked date
    s.director.tick()
    expect(s.tasks.list({ type: 'write_episode', status: 'queued', brandId: hollowId(e) }).filter((x) => (x.payload as { slotDate: string }).slotDate === '2026-06-05')).toHaveLength(0)
  })
})

describe('Hollow handoff and runway', () => {
  it('a passing Hollow package is READY: in the Muse folder, in the Library view, and the calendar shows the window', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 10) })
    const s = e.studio
    const hid = hollowId(e)
    const t = await write(e, hid, '2026-06-05')
    const id = (t.result as { episodeId: string }).episodeId
    expect(existsSync(join(s.episodes.readyDir(), `${id}.json`))).toBe(true)
    const detail = await s.episode(id)
    expect(detail.pkg!.scenes[0].grok_prompt.length).toBeGreaterThan(20)
    expect(detail.row.status).toBe('Ready for production')
    const items = s.calendarFeed.items({ fromUtc: '2026-06-01T04:00:00Z', toUtc: '2026-06-08T04:00:00Z', brandId: hid })
    expect(items.some((i) => i.kind === 'production_window' && i.date === '2026-06-03')).toBe(true)
    expect(items.some((i) => i.episodeId === id && i.date === '2026-06-05')).toBe(true)
  })

  it('with a 7 day runway and an empty queue the Director fills it without any alert', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 9) }) // Monday 05:00 Eastern
    const s = e.studio
    await s.tick()
    const eps = s.episodes.list({ limit: 500 })
    // four short brands at every 3 days (days 0, 3, 6) plus Hollow Tuesday and Friday
    expect(eps.filter((x) => x.status === 'Ready for production').length).toBe(14)
    const brands = await s.brands()
    for (const b of brands) expect(b.runwayCovered).toBeGreaterThanOrEqual(2)
    expect(e.alerts).toEqual([])
    // a second pass finds nothing left to do
    expect((await s.tick()).created).toBe(0)
  })
})
