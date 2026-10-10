import { z } from 'zod'
import type { Db } from '../db'
import type { LlmGateway } from './agents/llm'
import type { CompetitorView, CompetitorVideo, TitleLabResult, TrendVideo } from '@shared/studio/research'

/** What the research tools need from YouTube. The real one is YoutubeClient. */
export interface ResearchYoutube {
  searchVideos(accountId: number, q: string, max?: number): Promise<Array<{ id: string; title: string; channel: string; publishedAt: string | null; views: number | null }>>
  channelWithRecent(accountId: number, handleOrId: string, recent?: number): Promise<{ id: string; title: string; subscribers: number | null; videos: CompetitorVideo[] } | null>
  trending(accountId: number, categoryId: string, max?: number): Promise<TrendVideo[]>
}

export interface ResearchDeps {
  db: Db
  gateway: LlmGateway
  youtube: () => ResearchYoutube | null
  /** The connected YouTube account to ask with, for a channel. */
  accountFor: (brandId: number) => number | null
  categoryFor: (brandId: number) => string
  mock: () => boolean
  brandName: (id: number) => string
  bibleText: (brandId: number) => string
  addIdeas: (brandId: number, texts: string[]) => void
  fetchImpl?: typeof fetch
  now?: () => number
}

const Titles = z.object({
  titles: z.array(z.object({ title: z.string(), why: z.string() })).default([]),
  tags: z.array(z.string()).default([]),
})
const Angles = z.object({ ideas: z.array(z.string()).default([]) })

const MOCK_SUGGESTIONS = (q: string) => [`${q} for beginners`, `${q} tips`, `${q} explained`, `${q} mistakes`, `${q} in one minute`]

/** Title and keyword research, competitor watching and trends. Free to use except where a button says it costs YouTube quota. */
export class Research {
  constructor(private d: ResearchDeps) {}
  private now() {
    return this.d.now ? this.d.now() : Date.now()
  }
  private iso() {
    return new Date(this.now()).toISOString()
  }

  /** What people type into YouTube search for this topic. Free, needs no login. */
  async suggestions(q: string): Promise<string[]> {
    if (this.d.mock()) return MOCK_SUGGESTIONS(q)
    try {
      const res = await (this.d.fetchImpl ?? fetch)(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) return []
      const j = (await res.json()) as [string, string[]]
      return (j[1] ?? []).slice(0, 10)
    } catch {
      return []
    }
  }

  private account(brandId: number): number {
    const id = this.d.accountFor(brandId)
    if (id === null) throw new Error('Connect YouTube for this channel first (Channels, Connections).')
    return id
  }

  async titleLab(brandId: number, topic: string, includeTop: boolean): Promise<TitleLabResult> {
    const q = topic.trim()
    if (q.length < 3) throw new Error('Type a topic first, at least 3 letters.')
    const suggestions = await this.suggestions(q)
    let topVideos: TitleLabResult['topVideos'] = []
    let note = ''
    if (includeTop) {
      if (this.d.mock()) topVideos = [{ title: `${q}: the 3 things nobody tells you`, channel: 'Example channel', views: 120_000 }]
      else {
        const yt = this.d.youtube()
        if (!yt) note = 'YouTube is not connected, so top videos were skipped.'
        else {
          const found = await yt.searchVideos(this.account(brandId), q, 8)
          topVideos = found.map((v) => ({ title: v.title, channel: v.channel, views: v.views }))
        }
      }
    }
    const name = this.d.brandName(brandId)
    const out = await this.d.gateway.json(
      {
        agent: 'Title Lab',
        brandId,
        system: [
          `You help name videos for the channel "${name}". Use the channel bible for voice, and follow its do and don't lists.`,
          'Write 8 title options, each under 70 characters, each with one short reason it should get clicks. Do not copy any title you are shown. Also give 12 tags.',
          'Plain words, never use em dashes. Answer only with JSON: {"titles":[{"title":"","why":""}],"tags":[""]}.',
          `Channel bible:\n${this.d.bibleText(brandId).slice(0, 5000)}`,
        ].join('\n'),
        user: [`Topic: ${q}`, suggestions.length ? `What people search for: ${suggestions.join('; ')}` : '', topVideos.length ? `Top videos on this topic now (for inspiration only): ${topVideos.map((v) => `"${v.title}" (${v.views ?? '?'} views)`).join('; ')}` : ''].filter(Boolean).join('\n'),
        maxTokens: 2500,
      },
      Titles,
    )
    return { topic: q, suggestions, topVideos, titles: out.titles.slice(0, 10), tags: out.tags.slice(0, 15), note }
  }

  // ---------- competitors ----------

  private view(r: { id: number; brand_id: number; handle: string; title: string; subscribers: number | null; videos_json: string; checked_utc: string | null }): CompetitorView {
    const videos = JSON.parse(r.videos_json) as CompetitorVideo[]
    const withViews = videos.filter((v) => v.views !== null)
    return { id: r.id, brandId: r.brand_id, handle: r.handle, title: r.title, subscribers: r.subscribers, checkedUtc: r.checked_utc, videos, averageViews: withViews.length ? Math.round(withViews.reduce((n, v) => n + (v.views ?? 0), 0) / withViews.length) : null }
  }

