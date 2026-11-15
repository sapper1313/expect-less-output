import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { makeEnv } from './helpers'
import { SecretStore } from '../src/main/services/secrets'
import { UploadPostService } from '../src/main/services/uploadPost'
import { EngageService } from '../src/main/services/engage'
import { FirstCommentService } from '../src/main/services/firstComments'
import { UploadPostError, isDefinitiveFailure } from '../src/main/uploadpost/client'

const MIN = 60_000
const crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
}

function setup(upErr: UploadPostError | null) {
  const env = makeEnv(Date.UTC(2026, 10, 8, 18, 0, 0))
  const secrets = new SecretStore(join(mkdtempSync(join(tmpdir(), 'ob-')), 's.bin'), crypto)
  const up = new UploadPostService(env.db, secrets, {} as any)
  up.setKey('k')
  up.setLink(2, 'Clock_Out_Early', { youtube: true, instagram: true, facebook: true, bluesky: true })
  const own = { list: 0, reply: [] as any[], dmSend: [] as any[], dmList: 0, comment: [] as any[] }
  const alerts: string[][] = []
  const fail = async () => {
    if (upErr) throw upErr
    return { id: 'r1', warnings: [] }
  }
  const client = {
    listComments: async () => {
      if (upErr) throw upErr
      return []
    },
    createComment: fail,
    dmConversations: async () => {
      if (upErr) throw upErr
      return []
    },
    sendDm: async () => {
      if (upErr) throw upErr
    },
    status: async () => ({ status: 'in_progress', results: [] }),
  } as any
  const ownEngage = {
    listComments: async () => {
      own.list++
      return [{ id: 'c9', text: 'nice', at: null, userId: '', username: 'fan' }]
    },
    reply: async (i: any) => (own.reply.push(i), true),
    dmConversations: async () => (own.dmList++, []),
    sendDm: async (...a: any[]) => (own.dmSend.push(a), true),
    postComment: async (i: any) => (own.comment.push(i), true),
  }
  const engage = new EngageService({
    db: env.db,
    uploadPost: up,
    client,
    log: env.log,
    now: () => env.clock.ms,
    sleep: async () => {},
    own: ownEngage as any,
    alert: (h, d) => alerts.push([h, d]),
  })
  const fc = new FirstCommentService({
    db: env.db,
    uploadPost: up,
    client,
    log: env.log,
    alert: (h, d) => alerts.push([h, d]),
    now: () => env.clock.ms,
    ownComment: (i) => ownEngage.postComment(i),
  })
  const post = (platform: string) => {
    const id = Number(
      env.db
        .prepare("INSERT INTO posts (brand_id, video_path, title, caption, status, scheduled_at_utc, first_comment) VALUES (2, 'x.mp4', 'A video', 'c', 'posted', ?, 'Which first?')")
        .run(new Date(env.clock.ms).toISOString()).lastInsertRowid,
    )
    const t = Number(
      env.db
        .prepare("INSERT INTO post_targets (post_id, platform, status, external_id, external_url, posted_at_utc, account_id) VALUES (?, ?, 'posted', 'ext1', 'https://x/1', ?, NULL)")
        .run(id, platform, new Date(env.clock.ms - 30 * MIN).toISOString()).lastInsertRowid,
    )
    return { id, t }
  }
  return { env, engage, fc, own, alerts, post }
}

describe('definitive versus unsure', () => {
  it('a 4xx refusal is definitive; no answer, a time out and a 5xx are not', () => {
    expect(isDefinitiveFailure(new UploadPostError('x', 403))).toBe(true)
    expect(isDefinitiveFailure(new UploadPostError('x', 400))).toBe(true)
    expect(isDefinitiveFailure(new UploadPostError('x', 0))).toBe(false)
    expect(isDefinitiveFailure(new UploadPostError('x', 408))).toBe(false)
    expect(isDefinitiveFailure(new UploadPostError('x', 500))).toBe(false)
    expect(isDefinitiveFailure(new UploadPostError('x', 429))).toBe(false)
  })
})

