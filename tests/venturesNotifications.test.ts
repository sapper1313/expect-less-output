import { describe, expect, it } from 'vitest'
import { makeEnv } from './helpers'
import { VentureStore } from '../src/main/ventures/store'
import { VentureNotifier } from '../src/main/ventures/notifications'

const base = { storefront: 'etsy', at: '2026-06-01T00:00:00.000Z', url: null as string | null }

function setup() {
  const store = new VentureStore(makeEnv().db)
  const sent: string[] = []
  let refreshed = 0
  const n = new VentureNotifier({ store, telegram: async (t) => void sent.push(t), label: () => 'Etsy', onNew: () => void refreshed++ })
  return { store, sent, n, refreshed: () => refreshed }
}
const flush = () => new Promise((r) => setTimeout(r, 5))

describe('VentureNotifier', () => {
  it('stores and announces a notification once per key', async () => {
    const { store, sent, n, refreshed } = setup()
    n.notify({ ...base, kind: 'order', title: 'New order from buyer_1', detail: 'Mug x1' }, 'order:1')
    n.notify({ ...base, kind: 'order', title: 'New order from buyer_1', detail: 'Mug x1' }, 'order:1')
    await flush()
    expect(store.unreadCount('etsy')).toBe(1)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('New order from buyer_1')
    expect(refreshed()).toBe(1)
  })
  it('says low rating for a 1 to 3 star review and never sends the review text', async () => {
    const { sent, n } = setup()
    n.notify({ ...base, kind: 'low_review', title: 'New 2 star review', detail: 'SECRET REVIEW WORDS' }, 'low:1')
    await flush()
    expect(sent[0].toLowerCase()).toContain('low rating')
    expect(sent[0]).not.toContain('SECRET REVIEW WORDS')
  })
  it('does not send message snippets to Telegram', async () => {
    const { sent, n } = setup()
    n.notify({ ...base, kind: 'message', title: 'New message from Sam', detail: 'Hello private snippet' }, 'm:1')
    await flush()
    expect(sent[0]).toContain('New message from Sam')
    expect(sent[0]).not.toContain('private snippet')
  })
  it('keeps the notification even if Telegram is down', async () => {
    const store = new VentureStore(makeEnv().db)
    const n = new VentureNotifier({ store, telegram: async () => { throw new Error('offline') }, label: () => 'Etsy' })
    n.notify({ ...base, kind: 'review', title: 'New 5 star review', detail: '' }, 'r:1')
    await flush()
    expect(store.unreadCount('etsy')).toBe(1)
  })
})
