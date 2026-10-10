import { describe, expect, it, vi } from 'vitest'
import { describeFlag } from '../../src/shared/studio/flagText'
import type { AgentTask } from '../../src/shared/studio/types'
import { makeStudioEnv } from './helpers'

vi.setConfig({ testTimeout: 60_000 })

const task = (over: Partial<AgentTask>): AgentTask => ({
  id: 1, type: 'write_episode', brandId: 1, episodeId: null, parentId: null, status: 'flagged', attempts: 3,
  payload: { slotDate: '2026-10-15' }, result: null, error: null, notBeforeUtc: null, createdUtc: '', startedUtc: null, finishedUtc: null, ...over,
})

describe('flag text', () => {
  it('names the channel, the job and a plain reason', () => {
    const f = describeFlag(task({ error: 'The answer was cut off because it was too long. It will be tried again.' }), null, 'Trash Panda')
    expect(f.channel).toBe('Trash Panda')
    expect(f.doing).toBe('Writing a new episode')
    expect(f.episode).toContain('2026-10-15')
    expect(f.why).toMatch(/ran out of room/)
    expect(f.next).toMatch(/Retry/)
  })
  it('explains a failed script check and a timeout', () => {
    const qc = describeFlag(task({ error: 'The Writer could not get this script through its checks after 3 tries. Last problem: Script QC: Scene 4 is too short.' }), null, null)
    expect(qc.why).toMatch(/checked 3 times/)
    expect(describeFlag(task({ error: 'The operation was aborted due to timeout' }), null, null).why).toMatch(/too long to answer/)
  })
})

describe('Director chat', () => {
  it('answers in mock mode and applies a pause and an idea on request', async () => {
    const e = makeStudioEnv()
    const chat = await e.studio.directorChat('what is going on?')
    expect(chat.reply.length).toBeGreaterThan(0)
    await expect(e.studio.directorChat('   ')).rejects.toThrow()
    expect(await e.studio.directorApply({ kind: 'pause_all', brandId: null, text: '', label: 'Pause' })).toMatch(/paused/)
    expect((await e.studio.overview()).paused).toBe(true)
    const id = (await e.studio.brands())[0].brandId
    await e.studio.directorApply({ kind: 'add_idea', brandId: id, text: 'Spam texts from fake delivery', label: 'Add' })
    expect((await e.studio.ideas(id)).some((i) => i.text.includes('fake delivery'))).toBe(true)
    await expect(e.studio.directorApply({ kind: 'pause_brand', brandId: 99999, text: '', label: 'x' })).rejects.toThrow()
  })
})
