import { fetchOneStats, type StatsProvider } from '../stats/providers'
import { statSync } from 'fs'
import {
  AdapterError,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
} from './types'
import { COPY } from '@shared/copy'
import { durationProblem } from '@shared/platformLimits'
import type { Account } from '@shared/types'
import {
  FB_MIN_SCHEDULE_LEAD_MS,
  FB_REELS_PER_DAY,
  GRAPH_VERSION,
  type MetaUrls,
} from '../meta/config'
import { MetaApiError, type GraphClient } from '../meta/graph'

export interface MetaAdapterHost {
  notify(title: string, body: string): void
  /** Called when Meta says the saved login is dead (error 190). */
  authFailed(reason: string): void
  tokenFor(account: Account | null): string
  log(level: 'info' | 'warn' | 'error', message: string, ctx: AdapterContext): void
}

export interface FacebookDeps {
  /** Reads views, likes and so on for one posted video. */
  stats?: StatsProvider
  graph: GraphClient
  urls: MetaUrls
  host: MetaAdapterHost
  publishesLast24h: (pageId: string) => number
  recordPublish: (pageId: string) => void
}

const SCHEDULE_GRACE_MS = 15 * 60_000
const NOW_TIMEOUT_MS = 30 * 60_000
const FB_ORIGIN = 'https://www.facebook.com'

/** Facebook Page Reels: start, upload, finish. Early handoff uses video_state=SCHEDULED. */
export class FacebookAdapter implements PlatformAdapter {
  readonly platform = 'facebook' as const
  constructor(private d: FacebookDeps) {}

  wantsHandoff(account: Account | null): boolean {
    return account?.mode === 'live'
  }
  minHandoffLeadMs(): number {
    return FB_MIN_SCHEDULE_LEAD_MS
  }
  async connect(): Promise<void> {}
  async refreshIfNeeded(): Promise<void> {}

