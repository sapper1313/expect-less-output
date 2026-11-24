import { describe, expect, it } from 'vitest'
import { AmazonLists, amazonLink, cleanProducts, type ListFile } from '../src/main/pipeline/amazonLists'
import { pipelineSetup } from './pipelineHelpers'

const PICKS = [
  { asin: 'B0TEST0001', name: 'Phone stand', note: 'Holds the phone so the video stays steady.' },
  { asin: 'b0test0002', name: 'Cable tidy', note: 'Keeps the charger from tangling.' },
]

function setup(live = true) {
  const t = pipelineSetup({ patch: { inboxAutoScheduleBrandIds: [], amazonListsLive: live } })
  const files: ListFile[] = []
  let fail = false
  const amazon = new AmazonLists({
    db: t.env.db,
    publishList: async (f) => {
      if (fail) throw new Error('GitHub is down')
      files.push(f)
    },
    log: (level, m, o) => t.env.log.log(level, m, o),
  })
  t.env.posts.afterCreate = (id, p) => amazon.attach(id, p)
  const brand = t.env.db.prepare("SELECT id FROM brands WHERE slug = 'trash-panda'").get() as { id: number }
  t.env.db
    .prepare('INSERT OR REPLACE INTO website_profiles (brand_id, add_to_site, site_slug) VALUES (?, 1, ?)')
    .run(brand.id, 'trash-panda')
  return { t, amazon, files, brandId: brand.id, failNext: () => (fail = true) }
}

describe('amazon lists', () => {
  it('checks the picks and builds the one allowed link shape', () => {
    expect(cleanProducts(PICKS).map((p) => p.asin)).toEqual(['B0TEST0001', 'B0TEST0002'])
    expect(cleanProducts([PICKS[0], PICKS[0]])).toHaveLength(1)
    expect(() => cleanProducts([{ asin: 'short', name: 'x', note: '' }])).toThrow(/ASIN/)
    expect(() => cleanProducts(Array(6).fill(PICKS[0]))).toThrow(/at most 5/)
    expect(amazonLink('B0TEST0001', 'josh-20')).toBe('https://www.amazon.com/dp/B0TEST0001?tag=josh-20')
  })

  it('a bot drop with picks makes the list file and adds the lines to the text and first comment', async () => {
    const s = setup()
    s.amazon.saveChannel(s.brandId, { tag: 'josh-20' })
    s.t.drop('Trash Panda', 'trash-panda', 1, { products: PICKS, first_comment: 'Which one first?' })
    await s.t.settle()
    const post = s.t.env.posts.list().find((p) => p.episodeRef)!
    expect(post.listState).toBe('published')
    expect(s.files).toHaveLength(1)
    expect(s.files[0].episodeId).toBe('trash-panda-2026-0001')
    expect(s.files[0].products[0].url).toBe('https://www.amazon.com/dp/B0TEST0001?tag=josh-20')
    const listUrl = 'https://expectlessmedia.com/lists/trash-panda-2026-0001/'
    expect(post.caption).toContain('As an Amazon Associate I earn from qualifying purchases.')
    // Clickable form for a long video, the bio page for a Short. Either way the text names where to go.
    expect(post.caption.includes(listUrl) || post.caption.includes('expectlessmedia.com/trash-panda/resources/')).toBe(true)
    expect(post.firstComment).toContain('Which one first?')
    expect(post.firstComment).toContain('Amazon Associate')
  })

  it('a failed page never holds the post and leaves its text alone', async () => {
    const s = setup()
    s.amazon.saveChannel(s.brandId, { tag: 'josh-20' })
    s.failNext()
    s.t.drop('Trash Panda', 'trash-panda', 2, { products: PICKS })
    await s.t.settle()
    const post = s.t.env.posts.list().find((p) => p.episodeRef)!
    expect(post.listState).toBe('failed')
    expect(post.listError).toMatch(/GitHub is down/)
    expect(post.caption).not.toContain('Amazon Associate')
    expect(post.status).not.toBe('failed')
  })

  it('waits while the switch is off or the channel has no tracking id, then catches up', async () => {
    const s = setup(false)
    s.t.drop('Trash Panda', 'trash-panda', 3, { products: PICKS })
    await s.t.settle()
    let post = s.t.env.posts.list().find((p) => p.episodeRef)!
    expect(post.listState).toBe('waiting')
    expect(post.products).toHaveLength(2)
    expect(post.caption).not.toContain('Amazon Associate')
    s.t.env.settings.set({ amazonListsLive: true })
    expect(s.amazon.blockedReason(s.brandId)).toMatch(/tracking id/)
    s.amazon.saveChannel(s.brandId, { tag: 'josh-20' })
    await s.amazon.catchUp()
    post = s.t.env.posts.list().find((p) => p.episodeRef)!
    expect(post.listState).toBe('published')
    expect(post.caption).toContain('Amazon Associate')
    // Running it again does not add the lines twice.
    await s.amazon.apply(post.id)
    const again = s.t.env.posts.list().find((p) => p.episodeRef)!
    expect(again.caption.match(/Amazon Associate/g)).toHaveLength(1)
  })

  it('a 24/7 stream channel never carries lists', async () => {
    const s = setup()
    s.amazon.saveChannel(s.brandId, { tag: 'josh-20' })
    s.t.env.db.prepare('UPDATE channel_rules SET always_on = 1 WHERE brand_id = ?').run(s.brandId)
    expect(s.amazon.blockedReason(s.brandId)).toMatch(/24\/7/)
  })
})
