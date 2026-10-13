import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import { getNextOpenSlots } from '../../src/shared/slots'
import { defaultBrandConfig, normalizeBrandConfig } from '../../src/shared/studio/config'
import { hollowId, makeStudioEnv, minimalPackage } from './helpers'

const weekdayOf = (utc: string) => DateTime.fromISO(utc, { zone: 'utc' }).setZone('America/New_York').weekday
// Tuesday 2026-10-13, 10:00 Eastern
const TUE = Date.UTC(2026, 9, 13, 14)

describe('Wonder Hollow posts on Wednesday and Friday only', () => {
  it('the slot engine skips weekdays that are not allowed', () => {
    const slots = getNextOpenSlots({
      slots: [
        { dayType: 'weekday', timeLocal: '08:00', enabled: true },
        { dayType: 'weekday', timeLocal: '17:00', enabled: true },
      ],
      taken: [],
      count: 4,
      from: new Date(TUE),
      weekdays: [3, 5],
    })
    expect(slots).toEqual([
      '2026-10-14T12:00:00.000Z', // Wed 08:00
      '2026-10-14T21:00:00.000Z', // Wed 17:00
      '2026-10-16T12:00:00.000Z', // Fri 08:00
      '2026-10-16T21:00:00.000Z', // Fri 17:00
    ])
  })

  it('every next-slot lookup for Hollow lands on Wednesday or Friday, even though its brand slots are Monday to Friday', () => {
    const e = makeStudioEnv({ startMs: TUE })
    const hid = hollowId(e)
    expect(e.studio.cfg.getBrand(hid).postDays).toEqual([3, 5])
    const slots = e.posts.nextSlots(hid, 8, new Date(TUE).toISOString())
    expect(slots).toHaveLength(8)
    expect(slots.every((s) => [3, 5].includes(weekdayOf(s)))).toBe(true)
    // a brand on an every N days schedule keeps using all of its slots
    const other = (e.db.prepare("SELECT id FROM brands WHERE name NOT LIKE 'Wonder Hollow%' ORDER BY id").get() as { id: number }).id
    expect(e.posts.postDays(other)).toBeUndefined()
    expect(e.posts.nextSlots(other, 6, new Date(TUE).toISOString()).some((s) => ![3, 5].includes(weekdayOf(s)))).toBe(true)
  })

  it('a stored Tuesday and Friday row on every platform is fixed by the migration, and long form is YouTube only on read', () => {
    const e = makeStudioEnv({ startMs: TUE })
    const hid = hollowId(e)
    const old = {
      ...defaultBrandConfig('long', '2026-10-01'),
      postDays: [2, 5],
      windows: [
        { days: [7, 1], forPostDay: 2 },
        { days: [3, 4], forPostDay: 5 },
      ],
      platforms: { youtube: true, facebook: true, instagram: true, tiktok: true, bluesky: true },
    }
    e.db.prepare('UPDATE studio_brands SET config_json = ? WHERE brand_id = ?').run(JSON.stringify(old), hid)
    // read side: the platforms are cut down even before the migration runs
    expect(e.studio.cfg.getBrand(hid).platforms).toMatchObject({ youtube: true, facebook: false, instagram: false, tiktok: false, bluesky: false })
    expect(normalizeBrandConfig({ format: 'long', platforms: old.platforms } as never, 'long', '2026-10-01').platforms.tiktok).toBe(false)
    // migration side
    e.db.exec(readFileSync(join(__dirname, '../../src/main/db/migrations/014_hollow_wed_fri.sql'), 'utf8'))
    const cfg = e.studio.cfg.getBrand(hid)
    expect(cfg.cadenceMode).toBe('weekly')
    expect(cfg.postDays).toEqual([3, 5])
    expect(cfg.windows).toEqual([
      { days: [7, 1], forPostDay: 3 },
      { days: [3, 4], forPostDay: 5 },
    ])
    expect(e.posts.nextSlots(hid, 4, new Date(TUE).toISOString()).every((s) => [3, 5].includes(weekdayOf(s)))).toBe(true)
  })
})

describe('a video stays bound to the text it arrived with', () => {
  async function attached() {
    const e = makeStudioEnv({ startMs: Date.UTC(2026, 5, 1, 12) })
    const hid = hollowId(e)
    const ep = e.studio.episodes.create(hid, minimalPackage('Acorn Boats') as never, { status: 'Awaiting video' })
    const src = join(e.dir, 'acorn.mp4')
    writeFileSync(src, 'fake video bytes')
    const post = await e.posts.create({
      brandId: hid,
      sourcePath: src,
      title: 'Acorn Boats',
      caption: 'About Acorn Boats.',
      scheduledAtUtc: new Date(Date.UTC(2026, 5, 3, 12)).toISOString(),
      status: 'scheduled',
      targets: [{ platform: 'youtube', aiFlag: true, captionOverride: null }],
    })
    e.studio.episodes.setFields(ep.id, { postId: post.id })
    e.studio.episodes.setStatus(ep.id, 'Scheduled', 'Scheduled.', { postId: post.id })
    return { e, hid, ep, post }
  }

  it('the Publisher refuses to restamp an attached post after the episode moved on', async () => {
    const { e, ep, post } = await attached()
    // the record is rewritten: new title, new summary
    const pkg = e.studio.episodes.getPackage(ep.id)!
    e.studio.episodes.savePackage(ep.id, { ...pkg, title: 'Spools', summary: 'All about spools.', youtube: { ...pkg.youtube, title: 'Spools' } })
    e.studio.episodes.setStatus(ep.id, 'Ready for production', 'Rewritten.')
    await expect(e.studio.publisher.run({ episodeId: ep.id, postId: post.id })).rejects.toThrow(/already has its title and text/)
    expect(e.posts.get(post.id)!.title).toBe('Acorn Boats')
    expect(e.posts.get(post.id)!.scheduledAtUtc).toBe('2026-06-03T12:00:00.000Z')
  })

  it('the Publisher refuses a post that belongs to another episode', async () => {
    const { e, hid, post } = await attached()
    const other = e.studio.episodes.create(hid, minimalPackage('Spools') as never, { status: 'Video received' })
    e.studio.episodes.setFields(other.id, { postId: post.id + 100 })
    await expect(e.studio.publisher.run({ episodeId: other.id, postId: post.id })).rejects.toThrow(/not post/)
  })

  it('an episode with a post is not rebuilt', async () => {
    const { e, ep } = await attached()
    e.studio.episodes.setStatus(ep.id, 'Flagged', 'Publishing could not finish.', { flaggedReason: 'x' })
    await expect(e.studio.rebuildEpisode(ep.id)).rejects.toThrow(/already has a video/)
    expect(e.studio.episodes.get(ep.id).title).toBe('Acorn Boats')
  })

  it('a second video for the same episode is refused', async () => {
    const { e, ep } = await attached()
    await expect(e.studio.ingest.before(ep.id, join(e.dir, 'second.mp4'), {})).rejects.toThrow(/already has a video/)
  })
})
