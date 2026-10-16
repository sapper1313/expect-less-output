import type { Db } from './db'
import type { Post, HealthRow, PostStats } from '@shared/types'
import type { SpendSummary } from '@shared/studio/types'
import type { BrandStudioRow } from '@shared/studio/api'
import {
  EPISODE_STAGE,
  type HomeChannel,
  type HomeConnection,
  type HomePost,
  type HomeStage,
  type HomeSummary,
  type SetupStep,
} from '@shared/home'

export interface HomeDeps {
  db: Db
  now: () => number
  posts: (filter: { status?: 'upcoming' | 'recent' | 'all'; brandId?: number | null }) => Post[]
  health: () => HealthRow[]
  bluesky: () => Promise<
    Array<{ brandId: number; bluesky: { handle: string; state: string; message: string } }>
  >
  studioBrands: () => Promise<BrandStudioRow[]>
  openFlags: () => number
  spend: () => Promise<SpendSummary>
  mockMode: () => boolean
  postStats: (id: number) => PostStats
  /** The app settings, to see whether alerts are set up. */
  settings?: () => {
    alertIMessageEnabled: boolean
    alertIMessageNumber: string
    alertEmailEnabled: boolean
    alertEmailTo: string
  }
}

const LABEL: Record<string, string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  bluesky: 'Bluesky',
}
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

  const counts = d.db
    .prepare(
      'SELECT status, brand_id, COUNT(*) n FROM episodes WHERE status != ? GROUP BY status, brand_id',
    )
    .all('Archived') as Array<{ status: string; brand_id: number; n: number }>
  const stage: Record<HomeStage['key'], number> = {
    writing: 0,
    ready: 0,
    making: 0,
    scheduled: 0,
    posted: 0,
    flagged: 0,
  }
  const perBrand = new Map<number, HomeChannel['pipeline']>()
  for (const c of counts) {
    const k = EPISODE_STAGE[c.status]
    if (!k) continue
    stage[k] += c.n
    const p = perBrand.get(c.brand_id) ?? {
      writing: 0,
      ready: 0,
      making: 0,
      scheduled: 0,
      flagged: 0,
    }
    if (k !== 'posted') p[k] += c.n
    perBrand.set(c.brand_id, p)
  }

  const upcomingAll = d.posts({ status: 'upcoming' })
  const recentAll = d.posts({ status: 'recent' })
  const posted = recentAll
    .filter((p) => p.status === 'posted')
    .sort((a, b) => String(b.scheduledAtUtc).localeCompare(String(a.scheduledAtUtc)))

  const connState = (r: HealthRow): HomeConnection => {
    const days = r.expiresAt ? Math.floor((Date.parse(r.expiresAt) - now) / DAY) : null
    if (r.status !== 'connected')
      return {
        platform: r.platform,
        label: LABEL[r.platform] ?? r.platform,
        state: 'bad',
        note: r.status === 'needs_reauth' ? 'Needs you to sign in again' : 'Has an error',
      }
    if (days !== null && days < 0)
      return {
        platform: r.platform,
        label: LABEL[r.platform] ?? r.platform,
        state: 'bad',
        note: 'The login ran out',
      }
    if (days !== null && days <= 7)
      return {
        platform: r.platform,
        label: LABEL[r.platform] ?? r.platform,
        state: 'warn',
        note: `Login runs out in ${days} day${days === 1 ? '' : 's'}`,
      }
    return {
      platform: r.platform,
      label: LABEL[r.platform] ?? r.platform,
      state: 'ok',
      note: 'Connected',
    }
  }

  const channels: HomeChannel[] = brands.map((b) => {
    const conns = health.filter((h) => h.brandId === b.brandId).map(connState)
    const bs = bsky.find((x) => x.brandId === b.brandId)?.bluesky
    if (bs && bs.state !== 'not_set')
      conns.push({
        platform: 'bluesky',
        label: 'Bluesky',
        state: bs.state === 'connected' ? 'ok' : bs.state === 'failed' ? 'bad' : 'warn',
        note: bs.state === 'connected' ? 'Connected' : bs.message || 'Not tested yet',
      })
    if (!conns.length)
      conns.push({
        platform: 'youtube',
        label: 'No accounts',
        state: 'none',
        note: 'Nothing is connected yet',
      })
    const last = posted.find((p) => p.brandId === b.brandId)
    let latest: HomeChannel['latest'] = null
    // A video that was already on the channel (found by Import existing videos) counts too, if it is newer.
    const found = d.db
      .prepare(
        `SELECT v.platform AS platform, v.title AS title, v.published_at_utc AS at,
           (SELECT views FROM imported_stats WHERE imported_id = v.id ORDER BY id DESC LIMIT 1) AS views,
           (SELECT likes FROM imported_stats WHERE imported_id = v.id ORDER BY id DESC LIMIT 1) AS likes,
           (SELECT comments FROM imported_stats WHERE imported_id = v.id ORDER BY id DESC LIMIT 1) AS comments,
           (SELECT shares FROM imported_stats WHERE imported_id = v.id ORDER BY id DESC LIMIT 1) AS shares
         FROM imported_videos v WHERE v.brand_id = ? AND v.published_at_utc IS NOT NULL
         ORDER BY v.published_at_utc DESC LIMIT 1`,
      )
      .get(b.brandId) as
      | {
          platform: string
          title: string
          at: string
          views: number | null
          likes: number | null
          comments: number | null
          shares: number | null
        }
      | undefined
    const lastAt = last?.scheduledAtUtc ?? ''
    if (found && (!last || found.at > lastAt)) {
      latest = {
        postId: null,
        existing: true,
        title: found.title || '(no title)',
        platforms: [found.platform],
        postedAtUtc: found.at,
        views: found.views,
        likes: found.likes,
        comments: found.comments,
        shares: found.shares,
      }
    } else if (last) {
      const t = d.postStats(last.id).totals
      latest = {
        postId: last.id,
        title: last.title || last.fileName,
        platforms: last.targets.map((x) => x.platform),
        postedAtUtc: last.scheduledAtUtc,
        views: t.views,
        likes: t.likes,
        comments: t.comments,
        shares: t.shares,
      }
    }
    const pipe = perBrand.get(b.brandId) ?? {
      writing: 0,
      ready: 0,
      making: 0,
      scheduled: 0,
      flagged: 0,
    }
    const sched = upcomingAll.filter(
      (p) => p.brandId === b.brandId && p.status !== 'missed' && p.status !== 'draft',
    ).length
    return {
      brandId: b.brandId,
      name: b.name,
      color: b.color,
      paused: b.config.paused,
      runwayDays: b.runwayCovered,
      nextDue: b.nextDue,
      pipeline: { ...pipe, scheduled: Math.max(pipe.scheduled, sched) },
      connections: conns,
      latest,
    }
  })

  const scheduledPosts = upcomingAll.filter(
    (p) => p.status === 'scheduled' || p.status === 'in_progress' || p.status === 'partial',
  ).length
  stage.scheduled = Math.max(stage.scheduled, scheduledPosts)
  stage.posted =
    recentAll.filter(
      (p) => p.status === 'posted' && now - Date.parse(p.scheduledAtUtc ?? '') < 7 * DAY,
    ).length || stage.posted
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
  const eastern = new Date(now - 4 * 3600_000) // close enough to Eastern for a day count
  const dayOfMonth = Math.max(1, eastern.getUTCDate())
  const daysInMonth = new Date(
    Date.UTC(eastern.getUTCFullYear(), eastern.getUTCMonth() + 1, 0),
  ).getUTCDate()
  const projected = Math.round((sp.total / dayOfMonth) * daysInMonth * 100) / 100
  const g = sp.caps.find((c) => c.key === 'global')
  const capValue = g && !g.cap.none ? g.cap.value : null
  const failedPosts =
    upcomingAll.filter((p) => p.status === 'missed').length +
    recentAll.filter((p) => p.status === 'failed').length
  const badConns = channels
    .flatMap((c) => c.connections.map((x) => ({ c, x })))
    .filter(({ x }) => x.state === 'bad' || x.state === 'warn')
  const setting = (key: string): unknown => {
    const r = d.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
      { value_json: string } | undefined
    try {
      return r ? JSON.parse(r.value_json) : null
    } catch {
      return null
    }
  }
  const n = (sql: string) => (d.db.prepare(sql).get() as { n: number }).n
  const liveAccounts = n(
    "SELECT COUNT(*) AS n FROM accounts WHERE mode != 'dry_run' AND status = 'connected'",
  )
  const brandsWithoutSlots = n(
    `SELECT COUNT(*) AS n FROM brands b WHERE b.archived = 0
       AND EXISTS (SELECT 1 FROM accounts a WHERE a.brand_id = b.id AND a.mode != 'dry_run')
       AND NOT EXISTS (SELECT 1 FROM brand_slots s WHERE s.brand_id = b.id AND s.enabled = 1)`,
  )
  const telegram = setting('studio.telegram') as { chatIds?: number[] } | null
  const st = d.settings?.()
  const alertsOn =
    (!!st?.alertIMessageEnabled && !!st.alertIMessageNumber.trim()) ||
    (!!st?.alertEmailEnabled && !!st.alertEmailTo.trim()) ||
    (telegram?.chatIds?.length ?? 0) > 0
  const setup: SetupStep[] = [
    {
      key: 'connect',
      label: 'Connect your accounts',
      detail: 'Sign in to YouTube, Facebook, Instagram and TikTok for each channel.',
      done: liveAccounts > 0,
      go: { screen: 'channels', channelsTab: 'connections' },
    },
    {
      key: 'slots',
      label: 'Set your posting times',
      detail: 'Choose the times each channel posts, so a new post can take the next open time.',
      done: liveAccounts > 0 && brandsWithoutSlots === 0,
      go: { screen: 'channels', channelsTab: 'setup' },
    },
    {
      key: 'import',
      label: 'Bring in your existing videos',
      detail: 'Adds the videos already on your channels so the numbers cover everything.',
      done: n('SELECT COUNT(*) AS n FROM imported_videos') > 0,
      go: { screen: 'stats', statsTab: 'numbers' },
    },
    {
      key: 'alerts',
      label: 'Turn on alerts',
      detail: 'Get a message when something fails. iMessage, email or the Telegram bot.',
      done: alertsOn,
      go: { screen: 'settings', settingsTab: 'alerts' },
    },
    {
      key: 'firstPost',
      label: 'Schedule your first post',
      detail: 'Pick a video, check each platform and choose a time.',
      done: n('SELECT COUNT(*) AS n FROM posts') > 0,
      go: { screen: 'schedule' },
    },
  ]
  const needsYou: string[] = []
  if (d.openFlags())
    needsYou.push(`${d.openFlags()} studio item${d.openFlags() === 1 ? '' : 's'} flagged`)
  if (failedPosts)
    needsYou.push(`${failedPosts} post${failedPosts === 1 ? '' : 's'} failed or missed`)
  for (const { c, x } of badConns.slice(0, 4)) needsYou.push(`${c.name}: ${x.label}. ${x.note}`)

  return {
    generatedUtc: new Date(now).toISOString(),
    stages,
    channels,
    upcoming: upcomingAll
      .filter(
        (p) => p.status === 'scheduled' || p.status === 'in_progress' || p.status === 'partial',
      )
      .slice(0, 8)
      .map(toPost),
    recent: posted.slice(0, 6).map(toPost),
    spend: {
      month: sp.month,
      total: sp.total,
      projected,
      capLabel: g ? `${g.label}` : 'Global cap',
      capValue,
      percent: capValue ? Math.min(100, Math.round((sp.total / capValue) * 100)) : null,
      mock: d.mockMode(),
    },
    badges: { studio: d.openFlags(), queue: failedPosts, channels: badConns.length },
    needsYou,
    setup,
  }
}
