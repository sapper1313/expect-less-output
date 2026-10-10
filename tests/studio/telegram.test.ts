import { describe, expect, it, vi } from 'vitest'
import { EMPTY_STATE, TelegramAssistant, type TelegramState } from '../../src/main/studio/telegram'
import { homeSnapshotText, latestLines } from '../../src/main/homeSnapshot'
import type { HomeSummary } from '../../src/shared/home'

const summary: HomeSummary = {
  generatedUtc: '2026-10-10T16:00:00.000Z',
  stages: [{ key: 'writing', label: 'Being written', count: 1 }],
  channels: [{ brandId: 1, name: 'Trash Panda', color: '#fff', paused: false, runwayDays: 5, nextDue: '2026-10-12', pipeline: { writing: 1, ready: 0, making: 0, scheduled: 1, flagged: 0 }, connections: [{ platform: 'youtube', label: 'YouTube', state: 'ok', note: 'Connected' }], latest: { postId: 9, title: 'Ctrl-Enter tip', platforms: ['youtube'], postedAtUtc: '2026-10-10T12:00:00Z', views: 111, likes: 4, comments: 2, shares: 0 } }],
  upcoming: [],
  recent: [],
  spend: { month: '2026-10', total: 12.5, projected: 40, capLabel: 'Global', capValue: 150, percent: 8, mock: false },
  badges: { studio: 0, queue: 0, channels: 0 },
  needsYou: [],
}

function rig(opts: { token?: string | null; state?: Partial<TelegramState> } = {}) {
  let state: TelegramState = { ...EMPTY_STATE, enabled: true, ...opts.state }
  const sent: Array<{ chat_id: number; text: string }> = []
  let updates: unknown[] = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? '{}'))
    const method = String(url).split('/').pop()
    if (method === 'getUpdates') {
      const out = updates
      updates = []
      return new Response(JSON.stringify({ ok: true, result: out }))
    }
    if (method === 'sendMessage') sent.push(body)
    return new Response(JSON.stringify({ ok: true, result: { username: 'elo_bot' } }))
  }) as unknown as typeof fetch
  const ask = vi.fn(async (system: string, user: string) => (system && user ? 'Trash Panda is at 111 views.' : ''))
  const setPaused = vi.fn(async () => undefined)
  const t = new TelegramAssistant({
    token: () => (opts.token === undefined ? 'TOKEN' : opts.token),
    fetchImpl,
    load: () => state,
    save: (s) => (state = s),
    snapshot: async () => ({ text: homeSnapshotText(summary), status: 'STATUS', latest: latestLines(summary) }),
    ask,
    setPaused,
    log: () => undefined,
    code: () => '123456',
  })
  const say = async (chat: number, text: string, id = Math.floor(Math.random() * 1e6)) => {
    updates = [{ update_id: id, message: { chat: { id: chat, type: 'private' }, text } }]
    await t.pollOnce()
  }
  return { t, sent, ask, setPaused, say, state: () => state }
}

describe('Telegram assistant', () => {
  it('ignores strangers, pairs with the code, then answers from the snapshot', async () => {
    const r = rig()
    r.t.newCode()
    await r.say(7, 'hello?')
    expect(r.sent.at(-1)?.text).toMatch(/only talk to my owner/)
    expect(r.ask).not.toHaveBeenCalled()
    await r.say(7, '123456')
    expect(r.sent.at(-1)?.text).toMatch(/Paired/)
    expect(r.state().chatIds).toEqual([7])
    await r.say(7, 'how is the last post doing?')
    expect(r.ask).toHaveBeenCalledOnce()
    expect(String(r.ask.mock.calls[0][0])).toContain('111')
    expect(r.sent.at(-1)?.text).toMatch(/111 views/)
    await r.say(8, 'what is going on')
    expect(r.ask).toHaveBeenCalledOnce()
  })
  it('answers quick commands without the model and keeps secrets out of the facts', async () => {
    const r = rig({ state: { chatIds: [7] } })
    await r.say(7, '/latest')
    expect(r.sent.at(-1)?.text).toBe('Trash Panda: "Ctrl-Enter tip" has 111 views, 4 likes, 2 comments.')
    await r.say(7, '/spend')
    expect(r.sent.at(-1)?.text).toMatch(/\$12\.50 of a \$150 cap/)
    expect(r.ask).not.toHaveBeenCalled()
    expect(homeSnapshotText(summary)).not.toMatch(/token|password/i)
  })
  it('pauses only after YES', async () => {
    const r = rig({ state: { chatIds: [7] } })
    await r.say(7, '/pause')
    expect(r.setPaused).not.toHaveBeenCalled()
    await r.say(7, 'no thanks')
    await r.say(7, 'yes')
    expect(r.setPaused).not.toHaveBeenCalled()
    await r.say(7, '/pause')
    await r.say(7, 'YES')
    expect(r.setPaused).toHaveBeenCalledWith(true)
  })
  it('does nothing when it is off or has no token, and group chats are ignored', async () => {
    const off = rig({ state: { enabled: false } })
    expect(await off.t.pollOnce()).toBe(0)
    const none = rig({ token: null })
    expect(await none.t.pollOnce()).toBe(0)
    const r = rig({ state: { chatIds: [7] } })
    await r.t.handle(7, '/help')
    expect(r.sent.at(-1)?.text).toMatch(/Quick commands/)
  })
})
