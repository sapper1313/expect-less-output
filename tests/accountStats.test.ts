import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { makeEnv } from './helpers'
import { SecretStore } from '../src/main/services/secrets'
import { UploadPostService } from '../src/main/services/uploadPost'
import { AccountStatsService, flatNumbers, watchMinutesOf } from '../src/main/services/accountStats'

const HOUR = 3_600_000
const crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
}

function setup(answer: Record<string, any> | (() => Record<string, any>)) {
  const env = makeEnv(Date.UTC(2026, 10, 8, 18, 0, 0))
  const secrets = new SecretStore(join(mkdtempSync(join(tmpdir(), 'as-')), 's.bin'), crypto)
  const up = new UploadPostService(env.db, secrets, {} as any)
  up.setKey('k')
  up.setLink(2, 'Clock_Out_Early', { youtube: true, instagram: true, tiktok: true, linkedin: true })
  const calls = { analytics: [] as any[], audience: 0 }
  const svc = new AccountStatsService({
    db: env.db,
    uploadPost: up,
    client: {
      async analytics(_k: string, user: string, platforms: string[]) {
        calls.analytics.push({ user, platforms })
        return typeof answer === 'function' ? answer() : answer
      },
      async audience() {
        calls.audience++
        return { range: { start_date: '2026-10-09', end_date: '2026-11-07' }, audience: { countries: [{ country: 'US', percentage: 0.8 }] }, activity_by_hour: [{ hour: '20', followers_online: 50 }] }
      },
    } as any,
    log: env.log,
    now: () => env.clock.ms,
  })
  return { env, svc, calls }
}

describe('number helpers', () => {
  it('keeps plain numbers and finds watch time in minutes', () => {
    expect(flatNumbers({ followers: 10, views: 5, reach_timeseries: [{ date: 'x', value: 1 }], name: 'a' })).toEqual({ followers: 10, views: 5 })
    expect(watchMinutesOf({ followers: 3, watch_time_minutes: 120 })).toBe(120)
    expect(watchMinutesOf({ estimatedHoursWatched: 2 })).toBe(120)
    expect(watchMinutesOf({ averageViewDuration: 30, views: 4 })).toBeNull()
  })
})

describe('Account numbers through Upload-Post', () => {
  const answer = () => ({
    instagram: { followers: 100, views: 400, impressions: 400, reach: 300, likes: 20, comments: 2, shares: 1, saves: 3, reach_timeseries: [{ date: '2026-11-07', value: 5 }] },
    tiktok: { followers: 50, views: 1000, likes: 80, comments: 4, shares: 6, video_count: 12 },
    youtube: { followers: 10, views: 90, likes: 5, comments: 1, shares: 0, watch_time_minutes: 180 },
  })

  it('reads every ticked platform in one call per channel, skips LinkedIn, and adds them up for Home', async () => {
    const t = setup(answer)
    const r = await t.svc.sync()
    expect(r).toMatchObject({ channels: 1, platforms: 3 })
    expect(t.calls.analytics).toHaveLength(1)
    expect(t.calls.analytics[0]).toMatchObject({ user: 'Clock_Out_Early' })
    expect(t.calls.analytics[0].platforms.sort()).toEqual(['instagram', 'tiktok', 'youtube'])
    expect(t.calls.audience).toBe(1)
    const rows = t.svc.rows()
    expect(rows.map((x) => x.platform)).toEqual(['instagram', 'tiktok', 'youtube'])
    expect(rows[0]!.series).toHaveLength(1)
    expect(rows[2]!.watchMinutes).toBe(180)
    const home = t.svc.homeTotals()!
    expect(home.channels).toHaveLength(1)
    expect(home.channels[0]).toMatchObject({ followers: 160, views: 1490, likes: 105, shares: 7, comments: 7, impressions: 1490, watchHours: 3 })
    expect(home.total.followers).toBe(160)
    expect(t.svc.audience()[0]!.data.audience!.countries![0]!.country).toBe('US')
  })

  it('reads a channel at most once an hour unless forced, and shows the change since a week ago', async () => {
    const t = setup(answer)
    await t.svc.sync()
    await t.svc.sync()
    expect(t.calls.analytics).toHaveLength(1)
    await t.svc.sync({ force: true })
    expect(t.calls.analytics).toHaveLength(2)
    // A reading from 8 days ago becomes the "before".
    t.env.db.prepare("UPDATE up_account_stats SET day = '2026-10-31', metrics_json = ? WHERE platform = 'tiktok'").run(JSON.stringify({ numbers: { followers: 40 }, series: [] }))
    t.env.clock.ms += 2 * HOUR
    await t.svc.sync()
    const tt = t.svc.rows().find((r) => r.platform === 'tiktok')!
    expect(tt.numbers.followers).toBe(50)
    expect(tt.before?.followers).toBe(40)
  })

  it('records what went wrong for a platform instead of dropping it', async () => {
    const t = setup(() => ({ instagram: { error: 'Reconnect Instagram' }, tiktok: { followers: 5 } }))
    const r = await t.svc.sync()
    expect(r.problems.some((x) => /Reconnect Instagram/.test(x))).toBe(true)
    const ig = t.svc.rows().find((x) => x.platform === 'instagram')!
    expect(ig.error).toMatch(/Reconnect/)
    expect(t.svc.homeTotals()!.channels[0]!.followers).toBe(5)
  })
})
