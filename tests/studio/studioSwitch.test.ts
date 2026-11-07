import { describe, expect, it } from 'vitest'
import { makeStudioEnv } from './helpers'

describe('the AI Studio on/off switch', () => {
  it('sends no alert of any kind while it is off, and alerts again when it is on', async () => {
    const e = makeStudioEnv()
    e.studio.d.alert('Something needs a look.', 'Test flag')
    expect(e.alerts).toHaveLength(1)
    await e.studio.setEnabled(false)
    e.studio.d.alert('A posting slot will be missed.', 'Director alert')
    e.studio.d.alert('Something needs a look.', 'Another flag')
    expect(e.alerts).toHaveLength(1)
    expect(e.studio.openFlagCount()).toBe(0)
    await e.studio.setEnabled(true)
    e.studio.d.alert('Something needs a look.', 'Back on')
    expect(e.alerts).toHaveLength(2)
  })
})
