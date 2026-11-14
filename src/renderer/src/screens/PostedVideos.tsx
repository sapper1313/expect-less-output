import { PlatformName } from '../ui'
import { useEffect, useMemo, useState } from 'react'
import { PLATFORM_LABELS, type Platform } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { toCsv } from '@shared/csv'
import { formatEastern, localInputToIso } from '@shared/time'
import type { Post, PostStats, StatsNumbers } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { fmt } from '../components/StatsPanel'
import { PostEditor } from '../components/PostEditor'
import { useSort } from '../components/useSort'
import { ThemedHost } from '../components/ThemedHost'
import pageCss from '../dashboard/dashboard.css?inline'
import postedCss from '../dashboard/posted.css?inline'

const CSS = pageCss + postedCss

type Kind = 'Short' | 'Long form' | 'Clip' | ''
type Chip = { platform: Platform; url: string | null } & StatsNumbers
interface Row {
  key: string
  postId: number | null
  title: string
  fileName: string
  poster: string | null
  brandId: number
  brandName: string
  brandColor: string | null
  kind: Kind
  at: string
  chips: Chip[]
  hasComment: boolean
  outside: boolean
}

const NONE: StatsNumbers = { views: null, likes: null, comments: null, shares: null }
const DAY = 86_400_000

function kindOf(p: Post): Kind {
  if (p.postType === 'clip') return 'Clip'
  const { width, height } = p.videoMeta
  if (!width || !height) return ''
  return height >= width ? 'Short' : 'Long form'
}

function rowFromPost(p: Post, stats: PostStats | undefined): Row {
  const live = p.targets.filter((t) => t.status === 'posted')
  const times = live.map((t) => t.postedAtUtc).filter((x): x is string => !!x).sort()
  return {
    key: `p${p.id}`,
    postId: p.id,
    title: p.title || p.fileName,
    fileName: p.fileName,
    poster: p.posterUrl,
    brandId: p.brandId,
    brandName: p.brandName,
    brandColor: p.brandColor,
    kind: kindOf(p),
    at: times[0] ?? p.scheduledAtUtc ?? p.createdAt,
    chips: live.map((t) => {
      const n = stats?.targets.find((x) => x.platform === t.platform)?.latest ?? NONE
      return {
        platform: t.platform,
        url: t.externalUrl,
        views: n.views,
        likes: n.likes,
        comments: n.comments,
        shares: n.shares,
      }
    }),
    hasComment: live.some((t) => t.firstComment?.status === 'done'),
    outside: false,
  }
}

const sum = (chips: Chip[], k: keyof StatsNumbers): number | null => {
  const v = chips.map((c) => c[k]).filter((x): x is number => x !== null)
  return v.length ? v.reduce((a, b) => a + b, 0) : null
}

