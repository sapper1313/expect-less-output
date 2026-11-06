import { fetchOneStats, type StatsProvider } from '../stats/providers'
import { statSync } from 'fs'
import {
  AdapterError,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
} from './types'
import { PLATFORM_LIMITS, countHashtags, durationProblem } from '@shared/platformLimits'
import type { Account, BrandDefaults } from '@shared/types'
import { GRAPH_VERSION, IG_POLL_TIMEOUT_MS, type MetaUrls } from '../meta/config'
import { MetaApiError, type GraphClient } from '../meta/graph'
import type { MetaAdapterHost } from './facebook'

export interface InstagramDeps {
  /** Reads views, likes and so on for one posted video. */
  stats?: StatsProvider
  graph: GraphClient
  urls: MetaUrls
  host: MetaAdapterHost
  brandDefaults: (brandId: number) => BrandDefaults
}

/**
 * Instagram Reels: create a container, upload the local file (resumable), then let the scheduler poll the
 * container every tick. When it is FINISHED the Reel is published. Nothing blocks for minutes.
 */
/** Instagram expires an unpublished upload after 24 hours. Treat 23 hours as old. */
const containerIsOld = (createdAtMs: unknown, nowMs: number) => typeof createdAtMs === 'number' && nowMs - createdAtMs > 23 * 3600_000

export class InstagramAdapter implements PlatformAdapter {
  readonly platform = 'instagram' as const
  constructor(private d: InstagramDeps) {}

  wantsHandoff(): boolean {
    return false
  }
  minHandoffLeadMs(): number {
    return 0
  }
  async connect(): Promise<void> {}
  async refreshIfNeeded(): Promise<void> {}

  async validate(ctx: AdapterContext): Promise<void> {
    const a = ctx.account
    if (!a || !a.externalId)
      throw new AdapterError(
        `${ctx.brandName} has no Instagram account connected. Assign one in Setup Channels, on the Connections tab.`,
        'permanent',
      )
    if (a.status === 'needs_reauth') {
      throw new AdapterError(
        `Meta needs you to sign in again for ${ctx.brandName}. Click Reconnect Meta in Setup Channels, on the Connections tab.`,
        'permanent',
      )
    }
    const problem = ctx.videoDurationSeconds
      ? durationProblem('instagram', ctx.videoDurationSeconds)
      : null
    if (problem) throw new AdapterError(problem, 'permanent')
    const lim = PLATFORM_LIMITS.instagram
    if (ctx.caption.length > lim.captionMax) {
      throw new AdapterError(
        `The Instagram caption is ${ctx.caption.length} characters. The limit is ${lim.captionMax}.`,
        'permanent',
      )
    }
    if (countHashtags(ctx.caption) > lim.hashtagsMax) {
      throw new AdapterError(
        `The Instagram caption has ${countHashtags(ctx.caption)} hashtags. The limit is ${lim.hashtagsMax}.`,
        'permanent',
      )
    }
    this.d.host.tokenFor(a)
  }

