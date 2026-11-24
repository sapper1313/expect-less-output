import { slotKindFor } from '@shared/slots'
import type { AmazonChannelSettings, ProductInput } from '@shared/types'
import type { Db } from '../db'
import { readSetting } from '../services/settings'

/** Amazon product lists. One code path for bot drops and the manual New Post page. */

export const MAX_PRODUCTS = 5
export const SITE_URL = 'https://expectlessmedia.com'
const ASIN_RE = /^[A-Z0-9]{10}$/
/** Associates tracking ids look like name-20. Letters, digits and dashes only. */
export const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,40}$/
export const DEFAULT_POINTER = 'Products from this video:'
export const DEFAULT_DISCLOSURE = 'As an Amazon Associate I earn from qualifying purchases.'

/** Checks the picks and tidies them. Throws a plain sentence for the first problem. */
export function cleanProducts(raw: unknown): ProductInput[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error('Products must be a list.')
  if (raw.length > MAX_PRODUCTS) throw new Error(`A video can have at most ${MAX_PRODUCTS} products.`)
  const seen = new Set<string>()
  const out: ProductInput[] = []
  raw.forEach((r, i) => {
    const n = i + 1
    const asin = String((r as ProductInput)?.asin ?? '').trim().toUpperCase()
    const name = String((r as ProductInput)?.name ?? '').replace(/\s+/g, ' ').trim()
    const note = String((r as ProductInput)?.note ?? '').replace(/\s+/g, ' ').trim()
    if (!ASIN_RE.test(asin)) throw new Error(`Product ${n}: the ASIN must be 10 letters and numbers.`)
    if (!name) throw new Error(`Product ${n}: add a short name.`)
    if (name.length > 70) throw new Error(`Product ${n}: the name is over 70 characters.`)
    if (note.length > 240) throw new Error(`Product ${n}: the note is over 240 characters.`)
    if (seen.has(asin)) return // the same product twice is shown once
    seen.add(asin)
    out.push({ asin, name, note })
  })
  return out
}

/** The one link shape Associates allows us to hand out: a plain product page with our tag. */
export function amazonLink(asin: string, tag: string): string {
  return `https://www.amazon.com/dp/${asin}?tag=${tag}`
}
const LINK_RE = /^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}\?tag=[A-Za-z0-9-]+$/

export const listUrlFor = (id: string) => `${SITE_URL}/lists/${id}/`
/** What a caption that cannot hold a link shows: the channel page people reach from the bio. */
export const resourcesShort = (siteSlug: string) => `expectlessmedia.com/${siteSlug}/resources/`

/** Platforms whose text turns a link into something you can tap. Shorts, Reels and TikTok captions do not. */
export function linkWorks(platform: string, kind: 'short' | 'long' | undefined): boolean {
  if (platform === 'bluesky') return true
  if (platform === 'youtube' || platform === 'facebook') return kind !== 'short'
  return false
}

export function block(s: AmazonChannelSettings, where: string): string {
  return `${s.pointer || DEFAULT_POINTER} ${where}\n${s.disclosure || DEFAULT_DISCLOSURE}`
}

/** Adds the block once. A text that already has this place in it is left alone. */
export function withBlock(text: string, s: AmazonChannelSettings, where: string): string {
  if (text.includes(where)) return text
  const body = text.trimEnd()
  return `${body}${body ? '\n\n' : ''}${block(s, where)}`
}

export type ListState = 'waiting' | 'published' | 'failed' | 'skipped'

export interface ListFile {
  episodeId: string
  channel: string
  title: string
  videoId: string | null
  createdAt: string
  products: Array<{ asin: string; name: string; note: string; url: string }>
}

export interface AmazonListsDeps {
  db: Db
  /** Writes the list file into the website project and pushes it. */
  publishList: (file: ListFile) => Promise<void>
  log: (level: 'info' | 'warn' | 'error', message: string, opts?: { postId?: number }) => void
  audit?: (action: string, target: string, after: unknown) => void
  emit?: () => void
  now?: () => number
}

interface PostRow {
  id: number
  brand_id: number
  title: string
  caption: string
  first_comment: string | null
  episode_ref: string | null
  video_meta_json: string
  products_json: string | null
  list_id: string | null
  list_state: string | null
  list_video_id: string | null
  scheduled_at_utc: string | null
  created_at: string
}

export class AmazonLists {
  constructor(private d: AmazonListsDeps) {}

  live(): boolean {
    return readSetting(this.d.db, 'amazonListsLive') === true
  }

  channel(brandId: number): AmazonChannelSettings {
    const r = this.d.db
      .prepare('SELECT amazon_tag, amazon_pointer, amazon_disclosure FROM channel_rules WHERE brand_id = ?')
      .get(brandId) as { amazon_tag: string; amazon_pointer: string; amazon_disclosure: string } | undefined
    return { tag: r?.amazon_tag ?? '', pointer: r?.amazon_pointer ?? '', disclosure: r?.amazon_disclosure ?? '' }
  }

