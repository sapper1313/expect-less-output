import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { RetryableError } from '../../src/main/studio/agents/framework'
import { makeStudioEnv } from './helpers'

const Any = z.object({ slotDate: z.string().optional() }).passthrough()

describe('Director and agent framework', () => {
  it('fills the runway with write tasks, once per date, with no iMessage alert', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 14) })
    const s = e.studio
    const first = s.director.tick()
    // 4 short brands every 3 days over a 7 day runway (days 0..7 -> dates 0,3,6) = 3 each, plus Hollow Tue/Fri
    const shorts = first.created.filter((t) => t.brandId !== null && s.cfg.getBrand(t.brandId).format === 'short')
    expect(shorts).toHaveLength(12)
    expect(first.created.every((t) => t.type === 'write_episode')).toBe(true)
    const again = s.director.tick()
    expect(again.created).toHaveLength(0) // deduped
    expect(e.alerts.filter(([h]) => /runway|Runway/.test(h))).toEqual([])
    const log = s.audit.list({ agent: 'Director' })
    expect(log.some((x) => x.action === 'ask_writer')).toBe(true)
  })

  it('retries a failing task with backoff and flags it after the retry cap', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 14) })
    const s = e.studio
    let runs = 0
    s.runner.register({
      name: 'Show Writer',
      taskType: 'write_episode',
      role: 'test',
      input: Any,
      output: z.any(),
      tools: [],
      async run() {
        runs++
        throw new RetryableError('model is having a bad day')
      },
    })
    const flagged: string[] = []
    const brand = s.cfg.listBrandConfigs()[0]
    s.tasks.create({ type: 'write_episode', brandId: brand.brandId, payload: { slotDate: '2026-06-01' } })
    await s.runner.runDue()
    let t = s.tasks.list({ type: 'write_episode' })[0]
    expect(t.status).toBe('queued')
    expect(t.attempts).toBe(1)
    expect(t.error).toMatch(/bad day/)
    expect(await s.runner.runDue()).toBe(0) // backoff: not yet
    e.clock.ms += 2 * 60_000
    await s.runner.runDue()
    e.clock.ms += 10 * 60_000
    await s.runner.runDue()
    t = s.tasks.list({ type: 'write_episode' })[0]
    expect(runs).toBe(3)
    expect(t.status).toBe('flagged')
    expect(e.alerts.some(([h]) => h === 'Something needs a look.')).toBe(true)
    void flagged
    const acts = s.audit.list({ agent: 'Show Writer' }).map((x) => x.action)
    expect(acts).toContain('retry')
    expect(acts).toContain('flagged')
    // the owner can retry a flagged task
    await s.resolveFlag(t.id, 'retry')
    expect(s.tasks.get(t.id)!.status).toBe('queued')
  })

  it('Pause everything stops new work, and pausing one brand skips only that brand', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 14) })
    const s = e.studio
    let ran = 0
    s.runner.register({ name: 'Show Writer', taskType: 'write_episode', role: 't', input: Any, output: z.any(), tools: [], async run() { ran++; return {} } })
    const [a, b] = s.cfg.listBrandConfigs()
    s.tasks.create({ type: 'write_episode', brandId: a.brandId, payload: { slotDate: '2026-06-01' } })
    s.tasks.create({ type: 'write_episode', brandId: b.brandId, payload: { slotDate: '2026-06-01' } })
    await s.pauseAll(true)
    expect(await s.runner.runDue()).toBe(0)
    expect(s.director.tick().created).toHaveLength(0)
    await s.pauseAll(false)
    await s.setBrand(a.brandId, { paused: true })
    await s.runner.runDue()
    expect(ran).toBe(1)
    expect(s.tasks.list({ brandId: a.brandId })[0].status).toBe('queued')
    expect(s.audit.list({ agent: 'Director' }).some((x) => x.action === 'pause_all')).toBe(true)
  })

  it('a cap stop marks the task Stopped, not flagged', async () => {
    const e = makeStudioEnv()
    const s = e.studio
    await s.setConfig({ mockMode: false, globalCap: { value: 0.01, none: false } })
    s.runner.register({
      name: 'Producer',
      taskType: 'produce',
      role: 't',
      input: Any,
      output: z.any(),
      tools: [],
      paid: true,
      async run() {
        s.spend.check({ vendor: 'xai', dollars: 1 })
        return {}
      },
    })
    s.tasks.create({ type: 'produce', payload: {} })
    await s.runner.runDue()
    expect(s.tasks.list({ type: 'produce' })[0].status).toBe('stopped')
  })

  it('a waiting task is asked again later; a task left running by a crash is requeued', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 14) })
    const s = e.studio
    const { Waiting } = await import('../../src/main/studio/agents/framework')
    let polls = 0
    s.runner.register({
      name: 'Producer',
      taskType: 'poll',
      role: 't',
      input: Any,
      output: z.any(),
      tools: [],
      async run(ctx) {
        polls++
        if (polls < 3) throw new Waiting(ctx.now() + 30_000)
        return { done: true }
      },
    })
    const t = s.tasks.create({ type: 'poll', payload: {} })
    await s.runner.runDue()
    expect(s.tasks.get(t.id)!.status).toBe('waiting')
    expect(await s.runner.runDue()).toBe(0)
    e.clock.ms += 31_000
    await s.runner.runDue()
    e.clock.ms += 31_000
    await s.runner.runDue()
    expect(s.tasks.get(t.id)!.status).toBe('done')
    expect(polls).toBe(3)

    const t2 = s.tasks.create({ type: 'poll', payload: {} })
    s.tasks.claim(t2.id) // simulates a crash mid job
    expect(s.tasks.get(t2.id)!.status).toBe('running')
    expect(s.tasks.recoverRunning()).toBe(1)
    expect(s.tasks.get(t2.id)!.status).toBe('queued')
  })

  it('the text gateway sends bad JSON and em dash answers back for a rewrite', async () => {
    const e = makeStudioEnv()
    const s = e.studio
    const DASH = String.fromCharCode(0x2014)
    let n = 0
    s.mockLlm.respond('Show Writer', () => {
      n++
      if (n === 1) return 'not json at all'
      if (n === 2) return { line: `bad ${DASH} dash` }
      return { line: 'clean line' }
    })
    const out = await s.gateway.json({ agent: 'Show Writer', system: 's', user: 'u' }, z.object({ line: z.string() }))
    expect(out.line).toBe('clean line')
    expect(n).toBe(3)
    expect(s.mockLlm.calls[2].user).toMatch(/Never use an em dash/)
    const runs = e.db.prepare('SELECT COUNT(*) AS n FROM agent_runs').get() as { n: number }
    expect(runs.n).toBe(3)
  })

  it('missed slot: alerts once when a package brand has nothing ready for today', async () => {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 2, 10) }) // Tuesday 06:00 Eastern
    const s = e.studio
    s.director.tick()
    s.director.tick()
    const missed = e.alerts.filter(([h]) => h === 'A posting slot will be missed.')
    // Hollow is a package brand, so it alerts a day ahead. Shorts post at 08:00, so 06:00 is too early to worry.
    expect(missed).toHaveLength(1)
    expect(missed[0][1]).toMatch(/Wonder Hollow/)
    expect(e.alerts.filter(([h]) => h === 'An episode package is not ready.').length).toBeGreaterThan(0)
    e.clock.ms = Date.UTC(2026, 5, 2, 11, 45) // 07:45 Eastern, within 30 minutes of the 08:00 slot
    s.director.tick()
    expect(e.alerts.filter(([h]) => h === 'A posting slot will be missed.')).toHaveLength(5)
  })
})
