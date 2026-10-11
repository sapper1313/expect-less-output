import { DateTime } from 'luxon'
import type { Db } from '../db'
import { addDays, todayEastern } from '@shared/studio/cadence'
import type { StudioConfigService } from './configService'
import type { SpendService } from './spend'

export interface DigestDeps {
  db: Db
  cfg: StudioConfigService
  spend: SpendService
  /** Plain lines about logins that need attention: Meta, TikTok, YouTube. */
  expiring: () => string[]
  now?: () => number
}

/**
 * The morning message. Short on purpose: what went out, what is coming, how many days of scripts are ready, what has been
 * spent, what needs the owner, what the comment agent did, and any login about to run out.
 */
export function buildDigest(d: DigestDeps): string {
  const nowMs = d.now ? d.now() : Date.now()
  const since = new Date(nowMs - 86_400_000).toISOString()
  const today = todayEastern(nowMs)
  const to3 = DateTime.fromISO(`${addDays(today, 3)}T00:00:00`, { zone: 'America/New_York' })
    .toUTC()
    .toISO() as string
  const nowIso = new Date(nowMs).toISOString()
  const brands = d.cfg.listBrandConfigs()
  const q = <T>(sql: string, ...a: unknown[]) => d.db.prepare(sql).all(...a) as T[]
  const n = (sql: string, ...a: unknown[]) => (d.db.prepare(sql).get(...a) as { n: number }).n

  const posted = q<{ name: string; n: number }>(
    "SELECT b.name, COUNT(*) AS n FROM posts p JOIN brands b ON b.id = p.brand_id WHERE p.status = 'posted' AND p.scheduled_at_utc >= ? AND p.scheduled_at_utc <= ? GROUP BY b.id",
    since,
    nowIso,
  )
  const social = n(
    "SELECT COUNT(*) AS n FROM social_posts WHERE status = 'posted' AND posted_utc >= ?",
    since,
  )
  const totalPosted = posted.reduce((a, b) => a + b.n, 0)
  const upcoming = n(
    "SELECT COUNT(*) AS n FROM posts WHERE status = 'scheduled' AND scheduled_at_utc > ? AND scheduled_at_utc <= ?",
    nowIso,
    to3,
  )
  const runway = brands
    .map((b) => {
      const r = d.db
        .prepare(
          "SELECT MAX(slot_date) AS m FROM episodes WHERE brand_id = ? AND slot_date >= ? AND status NOT IN ('Failed','Archived','Flagged','Idea')",
        )
        .get(b.brandId, today) as { m: string | null }
      const days = r.m ? Math.round((Date.parse(r.m) - Date.parse(today)) / 86_400_000) : 0
      return `${b.name} ${days}d`
    })
    .join(', ')
  const spend = d.spend.summary()
  const cap = d.cfg.get().globalCap
  const flagged =
    n("SELECT COUNT(*) AS n FROM agent_tasks WHERE status IN ('flagged','stopped')") +
    n("SELECT COUNT(*) AS n FROM comment_items WHERE status = 'flagged'") +
    n("SELECT COUNT(*) AS n FROM episodes WHERE status = 'Flagged'")
  const c = q<{ status: string; n: number }>(
    'SELECT status, COUNT(*) AS n FROM comment_items WHERE created_utc >= ? OR replied_utc >= ? GROUP BY status',
    since,
    since,
  )
  const cn = (s: string) => c.find((x) => x.status === s)?.n ?? 0
  const soon = d.expiring()

  const parts: string[] = []
  parts.push(
    `Good morning. Posted ${totalPosted + social} in the last day${posted.length ? ` (${posted.map((p) => `${p.name} ${p.n}`).join(', ')})` : ''}.`,
  )
  parts.push(`${upcoming} scheduled in the next 3 days.`)
  parts.push(`Scripts ready: ${runway}.`)
  parts.push(
    `Spent $${spend.total.toFixed(2)} this month${cap.none ? '' : ` of $${cap.value.toFixed(2)}`}.`,
  )
  parts.push(
    flagged ? `${flagged} item${flagged === 1 ? '' : 's'} need you.` : 'Nothing needs you.',
  )
  if (cn('replied') || cn('draft') || cn('flagged'))
    parts.push(
      `Comments: ${cn('replied')} replied, ${cn('draft')} drafts, ${cn('flagged')} flagged.`,
    )
  if (soon.length) parts.push(`Heads up: ${soon.join(' ')}`)
  return (d.cfg.get().mockMode ? '(Mock mode) ' : '') + parts.join(' ')
}