  saveChannel(brandId: number, patch: Partial<AmazonChannelSettings>): AmazonChannelSettings {
    const next = { ...this.channel(brandId), ...patch }
    next.tag = next.tag.trim()
    if (next.tag && !TAG_RE.test(next.tag))
      throw new Error('A tracking id has letters, numbers and dashes only, like yourname-20.')
    this.d.db
      .prepare(
        `INSERT INTO channel_rules (brand_id, max_per_day, blackout_json, amazon_tag, amazon_pointer, amazon_disclosure)
         VALUES (?, 1, '[]', ?, ?, ?)
         ON CONFLICT(brand_id) DO UPDATE SET amazon_tag = excluded.amazon_tag, amazon_pointer = excluded.amazon_pointer,
           amazon_disclosure = excluded.amazon_disclosure`,
      )
      .run(brandId, next.tag, next.pointer.trim(), next.disclosure.trim())
    this.d.audit?.('amazon.channel', String(brandId), { tagSet: !!next.tag })
    this.d.emit?.()
    return next
  }

  /** The slug the website uses for this channel (its channel page address). */
  private siteSlug(brandId: number): string | null {
    const w = this.d.db
      .prepare('SELECT site_slug FROM website_profiles WHERE brand_id = ? AND add_to_site = 1')
      .get(brandId) as { site_slug: string | null } | undefined
    return w?.site_slug || null
  }

  /** True when the channel is marked as a 24/7 stream. */
  isStream(brandId: number): boolean {
    const r = this.d.db.prepare('SELECT always_on FROM channel_rules WHERE brand_id = ?').get(brandId) as
      | { always_on: number }
      | undefined
    return !!r?.always_on
  }

  /** Why a list cannot be made for this channel yet, in plain words. Null when it can. */
  blockedReason(brandId: number): string | null {
    return this.reasonOff(brandId)
  }

  private reasonOff(brandId: number): string | null {
    if (!this.live()) return 'Amazon lists are switched off.'
    if (!this.channel(brandId).tag) return 'This channel has no Amazon tracking id yet.'
    const rules = this.d.db.prepare('SELECT always_on FROM channel_rules WHERE brand_id = ?').get(brandId) as
      | { always_on: number }
      | undefined
    if (rules?.always_on) return 'A 24/7 stream channel does not carry Amazon lists.'
    if (!this.siteSlug(brandId)) return 'This channel is not on the website yet.'
    return null
  }

  /**
   * Called once a post exists, for a bot drop and for a manual post alike. Saves the picks, and when everything is
   * ready adds the lines to the text and sends the list page to the website. It never throws and never holds the post.
   */
  async attach(postId: number, products: ProductInput[]): Promise<void> {
    const picks = cleanProducts(products)
    if (picks.length === 0) return
    const post = this.row(postId)
    if (!post) return
    const brand = this.d.db.prepare('SELECT slug FROM brands WHERE id = ?').get(post.brand_id) as {
      slug: string | null
    }
    const id = (post.episode_ref ?? `${brand.slug ?? 'channel'}-manual-${post.id}`)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    this.d.db
      .prepare('UPDATE posts SET products_json = ?, list_id = ?, list_state = ?, list_error = NULL WHERE id = ?')
      .run(JSON.stringify(picks), id, 'waiting', postId)
    await this.apply(postId)
  }

  /** Does the work for a post that has picks. Safe to run again. */
  async apply(postId: number): Promise<void> {
    const post = this.row(postId)
    if (!post?.products_json || !post.list_id) return
    const off = this.reasonOff(post.brand_id)
    if (off) {
      this.set(postId, 'waiting', off)
      this.d.log('info', `Amazon list kept for later: ${off}`, { postId })
      return
    }
    try {
      const s = this.channel(post.brand_id)
      const siteSlug = this.siteSlug(post.brand_id) as string
      const picks = cleanProducts(JSON.parse(post.products_json))
      const products = picks.map((p) => ({ ...p, url: amazonLink(p.asin, s.tag) }))
      for (const p of products)
        if (!LINK_RE.test(p.url)) throw new Error(`The link for ${p.asin} is not in the allowed format.`)
      const file: ListFile = {
        episodeId: post.list_id,
        channel: siteSlug,
        title: post.title,
        videoId: post.list_video_id,
        createdAt: new Date(this.now()).toISOString(),
        products,
      }
      // The list page goes first. If it fails, the text stays as it was and the post goes out without the lines.
      await this.d.publishList(file)
      this.addLines(post, s, siteSlug)
      this.set(postId, 'published', null)
      this.d.audit?.('amazon.list', post.list_id, { postId, products: picks.length })
      this.d.log('info', `Amazon list page sent: ${post.list_id}.`, { postId })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.set(postId, 'failed', msg)
      this.d.log('error', `Amazon list page failed, the post goes out without it: ${msg}`, { postId })
    }
  }

