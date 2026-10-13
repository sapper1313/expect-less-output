import { existsSync, readFileSync } from 'fs'
import { afterEach, describe, expect, it } from 'vitest'
import { makeAgentEnv } from './agentHelpers'
import { minimalPackage } from './studio/helpers'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})
const env = async (patch: Record<string, unknown> = {}) => {
  const a = await makeAgentEnv(patch, { studio: true })
  closers.push(a.close)
  return a
}
const unlocked = { agentMayChangeStudio: true }

describe('Studio over the agent API: reading is always allowed', () => {
  it('shows spend with every cap, and flagged tasks', async () => {
    const a = await env()
    const spend = await a.api('GET', '/v1/studio/spend')
    expect(spend.status).toBe(200)
    expect(spend.json.caps.length).toBeGreaterThan(0)
    expect(spend.json.caps[0]).toHaveProperty('limit')
    const flagged = await a.api('GET', '/v1/studio/flagged')
    expect(flagged.status).toBe(200)
    expect(flagged.json.tasks).toEqual([])
  })
})

describe('Studio changes are locked unless the owner allows them', () => {
  it('refuses every change with studio_locked and changes nothing', async () => {
    const a = await env()
    const before = a.env.studio.cfg.get().globalCap
    const calls: Array<[string, string, unknown?]> = [
      ['PATCH', '/v1/studio/caps', { global_monthly: 999 }],
      ['POST', '/v1/brands/1/skills', { name: 'x.md', text: 'hello' }],
      ['POST', '/v1/brands/1/skills/1/remove'],
      ['POST', '/v1/studio/flagged/1/retry'],
      ['POST', '/v1/studio/episodes/abc/rebuild', {}],
      ['POST', '/v1/studio/brands/1/pause', { paused: true }],
    ]
    for (const [method, path, body] of calls) {
      const r = await a.api(method, path, body)
      expect(r.status, `${method} ${path}`).toBe(403)
      expect(r.json.error.code).toBe('studio_locked')
    }
    expect(a.env.studio.cfg.get().globalCap).toEqual(before)
  })
})

describe('spend caps', () => {
  it('sets, reads back and clears caps, and refuses bad amounts', async () => {
    const a = await env(unlocked)
    const r = await a.api('PATCH', '/v1/studio/caps', {
      global_monthly: 400,
      per_episode_default: 40,
      brands: [{ brand_id: 1, monthly: 120 }],
    })
    expect(r.status).toBe(200)
    const cap = (key: string) => r.json.caps.find((c: { key: string }) => c.key === key)
    expect(a.env.studio.cfg.get().globalCap).toEqual({ value: 400, none: false })
    expect(a.env.studio.cfg.get().perEpisodeCapDefault).toEqual({ value: 40, none: false })
    expect(a.env.studio.cfg.getBrand(1).monthlyCap).toEqual({ value: 120, none: false })
    expect(r.json.caps.some((c: { limit: number | null }) => c.limit === 400)).toBe(true)
    expect(cap).toBeTypeOf('function')

    const off = await a.api('PATCH', '/v1/studio/caps', { global_monthly: null })
    expect(off.status).toBe(200)
    expect(a.env.studio.cfg.get().globalCap.none).toBe(true)

    expect((await a.api('PATCH', '/v1/studio/caps', { global_monthly: 10000 })).status).toBe(400)
    expect((await a.api('PATCH', '/v1/studio/caps', { global_monthly: -1 })).status).toBe(400)
    expect((await a.api('PATCH', '/v1/studio/caps', {})).status).toBe(400)
    expect(
      (await a.api('PATCH', '/v1/studio/caps', { brands: [{ brand_id: 999, monthly: 5 }] })).status,
    ).toBe(404)
  })
})

