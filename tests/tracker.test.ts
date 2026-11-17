import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { buildTracker, stageOf, type TrackerInput } from '../src/shared/tracker'

// Tue Nov 17 2026, 10:00 AM Eastern.
const NOW = DateTime.fromISO('2026-11-17T10:00:00', { zone: 'America/New_York' }).toMillis()
const et = (iso: string) => DateTime.fromISO(iso, { zone: 'America/New_York' }).toUTC().toISO() as string

function input(over: Partial<TrackerInput> = {}): TrackerInput {
  return {
    nowMs: NOW,
    flagDays: 3,
    channels: [
      {
        brandId: 1,
        slug: 'math-of-it',
        name: 'The Math of It',
        color: '#fff',
        state: 'active',
        shown: ['youtube', 'facebook', 'instagram', 'tiktok'],
        expected: ['youtube', 'facebook', 'instagram'],
        waiting: 0,
      },
    ],
    entries: [],
    posts: [],
    openSlots: [],
    ...over,
  }
}
const entry = (id: string, status: string, air?: string) => ({
  channel: 'math-of-it',
  episode_id: id,
  working_title: `Title ${id}`,
  status,
  ...(air ? { air_date: air } : {}),
})
const kinds = (v: ReturnType<typeof buildTracker>) => v.flags.map((f) => f.kind)

describe('stages', () => {
  it('queued and rendering are one building step', () => {
    expect(stageOf('queued')).toBe('building')
    expect(stageOf('rendering')).toBe('building')
    expect(stageOf('muse-passed')).toBe('muse-passed')
  })
  it('counts every stage per channel', () => {
    const v = buildTracker(
      input({
        entries: [
          entry('a', 'idea'),
          entry('b', 'scripted'),
          entry('c', 'rendering'),
          entry('d', 'needs-review'),
          entry('e', 'muse-passed', '2026-11-25'),
        ],
      }),
    )
    expect(v.channels[0]!.counts).toEqual({
      idea: 1,
      scripted: 1,
      building: 1,
      'needs-review': 1,
      'muse-passed': 1,
      dropped: 0,
    })
  })
})

describe('flag: a Muse passed episode not yet dropped', () => {
  it('warns ahead of the air date and is bad on or after it', () => {
    const v = buildTracker(
      input({ entries: [entry('x', 'muse-passed', '2026-11-24'), entry('y', 'muse-passed', '2026-11-17')] }),
    )
    const mp = v.flags.filter((f) => f.kind === 'muse_passed_not_dropped')
    expect(mp.find((f) => f.episodeId === 'x')!.severity).toBe('warn')
    expect(mp.find((f) => f.episodeId === 'y')!.severity).toBe('bad')
  })
})

describe('flag: a Muse passed episode with no post by its air date', () => {
  it('fires on the air day and after, not before, and not once a post exists', () => {
    const none = buildTracker(input({ entries: [entry('x', 'muse-passed', '2026-11-18')] }))
    expect(kinds(none)).not.toContain('muse_passed_no_post')
    const today = buildTracker(input({ entries: [entry('x', 'muse-passed', '2026-11-17')] }))
    expect(kinds(today)).toContain('muse_passed_no_post')
    const dropped = buildTracker(
      input({
        entries: [entry('x', 'dropped', '2026-11-17')],
        posts: [
          {
            id: 1,
            brandId: 1,
            episodeRef: 'x',
            status: 'scheduled',
            scheduledAtUtc: et('2026-11-17T19:00:00'),
            targets: ['youtube', 'facebook', 'instagram'].map((platform) => ({
              platform,
              status: 'pending',
              atUtc: et('2026-11-17T19:00:00'),
            })),
          },
        ],
      }),
    )
    expect(dropped.flags).toEqual([])
  })
  it('a muse passed episode with no air date asks for one instead of guessing', () => {
    const v = buildTracker(input({ entries: [entry('x', 'muse-passed')] }))
    expect(kinds(v)).toContain('no_air_date')
    expect(kinds(v)).not.toContain('muse_passed_no_post')
  })
  it('an unfinished episode past its planned day is flagged late', () => {
    const v = buildTracker(input({ entries: [entry('x', 'rendering', '2026-11-16')] }))
    expect(kinds(v)).toEqual(['late_unfinished'])
  })
})

describe('flag: dropped for some platforms and not the others', () => {
  const post = (platforms: string[], over: Record<string, unknown> = {}) => ({
    id: 7,
    brandId: 1,
    episodeRef: 'x',
    status: 'scheduled',
    scheduledAtUtc: et('2026-11-19T19:00:00'),
    targets: platforms.map((platform) => ({ platform, status: 'pending', atUtc: et('2026-11-19T19:00:00') })),
    ...over,
  })
  it('names the missing platform and shows it as missing in its cell', () => {
    const v = buildTracker(
      input({ entries: [entry('x', 'dropped', '2026-11-19')], posts: [post(['youtube', 'facebook'])] }),
    )
    const f = v.flags.find((x) => x.kind === 'partial_drop')!
    expect(f.platforms).toEqual(['instagram'])
    const cells = v.channels[0]!.episodes[0]!.cells
    expect(cells.find((c) => c.platform === 'instagram')!.state).toBe('missing')
    // TikTok is shown but not expected (a dry run account), so it is skipped, not missing.
    expect(cells.find((c) => c.platform === 'tiktok')!.state).toBe('skipped')
  })
  it('does not flag a complete drop, a canceled post or an old post', () => {
    expect(buildTracker(input({ posts: [post(['youtube', 'facebook', 'instagram'])] })).flags).toEqual([])
    expect(buildTracker(input({ posts: [post(['youtube'], { status: 'canceled' })] })).flags).toEqual([])
    expect(
      buildTracker(
        input({ posts: [post(['youtube'], { status: 'posted', scheduledAtUtc: et('2026-11-01T19:00:00') })] }),
      ).flags,
    ).toEqual([])
  })
  it('a skipped target counts as not dropped for that platform', () => {
    const p = post(['youtube', 'facebook'])
    p.targets.push({ platform: 'instagram', status: 'skipped', atUtc: null as unknown as string })
    expect(kinds(buildTracker(input({ posts: [p] })))).toContain('partial_drop')
  })
})

