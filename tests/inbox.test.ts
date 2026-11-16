import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { InboxWatcher } from '../src/main/agent/inbox'
import type { AgentServices } from '../src/main/agent/core'
import { makeEnv } from './helpers'

const SEC = 1000

function setup(patch: Record<string, unknown> = { inboxBrandIds: [1] }, fetchImpl?: typeof fetch) {
  const env = makeEnv()
  env.settings.set(patch as never)
  const services: AgentServices = {
    settings: env.settings,
    brands: env.brands,
    posts: env.posts,
    scheduler: env.scheduler,
    log: env.log,
    appVersion: 't',
    now: () => env.clock.ms,
    health: () => null,
  }
  const alerts: string[][] = []
  const watcher = new InboxWatcher({
    s: services,
    library: env.library,
    alert: (h, d) => alerts.push([h, d]),
    now: () => env.clock.ms,
    fetch: fetchImpl,
  })
  const inbox = join(env.root, 'Trash Panda', 'Inbox')
  mkdirSync(join(inbox, 'Rejected'), { recursive: true })
  const drop = (name: string, sidecar?: unknown, text = 'fake video bytes') => {
    writeFileSync(join(inbox, name), text)
    if (sidecar !== undefined)
      writeFileSync(
        join(inbox, name.replace(/\.[^.]+$/, '') + '.json'),
        typeof sidecar === 'string' ? sidecar : JSON.stringify(sidecar),
      )
  }
  /** Looks, waits until the file counts as finished, looks again. */
  const settle = async () => {
    await watcher.scan()
    env.clock.ms += 6 * SEC
    return watcher.scan()
  }
  return { env, watcher, alerts, inbox, drop, settle }
}

