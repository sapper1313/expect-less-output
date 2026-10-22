import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { BotStore } from '../src/main/agent/bots'
import { handleAgentRequest } from '../src/main/agent/server'
import type { AgentServices } from '../src/main/agent/core'
import { verifyPipelinePost } from '../src/main/pipeline/verify'
import { pipelineSetup } from './pipelineHelpers'

const TP = 'Trash Panda'
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 1),
])

async function rig(patch: Record<string, unknown> = {}) {
  const t = pipelineSetup({ live: [[1, 'youtube']], patch })
  t.drop(TP, 'trash-panda', 201)
  await t.settle()
  const post = t.env.posts.list()[0]
  const dir = mkdtempSync(join(tmpdir(), 'elo-thumb-'))
  const img = join(dir, 'new.png')
  writeFileSync(img, PNG)
  const bots = new BotStore(t.env.db, () => t.env.clock.ms)
  const beth = bots.create('beth', ['*'], 'orchestrator')
  const grok = bots.create('grok-bot', ['trash-panda'], 'writer')
  const youtubeThumbnail = vi.fn(async () => undefined)
  const youtubeEdit = vi.fn(async () => undefined)
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
    library: t.env.library,
    youtubeThumbnail,
    youtubeEdit,
  }
  const call = (token: string, id: number, body: unknown) =>
    handleAgentRequest(s, () => 'owner', {
      method: 'POST',
      url: `/v1/posts/${id}/thumbnail`,
      headers: {
        host: '127.0.0.1:1',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      port: 1,
    })
  const ytTarget = () => t.env.posts.get(post.id)!.targets.find((x) => x.platform === 'youtube')!
  return { t, post, img, dir, beth, grok, call, youtubeThumbnail, youtubeEdit, ytTarget }
}

describe('thumbnail route: who and what', () => {
  it('allows beth and the owner token, refuses any other bot, and audits the refusal', async () => {
    const r = await rig()
    expect((await r.call(r.grok.token, r.post.id, { image_path: r.img })).status).toBe(403)
    expect(
      r.t.audit.list().some((e) => e.action === 'api.denied' && e.actor === 'agent:grok-bot'),
    ).toBe(true)
    expect((await r.call(r.beth.token, r.post.id, { image_path: r.img })).status).toBe(200)
    expect((await r.call('owner', r.post.id, { image_path: r.img })).status).toBe(200)
    expect((await r.call(r.beth.token, r.post.id, {})).status).toBe(400)
    expect((await r.call(r.beth.token, 9999, { title: 'x' })).status).toBe(404)
  })

  it('checks the picture: absolute path, jpg or png, a real image, under 2 MB', async () => {
    const r = await rig()
    const big = join(r.dir, 'big.png')
    writeFileSync(big, Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024, 1)]))
    const fake = join(r.dir, 'fake.png')
    writeFileSync(fake, 'not a picture at all')
    const gif = join(r.dir, 'x.gif')
    writeFileSync(gif, PNG)
    for (const bad of ['relative.png', big, fake, gif, join(r.dir, 'missing.png')]) {
      const res = await r.call(r.beth.token, r.post.id, { image_path: bad })
      expect(res.status, bad).toBe(400)
    }
  })
})

describe('thumbnail route: not posted yet', () => {
  it('keeps the picture with the post for the upload, and changes the title without holding the post', async () => {
    const r = await rig()
    const res = await r.call(r.beth.token, r.post.id, {
      image_path: r.img,
      title: 'A better title',
    })
    expect(res.status).toBe(200)
    const body = res.body as any
    expect(body.title).toBe('A better title')
    expect(body.applied).toEqual([
      expect.objectContaining({ platform: 'youtube', how: 'saved_for_upload' }),
    ])
    expect(existsSync(body.saved_image)).toBe(true)
    expect(body.saved_image).toMatch(/Trash Panda\/Queue\/trash-panda-2026-0201_thumb\.png$/)
    expect(r.ytTarget().settings.thumbnailPath).toBe(body.saved_image)
    expect(r.t.env.posts.get(r.post.id)!.title).toBe('A better title')
    // the title change moves the bot-drop safeguard with it, so the post is not held
    expect(await verifyPipelinePost(r.t.env.db, r.t.env.library, r.post.id)).toBeNull()
    expect(r.youtubeThumbnail).not.toHaveBeenCalled()
    expect(r.t.audit.list().some((e) => e.action === 'post.thumbnail')).toBe(true)
  })

  it('a video already inside YouTube (handed off) gets thumbnails.set and a YouTube title update', async () => {
    const r = await rig()
    r.t.env.db
      .prepare("UPDATE post_targets SET status = 'handed_off', external_id = 'vid123' WHERE id = ?")
      .run(r.ytTarget().id)
    const res = await r.call(r.beth.token, r.post.id, {
      image_path: r.img,
      title: 'Handed off title',
    })
    expect(res.status).toBe(200)
    expect(r.youtubeThumbnail).toHaveBeenCalledWith(
      expect.any(Number),
      'vid123',
      expect.stringContaining('_thumb.png'),
    )
    expect(r.youtubeEdit).toHaveBeenCalledWith(expect.any(Number), 'vid123', {
      title: 'Handed off title',
    })
    expect((res.body as any).applied.map((a: any) => a.how).sort()).toEqual([
      'set_on_youtube',
      'title_updated_on_youtube',
    ])
  })

  it('stays in the drafts-only gate for posts that are not drafts', async () => {
    const r = await rig({ agentMaySchedule: false })
    // the post waits as a draft, so the gate allows it
    expect(r.post.status).toBe('draft')
    expect((await r.call(r.beth.token, r.post.id, { image_path: r.img })).status).toBe(200)
    r.t.env.db
      .prepare(
        "UPDATE posts SET status = 'scheduled', scheduled_at_utc = '2031-01-01T15:00:00Z' WHERE id = ?",
      )
      .run(r.post.id)
    const res = await r.call(r.beth.token, r.post.id, { image_path: r.img })
    expect(res.status).toBe(403)
    expect((res.body as any).error.code).toBe('drafts_only')
  })
})

describe('thumbnail route: already posted', () => {
  async function posted() {
    const r = await rig()
    r.t.env.db
      .prepare(
        "UPDATE post_targets SET status = 'posted', external_id = 'live99', external_url = 'https://youtu.be/live99' WHERE id = ?",
      )
      .run(r.ytTarget().id)
    r.t.env.db.prepare("UPDATE posts SET status = 'posted' WHERE id = ?").run(r.post.id)
    return r
  }

  it('calls thumbnails.set on the live video and refuses a title change', async () => {
    const r = await posted()
    const res = await r.call(r.beth.token, r.post.id, { image_path: r.img })
    expect(res.status).toBe(200)
    expect(r.youtubeThumbnail).toHaveBeenCalledWith(
      expect.any(Number),
      'live99',
      expect.any(String),
    )
    expect((res.body as any).applied[0].how).toBe('set_on_youtube')
    const t = await r.call(r.beth.token, r.post.id, { title: 'Too late' })
    expect(t.status).toBe(409)
    expect(r.youtubeEdit).not.toHaveBeenCalled()
  })

  it('tells the caller plainly when YouTube refuses', async () => {
    const r = await posted()
    r.youtubeThumbnail.mockRejectedValueOnce(new Error('The channel is not verified'))
    const res = await r.call(r.beth.token, r.post.id, { image_path: r.img })
    expect(res.status).toBe(502)
    expect((res.body as any).error.message).toMatch(
      /YouTube refused the thumbnail: The channel is not verified/,
    )
  })
})
