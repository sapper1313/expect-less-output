import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../src/main/db'
import { seedIfEmpty } from '../src/main/db/seed'
import { WebsiteService } from '../src/main/website/service'
import { formatChannels, matchEntry, type SiteEntry } from '../src/shared/website'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function entry(slug: string, name: string, n: number, extra: Partial<SiteEntry> = {}): SiteEntry {
  return {
    slug,
    number: n,
    name,
    status: 'live',
    host: 'Host',
    tagline: 'Tag',
    description: 'Desc',
    youtubeChannelId: 'UC' + n,
    youtubeHandle: '@' + slug,
    feeds: ['shorts', 'long'],
    links: { youtube: `https://www.youtube.com/@${slug}` },
    accent: '#112233',
    heroImage: `/brand/${slug}.png`,
    cadence: '',
    ...extra,
  }
}

describe('matchEntry', () => {
  const entries = [
    entry('trash-panda-money', 'Trash Panda Money', 1),
    entry('the-math-of-it', 'The Math of It with Ms. Cross', 4),
    entry('wonder-hollow-workshop', 'Wonder Hollow Workshop', 5),
    entry('clock-out-early', 'Clock Out Early', 2),
  ]
  it('finds the card when the slugs differ by extra words or a leading the', () => {
    expect(matchEntry({ slug: 'trash-panda', name: 'Trash Panda' }, entries)?.slug).toBe(
      'trash-panda-money',
    )
    expect(matchEntry({ slug: 'math-of-it', name: 'The Math of It' }, entries)?.slug).toBe(
      'the-math-of-it',
    )
    expect(
      matchEntry({ slug: 'wonder-hollow', name: 'Wonder Hollow Workshop' }, entries)?.slug,
    ).toBe('wonder-hollow-workshop')
    expect(matchEntry({ slug: 'clock-out-early', name: 'x' }, entries)?.slug).toBe(
      'clock-out-early',
    )
  })
  it('finds nothing for a channel the site does not have', () => {
    expect(
      matchEntry({ slug: 'mia-chloe', name: "Mia & Chloe's Mega Builds" }, entries),
    ).toBeUndefined()
  })
})

describe('formatChannels', () => {
  it('keeps short string lists on one line like the site formatter', () => {
    const text = formatChannels([entry('a', 'A', 1)])
    expect(text).toContain('"feeds": ["shorts", "long"]')
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)[0].slug).toBe('a')
  })
})

