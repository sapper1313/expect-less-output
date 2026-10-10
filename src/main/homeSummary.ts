import type { Db } from './db'
import type { Post, HealthRow, PostStats } from '@shared/types'
import type { SpendSummary } from '@shared/studio/types'
import type { BrandStudioRow } from '@shared/studio/api'
import { EPISODE_STAGE, type HomeChannel, type HomeConnection, type HomePost, type HomeStage, type HomeSummary } from '@shared/home'

export interface HomeDeps {
  db: Db
  now: () => number
  posts: (filter: { status?: 'upcoming' | 'recent' | 'all'; brandId?: number | null }) => Post[]
  health: () => HealthRow[]
  bluesky: () => Promise<Array<{ brandId: number; bluesky: { handle: string; state: string; message: string } }>>
  studioBrands: () => Promise<BrandStudioRow[]>
  openFlags: () => number
  spend: () => Promise<SpendSummary>
  mockMode: () => boolean
  postStats: (id: number) => PostStats
}

const LABEL: Record<string, string> = { youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', bluesky: 'Bluesky' }
const DAY = 86_400_000

const toPost = (p: Post): HomePost => ({
  postId: p.id,
  brandId: p.brandId,
  brandName: p.brandName,
  color: p.brandColor,
  title: p.title || p.fileName,
  whenUtc: p.scheduledAtUtc,
  platforms: p.targets.map((t) => t.platform),
  status: p.status,
})

/** One picture of the whole studio for the Home screen and the left menu badges. */
export async function buildHomeSummary(d: HomeDeps): Promise<HomeSummary> {
  const now = d.now()
  const brands = await d.studioBrands()
  const health = d.health()
  const bsky = await d.bluesky().catch(() => [])

  const counts = (d.db.prepare('SELECT status, brand_id, COUNT(*) n FROM episodes WHERE status != ? GROUP BY status, brand_id').all('Archived') as Array<{ status: string; brand_id: number; n: number }>)
  const stage: Record<HomeStage['key'], number> = { writing: 0, ready: 0, making: 0, scheduled: 0, posted: 0, flagged: 0 }
  const perBrand = new Map<number, HomeChannel['pipeline']>()
  for (const c of counts) {
    const k = EPISODE_STAGE[c.status]
    if (!k) continue
    stage[k] += c.n
    const p = perBrand.get(c.brand_id) ?? { writing: 0, ready: 0, making: 0, scheduled: 0, flagged: 0 }
    if (k !== 'posted') p[k] += c.n
    perBrand.set(c.brand_id, p)
  }

  const upcomingAll = d.posts({ status: 'upcoming' })
  const recentAll = d.posts({ status: 'recent' })
  const posted = recentAll.filter((p) => p.status === 'posted').sort((a, b) => String(b.scheduledAtUtc).localeCompare(String(a.scheduledAtUtc)))

  const connState = (r: HealthRow): HomeConnection => {
    const days = r.expiresAt ? Math.floor((Date.parse(r.expiresAt) - now) / DAY) : null
    if (r.status !== 'connected') return { platform: r.platform, label: LABEL[r.platform] ?? r.platform, state: 'bad', note: r.status === 'needs_reauth' ? 'Needs you to sign in again' : 'Has an error' }
    if (days !== null && days < 0) return { platform: r.platform, label: LABEL[r.platform] ?? r.platform, state: 'bad', note: 'The login ran out' }
    if (days !== null && days <= 7) return { platform: r.platform, label: LABEL[r.platform] ?? r.platform, state: 'warn', note: `Login runs out in ${days} day${days === 1 ? '' : 's'}` }
    return { platform: r.platform, label: LABEL[r.platform] ?? r.platform, state: 'ok', note: 'Connected' }
  }

  const channels: HomeChannel[] = brands.map((b) => {
    const conns = health.filter((h) => h.brandId === b.brandId).map(connState)
    const bs = bsky.find((x) => x.brandId === b.brandId)?.bluesky
    if (bs && bs.state !== 'not_set') conns.push({ platform: 'bluesky', label: 'Bluesky', state: bs.state === 'connected' ? 'ok' : bs.state === 'failed' ? 'bad' : 'warn', note: bs.state === 'connected' ? 'Connected' : bs.message || 'Not tested yet' })
    if (!conns.length) conns.push({ platform: 'youtube', label: 'No accounts', state: 'none', note: 'Nothing is connected yet' })
    const last = posted.find((p) => p.brandId === b.brandId)
    let latest: HomeChannel['latest'] = null
    if (last) {
      const t = d.postStats(last.id).totals
      latest = { postId: last.id, title: last.title || last.fileName, platforms: last.targets.map((x) => x.platform), postedAtUtc: last.scheduledAtUtc, views: t.views, likes: t.likes, comments: t.comments, shares: t.shares }
    }
    const pipe = perBrand.get(b.brandId) ?? { writing: 0, ready: 0, making: 0, scheduled: 0, flagged: 0 }
    const sched = upcomingAll.filter((p) => p.brandId === b.brandId && p.status !== 'missed' && p.status !== 'draft').length
    return { brandId: b.brandId, name: b.name, color: b.color, paused: b.config.paused, runwayDays: b.runwayCovered, nextDue: b.nextDue, pipeline: { ...pipe, scheduled: Math.max(pipe.scheduled, sched) }, connections: conns, latest }
  })

  const scheduledPosts = upcomingAll.filter((p) => p.status === 'scheduled' || p.status === 'in_progress' || p.status === 'partial').length
  stage.scheduled = Math.max(stage.scheduled, scheduledPosts)
  stage.posted = recentAll.filter((p) => p.status === 'posted' && now - Date.parse(p.scheduledAtUtc ?? '') < 7 * DAY).length || stage.posted
  stage.flagged = Math.max(stage.flagged, d.openFlags())

  const stages: HomeStage[] = [
    { key: 'writing', label: 'Being written', count: stage.writing },
    { key: 'ready', label: 'Ready for video', count: stage.ready },
    { key: 'making', label: 'Video in progress', count: stage.making },
    { key: 'scheduled', label: 'Scheduled', count: stage.scheduled },
    { key: 'posted', label: 'Posted this week', count: stage.posted },
    { key: 'flagged', label: 'Needs a look', count: stage.flagged },
  ]

  const sp = await d.spend()
  const g = sp.caps.find((c) => c.key === 'global')
  const capValue = g && !g.cap.none ? g.cap.value : null
  const failedPosts = upcomingAll.filter((p) => p.status === 'missed').length + recentAll.filter((p) => p.status === 'failed').length
  const badConns = channels.flatMap((c) => c.connections.map((x) => ({ c, x }))).filter(({ x }) => x.state === 'bad' || x.state === 'warn')
  const needsYou: string[] = []
  if (d.openFlags()) needsYou.push(`${d.openFlags()} studio item${d.openFlags() === 1 ? '' : 's'} flagged`)
  if (failedPosts) needsYou.push(`${failedPosts} post${failedPosts === 1 ? '' : 's'} failed or missed`)
  for (const { c, x } of badConns.slice(0, 4)) needsYou.push(`${c.name}: ${x.label}. ${x.note}`)

  return {
    generatedUtc: new Date(now).toISOString(),
    stages,
    channels,
    upcoming: upcomingAll.filter((p) => p.status === 'scheduled' || p.status === 'in_progress' || p.status === 'partial').slice(0, 8).map(toPost),
    recent: posted.slice(0, 6).map(toPost),
    spend: { month: sp.month, total: sp.total, capLabel: g ? `${g.label}` : 'Global cap', capValue, percent: capValue ? Math.min(100, Math.round((sp.total / capValue) * 100)) : null, mock: d.mockMode() },
    badges: { studio: d.openFlags(), queue: failedPosts, channels: badConns.length },
    needsYou,
  }
}