describe('Inbox comments backup', () => {
  it('reads comments through ELO when Upload-Post fails, and tells the owner once', async () => {
    const s = setup(new UploadPostError('Username not associated with any profile', 400))
    s.post('youtube')
    const r = await s.engage.sync({ force: true })
    expect(s.own.list).toBe(1)
    expect(r.added).toBe(1)
    expect(r.problems).toEqual([])
    expect(s.alerts.filter((a) => /took over/.test(a[0]))).toHaveLength(1)
    await s.engage.sync({ force: true })
    expect(s.alerts.filter((a) => /took over/.test(a[0]))).toHaveLength(1) // not repeated within 6 hours
  })

  it('does not use ELO when Upload-Post works', async () => {
    const s = setup(null)
    s.post('youtube')
    await s.engage.sync({ force: true })
    expect(s.own.list).toBe(0)
  })

  it('a reply refused with a 4xx goes through ELO; an unsure answer does not', async () => {
    const refused = setup(new UploadPostError('no permission', 403))
    const a = refused.post('facebook')
    refused.env.db.prepare("INSERT INTO inbox_comments (brand_id, post_id, target_id, platform, comment_id, author, author_id, text, status, fetched_at_utc) VALUES (2, ?, ?, 'facebook', 'cm1', 'fan', '1', 'hi', 'new', ?)").run(a.id, a.t, new Date().toISOString())
    const row = refused.env.db.prepare('SELECT id FROM inbox_comments').get() as { id: number }
    await refused.engage.reply(row.id, 'thanks')
    expect(refused.own.reply).toHaveLength(1)

    const unsure = setup(new UploadPostError('timed out', 0))
    const b = unsure.post('facebook')
    unsure.env.db.prepare("INSERT INTO inbox_comments (brand_id, post_id, target_id, platform, comment_id, author, author_id, text, status, fetched_at_utc) VALUES (2, ?, ?, 'facebook', 'cm1', 'fan', '1', 'hi', 'new', ?)").run(b.id, b.t, new Date().toISOString())
    const row2 = unsure.env.db.prepare('SELECT id FROM inbox_comments').get() as { id: number }
    await expect(unsure.engage.reply(row2.id, 'thanks')).rejects.toThrow()
    expect(unsure.own.reply).toHaveLength(0)
  })
})

describe('Instagram messages backup', () => {
  it('sends through ELO only after a clear refusal', async () => {
    const refused = setup(new UploadPostError('refused', 400))
    await refused.engage.dmSend(2, 'u1', 'hello')
    expect(refused.own.dmSend).toHaveLength(1)
    const unsure = setup(new UploadPostError('boom', 502))
    await expect(unsure.engage.dmSend(2, 'u1', 'hello')).rejects.toThrow()
    expect(unsure.own.dmSend).toHaveLength(0)
  })

  it('reads conversations through ELO when Upload-Post fails', async () => {
    const s = setup(new UploadPostError('nope', 500))
    const out = await s.engage.dms(true)
    expect(s.own.dmList).toBe(1)
    expect(out[0].problem).toBeNull()
  })
})

describe('First comments backup', () => {
  it('Facebook and Bluesky: ELO posts the comment after a clear Upload-Post refusal', async () => {
    const s = setup(new UploadPostError('Username not associated with any profile', 400))
    const fb = s.post('facebook')
    const bs = s.post('bluesky')
    await s.fc.sweep()
    s.env.clock.ms += 3 * MIN
    await s.fc.sweep()
    expect(s.own.comment.map((c) => c.platform).sort()).toEqual(['bluesky', 'facebook'])
    for (const t of [fb.t, bs.t]) {
      const j = s.env.db.prepare('SELECT status, last_error FROM first_comment_jobs WHERE target_id = ?').get(t) as any
      expect(j.status).toBe('done')
      expect(j.last_error).toMatch(/ELO's own login posted it/)
    }
    expect(s.alerts.some((a) => /took over/.test(a[0]))).toBe(true)
  })

  it('never uses ELO after an unsure answer, even when retries run out', async () => {
    const s = setup(new UploadPostError('timed out', 0))
    s.post('facebook')
    for (let i = 0; i < 8; i++) {
      await s.fc.sweep()
      s.env.clock.ms += 20 * MIN
    }
    expect(s.own.comment).toHaveLength(0)
  })
})
