import { describe, expect, it, vi } from 'vitest'
import { Studio } from '../../src/main/studio/studio'
import { makeEnv } from '../helpers'
import { SecretStore } from '../../src/main/services/secrets'
import { fakeCrypto } from '../googleHelpers'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

function rig() {
  const env = makeEnv()
  const dir = mkdtempSync(join(tmpdir(), 'elo-pause-'))
  const schedulerPaused = vi.fn()
  const schedulerBrandPaused = vi.fn()
  const studio = new Studio({
    db: env.db,
    secrets: new SecretStore(join(dir, 's.bin'), fakeCrypto),
    posts: env.posts,
    media: env.library,
    log: env.log,
    alert: () => {},
    emit: () => {},
    now: () => env.clock.ms,
    setSchedulerPaused: schedulerPaused,
    setSchedulerBrandPaused: schedulerBrandPaused,
  })
  return { env, studio, schedulerPaused, schedulerBrandPaused }
}

describe('one pause for the Studio and the scheduler', () => {
  it('pausing a brand in the Studio also pauses it for the scheduler, and resuming does too', async () => {
    const r = rig()
    await r.studio.setBrand(1, { paused: true })
    expect(r.schedulerBrandPaused).toHaveBeenLastCalledWith(1, true)
    expect(r.studio.cfg.getBrand(1).paused).toBe(true)
    await r.studio.setBrand(1, { paused: false })
    expect(r.schedulerBrandPaused).toHaveBeenLastCalledWith(1, false)
    // changing something else does not touch the scheduler
    r.schedulerBrandPaused.mockClear()
    await r.studio.setBrand(1, { runwayDays: 5 })
    expect(r.schedulerBrandPaused).not.toHaveBeenCalled()
  })

  it('pause everything pauses the Studio and the scheduler together', async () => {
    const r = rig()
    await r.studio.pauseAll(true)
    expect(r.studio.cfg.get().paused).toBe(true)
    expect(r.schedulerPaused).toHaveBeenLastCalledWith(true)
    await r.studio.pauseAll(false)
    expect(r.studio.cfg.get().paused).toBe(false)
    expect(r.schedulerPaused).toHaveBeenLastCalledWith(false)
  })
})
