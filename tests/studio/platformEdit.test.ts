import { describe, expect, it, vi } from 'vitest'
import { PlatformEditor } from '../../src/main/studio/platformEdit'
import { makeStudioEnv } from './helpers'

vi.setConfig({ testTimeout: 60_000 })

async function postedPost(e: ReturnType<typeof makeStudioEnv>, platform: 'youtube' | 'facebook' | 'instagram', accountMode: string, settings = '{}') {
  const brand = (await e.studio.brands())[0].brandId
  const post = await e.makePost({ brandId: brand, whenMs: e.clock.ms - 3600_000, platforms: [platform], title: 'Old title' })
  e.db.prepare('INSERT OR IGNORE INTO accounts (brand_id, platform, mode, status, display_name) VALUES (?, ?, ?, ?, ?)').run(brand, platform, accountMode, 'connected', 'x')
  e.db.prepare('UPDATE accounts SET mode = ?, status = ? WHERE brand_id = ? AND platform = ?').run(accountMode, 'connected', brand, platform)
  const acct = (e.db.prepare('SELECT id FROM accounts WHERE brand_id = ? AND platform = ?').get(brand, platform) as { id: number }).id
  e.db.prepare("UPDATE post_targets SET status = 'posted', external_id = 'VID9', account_id = ?, settings_json = ? WHERE post_id = ?").run(acct, settings, post.id)
  return { post, brand, acct: Number(acct) }
}

describe('edit a live video', () => {
  it('updates YouTube for a real account and keeps our copy in step', async () => {
    const e = makeStudioEnv()
    const { post, acct } = await postedPost(e, 'youtube', 'live')
    const yt = vi.fn(async () => undefined)
    const ed = new PlatformEditor({ db: e.db, youtubeUpdate: yt, facebookUpdate: vi.fn(), mock: () => false, log: () => undefined })
    const msg = await ed.edit(post.id, 'youtube', { title: ' New title ', description: 'New text', tags: ['#a', 'b'] })
    expect(msg).toBe('Changed on the platform.')
    expect(yt).toHaveBeenCalledWith(acct, 'VID9', { title: 'New title', description: 'New text', tags: ['a', 'b'] })
    expect((e.db.prepare('SELECT title FROM posts WHERE id = ?').get(post.id) as { title: string }).title).toBe('New title')
  })
  it('never calls the platform for a mock post or a test account', async () => {
    const e = makeStudioEnv()
    const a = await postedPost(e, 'youtube', 'live', '{"mock":true}')
    const yt = vi.fn()
    const ed = new PlatformEditor({ db: e.db, youtubeUpdate: yt, facebookUpdate: vi.fn(), mock: () => false, log: () => undefined })
    expect(await ed.edit(a.post.id, 'youtube', { title: 'x' })).toMatch(/test or mock/)
    expect(yt).not.toHaveBeenCalled()
  })
  it('explains platforms that cannot be edited and rejects bad input', async () => {
    const e = makeStudioEnv()
    const a = await postedPost(e, 'instagram', 'live')
    const ed = new PlatformEditor({ db: e.db, youtubeUpdate: vi.fn(), facebookUpdate: vi.fn(), mock: () => false, log: () => undefined })
    await expect(ed.edit(a.post.id, 'instagram', { description: 'x' })).rejects.toThrow(/Instagram/)
    await expect(ed.edit(a.post.id, 'tiktok', {})).rejects.toThrow(/TikTok/)
    const y = await postedPost(e, 'youtube', 'live')
    await expect(ed.edit(y.post.id, 'youtube', { title: '' })).rejects.toThrow(/empty/)
    await expect(ed.edit(y.post.id, 'youtube', { title: 'x'.repeat(101) })).rejects.toThrow(/100/)
  })
})
