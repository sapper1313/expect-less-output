import type { Db } from '../db'
import type { QuotaStatus } from '@shared/types'
import type { Scheduler } from '../scheduler/scheduler'
import type { SettingsService } from '../services/settings'
import { healthRows } from '../services/health'

export interface AgentHealthDeps {
  db: Db
  scheduler: Scheduler
  settings: SettingsService
  version: string
  quota: () => QuotaStatus
  metaExpiresAt: () => string | null
  tiktokExpiresAt: (accountId: number) => string | null
}

/** The body of GET /v1/health. */
export function buildHealth(d: AgentHealthDeps) {
  const st = d.scheduler.status()
  const q = d.quota()
  return {
    app_version: d.version,
    scheduler: {
      running: st.running,
      paused: st.paused,
      pending_posts: st.pendingCount,
      next_post: st.nextPost
        ? {
            post_id: st.nextPost.postId,
            brand: st.nextPost.brandName,
            title: st.nextPost.title,
            at: st.nextPost.whenUtc,
          }
        : null,
    },
    agents: { drafts_only: !d.settings.get().agentMaySchedule },
    accounts: healthRows({
      db: d.db,
      metaExpiresAt: d.metaExpiresAt,
      tiktokExpiresAt: d.tiktokExpiresAt,
    }).map((r) => ({
      brand: r.brandName,
      platform: r.platform,
      account: r.displayName,
      status: r.status,
      mode: r.mode,
      last_checked_at: r.lastCheckedAt,
      login_expires_at: r.expiresAt,
    })),
    youtube_quota: {
      uploads_used: q.uploads.used,
      uploads_limit: q.uploads.limit,
      other_used: q.other.used,
      other_limit: q.other.limit,
    },
  }
}
