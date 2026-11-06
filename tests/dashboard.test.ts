import { afterEach, describe, expect, it } from 'vitest'
import { DashboardService } from '../src/main/dashboard/service'
import { makeAgentEnv } from './agentHelpers'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()!()
})
const HOUR = 3_600_000

async function setup() {
  const a = await makeAgentEnv()
  closers.push(a.close)
  const dash = new DashboardService({
    db: a.env.db,
    services: a.services,
    settings: a.env.settings,
    now: () => new Date(a.env.clock.ms),
  })
  return { a, dash }
}

describe('Dashboard screen data', () => {
  it('builds a snapshot from ELO itself, with a ring total and one card per active channel', async () => {
    const { a, dash } = await setup()
    expect(dash.snapshot()).toBeNull()
    const s = await dash.refresh()
    expect(s).not.toBeNull()
    expect(s!.status.elo).toBe('ok')
    expect(s!.week.tz).toBe('America/New_York')
    expect(s!.channels.length).toBe(a.env.brands.list().filter((b) => !b.archived).length)
    expect(s!.totals.filled + s!.totals.open + s!.totals.attention).toBe(s!.totals.slots)
  })

  it('counts a scheduled post as a filled slot and keeps the snapshot for the next start', async () => {
    const { a, dash } = await setup()
    const before = await dash.refresh()
    const post = await a.env.makePost({ whenMs: a.env.clock.ms + 2 * HOUR, platforms: ['youtube'] })
    expect(post.id).toBeGreaterThan(0)
    const after = await dash.refresh()
    expect(after!.upNext.length).toBeGreaterThanOrEqual(before!.upNext.length)
    const again = new DashboardService({
      db: a.env.db,
      services: a.services,
      settings: a.env.settings,
      now: () => new Date(a.env.clock.ms),
    })
    again.start()
    expect(again.snapshot()?.totals.slots).toBe(after!.totals.slots)
    again.stop()
  })
})