  /** Runs one Meta call. A refusal says which step it happened in, so a failure can be understood. */
  private async guard<T>(fn: () => Promise<T>, step = ''): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof MetaApiError && err.needsReauth) this.d.host.authFailed(err.message)
      if (err instanceof MetaApiError && step && !err.needsReauth && !err.message.startsWith('Step: '))
        throw new MetaApiError(`Step: ${step}. ${err.message}`, err.kind, err.code, err.subcode)
      throw err
    }
  }

  async publish(ctx: AdapterContext): Promise<AdapterResult> {
    const a = ctx.account as Account
    const ig = a.externalId as string
    const token = this.d.host.tokenFor(a)
    const g = this.d.graph
    let st = ctx.getState()
    // Instagram throws away an upload that was not published within a day. An old one is never reused.
    if (typeof st.igContainerId === 'string' && containerIsOld(st.igCreatedAtMs, ctx.nowMs())) {
      ctx.setState({ igContainerId: null, igUploaded: false, igUploadUrl: null, igCreatedAtMs: null })
      st = ctx.getState()
    }
    let container = typeof st.igContainerId === 'string' ? st.igContainerId : null

    if (!container) {
      const limit = await this.guard(() =>
        g.get<{ data: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>(
          `/${ig}/content_publishing_limit`,
          { fields: 'quota_usage,config' },
          token,
        ),
        'checking the daily Instagram post limit',
      )
      const row = limit.data?.[0]
      if (
        row &&
        typeof row.quota_usage === 'number' &&
        row.quota_usage >= (row.config?.quota_total ?? 100)
      ) {
        throw new AdapterError(
          `Instagram allows ${row.config?.quota_total ?? 100} API posts per 24 hours and this account is at the limit. Try again later.`,
          'permanent',
        )
      }
      const brand = this.d.brandDefaults(ctx.brandId)
      const thumb =
        typeof ctx.settings.thumbOffsetMs === 'number' ? ctx.settings.thumbOffsetMs : undefined
      const created = await this.guard(() =>
        g.post<{ id: string; uri?: string }>(
          `/${ig}/media`,
          {
            media_type: 'REELS',
            upload_type: 'resumable',
            caption: ctx.caption,
            share_to_feed: brand.instagramShareToFeed,
            thumb_offset: thumb,
            cover_url:
              typeof ctx.settings.coverUrl === 'string' ? ctx.settings.coverUrl : undefined,
            is_ai_generated: ctx.aiFlag ? true : undefined,
          },
          token,
        ),
        'starting the Reel on Instagram',
      )
      container = created.id
      ctx.setState({
        igContainerId: container,
        igUploadUrl: created.uri ?? null,
        igCreatedAtMs: ctx.nowMs(),
        igUploaded: false,
      })
      st = ctx.getState()
    }
    if (!st.igUploaded) {
      const url =
        typeof st.igUploadUrl === 'string' && st.igUploadUrl
          ? st.igUploadUrl
          : `${this.d.urls.rupload}/ig-api-upload/${GRAPH_VERSION}/${container}`
      try {
        await this.guard(() =>
          g.uploadFile({
            url,
            token,
            filePath: ctx.videoAbsPath,
            fileSize: statSync(ctx.videoAbsPath).size,
            onProgress: (f) => ctx.reportProgress(f),
          }),
          'uploading the video to Instagram',
        )
      } catch (err) {
        // Instagram will not take a file for a container it already closed (a first try that broke part way).
        // That container can never be used again, so the retry has to start a new one.
        if (err instanceof Error && /not in the status to upload/i.test(err.message)) {
          ctx.setState({ igContainerId: null, igUploaded: false, igUploadUrl: null, igCreatedAtMs: null })
          throw new AdapterError(
            'Instagram closed the earlier upload before it finished. Starting a fresh upload.',
            'transient',
          )
        }
        throw err
      }
      ctx.setState({ igUploaded: true })
      this.d.host.log('info', 'Instagram received the video. Waiting for it to process.', ctx)
    }
    return { status: 'processing', externalId: container }
  }

  async checkStatus(ctx: AdapterContext): Promise<AdapterResult> {
    const a = ctx.account
    const st = ctx.getState()
    if (!a) return { status: 'processing' }
    const token = this.d.host.tokenFor(a)
    const ig = a.externalId as string
    const g = this.d.graph

    // Already published on an earlier pass (for example the app quit right after): just finish up.
    if (typeof st.igMediaId === 'string') return this.posted(ctx, st.igMediaId, token)

    const container = st.igContainerId
    if (typeof container !== 'string') return { status: 'processing' }
    if (containerIsOld(st.igCreatedAtMs, ctx.nowMs())) {
      ctx.setState({ igContainerId: null, igUploaded: false, igUploadUrl: null, igCreatedAtMs: null })
      throw new AdapterError('The earlier Instagram upload sat for more than a day and expired. Starting a fresh upload.', 'transient')
    }
    const res = await this.guard(() =>
      g.get<{ status_code?: string; status?: string }>(
        `/${container}`,
        { fields: 'status_code,status' },
        token,
      ),
      'asking Instagram if the Reel is ready',
    )
    switch (res.status_code) {
      case 'FINISHED': {
        const pub = await this.guard(() =>
          g.post<{ id: string }>(`/${ig}/media_publish`, { creation_id: container }, token),
          'publishing the Reel',
        )
        ctx.setState({ igMediaId: pub.id })
        return this.posted(ctx, pub.id, token)
      }
      case 'PUBLISHED':
        return { status: 'posted', externalId: container }
      case 'EXPIRED': {
        ctx.setState({ igContainerId: null, igUploaded: false, igUploadUrl: null, igCreatedAtMs: null })
        throw new AdapterError('Instagram dropped the old upload because it was not published in time. Starting a fresh upload.', 'transient')
      }
      case 'ERROR': {
        const why = res.status || res.status_code
        // Forget this container so a Retry starts a fresh one.
        ctx.setState({ igContainerId: null, igUploaded: false, igUploadUrl: null, igCreatedAtMs: null })
        throw new AdapterError(`Instagram could not process the Reel (${why}).`, 'permanent')
      }
      default: {
        const started = typeof st.igCreatedAtMs === 'number' ? st.igCreatedAtMs : ctx.nowMs()
        if (ctx.nowMs() - started > IG_POLL_TIMEOUT_MS) {
          ctx.setState({ igContainerId: null, igUploaded: false, igUploadUrl: null })
          throw new AdapterError(
            'Instagram is taking more than 15 minutes to process the Reel. Starting over.',
            'transient',
          )
        }
        return { status: 'processing', externalId: container }
      }
    }
  }

  private async posted(
    ctx: AdapterContext,
    mediaId: string,
    token: string,
  ): Promise<AdapterResult> {
    let link: string | undefined
    try {
      const m = await this.d.graph.get<{ permalink?: string }>(
        `/${mediaId}`,
        { fields: 'permalink' },
        token,
      )
      link = m.permalink
    } catch (e) {
      this.d.host.log(
        'warn',
        `Posted, but could not fetch the Instagram link: ${(e as Error).message}`,
        ctx,
      )
    }
    return { status: 'posted', externalId: mediaId, externalUrl: link }
  }

  async fetchStats(ctx: AdapterContext): Promise<Record<string, number>> {
    return fetchOneStats(this.d.stats, 'instagram', ctx)
  }
}
