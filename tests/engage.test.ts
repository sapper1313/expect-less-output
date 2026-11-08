import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { makeEnv } from './helpers'
import { SecretStore } from '../src/main/services/secrets'
import { UploadPostService } from '../src/main/services/uploadPost'
import { EngageService, commentRef } from '../src/main/services/engage'
import { UploadPostError } from '../src/main/uploadpost/client'

const MIN = 60_000
const crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
}

function setup(over: { list?: (i: any) => any[]; convos?: any[]; suggest?: any } = {}) {
  const env = makeEnv(Date.UTC(2026, 10, 8, 18, 0, 0))
  const secrets = new SecretStore(join(mkdtempSync(join(tmpdir(), 'eg-')), 's.bin'), crypto)
  const up = new UploadPostService(env.db, secrets, {} as any)
  up.setKey('k')
  up.setLink(2, 'Clock_Out_Early', { youtube: true, instagram: true, tiktok: true, facebook: true })
  const calls = { list: [] as any[], create: [] as any[], dm: [] as any[] }
  const svc = new EngageService({
    db: env.db,
    uploadPost: up,
    client: {
      async listComments(_k: string, i: any) {
        calls.list.push(i)
        if (over.list) return over.list(i)
        return []
      },
      async createComment(_k: string, i: any) {
        calls.create.push(i)
        return { id: 'r1', warnings: [] }
      },
      async dmConversations() {
        return over.convos ?? []
      },
      async sendDm(_k: string, i: any) {
        calls.dm.push(i)
      },
    } as any,
    log: env.log,
    now: () => env.clock.ms,
    sleep: async () => {},
    suggest: over.suggest,
  })
  const post = (title: string, targets: Array<[string, string, string | null]>, first: string | null = null) => {
    const id = Number(
      env.db
        .prepare("INSERT INTO posts (brand_id, video_path, title, caption, status, first_comment) VALUES (2, 'x.mp4', ?, 'c', 'posted', ?)")
        .run(title, first).lastInsertRowid,
    )
    const ids: Record<string, number> = {}
    for (const [platform, ext, url] of targets)
      ids[platform] = Number(
        env.db
          .prepare("INSERT INTO post_targets (post_id, platform, status, external_id, external_url, posted_at_utc) VALUES (?, ?, 'posted', ?, ?, ?)")
          .run(id, platform, ext, url, new Date(env.clock.ms - 30 * MIN).toISOString()).lastInsertRowid,
      )
    return { id, ids }
  }
  return { env, svc, up, calls, post }
}

describe('commentRef', () => {
  it('points Upload-Post at each kind of post', () => {
    expect(commentRef('youtube', 'abc', null)).toEqual({ postId: 'abc' })
    expect(commentRef('facebook', '5', 'https://fb.com/v/5')).toEqual({ postUrl: 'https://fb.com/v/5' })
    expect(commentRef('tiktok', 'v_inbox_x', null)).toBeNull()
    expect(commentRef('tiktok', 'v_inbox_x', 'https://www.tiktok.com/@a/video/777')).toEqual({ postId: '777' })
    expect(commentRef('tiktok', '888', null)).toEqual({ postId: '888' })
  })
})

describe('Comment sync', () => {
  it('stores new comments once, marks the channel\'s own first comment, and skips unticked platforms', async () => {
    const t = setup({
      list: (i) =>
        i.platform === 'youtube'
          ? [
              { id: 'c1', text: 'Great tip!', at: '2026-11-08T17:50:00Z', userId: 'u1', username: 'sam' },
              { id: 'c2', text: 'Which one first?', at: '2026-11-08T17:41:00Z', userId: 'me', username: 'clockoutearly' },
            ]
          : [],
    })
    t.post('Copy Text', [['youtube', 'vid1', null], ['instagram', '999', null]], 'Which one first?')
    t.up.setLink(2, 'Clock_Out_Early', { youtube: true })
    const r = await t.svc.sync()
    expect(r.checked).toBe(1)
    expect(r.added).toBe(2)
    expect(t.calls.list[0]).toMatchObject({ platform: 'youtube', user: 'Clock_Out_Early', postId: 'vid1' })
    const open = t.svc.list({})
    expect(open.map((c) => c.text)).toEqual(['Great tip!'])
    expect(open[0]).toMatchObject({ platform: 'youtube', author: 'sam', postTitle: 'Copy Text' })
    expect(t.svc.newCount()).toBe(1)
    // Checking again right away does nothing, and forcing it adds no duplicates.
    expect((await t.svc.sync()).checked).toBe(0)
    expect((await t.svc.sync({ force: true })).added).toBe(0)
  })

  it('explains a TikTok that needs reconnecting instead of failing silently', async () => {
    const t = setup({
      list: () => {
        throw new UploadPostError('reconnect', 400, 'tiktok_reconnect_required')
      },
    })
    t.post('A', [['tiktok', '123456', null]])
    const r = await t.svc.sync()
    expect(r.problems[0]).toMatch(/TikTok: .*connect it again/i)
  })
})

