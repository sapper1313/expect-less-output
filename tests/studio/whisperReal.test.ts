import { describe, expect, it } from 'vitest'
import { resolveWhisperCommand } from '../../src/main/studio/localAi'

describe('whisper command lookup', () => {
  it('finds a program outside the GUI PATH and adds a model for whisper.cpp, or says plainly what is missing', () => {
    const r = resolveWhisperCommand('whisper-cli -f {audio}', '/tmp/a.wav')
    if ('error' in r) expect(r.error).toMatch(/brew install whisper-cpp|model file/)
    else {
      expect(r.bin).toMatch(/whisper-cli$/)
      expect(r.args).toContain('-m')
      expect(r.args).toContain('/tmp/a.wav')
    }
    expect(resolveWhisperCommand('definitely-not-a-tool {audio}', '/tmp/a.wav')).toMatchObject({ error: expect.stringContaining('Could not find') })
    expect(resolveWhisperCommand('echo {audio}', '/tmp/a.wav')).toMatchObject({ bin: expect.stringMatching(/echo$/), args: ['/tmp/a.wav'] })
  })
})