describe('WebsiteService with a real git repository', () => {
  let root: string
  let origin: string
  let svc: WebsiteService
  let db: Database.Database
  let ids: Record<string, number>
  const notices: string[][] = []

  const channelsAtOrigin = (): SiteEntry[] => {
    const check = join(root, 'check-' + Math.random().toString(36).slice(2))
    git(root, 'clone', '-q', origin, check)
    return JSON.parse(readFileSync(join(check, 'src/data/channels.json'), 'utf8')) as SiteEntry[]
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'elo-web-'))
    origin = join(root, 'origin.git')
    git(root, 'init', '-q', '--bare', '-b', 'main', origin)
    const seed = join(root, 'seed')
    git(root, 'clone', '-q', origin, seed)
    git(seed, 'config', 'user.name', 'T')
    git(seed, 'config', 'user.email', 't@t')
    mkdirSync(join(seed, 'src/data'), { recursive: true })
    mkdirSync(join(seed, 'public/brand'), { recursive: true })
    writeFileSync(
      join(seed, 'src/data/channels.json'),
      formatChannels([
        entry('trash-panda-money', 'Trash Panda Money', 1),
        entry('clock-out-early', 'Clock Out Early', 2),
        entry('the-math-of-it', 'The Math of It with Ms. Cross', 4),
      ]),
    )
    writeFileSync(join(seed, 'public/brand/trash-panda-money.png'), 'png')
    git(seed, 'add', '-A')
    git(seed, 'commit', '-q', '-m', 'seed')
    git(seed, 'push', '-q', 'origin', 'HEAD:main')

    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db)
    seedIfEmpty(db)
    ids = Object.fromEntries(
      (db.prepare('SELECT id, slug FROM brands').all() as Array<{ id: number; slug: string }>).map(
        (b) => [b.slug, b.id],
      ),
    )
    db.prepare(
      "INSERT INTO brands (name, color, slug) VALUES ('Mia & Chloe''s Mega Builds', '#ff8800', 'mia-chloe')",
    ).run()
    ids['mia-chloe'] = Number(
      (db.prepare("SELECT id FROM brands WHERE slug = 'mia-chloe'").get() as { id: number }).id,
    )
    notices.length = 0
    svc = new WebsiteService({
      db,
      repoDir: join(root, 'clone'),
      heroDir: join(root, 'heroes'),
      syncDelayMs: 1_000_000,
      notify: (h, d) => notices.push([h, d]),
    })
    svc.setConfig({ repoUrl: origin, autoPublish: false })
  })

  it('pull fills ELO from the site and changes nothing on the site', async () => {
    const r = await svc.pull()
    expect(r.ok).toBe(true)
    const p = svc.profile(ids['trash-panda'])
    expect(p.addToSite).toBe(true)
    expect(p.siteSlug).toBe('trash-panda-money')
    expect(p.tagline).toBe('Tag')
    expect(p.heroImage).toBe('/brand/trash-panda-money.png')
    expect(p.missing).toEqual([])
    expect(p.dirty).toBe(false)
    expect(svc.profile(ids['math-of-it']).title).toBe('The Math of It with Ms. Cross')
    expect(channelsAtOrigin()).toHaveLength(3)
    expect(svc.heroPreview(ids['trash-panda'])).toMatch(/^data:image\/png;base64,/)
  })

  it('publish with no edits leaves the site alone', async () => {
    const before = git(origin, 'rev-parse', 'main')
    const r = await svc.publish()
    expect(r.ok).toBe(true)
    expect(r.message).toMatch(/already matches/)
    expect(git(origin, 'rev-parse', 'main')).toBe(before)
  })

  it('an edit in ELO changes only that card and keeps unknown fields', async () => {
    await svc.pull()
    svc.saveProfile(ids['clock-out-early'], { tagline: 'New tagline' })
    expect(svc.status().waiting).toBe(1)
    const r = await svc.publish()
    expect(r.updated).toEqual(['Clock Out Early'])
    const at = channelsAtOrigin()
    expect(at.find((e) => e.slug === 'clock-out-early')?.tagline).toBe('New tagline')
    expect(at.find((e) => e.slug === 'trash-panda-money')?.tagline).toBe('Tag')
    expect(at.find((e) => e.slug === 'clock-out-early')?.feeds).toEqual(['shorts', 'long'])
    expect(svc.status().waiting).toBe(0)
  })

  it('a new channel needs its fields, then goes up with its picture', async () => {
    await svc.pull()
    const mia = ids['mia-chloe']
    svc.saveProfile(mia, { addToSite: true, siteSlug: 'mia-chloe' })
    let r = await svc.publish()
    expect(r.skipped[0]?.name).toMatch(/Mia/)
    expect(r.skipped[0]?.why).toMatch(/tagline/)
    expect(channelsAtOrigin()).toHaveLength(3)

    const pic = join(root, 'pic.png')
    writeFileSync(pic, 'picture')
    svc.setHero(mia, pic)
    svc.saveProfile(mia, {
      title: "Mia & Chloe's Mega Builds",
      host: 'Mia and Chloe',
      tagline: 'Big builds',
      description: 'Two sisters build big things.',
      youtubeChannelId: 'UCmia',
      links: { tiktok: 'https://www.tiktok.com/@mia' },
    })
    r = await svc.publish()
    expect(r.added).toEqual([expect.stringMatching(/Mia/)])
    const at = channelsAtOrigin()
    const e = at.find((x) => x.slug === 'mia-chloe')!
    expect(e.number).toBe(5)
    expect(e.status).toBe('live')
    expect(e.heroImage).toBe('/brand/mia-chloe-hero.png')
    expect(e.links.tiktok).toBe('https://www.tiktok.com/@mia')
    expect(e.links.youtube).toBe('https://www.youtube.com/channel/UCmia')
    const check = join(root, 'check2')
    git(root, 'clone', '-q', origin, check)
    expect(existsSync(join(check, 'public/brand/mia-chloe-hero.png'))).toBe(true)
    expect(svc.profile(mia).heroPending).toBe(false)
  })

  it('archiving a channel takes it off the site', async () => {
    await svc.pull()
    db.prepare('UPDATE brands SET archived = 1 WHERE id = ?').run(ids['clock-out-early'])
    const r = await svc.publish()
    expect(r.removed).toEqual(['Clock Out Early'])
    expect(channelsAtOrigin().map((e) => e.slug)).toEqual(['trash-panda-money', 'the-math-of-it'])
  })

  it('unticking the check mark takes it off the site', async () => {
    await svc.pull()
    svc.saveProfile(ids['trash-panda'], { addToSite: false })
    const r = await svc.publish()
    expect(r.removed).toEqual(['Trash Panda'])
    expect(channelsAtOrigin().map((e) => e.slug)).not.toContain('trash-panda-money')
  })

  it('refuses to remove more than two cards at once', async () => {
    await svc.pull()
    for (const s of ['trash-panda', 'clock-out-early', 'math-of-it'])
      db.prepare('UPDATE brands SET archived = 1 WHERE id = ?').run(ids[s])
    const before = git(origin, 'rev-parse', 'main')
    const r = await svc.publish()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/looks wrong|That looks wrong/i)
    expect(git(origin, 'rev-parse', 'main')).toBe(before)
    expect(notices).toHaveLength(1)
  })

  it('retries when someone else pushed first', async () => {
    await svc.pull()
    const other = join(root, 'other')
    git(root, 'clone', '-q', origin, other)
    git(other, 'config', 'user.name', 'T')
    git(other, 'config', 'user.email', 't@t')
    writeFileSync(join(other, 'src/data/videos.json'), '[]')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', 'videos')
    git(other, 'push', '-q', 'origin', 'HEAD:main')
    svc.saveProfile(ids['clock-out-early'], { tagline: 'Again' })
    const r = await svc.publish()
    expect(r.ok).toBe(true)
    expect(channelsAtOrigin().find((e) => e.slug === 'clock-out-early')?.tagline).toBe('Again')
  })

  it('says it plainly when the repository cannot be reached', async () => {
    svc.setConfig({ repoUrl: 'git@github.com:nobody/none.git' })
    const bad = new WebsiteService({
      db,
      repoDir: join(root, 'clone2'),
      heroDir: join(root, 'heroes'),
      git: async () => {
        throw new Error('git@github.com: Permission denied (publickey).')
      },
    })
    const r = await bad.pull()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/did not accept this Mac/)
    expect(bad.status().lastError).toMatch(/did not accept/)
  })

  it('validates the web address name and links', () => {
    expect(() => svc.saveProfile(ids['clock-out-early'], { siteSlug: 'Bad Name' })).toThrow(
      /lowercase/,
    )
    expect(() =>
      svc.saveProfile(ids['clock-out-early'], { links: { tiktok: 'http://x' } }),
    ).toThrow(/https/)
    expect(() => svc.saveProfile(ids['clock-out-early'], { accent: 'red' })).toThrow(/color/)
  })
})