describe('Bible skills', () => {
  it('adds a skill, lists it, and removes it after saving a backup file', async () => {
    const a = await env(unlocked)
    const text = '# Test skill\nHello Hollow.\n'
    const add = await a.api('POST', '/v1/brands/1/skills', { name: 'test-skill.md', text })
    expect(add.status).toBe(201)
    const mine = add.json.skills.find((k: { name: string }) => k.name === 'test-skill.md')
    expect(mine.characters).toBe(text.length)
    expect(
      (await a.api('GET', '/v1/brands/1/skills')).json.skills.some(
        (k: { id: number }) => k.id === mine.id,
      ),
    ).toBe(true)

    const rm = await a.api('POST', `/v1/brands/1/skills/${mine.id}/remove`)
    expect(rm.status).toBe(200)
    expect(rm.json.removed.name).toBe('test-skill.md')
    expect(existsSync(rm.json.backup_file)).toBe(true)
    expect(readFileSync(rm.json.backup_file, 'utf8')).toBe(text)
    expect(rm.json.skills.some((k: { id: number }) => k.id === mine.id)).toBe(false)

    expect((await a.api('POST', `/v1/brands/1/skills/${mine.id}/remove`)).status).toBe(400)
    expect((await a.api('POST', '/v1/brands/999/skills', { name: 'x', text: 'y' })).status).toBe(
      404,
    )
    expect((await a.api('POST', '/v1/brands/1/skills', { name: 'x', text: '' })).status).toBe(400)
  })
})

describe('flagged tasks, rebuilds and pauses', () => {
  it('retries a flagged task and refuses a task that is not flagged', async () => {
    const a = await env(unlocked)
    const t = a.env.studio.tasks.create({ type: 'write_episode', brandId: 1, payload: {} })
    a.env.studio.tasks.setStatus(t.id, 'flagged', { error: 'The answer was cut off.' })
    const list = await a.api('GET', '/v1/studio/flagged')
    expect(list.json.tasks[0]).toMatchObject({
      task_id: t.id,
      status: 'flagged',
      error: 'The answer was cut off.',
    })
    const r = await a.api('POST', `/v1/studio/flagged/${t.id}/retry`)
    expect(r.status).toBe(200)
    expect(a.env.studio.tasks.get(t.id)?.status).toBe('queued')
    expect((await a.api('POST', `/v1/studio/flagged/${t.id}/retry`)).status).toBe(404)
  })

  it('rebuilds an episode without a video and refuses one with a video', async () => {
    const a = await env(unlocked)
    const ep = a.env.studio.episodes.create(1, minimalPackage('Rebuild me'), { status: 'Idea' })
    const r = await a.api('POST', `/v1/studio/episodes/${ep.id}/rebuild`, { note: 'shorter hook' })
    expect(r.status).toBe(200)
    expect(a.env.studio.tasks.get(r.json.task_id)?.payload.note).toBe('shorter hook')
    a.env.db.prepare('UPDATE episodes SET video_path = ? WHERE id = ?').run('x.mp4', ep.id)
    const refused = await a.api('POST', `/v1/studio/episodes/${ep.id}/rebuild`, {})
    expect(refused.status).toBe(400)
    expect(refused.json.error.message).toMatch(/already has a video/)
  })

  it('pauses and resumes a brand and writes it to the Activity Log', async () => {
    const a = await env(unlocked)
    expect((await a.api('POST', '/v1/studio/brands/1/pause', { paused: true })).json).toEqual({
      brand_id: 1,
      paused: true,
    })
    expect(a.env.studio.cfg.getBrand(1).paused).toBe(true)
    await a.api('POST', '/v1/studio/brands/1/pause', { paused: false })
    expect(a.env.studio.cfg.getBrand(1).paused).toBe(false)
    expect((await a.api('POST', '/v1/studio/brands/999/pause', { paused: true })).status).toBe(404)
    expect(a.env.log.list({ limit: 20 }).some((e) => /paused Studio work/.test(e.message))).toBe(
      true,
    )
  })
})
