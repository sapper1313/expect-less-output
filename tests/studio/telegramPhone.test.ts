import { describe, expect, it, vi } from 'vitest'
import { EMPTY_STATE, TelegramAssistant, type TelegramState } from '../../src/main/studio/telegram'
import { TelegramReports } from '../../src/main/studio/telegramReports'
import { StatsService } from '../../src/main/stats/service'
import { makeStudioEnv } from './helpers'

const HOUR = 3_600_000
const DAY = 24 * HOUR

async function rig() {
  const e = makeStudioEnv({ startMs: Date.UTC(2026, 9, 15, 11, 0, 0) }) // Thu Oct 15 2026, 7:00 AM Eastern
  e.db.prepare("UPDATE accounts SET mode = 'live'").run()
  const stats = new StatsService({ db: e.db, log: e.log, providers: {}, now: () => e.clock.ms })
  const reports = new TelegramReports({
    db: e.db,
    brands: () =>
      e.studio.cfg
        .listBrandConfigs()
        .map((b) => ({ id: b.brandId, name: b.name, paused: b.config.paused })),
    spend: () => e.studio.spend.summary(),
    flagged: () =>
      e.studio.tasks.list({ status: ['flagged', 'stopped'] }).map((t) => ({
        taskId: t.id,
        brandName: null,
        title: null,
        error: t.error,
      })),
    brandStats: (id, range) => stats.brandSummary(id, range),
    now: () => e.clock.ms,
  })
  let state: TelegramState = { ...EMPTY_STATE, enabled: true, chatIds: [7] }
  const sent: string[] = []
  let updates: unknown[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const method = String(url).split('/').pop()
    if (method === 'getUpdates') {
      const out = updates
      updates = []
      return new Response(JSON.stringify({ ok: true, result: out }))
    }
    if (method === 'sendMessage') sent.push(JSON.parse(String(init.body)).text)
    return new Response(JSON.stringify({ ok: true, result: {} }))
  }) as unknown as typeof fetch
  const ask = vi.fn<(system: string, user: string) => Promise<string>>(async () => 'LLM ANSWER')
  const addIdea = vi.fn(async (brandId: number, text: string) => `idea ${brandId}: ${text}`)
  const setPaused = vi.fn(async () => undefined)
  const setBrandPaused = vi.fn(async (id: number, paused: boolean) => {
    await e.studio.setBrand(id, { paused })
  })
  const t = new TelegramAssistant({
    token: () => 'T',
    fetchImpl,
    load: () => state,
    save: (s) => (state = s),
    snapshot: async () => ({ text: 'SNAP', status: 'STATUS', latest: 'LATEST' }),
    ask,
    setPaused,
    reports,
    setBrandPaused,
    addIdea,
    log: () => undefined,
  })
  let n = 1
  const say = async (text: string) => {
    updates = [{ update_id: n++, message: { chat: { id: 7, type: 'private' }, text } }]
    await t.pollOnce()
    return sent.at(-1) ?? ''
  }
  /** A posted video with numbers. */
  const posted = async (
    brandId: number,
    platform: 'youtube' | 'instagram',
    title: string,
    agoMs: number,
    views: number,
  ) => {
    const post = await e.makePost({
      brandId,
      whenMs: e.clock.ms - agoMs,
      platforms: [platform],
      title,
    })
    const at = new Date(e.clock.ms - agoMs).toISOString()
    e.db
      .prepare(
        "UPDATE post_targets SET status = 'posted', external_id = 'x' || id, posted_at_utc = ? WHERE post_id = ?",
      )
      .run(at, post.id)
    e.db.prepare("UPDATE posts SET status = 'posted' WHERE id = ?").run(post.id)
    const tid = (
      e.db.prepare('SELECT id FROM post_targets WHERE post_id = ?').get(post.id) as { id: number }
    ).id
    e.db
      .prepare(
        'INSERT INTO post_stats (post_target_id, fetched_at_utc, views, likes, comments) VALUES (?, ?, ?, 7, 2)',
      )
      .run(tid, at, views)
    return post
  }
  return { e, say, sent, ask, addIdea, setPaused, setBrandPaused, posted, state: () => state }
}

