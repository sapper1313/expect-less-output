import { describe, expect, it } from 'vitest'
import { getSlotTimes } from '../src/shared/slots'
import { makeStudioEnv, hollowId } from './studio/helpers'
import { makeEnv } from './helpers'

const MON = Date.UTC(2026, 9, 19, 14, 0, 0) // Monday 10:00 AM Eastern
const et = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
  })
const from = '2026-10-19T04:00:00Z'
const to = '2026-10-26T04:00:00Z'

describe('getSlotTimes', () => {
  const slots = [
    { dayType: 'weekday' as const, timeLocal: '10:00', enabled: true },
    { dayType: 'weekday' as const, timeLocal: '17:00', enabled: true },
    { dayType: 'weekend' as const, timeLocal: '10:00', enabled: true },
  ]
  it('lists every slot in the window, and only the earliest N of a day when there is a daily limit', () => {
    expect(getSlotTimes({ slots, from, to: '2026-10-21T04:00:00Z' }).map(et)).toEqual([
      'Mon, 10/19, 10 AM',
      'Mon, 10/19, 5 PM',
      'Tue, 10/20, 10 AM',
      'Tue, 10/20, 5 PM',
    ])
    expect(getSlotTimes({ slots, from, to: '2026-10-21T04:00:00Z', maxPerDay: 1 }).map(et)).toEqual(
      ['Mon, 10/19, 10 AM', 'Tue, 10/20, 10 AM'],
    )
  })
  it('honors the days a channel posts on and blackout dates', () => {
    expect(getSlotTimes({ slots, from, to, weekdays: [3, 5], maxPerDay: 1 }).map(et)).toEqual([
      'Wed, 10/21, 10 AM',
      'Fri, 10/23, 10 AM',
    ])
    expect(
      getSlotTimes({
        slots,
        from,
        to,
        weekdays: [3, 5],
        maxPerDay: 1,
        blackoutDates: ['2026-10-21'],
      }).map(et),
    ).toEqual(['Fri, 10/23, 10 AM'])
  })
})

describe('open slots for the Calendar', () => {
  it('shows the slots of the channel settings, and a slot with a post in it is not open', async () => {
    const e = makeEnv(MON)
    const open = () =>
      e.posts
        .openSlotsInRange(1, from, to)
        .filter((s) => s.kind === 'episode')
        .map((s) => et(s.whenUtc))
    // Monday's first slot (8 AM) has passed. Every later day has its first slot, one a day because the daily limit is 1.
    expect(open()).toEqual([
      'Tue, 10/20, 8 AM',
      'Wed, 10/21, 8 AM',
      'Thu, 10/22, 8 AM',
      'Fri, 10/23, 8 AM',
      'Sat, 10/24, 10 AM',
      'Sun, 10/25, 10 AM',
    ])
    const tue = e.posts.nextSlots(1, 2)[1]
    await e.makePost({ whenMs: new Date(tue).getTime(), title: 'Tuesday video' })
    expect(open()).not.toContain(et(tue))
    // the daily limit is used up by a post at some other time of that day, so no slot is offered that day
    const wed = new Date('2026-10-21T20:30:00Z').getTime() // 4:30 PM Wednesday, not a slot time
    await e.makePost({ whenMs: wed, title: 'Wednesday, off slot' })
    expect(open()).not.toContain('Wed, 10/21, 8 AM')
    // a bigger limit offers the day's other slot again
    e.db.prepare('UPDATE channel_rules SET max_per_day = 2 WHERE brand_id = 1').run()
    expect(open().filter((x) => x.startsWith('Wed'))).toHaveLength(1) // the day's other slot is offered again, the first is taken by the 4:30 PM post only if it was on a slot
    // slots in the past are never offered
    expect(e.posts.openSlotsInRange(1, '2026-10-10T04:00:00Z', '2026-10-12T04:00:00Z')).toEqual([])
  })

  it('a blackout date removes the slot, and a channel that posts weekly shows only its days', async () => {
    const e = makeStudioEnv({ startMs: MON })
    const id = hollowId(e)
    e.db
      .prepare('UPDATE channel_rules SET blackout_json = ? WHERE brand_id = ?')
      .run(JSON.stringify(['2026-10-23']), id)
    const days = e.posts.openSlotsInRange(id, from, to).map((s) => et(s.whenUtc).slice(0, 3))
    expect(days).toEqual(['Wed'])
  })

  it('clips have their own open slots on the clip days at the clip time', async () => {
    const e = makeEnv(MON)
    e.db
      .prepare('INSERT OR REPLACE INTO studio_brands (brand_id, config_json) VALUES (1, ?)')
      .run(JSON.stringify({ clipPostDays: [2, 4], clipTime: '12:00' }))
    const clips = e.posts.openSlotsInRange(1, from, to).filter((s) => s.kind === 'clip')
    expect(clips.map((s) => et(s.whenUtc))).toEqual(['Tue, 10/20, 12 PM', 'Thu, 10/22, 12 PM'])
    // a clip in the slot fills it, and the episode slots are not touched
    const p = await e.makePost({ whenMs: new Date(clips[0].whenUtc).getTime(), title: 'A clip' })
    e.db.prepare("UPDATE posts SET post_type = 'clip' WHERE id = ?").run(p.id)
    expect(
      e.posts
        .openSlotsInRange(1, from, to)
        .filter((s) => s.kind === 'clip')
        .map((s) => et(s.whenUtc)),
    ).toEqual(['Thu, 10/22, 12 PM'])
    expect(e.posts.openSlotsInRange(1, from, to).filter((s) => s.kind === 'episode')).toHaveLength(
      6,
    )
  })
})