describe('flag: a scheduled slot with no finished episode', () => {
  const slot = (platform: string, day: string, time: string) => ({
    brandId: 1,
    platform,
    whenUtc: et(`${day}T${time}`),
  })
  it('flags an empty slot inside the window and names what is planned for the day', () => {
    const v = buildTracker(
      input({
        entries: [entry('x', 'rendering', '2026-11-19')],
        openSlots: [slot('youtube', '2026-11-19', '19:00:00'), slot('facebook', '2026-11-19', '17:30:00')],
      }),
    )
    const f = v.flags.find((x) => x.kind === 'slot_no_episode')!
    expect(f.day).toBe('2026-11-19')
    expect(f.platforms?.sort()).toEqual(['facebook', 'youtube'])
    expect(f.detail).toMatch(/Title x .* is at building/)
  })
  it('ignores a slot beyond the window and a platform that is not expected', () => {
    const v = buildTracker(
      input({ openSlots: [slot('youtube', '2026-11-25', '19:00:00'), slot('tiktok', '2026-11-18', '16:00:00')] }),
    )
    expect(v.flags).toEqual([])
  })
  it('a Muse passed episode planned for that day covers it, so only the not dropped flag shows', () => {
    const v = buildTracker(
      input({
        entries: [entry('x', 'muse-passed', '2026-11-18')],
        openSlots: [slot('youtube', '2026-11-18', '19:00:00')],
      }),
    )
    expect(kinds(v)).toEqual(['muse_passed_not_dropped'])
  })
  it('a finished episode with no air date covers the earliest empty day only', () => {
    const v = buildTracker(
      input({
        entries: [entry('x', 'muse-passed')],
        openSlots: [slot('youtube', '2026-11-18', '19:00:00'), slot('youtube', '2026-11-19', '19:00:00')],
      }),
    )
    expect(v.flags.filter((f) => f.kind === 'slot_no_episode').map((f) => f.day)).toEqual(['2026-11-19'])
  })
  it('says how many videos wait in the Inbox, and stays quiet for a paused channel', () => {
    const base = input({ openSlots: [slot('youtube', '2026-11-18', '19:00:00')] })
    base.channels[0]!.waiting = 2
    expect(buildTracker(base).flags[0]!.detail).toMatch(/2 videos are waiting in the Inbox/)
    base.channels[0]!.state = 'paused'
    expect(buildTracker(base).flags).toEqual([])
  })
})

describe('per platform cells', () => {
  it('shows scheduled, posted and failed targets with their times', () => {
    const v = buildTracker(
      input({
        entries: [entry('x', 'dropped', '2026-11-17')],
        posts: [
          {
            id: 1,
            brandId: 1,
            episodeRef: 'x',
            status: 'partial',
            scheduledAtUtc: et('2026-11-17T09:00:00'),
            targets: [
              { platform: 'youtube', status: 'posted', atUtc: et('2026-11-17T09:00:00') },
              { platform: 'facebook', status: 'failed', atUtc: et('2026-11-17T09:00:00') },
              { platform: 'instagram', status: 'pending', atUtc: et('2026-11-17T19:30:00') },
            ],
          },
        ],
      }),
    )
    const c = Object.fromEntries(v.channels[0]!.episodes[0]!.cells.map((x) => [x.platform, x.state]))
    expect(c).toMatchObject({ youtube: 'posted', facebook: 'failed', instagram: 'scheduled' })
  })
  it('an unfinished episode shows not-ready on every platform and Muse passed shows ready', () => {
    const v = buildTracker(input({ entries: [entry('a', 'rendering', '2026-11-20'), entry('b', 'muse-passed', '2026-11-21')] }))
    const [a, b] = v.channels[0]!.episodes
    expect(a!.cells.every((c) => c.state === 'not-ready')).toBe(true)
    expect(b!.cells.every((c) => c.state === 'ready')).toBe(true)
  })
  it('drops an old dropped entry off the board but keeps it in the counts', () => {
    const v = buildTracker(input({ entries: [entry('old', 'dropped', '2026-11-01')] }))
    expect(v.channels[0]!.episodes).toEqual([])
    expect(v.channels[0]!.counts.dropped).toBe(1)
  })
  it('an entry still at needs-review whose episode id already has a post counts as dropped and raises no flag', () => {
    const v = buildTracker(
      input({
        entries: [entry('old', 'needs-review')],
        posts: [
          {
            id: 3,
            brandId: 1,
            episodeRef: 'old',
            status: 'posted',
            scheduledAtUtc: et('2026-11-16T09:00:00'),
            targets: ['youtube', 'facebook', 'instagram'].map((platform) => ({
              platform,
              status: 'posted',
              atUtc: et('2026-11-16T09:00:00'),
            })),
          },
        ],
      }),
    )
    expect(v.channels[0]!.counts['dropped']).toBe(1)
    expect(v.channels[0]!.counts['needs-review']).toBe(0)
    expect(v.flags).toEqual([])
  })
})