describe('watched Inbox folder', () => {
  it('turns a video with a sidecar into the post the sidecar describes, and moves both files into Queue', async () => {
    const t = setup()
    t.drop('fridge.mp4', {
      title: 'Fridge Math',
      caption: 'Do the math #funny',
      platforms: ['instagram', 'tiktok'],
      caption_overrides: { instagram: 'IG version' },
      ai_flags: { instagram: true },
      thumb_offset_ms: 900,
    })
    expect(await t.settle()).toBe(1)
    const [post] = t.env.posts.list()
    expect(post).toMatchObject({
      title: 'Fridge Math',
      caption: 'Do the math #funny',
      status: 'draft',
      brandId: 1,
    })
    expect(post.targets.map((x) => [x.platform, x.captionOverride, x.aiFlag])).toEqual([
      ['instagram', 'IG version', true],
      ['tiktok', null, false],
    ])
    expect(post.targets[0].settings.thumbOffsetMs).toBe(900)
    // the video AND the sidecar are in Queue, and the Inbox is empty (nothing deleted, everything moved)
    expect(post.videoPath).toMatch(/^Trash Panda\/Queue\/fridge\.mp4$/)
    expect(existsSync(join(t.env.root, 'Trash Panda', 'Queue', 'fridge.json'))).toBe(true)
    expect(readdirSync(t.inbox).filter((f) => f !== 'Rejected')).toEqual([])
    expect(
      t.env.log
        .list({ limit: 10 })
        .some((l) => l.message.includes('Agent (inbox): created draft post "Fridge Math"')),
    ).toBe(true)
  })

  it('creates a draft from the brand defaults when there is no sidecar, after a short wait for one', async () => {
    const t = setup()
    t.drop('my_new-clip.mov')
    await t.watcher.scan()
    t.env.clock.ms += 6 * SEC
    expect(await t.watcher.scan()).toBe(0) // finished copying, but still waiting for a sidecar
    t.env.clock.ms += 30 * SEC
    expect(await t.watcher.scan()).toBe(0) // a bot may take half a minute to write the sidecar
    t.env.clock.ms += 60 * SEC
    expect(await t.watcher.scan()).toBe(1)
    const [post] = t.env.posts.list()
    expect(post).toMatchObject({ title: 'My New Clip', status: 'draft' })
    expect(post.targets.map((x) => x.platform).sort()).toEqual([
      'facebook',
      'instagram',
      'tiktok',
      'youtube',
    ])
    expect(post.caption).toBe('My New Clip')
  })

  it('a sidecar that shows up during the wait is used', async () => {
    const t = setup()
    t.drop('late.mp4')
    await t.watcher.scan()
    t.env.clock.ms += 6 * SEC
    await t.watcher.scan()
    writeFileSync(join(t.inbox, 'late.json'), JSON.stringify({ title: 'From Sidecar' }))
    t.env.clock.ms += 1 * SEC
    expect(await t.watcher.scan()).toBe(1)
    expect(t.env.posts.list()[0].title).toBe('From Sidecar')
  })

  it('waits while a file is still growing', async () => {
    const t = setup()
    t.drop('big.mp4', { title: 'Big' }, 'a')
    await t.watcher.scan()
    t.env.clock.ms += 6 * SEC
    writeFileSync(join(t.inbox, 'big.mp4'), 'aaaaaaaaaaaaaaaaaaaa') // grew
    expect(await t.watcher.scan()).toBe(0)
    t.env.clock.ms += 3 * SEC
    expect(await t.watcher.scan()).toBe(0)
    t.env.clock.ms += 3 * SEC
    expect(await t.watcher.scan()).toBe(1)
  })

  it('moves a bad sidecar to Rejected with an explanation, alerts once, and never loses the video', async () => {
    const t = setup()
    t.drop('bad.mp4', '{ not json')
    t.drop('wrongfields.mp4', { title: 'X', platforms: ['myspace'], surprise: 1 })
    await t.settle()
    await t.settle()
    const rejected = join(t.inbox, 'Rejected')
    expect(readdirSync(rejected).sort()).toEqual([
      'bad.error.txt',
      'bad.json',
      'bad.mp4',
      'wrongfields.error.txt',
      'wrongfields.json',
      'wrongfields.mp4',
    ])
    expect(readFileSync(join(rejected, 'bad.error.txt'), 'utf8')).toContain('not valid JSON')
    expect(readFileSync(join(rejected, 'wrongfields.error.txt'), 'utf8')).toContain('platforms')
    expect(t.env.posts.list()).toHaveLength(0)
    expect(t.alerts.map((a) => a[0])).toEqual([
      'An Inbox file was not accepted.',
      'An Inbox file was not accepted.',
    ])
    await t.settle()
    expect(t.alerts).toHaveLength(2) // nothing repeats
  })

  it('does not let a sidecar schedule while agents are drafts-only, and does not quietly make it a draft', async () => {
    const t = setup()
    t.drop('sched.mp4', { status: 'scheduled', next_slot: true })
    await t.settle()
    expect(t.env.posts.list()).toHaveLength(0)
    const rejected = readdirSync(join(t.inbox, 'Rejected'))
    expect(rejected).toContain('sched.mp4')
    expect(readFileSync(join(t.inbox, 'Rejected', 'sched.error.txt'), 'utf8')).toContain(
      'limited to drafts',
    )
  })

  it('schedules from a sidecar when agents may schedule', async () => {
    const t = setup({ inboxBrandIds: [1], agentMaySchedule: true })
    const expected = t.env.posts.nextSlots(1, 1)[0]
    t.drop('go.mp4', { status: 'scheduled', next_slot: true })
    await t.settle()
    const [post] = t.env.posts.list()
    expect(post.status).toBe('scheduled')
    expect(post.scheduledAtUtc).toBe(expected)
  })

  it('schedules a bare video when the brand is set to automatic', async () => {
    const t = setup({ inboxBrandIds: [1], inboxAutoScheduleBrandIds: [1], agentMaySchedule: true })
    const expected = t.env.posts.nextSlots(1, 1)[0]
    writeFileSync(join(t.inbox, 'bare.mp4'), 'video bytes')
    await t.settle()
    t.env.clock.ms += 100 * SEC // the wait for a sidecar that never comes
    await t.watcher.scan()
    const [post] = t.env.posts.list()
    expect(post.status).toBe('scheduled')
    expect(post.scheduledAtUtc).toBe(expected)
  })

  it('automatic scheduling keeps an explicit draft and does nothing while drafts only', async () => {
    const on = setup({ inboxBrandIds: [1], inboxAutoScheduleBrandIds: [1], agentMaySchedule: true })
    on.drop('keep.mp4', { status: 'draft' })
    await on.settle()
    expect(on.env.posts.list()[0].status).toBe('draft')

    const locked = setup({
      inboxBrandIds: [1],
      inboxAutoScheduleBrandIds: [1],
      agentMaySchedule: false,
    })
    writeFileSync(join(locked.inbox, 'bare.mp4'), 'video bytes')
    await locked.settle()
    locked.env.clock.ms += 100 * SEC
    await locked.watcher.scan()
    expect(locked.env.posts.list()[0].status).toBe('draft')
  })

  it('rejects a sidecar that names another brand', async () => {
    const t = setup()
    t.drop('other.mp4', { brand_id: 2, title: 'Nope' })
    await t.settle()
    expect(t.env.posts.list()).toHaveLength(0)
    expect(readFileSync(join(t.inbox, 'Rejected', 'other.error.txt'), 'utf8')).toContain(
      'this is the Trash Panda Inbox',
    )
  })

  it('ignores brands that are not switched on, and files that are not videos', async () => {
    const off = setup({ inboxBrandIds: [] })
    off.drop('x.mp4', { title: 'x' })
    await off.settle()
    expect(off.env.posts.list()).toHaveLength(0)
    expect(existsSync(join(off.inbox, 'x.mp4'))).toBe(true) // untouched

    const on = setup()
    writeFileSync(join(on.inbox, 'notes.txt'), 'hello')
    writeFileSync(join(on.inbox, 'photo.png'), 'x')
    await on.settle()
    expect(readdirSync(on.inbox).sort()).toEqual(['Rejected', 'notes.txt', 'photo.png'])
  })

  it('does not create a second post when it looks again, and keeps two files with the same name apart', async () => {
    const t = setup()
    t.drop('same.mp4', { title: 'One' })
    await t.settle()
    await t.settle()
    expect(t.env.posts.list()).toHaveLength(1)
    t.drop('same.mp4', { title: 'Two' })
    await t.settle()
    const posts = t.env.posts.list()
    expect(posts.map((p) => p.title).sort()).toEqual(['One', 'Two'])
    expect(new Set(posts.map((p) => p.videoPath)).size).toBe(2)
  })

  describe('video_url', () => {
    const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64)])
    function withFetch(respond: (url: string) => Response | Promise<Response>) {
      const urls: string[] = []
      const t = setup({ inboxBrandIds: [1] }, (async (u: string) => {
        urls.push(u)
        return respond(u)
      }) as unknown as typeof fetch)
      /** Looks, waits, looks again, then more so the downloaded video is accepted. */
      const run = async () => {
        for (let i = 0; i < 4; i++) {
          await t.watcher.scan()
          t.env.clock.ms += 6 * SEC
        }
      }
      const sidecar = (name: string, body: unknown) =>
        writeFileSync(join(t.inbox, `${name}.json`), JSON.stringify(body))
      return { ...t, urls, run, sidecar }
    }

    it('downloads the video into Queue as <name>.mp4 and makes the post the sidecar describes', async () => {
      const t = withFetch(
        () => new Response(MP4, { status: 200, headers: { 'content-length': String(MP4.length) } }),
      )
      t.sidecar('fromurl', {
        video_url: 'https://cdn.example.com/v.mp4?token=secret',
        title: 'From The Web',
        caption: 'Hello #web',
        platforms: ['instagram'],
      })
      await t.run()
      expect(t.urls).toEqual(['https://cdn.example.com/v.mp4?token=secret'])
      const [post] = t.env.posts.list()
      expect(post).toMatchObject({ title: 'From The Web', caption: 'Hello #web', status: 'draft' })
      expect(post.videoPath).toBe('Trash Panda/Queue/fromurl.mp4')
      expect(readFileSync(join(t.env.root, post.videoPath)).equals(MP4)).toBe(true)
      expect(existsSync(join(t.env.root, 'Trash Panda', 'Queue', 'fromurl.json'))).toBe(true)
      expect(readdirSync(t.inbox)).toEqual(['Rejected'])
    })

    it('schedules from scheduled_at exactly like a dropped video', async () => {
      const t = withFetch(() => new Response(MP4))
      const cfg = { inboxBrandIds: [1], agentMaySchedule: true }
      t.env.settings.set(cfg as never)
      const when = '2099-01-05T17:00:00-05:00'
      t.sidecar('later', { video_url: 'https://x.example/v.mp4', status: 'scheduled', scheduled_at: when })
      await t.run()
      const [post] = t.env.posts.list()
      expect(post.status).toBe('scheduled')
      expect(post.scheduledAtUtc).toBe('2099-01-05T22:00:00.000Z')
    })

    it('rejects the sidecar with an .error.txt when the download fails, without leaking the address', async () => {
      const t = withFetch(() => new Response('nope', { status: 404 }))
      t.sidecar('gone', { video_url: 'https://cdn.example.com/missing.mp4?token=secret' })
      await t.run()
      const rejected = join(t.inbox, 'Rejected')
      expect(readdirSync(rejected).sort()).toEqual(['gone.error.txt', 'gone.json'])
      const why = readFileSync(join(rejected, 'gone.error.txt'), 'utf8')
      expect(why).toContain('404')
      expect(why).not.toContain('secret')
      expect(t.env.posts.list()).toHaveLength(0)
      expect(t.alerts).toHaveLength(1)
      expect(t.urls).toHaveLength(1) // not retried forever
    })

    it('rejects an incomplete download and one that is not a video, leaving no partial file', async () => {
      const short = withFetch(
        () => new Response(MP4, { status: 200, headers: { 'content-length': String(MP4.length + 100) } }),
      )
      short.sidecar('short', { video_url: 'https://x.example/a.mp4' })
      await short.run()
      expect(readFileSync(join(short.inbox, 'Rejected', 'short.error.txt'), 'utf8')).toContain('stopped early')

      const html = withFetch(() => new Response('<html>sign in</html>'))
      html.sidecar('page', { video_url: 'https://x.example/page' })
      await html.run()
      expect(readFileSync(join(html.inbox, 'Rejected', 'page.error.txt'), 'utf8')).toContain('not an MP4')

      for (const t of [short, html]) {
        expect(readdirSync(t.inbox)).toEqual(['Rejected'])
        expect(t.env.posts.list()).toHaveLength(0)
      }
    })

    it('rejects an address that is not http or https', async () => {
      const t = withFetch(() => new Response(MP4))
      t.sidecar('local', { video_url: 'file:///etc/passwd' })
      await t.run()
      expect(t.urls).toHaveLength(0)
      expect(readFileSync(join(t.inbox, 'Rejected', 'local.error.txt'), 'utf8')).toContain('http or https')
    })

    it('uses a dropped video instead of the URL, and leaves a .json without video_url alone', async () => {
      const t = withFetch(() => new Response(MP4))
      t.drop('both.mp4', { video_url: 'https://x.example/v.mp4', title: 'Dropped' })
      t.sidecar('plain', { title: 'No video here' })
      await t.run()
      expect(t.urls).toHaveLength(0)
      expect(t.env.posts.list().map((p) => p.title)).toEqual(['Dropped'])
      expect(existsSync(join(t.inbox, 'plain.json'))).toBe(true)
    })
  })

  it('puts a moved video back in the Inbox if saving the post fails', async () => {
    const t = setup()
    t.drop('rollback.mp4', { title: 'x', platforms: ['facebook'] })
    // make the account look unusable at the very last step
    t.env.db
      .prepare(
        "UPDATE accounts SET mode='live', status='needs_reauth' WHERE brand_id=1 AND platform='facebook'",
      )
      .run()
    await t.settle()
    expect(existsSync(join(t.env.root, 'Trash Panda', 'Queue', 'rollback.mp4'))).toBe(false)
    expect(existsSync(join(t.inbox, 'Rejected', 'rollback.mp4'))).toBe(true)
  })
})