describe('Replying', () => {
  it('replies to the comment, marks it replied, and sends TikTok the video too', async () => {
    const t = setup({ list: () => [{ id: 'c9', text: 'Nice', at: null, userId: 'u', username: 'v' }] })
    t.post('A', [['tiktok', '4242', null]])
    await t.svc.sync()
    const id = t.svc.list({})[0]!.id
    await expect(t.svc.reply(id, '  ')).rejects.toThrow(/Type the reply/)
    await t.svc.reply(id, 'Thanks!')
    expect(t.calls.create[0]).toMatchObject({ platform: 'tiktok', commentId: 'c9', postId: '4242', message: 'Thanks!', user: 'Clock_Out_Early' })
    const all = t.svc.list({ show: 'all' })
    expect(all[0]).toMatchObject({ status: 'replied', replyText: 'Thanks!' })
    expect(t.svc.list({})).toHaveLength(0)
  })

  it('can mark a comment done and bring it back, and asks the local AI only when told to', async () => {
    const suggest = async () => ['Thank you!', 'Glad you liked it']
    const t = setup({ list: () => [{ id: 'c1', text: 'Hi', at: null, userId: 'u', username: 'v' }], suggest })
    t.post('A', [['youtube', 'v1', null]])
    await t.svc.sync()
    const id = t.svc.list({})[0]!.id
    expect(await t.svc.draft(id)).toEqual(['Thank you!', 'Glad you liked it'])
    t.svc.setStatus(id, 'done')
    expect(t.svc.list({})).toHaveLength(0)
    t.svc.setStatus(id, 'new')
    expect(t.svc.list({})).toHaveLength(1)
    const noAi = setup()
    await expect(noAi.svc.draft(1)).rejects.toThrow(/local AI/)
  })
})

describe('Instagram messages', () => {
  const convo = (hoursAgo: number) => ({
    id: 't1',
    participants: { data: [{ id: 'ME', username: 'clockoutearlywithsarah' }, { id: 'U1', username: 'sam' }] },
    messages: {
      data: [
        { id: 'm2', created_time: new Date(Date.UTC(2026, 10, 8, 18, 0, 0) - hoursAgo * 3_600_000).toISOString(), from: { id: 'U1', username: 'sam' }, message: 'Can you do one on Excel?' },
        { id: 'm1', created_time: new Date(Date.UTC(2026, 10, 8, 18, 0, 0) - (hoursAgo + 1) * 3_600_000).toISOString(), from: { id: 'ME', username: 'clockoutearlywithsarah' }, message: 'Welcome!' },
      ],
    },
  })

  it('shows who said what, and allows a reply only inside 24 hours', async () => {
    const t = setup({ convos: [convo(2)] })
    t.env.db.prepare("UPDATE accounts SET display_name = '@clockoutearlywithsarah' WHERE brand_id = 2 AND platform = 'instagram'").run()
    const [ch] = await t.svc.dms()
    expect(ch!.brandName).toBeTruthy()
    const c = ch!.conversations[0]!
    expect(c.withName).toBe('sam')
    expect(c.messages.map((m) => [m.text, m.mine])).toEqual([['Welcome!', true], ['Can you do one on Excel?', false]])
    expect(c.canReply).toBe(true)
    await t.svc.dmSend(2, 'U1', 'Yes, soon!')
    expect(t.calls.dm[0]).toMatchObject({ recipientId: 'U1', message: 'Yes, soon!', user: 'Clock_Out_Early' })

    const old = setup({ convos: [convo(30)] })
    old.env.db.prepare("UPDATE accounts SET display_name = '@clockoutearlywithsarah' WHERE brand_id = 2 AND platform = 'instagram'").run()
    const [och] = await old.svc.dms()
    expect(och!.conversations[0]!.canReply).toBe(false)
    await expect(old.svc.dmSend(2, 'U1', 'Late')).rejects.toThrow(/24 hours/)
  })
})