  competitors(brandId: number): CompetitorView[] {
    return (this.d.db.prepare('SELECT * FROM competitors WHERE brand_id = ? ORDER BY id').all(brandId) as never[]).map((r) => this.view(r))
  }

  async addCompetitor(brandId: number, input: string): Promise<CompetitorView[]> {
    const handle = input.trim().replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/\/.*$/, '')
    if (!handle) throw new Error('Paste a channel handle like @somechannel or its web address.')
    this.d.db.prepare('INSERT OR IGNORE INTO competitors (brand_id, handle, created_utc) VALUES (?, ?, ?)').run(brandId, handle, this.iso())
    await this.refreshCompetitors(brandId)
    return this.competitors(brandId)
  }

  removeCompetitor(id: number): void {
    this.d.db.prepare('DELETE FROM competitors WHERE id = ?').run(id)
  }

  async refreshCompetitors(brandId: number): Promise<CompetitorView[]> {
    const rows = this.d.db.prepare('SELECT id, handle FROM competitors WHERE brand_id = ?').all(brandId) as Array<{ id: number; handle: string }>
    for (const r of rows) {
      let got: { id: string; title: string; subscribers: number | null; videos: CompetitorVideo[] } | null
      if (this.d.mock())
        got = { id: 'UCmock', title: r.handle.replace(/^@/, ''), subscribers: 48_000, videos: [{ id: 'm1', title: 'A video that did very well', publishedAt: this.iso(), views: 90_000 }, { id: 'm2', title: 'An ordinary video', publishedAt: this.iso(), views: 9_000 }, { id: 'm3', title: 'Another ordinary video', publishedAt: this.iso(), views: 7_500 }] }
      else {
        const yt = this.d.youtube()
        if (!yt) throw new Error('YouTube is not connected.')
        got = await yt.channelWithRecent(this.account(brandId), r.handle, 10)
      }
      if (!got) throw new Error(`YouTube has no channel called ${r.handle}.`)
      this.d.db.prepare('UPDATE competitors SET channel_id = ?, title = ?, subscribers = ?, videos_json = ?, checked_utc = ? WHERE id = ?').run(got.id, got.title, got.subscribers, JSON.stringify(got.videos), this.iso(), r.id)
    }
    return this.competitors(brandId)
  }

  // ---------- trends ----------

  trends(brandId: number): { videos: TrendVideo[]; fetchedUtc: string | null } {
    const r = this.d.db.prepare('SELECT videos_json, fetched_utc FROM trend_cache WHERE brand_id = ?').get(brandId) as { videos_json: string; fetched_utc: string } | undefined
    return r ? { videos: JSON.parse(r.videos_json) as TrendVideo[], fetchedUtc: r.fetched_utc } : { videos: [], fetchedUtc: null }
  }

  async refreshTrends(brandId: number): Promise<{ videos: TrendVideo[]; fetchedUtc: string | null }> {
    let videos: TrendVideo[]
    if (this.d.mock()) videos = [{ id: 't1', title: 'Everyone is talking about this', channel: 'Trending channel', views: 2_400_000 }]
    else {
      const yt = this.d.youtube()
      if (!yt) throw new Error('YouTube is not connected.')
      videos = await yt.trending(this.account(brandId), this.d.categoryFor(brandId), 12)
    }
    this.d.db.prepare('INSERT INTO trend_cache (brand_id, videos_json, fetched_utc) VALUES (?, ?, ?) ON CONFLICT(brand_id) DO UPDATE SET videos_json = excluded.videos_json, fetched_utc = excluded.fetched_utc').run(brandId, JSON.stringify(videos), this.iso())
    return this.trends(brandId)
  }

  /** Fresh episode angles from what rivals and the trends are doing, added to the idea bank. */
  async ideasFromResearch(brandId: number): Promise<string[]> {
    const comp = this.competitors(brandId).flatMap((c) => c.videos.slice(0, 6).map((v) => `"${v.title}" (${v.views ?? '?'} views, ${c.title})`))
    const trend = this.trends(brandId).videos.slice(0, 8).map((v) => `"${v.title}" (${v.views ?? '?'} views)`)
    if (!comp.length && !trend.length) throw new Error('Add a competitor or fetch trends first, so there is something to learn from.')
    const out = await this.d.gateway.json(
      {
        agent: 'Title Lab',
        brandId,
        system: [`You suggest fresh episode ideas for the channel "${this.d.brandName(brandId)}". Learn from what is working elsewhere, but never copy a title or an idea. Fit the channel bible.`, 'Give 8 ideas, one short line each. Never use em dashes. Answer only with JSON: {"ideas":[""]}.', `Channel bible:\n${this.d.bibleText(brandId).slice(0, 4000)}`].join('\n'),
        user: `Rival videos: ${comp.join('; ') || 'none'}\nTrending: ${trend.join('; ') || 'none'}`,
        maxTokens: 1500,
      },
      Angles,
    )
    const ideas = out.ideas.map((s) => s.trim()).filter(Boolean).slice(0, 8)
    this.d.addIdeas(brandId, ideas)
    return ideas
  }
}