/** Every video that is live. Sort by clicking a heading. Filter by channel, platform, kind and date. */
export function PostedVideos() {
  const { toast } = useApp()
  const [outside, setOutside] = useState(false)
  const [brandId, setBrandId] = useState<number | null>(null)
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const [range, setRange] = useState<'7' | '30' | '90' | 'all' | 'custom'>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [sortBy, setSortBy] = useState<'posted' | 'views' | 'likes' | 'comments' | 'shares' | 'title'>('posted')
  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim().toLowerCase()), 200)
    return () => clearTimeout(t)
  }, [text])

  const { data: brands } = useLoad(() => api.brands.list())
  const { data: posts } = useLoad(() => api.posts.list({ status: 'live' }))
  const { data: stats } = useLoad(
    () => api.stats.forPosts((posts ?? []).map((p) => p.id)),
    [posts?.map((p) => p.id).join(',')],
  )
  const { data: imported } = useLoad(
    () => (outside ? api.stats.imported(null, 'all') : Promise.resolve([])),
    [outside],
  )

  const all: Row[] = useMemo(() => {
    const own = (posts ?? []).map((p) => rowFromPost(p, stats?.[p.id]))
    const out: Row[] = (imported ?? []).map((v) => ({
      key: `i${v.id}`,
      postId: null,
      title: v.title || '(no title)',
      fileName: '',
      poster: v.thumbnailUrl,
      brandId: v.brandId,
      brandName: v.brandName,
      brandColor: null,
      kind: '',
      at: v.publishedAt ?? '',
      chips: [{ platform: v.platform, url: v.url, ...(v.state === 'ok' ? v.numbers : NONE) }],
      hasComment: false,
      outside: true,
    }))
    return [...own, ...out]
  }, [posts, stats, imported])

  const fromMs = range === 'custom' ? (from ? Date.parse(localInputToIso(`${from}T00:00`) ?? '') : null) : null
  const toMs = range === 'custom' ? (to ? Date.parse(localInputToIso(`${to}T00:00`) ?? '') + DAY : null) : null
  const rows = useMemo(() => {
    const now = Date.now()
    return all
      .filter((r) => (brandId === null ? true : r.brandId === brandId))
      .filter((r) => (platform ? r.chips.some((c) => c.platform === platform) : true))
      .filter((r) => (kind === 'all' ? true : r.kind === kind))
      .filter((r) => {
        if (range === 'all') return true
        const t = Date.parse(r.at)
        if (Number.isNaN(t)) return false
        if (range === 'custom') return (fromMs === null || t >= fromMs) && (toMs === null || t < toMs)
        return t >= now - Number(range) * DAY
      })
      .filter((r) => (search ? `${r.title} ${r.fileName} ${r.brandName}`.toLowerCase().includes(search) : true))
      // With a platform picked, the numbers are that platform's own.
      .map((r) => (platform ? { ...r, chips: r.chips.filter((c) => c.platform === platform) } : r))
  }, [all, brandId, platform, kind, range, fromMs, toMs, search])

  const { sorted, th } = useSort(
    rows,
    {
      title: (r) => r.title.toLowerCase(),
      channel: (r) => r.brandName.toLowerCase(),
      kind: (r) => r.kind,
      posted: (r) => r.at,
      platform: (r) => r.chips.map((c) => PLATFORM_LABELS[c.platform]).sort()[0] ?? '',
      views: (r) => sum(r.chips, 'views') ?? -1,
      likes: (r) => sum(r.chips, 'likes') ?? -1,
      comments: (r) => sum(r.chips, 'comments') ?? -1,
      shares: (r) => sum(r.chips, 'shares') ?? -1,
    },
    'posted',
    { th: 'thc', btn: 'thbtn' },
  )

  const totals = useMemo(() => {
    const all4 = rows.flatMap((r) => r.chips)
    return {
      videos: rows.length,
      views: sum(all4, 'views'),
      likes: sum(all4, 'likes'),
      comments: sum(all4, 'comments'),
    }
  }, [rows])

  const platformsInUse = useMemo(
    () => [...new Set(all.flatMap((r) => r.chips.map((c) => c.platform)))].sort(),
    [all],
  )

  const cards = useMemo(() => {
    const out = [...rows]
    out.sort((a, b) =>
      sortBy === 'title'
        ? a.title.toLowerCase().localeCompare(b.title.toLowerCase())
        : sortBy === 'posted'
          ? b.at.localeCompare(a.at)
          : (sum(b.chips, sortBy) ?? -1) - (sum(a.chips, sortBy) ?? -1),
    )
    return out
  }, [rows, sortBy])

  return (
    <>
      <div className="h-full overflow-auto">
        <ThemedHost css={CSS}>
          <div className="page">
            <header className="top">
              <div>
                <div className="lab">Expect Less Output</div>
                <h1>{COPY.nav.posted}</h1>
              </div>
              <button
                type="button"
                className="btn glass"
                disabled={!sorted?.length}
                onClick={async () => {
                  const data = (sorted ?? []).map((r) => ({
                    Title: r.title,
                    Channel: r.brandName,
                    Kind: r.kind,
                    'Posted (Eastern)': r.at ? formatEastern(r.at, false) : '',
                    Platforms: r.chips.map((c) => PLATFORM_LABELS[c.platform]).join(' and '),
                    Views: sum(r.chips, 'views') ?? '',
                    Likes: sum(r.chips, 'likes') ?? '',
                    Comments: sum(r.chips, 'comments') ?? '',
                    Shares: sum(r.chips, 'shares') ?? '',
                    Source: r.outside ? 'Posted outside ELO' : 'Posted by ELO',
                    Links: r.chips.map((c) => c.url ?? '').filter(Boolean).join(' '),
                  }))
                  const path = await api.media.saveCsv(
                    `ELO posted videos ${new Date().toISOString().slice(0, 10)}.csv`,
                    toCsv(Object.keys(data[0] ?? { Title: '' }), data),
                  )
                  if (path) toast({ kind: 'success', headline: 'Saved.', detail: path })
                }}
              >
                Export CSV
              </button>
            </header>

            <div className="strip">
              {(
                [
                  ['Videos', totals.videos],
                  ['Views', totals.views],
                  ['Likes', totals.likes],
                  ['Comments', totals.comments],
                ] as const
              ).map(([cap, n]) => (
                <div key={cap} className="glass tile-btn static">
                  <div className="big">{fmt(n)}</div>
                  <div className="cap">{cap}</div>
                </div>
              ))}
            </div>

            <section className="glass filters">
              <input
                className="f"
                style={{ width: 240 }}
                placeholder="Search title or channel"
                aria-label="Search"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <select
                className="f"
                aria-label="Channel"
                value={brandId ?? ''}
                onChange={(e) => setBrandId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">All channels</option>
                {brands?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <select
                className="f"
                aria-label="Platform"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform | '')}
              >
                <option value="">All platforms</option>
                {platformsInUse.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </option>
                ))}
              </select>
              <select
                className="f"
                aria-label="Kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind | 'all')}
              >
                <option value="all">Shorts and long</option>
                <option value="Short">Shorts</option>
                <option value="Long form">Long form</option>
                <option value="Clip">Clips</option>
              </select>
              <select
                className="f"
                aria-label="Date range"
                value={range}
                onChange={(e) => setRange(e.target.value as typeof range)}
              >
                <option value="all">All time</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="custom">Pick dates</option>
              </select>
              {range === 'custom' && (
                <>
                  <input type="date" className="f" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
                  <input type="date" className="f" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
                </>
              )}
              <label className="check">
                <input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} />
                Include videos posted outside ELO
              </label>
              <select className="f" aria-label="Sort by" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                <option value="posted">Newest first</option>
                <option value="views">Most views</option>
                <option value="likes">Most likes</option>
                <option value="comments">Most comments</option>
                <option value="shares">Most shares</option>
                <option value="title">Title A to Z</option>
              </select>
              <span className="seg">
                <button type="button" className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')}>Cards</button>
                <button type="button" className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Compact table</button>
              </span>
            </section>

            {posts && sorted && sorted.length === 0 ? (
              <div className="glass card muted">
                No posted videos match.{' '}
                {outside ? '' : 'Tick Include videos posted outside ELO to add your older ones.'}
              </div>
            ) : view === 'cards' ? (
              <div className="pcards">
                {cards.map((r) => (
                  <article key={r.key} className={`glass pcard ${r.postId ? 'click' : ''}`} onClick={() => r.postId && setEditing(r.postId)}>
                    {r.poster ? <img src={r.poster} alt="" className="pthumb" /> : <div className="pthumb" />}
                    <div className="pmain">
                      <div className="pwho">
                        {r.brandColor && <span className="dot" style={{ background: r.brandColor }} />}
                        {r.brandName}
                        {r.kind && <span className="muted"> · {r.kind}</span>}
                      </div>
                      <div className="ptitle">
                        {r.title}
                        {r.kind === 'Clip' && <span className="tag clip">Clip</span>}
                        {r.outside && <span className="tag">Outside ELO</span>}
                        {r.hasComment && <span className="tag ok">comment added</span>}
                      </div>
                      <div className="pwhen">Posted {r.at ? formatEastern(r.at) : '-'}</div>
                      <div className="pplat" onClick={(e) => e.stopPropagation()}>
                        {r.chips.map((c) => {
                          const inner = (
                            <>
                              <PlatformName platform={c.platform} size={16} />
                              <span className="pn2">
                                {fmt(c.views)} views · {fmt(c.likes)} likes · {fmt(c.comments)} comments · {fmt(c.shares)} shares
                              </span>
                            </>
                          )
                          return c.url ? (
                            <a key={c.platform} className="ppill" href={c.url} target="_blank" rel="noreferrer" title={`Open on ${PLATFORM_LABELS[c.platform]}`}>
                              {inner}
                            </a>
                          ) : (
                            <span key={c.platform} className="ppill" title="No link saved for this one">
                              {inner}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                    <div className="pnums">
                      {(['views', 'likes', 'comments', 'shares'] as const).map((k) => (
                        <div key={k}>
                          <div className="pn">{fmt(sum(r.chips, k))}</div>
                          <div className="pc2">{k}</div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <section className="glass tbl-card scroll-x">
                <table className="tbl">
                  <thead>
                    <tr>
                      {th('title', 'Video')}
                      {th('channel', 'Channel')}
                      {th('kind', 'Kind')}
                      {th('posted', 'Posted')}
                      {th('platform', 'Platforms')}
                      {th('views', 'Views')}
                      {th('likes', 'Likes')}
                      {th('comments', 'Comments')}
                      {th('shares', 'Shares')}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted?.map((r) => (
                      <tr
                        key={r.key}
                        className={`vrow ${r.postId ? 'click' : ''}`}
                        onClick={() => r.postId && setEditing(r.postId)}
                      >
                        <td>
                          <div className="vid">
                            {r.poster ? <img src={r.poster} alt="" className="thumb" /> : <div className="thumb" />}
                            <div>
                              <div className="vt">
                                {r.title}
                                {r.kind === 'Clip' && <span className="tag clip">Clip</span>}
                                {r.outside && <span className="tag">Outside ELO</span>}
                                {r.hasComment && <span className="tag ok">comment added</span>}
                              </div>
                              {r.fileName && <div className="vf">{r.fileName}</div>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="who2">
                            {r.brandColor && <span className="dot" style={{ background: r.brandColor }} />}
                            {r.brandName}
                          </span>
                        </td>
                        <td className="muted">{r.kind || '-'}</td>
                        <td className="whenc">{r.at ? formatEastern(r.at) : '-'}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="pchips">
                            {r.chips.map((c) =>
                              c.url ? (
                                <a
                                  key={c.platform}
                                  className="pchip"
                                  href={c.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={`Open on ${PLATFORM_LABELS[c.platform]}`}
                                >
                                  <PlatformName platform={c.platform} />
                                </a>
                              ) : (
                                <span key={c.platform} className="pchip" title="No link saved for this one">
                                  <PlatformName platform={c.platform} />
                                </span>
                              ),
                            )}
                          </div>
                        </td>
                        <td className="num">{fmt(sum(r.chips, 'views'))}</td>
                        <td className="num">{fmt(sum(r.chips, 'likes'))}</td>
                        <td className="num">{fmt(sum(r.chips, 'comments'))}</td>
                        <td className="num">{fmt(sum(r.chips, 'shares'))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        </ThemedHost>
      </div>
      {editing !== null && <PostEditor postId={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
