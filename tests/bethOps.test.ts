import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { BotStore } from '../src/main/agent/bots'
import { handleAgentRequest } from '../src/main/agent/server'
import type { AgentServices } from '../src/main/agent/core'
import { pipelineSetup, sha } from './pipelineHelpers'

const TP = 'Trash Panda'

async function rig(
  opts: { patch?: Record<string, unknown>; probe?: (p: string) => Promise<any> } = {},
) {
  const t = pipelineSetup({
    live: [[1, 'youtube']],
    patch: opts.patch,
    probe:
      opts.probe ??
      (async () => ({ width: 1080, height: 1920, durationSeconds: 40, hasAudio: true })),
  })
  t.drop(TP, 'trash-panda', 301)
  await t.settle()
  const post = t.env.posts.list()[0]
  const bots = new BotStore(t.env.db, () => t.env.clock.ms)
  const beth = bots.create('beth', ['*'], 'orchestrator')
  const grok = bots.create('grok-bot', ['trash-panda'], 'writer')
  const notices: string[][] = []
  const s: AgentServices = {
    settings: t.env.settings,
    brands: t.env.brands,
    posts: t.env.posts,
    scheduler: t.env.scheduler,
    log: t.env.log,
    appVersion: 't',
    now: () => t.env.clock.ms,
    health: () => null,
    audit: t.audit,
    bots,
    drops: t.drops,
    library: t.env.library,
    intake: t.pipeline,
    notifyOwner: (h, d) => notices.push([h, d]),
  }
  const call = (token: string, method: string, path: string, body?: unknown) =>
    handleAgentRequest(s, () => 'owner', {
      method,
      url: path,
      headers: {
        host: '127.0.0.1:1',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? '' : JSON.stringify(body),
      port: 1,
    })
  const dir = mkdtempSync(join(tmpdir(), 'elo-beth-'))
  const newVideo = (name: string, text: string) => {
    const p = join(dir, name)
    writeFileSync(p, text)
    return p
  }
  return { t, post, beth, grok, call, notices, newVideo }
}

describe('beth: every channel, now and later', () => {
  it('the migration gives the existing beth token all channels', async () => {
    const r = await rig()
    r.t.env.db.prepare("UPDATE agent_bots SET channels_json = '[]' WHERE name = 'beth'").run()
    const sql = readFileSync(
      join(__dirname, '../src/main/db/migrations/026_beth_all_channels_dismiss.sql'),
      'utf8',
    )
    r.t.env.db.exec(sql.split(';')[0] + ';')
    expect(
      r.beth.bot &&
        r.t.env.db.prepare("SELECT channels_json FROM agent_bots WHERE name = 'beth'").get(),
    ).toEqual({ channels_json: '["*"]' })
  })

  it('works on a channel made after the token, and other bots stay limited', async () => {
    const r = await rig()
    const nb = r.t.env.brands.create('Mia Chloe', '#112233')
    expect(nb.slug).toBe('mia-chloe')
    const p = await r.t.env.makePost({
      brandId: nb.id,
      whenMs: r.t.env.clock.ms + 86_400_000,
      title: 'On the new channel',
    })
    expect((await r.call(r.beth.token, 'POST', `/v1/posts/${p.id}/cancel`)).status).toBe(200)
    const q = await r.t.env.makePost({
      brandId: nb.id,
      whenMs: r.t.env.clock.ms + 2 * 86_400_000,
      title: 'Another',
    })
    expect((await r.call(r.grok.token, 'POST', `/v1/posts/${q.id}/cancel`)).status).toBe(403)
    expect(
      r.t.audit.list().some((e) => e.action === 'api.denied' && e.actor === 'agent:grok-bot'),
    ).toBe(true)
  })
})

describe('beth: remove a post before it posts, then drop the fixed video', () => {
  it('cancels, keeps the files, tells the owner, and the same episode id can be dropped again', async () => {
    const r = await rig()
    const slot = r.post.scheduledAtUtc
    const res = await r.call(r.beth.token, 'POST', `/v1/posts/${r.post.id}/cancel`)
    expect(res.status).toBe(200)
    expect((res.body as any).status).toBe('canceled')
    expect(existsSync(r.t.env.library.resolve(r.post.videoPath))).toBe(true)
    expect(r.notices[0][0]).toMatch(/beth removed a post/)
    expect(r.t.drops.forPost(r.post.id)!.notes).toMatch(/Removed by agent:beth/)
    expect(r.t.audit.list().some((e) => e.action === 'post.removed')).toBe(true)
    // the fixed video comes in under the same id and takes the freed slot
    r.t.drop(TP, 'trash-panda', 301, {}, { bytes: 'the fixed video bytes' })
    await r.t.settle()
    const again = r.t.env.posts
      .list()
      .find((p) => p.episodeRef === 'trash-panda-2026-0301' && p.status !== 'canceled')!
    expect(again.status).toBe('scheduled')
    expect(again.scheduledAtUtc).toBe(slot)
  })

  it('refuses when a platform already has the video', async () => {
    const r = await rig()
    r.t.env.db
      .prepare(
        "UPDATE post_targets SET status = 'handed_off', external_id = 'abc' WHERE post_id = ?",
      )
      .run(r.post.id)
    const res = await r.call(r.beth.token, 'POST', `/v1/posts/${r.post.id}/cancel`)
    expect(res.status).toBe(409)
    expect((res.body as any).error.message).toMatch(/only the owner can take it down/)
    expect(r.t.env.posts.get(r.post.id)!.status).toBe('scheduled')
  })
})

describe('beth: edit', () => {
  it('edits words, and a writer bot may not edit at all', async () => {
    const r = await rig()
    const ok = await r.call(r.beth.token, 'PATCH', `/v1/posts/${r.post.id}`, {
      title: 'Fixed title',
      caption: 'Fixed caption',
    })
    expect(ok.status).toBe(200)
    expect(r.t.env.posts.get(r.post.id)).toMatchObject({
      title: 'Fixed title',
      caption: 'Fixed caption',
      scheduledAtUtc: r.post.scheduledAtUtc,
    })
    expect(r.notices.some((n) => /beth edited a post/.test(n[0]))).toBe(true)
    expect(

      (await r.call(r.grok.token, 'PATCH', `/v1/posts/${r.post.id}`, { title: 'x' })).status,
    ).toBe(403)
  })
})

describe('beth: replace the media and keep the slot', () => {
  it('swaps the video, title and description; the slot stays, the old file moves to Replaced, the safety check still passes', async () => {
    const r = await rig()
    const file = r.newVideo('replacement.mp4', 'a brand new video')
    const res = await r.call(r.beth.token, 'POST', `/v1/posts/${r.post.id}/media`, {
      file_path: file,
      checksum: sha('a brand new video'),
      title: 'Fixed title',
      description: 'Fixed description #fix',
    })
    expect(res.status).toBe(200)
    const b = res.body as any
    expect(b).toMatchObject({
      status: 'scheduled',
      scheduled_at: r.post.scheduledAtUtc,
      title: 'Fixed title',
      sha256: sha('a brand new video'),
      old_sha256: r.post.checksum,
    })
    expect(b.old_file_moved_to).toContain('Replaced')
    expect(existsSync(r.t.env.library.resolve(b.old_file_moved_to))).toBe(true)
    const after = r.t.env.posts.get(r.post.id)!
    expect(after.caption).toBe('Fixed description #fix')
    expect(after.fileName).toContain('trash-panda-2026-0301')
    const { verifyPipelinePost } = await import('../src/main/pipeline/verify')
    expect(await verifyPipelinePost(r.t.env.db, r.t.env.library, r.post.id)).toBeNull()
    expect(r.notices.some((n) => /beth changed a scheduled post/.test(n[0]))).toBe(true)
    expect(r.t.audit.list().some((e) => e.action === 'post.replace_media')).toBe(true)
  })

  it('refuses a wrong checksum, the same video, a duplicate, a video that does not fit, and a non-beth bot', async () => {
    const r = await rig({
      probe: async (p: string) =>
        p.includes('wide')
          ? { width: 1920, height: 1080, durationSeconds: 40, hasAudio: true }
          : { width: 1080, height: 1920, durationSeconds: 40, hasAudio: true },
    })
    const url = `/v1/posts/${r.post.id}/media`
    expect(
      (
        await r.call(r.beth.token, 'POST', url, {
          file_path: r.newVideo('a.mp4', 'one'),
          checksum: 'f'.repeat(64),
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await r.call(r.beth.token, 'POST', url, {
          file_path: r.newVideo('b.mp4', `video bytes for trash-panda-2026-0301`),
        })
      ).status,
    ).toBe(409)
    expect(
      (await r.call(r.beth.token, 'POST', url, { file_path: r.newVideo('wide.mp4', 'wide one') }))
        .status,
    ).toBe(400)
    expect((await r.call(r.beth.token, 'POST', url, {})).status).toBe(400)
    expect((await r.call(r.grok.token, 'POST', url, { title: 'x' })).status).toBe(403)
    // a duplicate of another post on the channel
    r.t.drop(TP, 'trash-panda', 302, {}, { bytes: 'second video' })
    await r.t.settle()
    expect(
      (await r.call(r.beth.token, 'POST', url, { file_path: r.newVideo('c.mp4', 'second video') }))
        .status,
    ).toBe(409)
  })

  it('refuses when a platform has it, when it posts in under 2 minutes, and obeys drafts only', async () => {
    const r = await rig()
    const url = `/v1/posts/${r.post.id}/media`
    const file = r.newVideo('d.mp4', 'fresh video')
    r.t.env.settings.set({ agentMaySchedule: false })
    expect((await r.call(r.beth.token, 'POST', url, { file_path: file })).status).toBe(403)
    r.t.env.settings.set({ agentMaySchedule: true })
    r.t.env.db
      .prepare('UPDATE posts SET scheduled_at_utc = ? WHERE id = ?')
      .run(new Date(r.t.env.clock.ms + 60_000).toISOString(), r.post.id)
    expect((await r.call(r.beth.token, 'POST', url, { file_path: file })).status).toBe(409)
    r.t.env.db
      .prepare('UPDATE posts SET scheduled_at_utc = ? WHERE id = ?')
      .run(new Date(r.t.env.clock.ms + 3_600_000).toISOString(), r.post.id)
    r.t.env.db
      .prepare("UPDATE post_targets SET status = 'uploading' WHERE post_id = ?")
      .run(r.post.id)
    expect((await r.call(r.beth.token, 'POST', url, { file_path: file })).status).toBe(409)
  })

  it('swaps the video on a partial post: posted platforms stay, failed ones start fresh', async () => {
    const r = await rig()
    const url = `/v1/posts/${r.post.id}/media`
    const ids = (
      r.t.env.db.prepare('SELECT id FROM post_targets WHERE post_id = ? ORDER BY id').all(r.post.id) as {
        id: number
      }[]
    ).map((x) => x.id)
    r.t.env.db
      .prepare(
        "INSERT INTO post_targets (post_id, platform, account_id, status) SELECT post_id, 'bluesky', account_id, 'pending' FROM post_targets WHERE post_id = ? LIMIT 1",
      )
      .run(r.post.id)
    ids.push(
      (r.t.env.db.prepare('SELECT MAX(id) m FROM post_targets').get() as { m: number }).m,
    )
    r.t.env.db
      .prepare("UPDATE post_targets SET status = 'posted', external_id = 'yt1' WHERE id = ?")
      .run(ids[0])
    r.t.env.db
      .prepare(
        "UPDATE post_targets SET status = 'failed', settings_json = ? WHERE id = ?",
      )
      .run(JSON.stringify({ igContainerId: 'c1', igUploaded: false }), ids[1])
    r.t.env.posts.recomputeStatus(r.post.id)
    const res = await r.call(r.beth.token, 'POST', url, {
      file_path: r.newVideo('fixed.mp4', 'fixed encode'),
      checksum: sha('fixed encode'),
    })
    expect(res.status).toBe(200)
    const rows = r.t.env.db
      .prepare('SELECT id, status, external_id, settings_json FROM post_targets WHERE id IN (?, ?)')
      .all(ids[0], ids[1]) as any[]
    expect(rows.find((x) => x.id === ids[0])).toMatchObject({ status: 'posted', external_id: 'yt1' })
    expect(JSON.parse(rows.find((x) => x.id === ids[1]).settings_json)).toEqual({})
    expect(r.t.env.posts.get(r.post.id)!.checksum).toBe(sha('fixed encode'))
  })

  it('a words-only change keeps the file and the slot', async () => {
    const r = await rig()
    const res = await r.call(r.beth.token, 'POST', `/v1/posts/${r.post.id}/media`, {
      title: 'Only the title',
      description: 'Only words',
    })
    expect(res.status).toBe(200)
    expect(r.t.env.posts.get(r.post.id)).toMatchObject({
      title: 'Only the title',
      caption: 'Only words',
      checksum: r.post.checksum,
      scheduledAtUtc: r.post.scheduledAtUtc,
    })
    expect(vi.isMockFunction(r.t.env.posts.update)).toBe(false)
  })
})

describe('who counts as the operator', () => {
  it('an orchestrator bot with any name may fix posts, a writer named something else may not', async () => {
    const r = await rig()
    const { BotStore: Store } = await import('../src/main/agent/bots')
    const bots = new Store(r.t.env.db, () => r.t.env.clock.ms)
    const shared = bots.create('elo-beth-grok', ['*'], 'orchestrator')
    const writer = bots.create('some-writer', ['*'], 'writer')
    expect(
      (
        await r.call(shared.token, 'POST', `/v1/posts/${r.post.id}/media`, {
          title: 'By the shared token',
        })
      ).status,
    ).toBe(200)
    expect(
      (await r.call(writer.token, 'POST', `/v1/posts/${r.post.id}/media`, { title: 'Nope' }))
        .status,
    ).toBe(403)
  })
})

describe('beth: change times, stop, create and replace', () => {
  it('moves a post to an exact time or one platform alone, and sends it back to draft', async () => {
    const r = await rig({ patch: { agentMaySchedule: true } })
    const when = '2026-10-21T21:17:00-04:00'
    const moved = await r.call(r.beth.token, 'PATCH', `/v1/posts/${r.post.id}`, { scheduled_at: when })
    expect(moved.status).toBe(200)
    expect((moved.body as any).scheduled_at).toBe('2026-10-22T01:17:00.000Z')
    const one = await r.call(r.beth.token, 'PATCH', `/v1/posts/${r.post.id}`, { platform_times: { youtube: '2026-10-22T08:00:00-04:00' } })
    expect(one.status).toBe(200)
    expect((one.body as any).targets.find((t: any) => t.platform === 'youtube').scheduled_at).toBe('2026-10-22T12:00:00.000Z')
    const draft = await r.call(r.beth.token, 'PATCH', `/v1/posts/${r.post.id}`, { status: 'draft', scheduled_at: null })
    expect(draft.status).toBe(200)
    expect((draft.body as any).status).toBe('draft')
    // a writer bot still cannot
    expect((await r.call(r.grok.token, 'PATCH', `/v1/posts/${r.post.id}`, { scheduled_at: when })).status).toBe(403)
  })

  it('refuses a time in the past and keeps the drafts only switch', async () => {
    const r = await rig({ patch: { agentMaySchedule: true } })
    const late = await r.call(r.beth.token, 'PATCH', `/v1/posts/${r.post.id}`, { platform_times: { youtube: '2020-01-01T08:00:00-04:00' } })
    expect(late.status).toBe(400)
    r.t.env.settings.set({ agentMaySchedule: false })
    const blocked = await r.call(r.beth.token, 'PATCH', `/v1/posts/${r.post.id}`, { scheduled_at: '2026-10-23T08:00:00-04:00' })
    expect(blocked.status).toBe(403)
  })

  it('creates a post: first open slot when no time is given, the exact time when one is, and only for orchestrators', async () => {
    const r = await rig({ patch: { agentMaySchedule: true } })
    const file = r.newVideo('new.mp4', 'brand new video bytes')
    const first = await r.call(r.beth.token, 'POST', '/v1/posts', { brand_id: 1, file_path: file, platforms: ['youtube'], status: 'scheduled' })
    expect(first.status).toBe(201)
    expect((first.body as any).scheduled_at).toBe(r.t.env.posts.list().find((p) => p.id === (first.body as any).id)!.scheduledAtUtc)
    const file2 = r.newVideo('new2.mp4', 'another new video')
    const exact = await r.call(r.beth.token, 'POST', '/v1/posts', { brand_id: 1, file_path: file2, platforms: ['youtube'], status: 'scheduled', scheduled_at: '2026-10-25T21:17:00-04:00' })
    expect(exact.status).toBe(201)
    expect((exact.body as any).scheduled_at).toBe('2026-10-26T01:17:00.000Z')
    expect(r.notices.some((n) => /beth created a post/.test(n[0]))).toBe(true)
    const file3 = r.newVideo('new3.mp4', 'third new video')
    expect((await r.call(r.grok.token, 'POST', '/v1/posts', { brand_id: 1, file_path: file3, platforms: ['youtube'], status: 'draft' })).status).toBe(403)
  })

  it('stops a post that has not gone out and frees its slot for a replacement', async () => {
    const r = await rig({ patch: { agentMaySchedule: true } })
    const slot = r.post.scheduledAtUtc
    const stop = await r.call(r.beth.token, 'POST', `/v1/posts/${r.post.id}/cancel`)
    expect(stop.status).toBe(200)
    expect(r.t.env.posts.nextSlotsFor(1, 'youtube', 20, undefined, [], 'short')).toContain(slot)
  })
})