describe('Telegram phone commands', () => {
  it('/last shows the last post per platform in Eastern time, brands with none, paused, and the next post', async () => {
    const r = await rig()
    await r.posted(3, 'youtube', 'Old tip', 3 * DAY, 100)
    await r.posted(3, 'youtube', 'Newest tip', 1 * DAY, 500)
    await r.posted(3, 'instagram', 'Reel tip', 2 * DAY, 80)
    await r.e.makePost({
      brandId: 3,
      whenMs: r.e.clock.ms + 2 * DAY,
      title: 'Coming up',
      platforms: ['youtube'],
    })
    await r.e.studio.setBrand(4, { paused: true })
    const text = await r.say('/last')
    expect(text).toContain('Teach Your Parents Tech')
    expect(text).toContain('YouTube: Wed Oct 14, 7:00 AM, Newest tip') // 11:00 UTC is 7:00 AM Eastern
    expect(text).not.toContain('Old tip')
    expect(text).toContain('Instagram: Tue Oct 13, 7:00 AM, Reel tip')
    expect(text).toMatch(/Next: Sat Oct 17, 7:00 AM, Coming up/)
    expect(text).toMatch(/The Math of It \(paused\)\n {2}No posts yet\./)
    expect(r.ask).not.toHaveBeenCalled()
  })

  it('/stats adds up the last 7 or 30 days and names the best video', async () => {
    const r = await rig()
    await r.posted(1, 'youtube', 'Small one', 2 * DAY, 100)
    await r.posted(1, 'youtube', 'Big one', 3 * DAY, 900)
    await r.posted(2, 'youtube', 'Older one', 20 * DAY, 4000)
    const week = await r.say('/stats')
    expect(week).toContain('Last 7 days')
    expect(week).toMatch(/Trash Panda: 2 videos, 1,000 views, 14 likes, 4 comments/)
    expect(week).toContain('Best video: "Big one" (Trash Panda, YouTube) with 900 views.')
    expect(week).not.toContain('Older one')
    const month = await r.say('/stats 30')
    expect(month).toContain('Last 30 days')
    expect(month).toContain('Best video: "Older one"')
    expect(await r.say('what are my analytics?')).toContain('Last 7 days')
  })

  it('/today, /spend, /flags and /brands read from the records', async () => {
    const r = await rig()
    await r.e.makePost({
      brandId: 1,
      whenMs: r.e.clock.ms + 6 * HOUR,
      title: 'This afternoon',
      platforms: ['youtube'],
    })
    const today = await r.say('/today')
    expect(today).toContain('Next 3 days')
    expect(today).toContain('Trash Panda, This afternoon')
    expect(today).toContain('Nothing is flagged')
    const t = r.e.studio.tasks.create({ type: 'write_episode', brandId: 1, payload: {} })
    r.e.studio.tasks.setStatus(t.id, 'flagged', { error: 'The answer was cut off.' })
    expect(await r.say('/flags')).toMatch(/Flagged in the Studio: 1[\s\S]*cut off/)
    expect(await r.say('/spend')).toMatch(/Spend this month \(2026-10\): \$0\.00/)
    expect(await r.say('/brands')).toContain('Wonder Hollow Workshop')
  })

  it('pauses and resumes one brand, only after YES', async () => {
    const r = await rig()
    await r.e.studio.setBrand(4, { paused: true })
    expect(await r.say('/resume the math of it')).toBe(
      'Reply YES to resume The Math of It. Anything else cancels.',
    )
    expect(r.setBrandPaused).not.toHaveBeenCalled()
    expect(await r.say('YES')).toBe('Done. The Math of It is running again.')
    expect(r.setBrandPaused).toHaveBeenCalledWith(4, false)
    expect(r.e.studio.cfg.getBrand(4).paused).toBe(false)

    // anything but YES cancels
    await r.say('/pause math')
    await r.say('no thanks')
    expect(r.setBrandPaused).toHaveBeenCalledTimes(1)
    expect(await r.say('yes')).not.toMatch(/Done/) // nothing is waiting any more
  })

  it('handles already paused, running, unknown and unclear brands', async () => {
    const r = await rig()
    await r.e.studio.setBrand(4, { paused: true })
    expect(await r.say('/pause The Math of It')).toBe('The Math of It is already paused.')
    expect(await r.say('/resume Trash Panda')).toBe('Trash Panda is already running.')
    expect(await r.say('/pause Nonsense Show')).toMatch(
      /could not find a brand called "Nonsense Show"[\s\S]*Trash Panda/,
    )
    expect(await r.say('/pause t')).toMatch(/could be .* or /)
  })

  it('still pauses everything with /pause and YES, and answers other questions with the model', async () => {
    const r = await rig()
    await r.say('/pause')
    await r.say('YES')
    expect(r.setPaused).toHaveBeenCalledWith(true)
    expect(await r.say('how is the newest video doing?')).toBe('LLM ANSWER')
    expect(await r.say('/help')).toContain('/last')
  })

  it('answers "when was the last post" from the records without the model', async () => {
    const r = await rig()
    await r.posted(1, 'youtube', 'Tip', 1 * DAY, 10)
    const text = await r.say('when was the last post to trash panda?')
    expect(text).toContain('Last posts (Eastern time)')
    expect(r.ask).not.toHaveBeenCalled()
  })

  it('with the model down, a question gets the fixed offline reply and the fixed commands still work (test 15)', async () => {
    const r = await rig()
    r.ask.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const reply = await r.say('how is the newest video doing?')
    expect(reply).toMatch(/language model is offline/)
    expect(reply).toContain('/queue')
    expect(await r.say('/status')).toBe('STATUS')
    expect(await r.say('/queue')).toContain('Next 3 days')
    expect(await r.say('/today')).toContain('Next 3 days')
    r.ask.mockRejectedValue(new Error('Writing comes from bots.'))
    expect(await r.say('hello?')).toMatch(/offline/)
  })

  it('"add idea for <channel>: ..." goes to the shared Upcoming list without the model', async () => {
    const r = await rig()
    const out = await r.say('add idea for trash panda: A raccoon files taxes')
    expect(r.addIdea).toHaveBeenCalledWith(1, 'A raccoon files taxes')
    expect(out).toContain('A raccoon files taxes')
    expect(r.ask).not.toHaveBeenCalled()
    expect(await r.say('add idea for nobody at all: x')).toMatch(/find|brand|channel/i)
  })
})