  private now() {
    return (this.d.now ?? Date.now)()
  }

  private row(postId: number): PostRow | undefined {
    return this.d.db
      .prepare(
        `SELECT id, brand_id, title, caption, first_comment, episode_ref, video_meta_json, products_json, list_id,
                list_state, list_video_id, scheduled_at_utc, created_at FROM posts WHERE id = ?`,
      )
      .get(postId) as PostRow | undefined
  }

  private set(postId: number, state: ListState, error: string | null) {
    this.d.db.prepare('UPDATE posts SET list_state = ?, list_error = ? WHERE id = ?').run(state, error, postId)
    this.d.emit?.()
  }

  /** Puts the right line into the text of every platform, and into the first comment. */
  private addLines(post: PostRow, s: AmazonChannelSettings, siteSlug: string): void {
    const url = listUrlFor(post.list_id as string)
    const bio = resourcesShort(siteSlug)
    let kind: 'short' | 'long' | undefined
    try {
      kind = slotKindFor(JSON.parse(post.video_meta_json))
    } catch {
      kind = undefined
    }
    const placeFor = (platform: string) => (linkWorks(platform, kind) ? url : bio)
    const db = this.d.db
    // The shared text uses the form for the main platforms, and any platform that needs the other form gets its own copy.
    const baseWhere = kind === 'short' ? bio : url
    const targets = db
      .prepare('SELECT id, platform, caption_override FROM post_targets WHERE post_id = ?')
      .all(post.id) as Array<{ id: number; platform: string; caption_override: string | null }>
    db.transaction(() => {
      const original = post.caption
      db.prepare('UPDATE posts SET caption = ? WHERE id = ?').run(withBlock(original, s, baseWhere), post.id)
      for (const t of targets) {
        const want = placeFor(t.platform)
        const text = t.caption_override ?? original
        if (t.caption_override === null && want === baseWhere) continue
        db.prepare('UPDATE post_targets SET caption_override = ? WHERE id = ?').run(withBlock(text, s, want), t.id)
      }
      const first = post.first_comment
      if (first !== null && first.trim() !== '')
        db.prepare('UPDATE posts SET first_comment = ? WHERE id = ?').run(withBlock(first, s, baseWhere), post.id)
      else db.prepare('UPDATE posts SET first_comment = ? WHERE id = ?').run(block(s, baseWhere), post.id)
    })()
  }

  /** The owner flipped the switch, or set a tracking id. Catch up every post still waiting that has not gone out. */
  async catchUp(): Promise<number> {
    const rows = this.d.db
      .prepare(
        `SELECT id FROM posts WHERE products_json IS NOT NULL AND list_state IN ('waiting','failed')
           AND status IN ('draft','scheduled') ORDER BY id`,
      )
      .all() as Array<{ id: number }>
    for (const r of rows) await this.apply(r.id)
    return rows.length
  }

  /** After a video is live on YouTube, tell the list page its video id so the watch page can show the list. */
  async syncVideoIds(): Promise<number> {
    const rows = this.d.db
      .prepare(
        `SELECT p.id, t.external_id AS vid FROM posts p JOIN post_targets t ON t.post_id = p.id
         WHERE p.list_state = 'published' AND p.list_video_id IS NULL AND t.platform = 'youtube'
           AND t.status = 'posted' AND t.external_id IS NOT NULL`,
      )
      .all() as Array<{ id: number; vid: string }>
    let n = 0
    for (const r of rows) {
      this.d.db.prepare('UPDATE posts SET list_video_id = ? WHERE id = ?').run(r.vid, r.id)
      try {
        const post = this.row(r.id)
        if (!post?.products_json) continue
        const s = this.channel(post.brand_id)
        const siteSlug = this.siteSlug(post.brand_id)
        if (!siteSlug) continue
        await this.d.publishList({
          episodeId: post.list_id as string,
          channel: siteSlug,
          title: post.title,
          videoId: r.vid,
          createdAt: post.created_at.replace(' ', 'T').replace(/Z?$/, 'Z'),
          products: cleanProducts(JSON.parse(post.products_json)).map((p) => ({ ...p, url: amazonLink(p.asin, s.tag) })),
        })
        n++
      } catch (e) {
        this.d.db.prepare('UPDATE posts SET list_video_id = NULL WHERE id = ?').run(r.id)
        this.d.log('warn', `Could not add the video to its list page yet: ${e instanceof Error ? e.message : String(e)}`, {
          postId: r.id,
        })
      }
    }
    return n
  }
}