  async validate(ctx: AdapterContext): Promise<void> {
    const a = ctx.account
    if (!a || !a.externalId)
      throw new AdapterError(
        `${ctx.brandName} has no Facebook Page connected. Assign one on the Connections screen.`,
        'permanent',
      )
    if (a.status === 'needs_reauth') {
      throw new AdapterError(
        `Meta needs you to sign in again for ${ctx.brandName}. Click Reconnect Meta on the Connections screen.`,
        'permanent',
      )
    }
    const problem = ctx.videoDurationSeconds
      ? durationProblem('facebook', ctx.videoDurationSeconds)
      : null
    if (problem) throw new AdapterError(problem, 'permanent')
    this.d.host.tokenFor(a) // fails clearly when the saved token is missing
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof MetaApiError && err.needsReauth) this.d.host.authFailed(err.message)
      throw err
    }
  }

  /** start, upload, finish. Every step records progress in the target state, so a retry never repeats a finished step. */
  private async send(ctx: AdapterContext, how: 'schedule' | 'now'): Promise<string> {
    const a = ctx.account as Account
    const page = a.externalId as string
    const token = this.d.host.tokenFor(a)
    const g = this.d.graph
    let st = ctx.getState()
    let videoId = typeof st.fbVideoId === 'string' ? st.fbVideoId : null

    if (!videoId) {
      if (this.d.publishesLast24h(page) >= FB_REELS_PER_DAY) {
        throw new AdapterError(
          `Facebook allows ${FB_REELS_PER_DAY} API Reels per Page in 24 hours and this Page is at the limit. Try again later.`,
          'permanent',
        )
      }
      const start = await this.guard(() =>
        g.post<{ video_id: string; upload_url?: string }>(
          `/${page}/video_reels`,
          { upload_phase: 'start' },
          token,
        ),
      )
      videoId = start.video_id
      ctx.setState({ fbVideoId: videoId, fbUploadUrl: start.upload_url ?? null })
      st = ctx.getState()
    }
    if (!st.fbUploaded) {
      const url =
        typeof st.fbUploadUrl === 'string' && st.fbUploadUrl
          ? st.fbUploadUrl
          : `${this.d.urls.rupload}/video-upload/${GRAPH_VERSION}/${videoId}`
      await this.guard(() =>
        g.uploadFile({
          url,
          token,
          filePath: ctx.videoAbsPath,
          fileSize: statSync(ctx.videoAbsPath).size,
          onProgress: (f) => ctx.reportProgress(f),
        }),
      )
      ctx.setState({ fbUploaded: true })
    }
    if (!st.fbFinished) {
      const params: Record<string, string | number> = {
        video_id: videoId,
        upload_phase: 'finish',
        video_state: how === 'schedule' ? 'SCHEDULED' : 'PUBLISHED',
        description: ctx.caption,
      }
      if (how === 'schedule')
        params.scheduled_publish_time = Math.floor(new Date(ctx.scheduledAtUtc).getTime() / 1000)
      await this.guard(() => g.post(`/${page}/video_reels`, params, token))
      this.d.recordPublish(page)
      ctx.setState({ fbFinished: true, fbHow: how, fbFinishedAtMs: ctx.nowMs() })
      this.d.host.log(
        'info',
        `Facebook Reel ${how === 'schedule' ? 'scheduled inside Facebook' : 'sent to publish'}.`,
        ctx,
      )
    }
    return videoId
  }

  async handOff(ctx: AdapterContext): Promise<AdapterResult> {
    const id = await this.send(ctx, 'schedule')
    return { status: 'handed_off', externalId: id }
  }

  async publish(ctx: AdapterContext): Promise<AdapterResult> {
    const id = await this.send(ctx, 'now')
    return { status: 'processing', externalId: id }
  }

  async checkStatus(ctx: AdapterContext, nowMs: number): Promise<AdapterResult> {
    const a = ctx.account
    const st = ctx.getState()
    const videoId = st.fbVideoId
    if (!a || typeof videoId !== 'string') return { status: 'processing' }
    const token = this.d.host.tokenFor(a)
    const v = await this.guard(() =>
      this.d.graph.get<any>(`/${videoId}`, { fields: 'status,permalink_url' }, token),
    )
    const s = v.status ?? {}
    for (const phase of ['uploading_phase', 'processing_phase', 'publishing_phase'] as const) {
      if (s[phase]?.status === 'error') {
        const why = s[phase]?.errors?.[0]?.message ?? s.video_status ?? 'unknown reason'
        throw new AdapterError(
          `Facebook could not finish the Reel (${phase.replace('_phase', '')} step): ${why}`,
          'permanent',
        )
      }
    }
    const published =
      s.publishing_phase?.status === 'complete' &&
      (s.publishing_phase?.publish_status ?? 'published') === 'published'
    if (published) {
      const link =
        typeof v.permalink_url === 'string'
          ? v.permalink_url.startsWith('http')
            ? v.permalink_url
            : `${FB_ORIGIN}${v.permalink_url}`
          : undefined
      if (ctx.aiFlag) {
        ctx.setState({ checklist: COPY.aiChecklist })
        this.d.host.notify(
          COPY.aiChecklist,
          `${ctx.brandName}: ${ctx.title}. Facebook has no API field for this label.`,
        )
      }
      return { status: 'posted', externalId: videoId, externalUrl: link }
    }
    const how = st.fbHow === 'schedule' ? 'schedule' : 'now'
    const waitedMs = nowMs - new Date(ctx.scheduledAtUtc).getTime()
    if (how === 'schedule' && waitedMs > SCHEDULE_GRACE_MS) {
      throw new AdapterError(
        'The scheduled Reel did not go live on time. Open Meta Business Suite to see what Facebook says, then retry.',
        'permanent',
      )
    }
    const finishedAt = typeof st.fbFinishedAtMs === 'number' ? st.fbFinishedAtMs : null
    if (how === 'now' && finishedAt && nowMs - finishedAt > NOW_TIMEOUT_MS) {
      throw new AdapterError(
        'Facebook is taking too long to process the Reel. Check Meta Business Suite, then retry.',
        'permanent',
      )
    }
    return { status: how === 'schedule' ? 'handed_off' : 'processing', externalId: videoId }
  }

  async fetchStats(ctx: AdapterContext): Promise<Record<string, number>> {
    return fetchOneStats(this.d.stats, 'facebook', ctx)
  }
}
