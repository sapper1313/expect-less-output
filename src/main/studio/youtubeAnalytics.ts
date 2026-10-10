import type { AnalyticsReader, Metrics } from './thumbTest'

/**
 * Thumbnail results from the YouTube Analytics API (impressions, click through rate, average view duration) for one video
 * between two times. Needs the yt-analytics.readonly permission: reconnect YouTube once after updating to grant it.
 */
export class YoutubeAnalyticsReader implements AnalyticsReader {
  constructor(
    private token: (accountId: number) => Promise<string>,
    private fetchImpl: typeof fetch = fetch,
    private base = 'https://youtubeanalytics.googleapis.com/v2/reports',
  ) {}

  async read(accountId: number | null, videoId: string, fromUtc: string, toUtc: string): Promise<Metrics> {
    if (accountId === null) throw new Error('No YouTube account is linked to this video.')
    const q = new URLSearchParams({
      ids: 'channel==MINE',
      metrics: 'videoThumbnailImpressions,videoThumbnailImpressionsClickRate,averageViewDuration',
      filters: `video==${videoId}`,
      startDate: fromUtc.slice(0, 10),
      endDate: toUtc.slice(0, 10),
    })
    const res = await this.fetchImpl(`${this.base}?${q}`, { headers: { authorization: `Bearer ${await this.token(accountId)}` }, signal: AbortSignal.timeout(30_000) })
    if (res.status === 403 || res.status === 401) throw new Error('YouTube Analytics refused the request. Reconnect YouTube on the Connections screen to allow analytics.')
    if (!res.ok) throw new Error(`YouTube Analytics answered HTTP ${res.status}.`)
    const d = (await res.json()) as { rows?: number[][] }
    const row = d.rows?.[0] ?? [0, 0, 0]
    return { impressions: row[0] ?? 0, ctr: (row[1] ?? 0) / 100 > 1 ? (row[1] ?? 0) / 100 : (row[1] ?? 0), avgViewSeconds: row[2] ?? null }
  }
}

export interface RetentionData {
  minutesWatched: number | null
  avgViewSeconds: number | null
  avgViewPercent: number | null
  curve: Array<{ t: number; watch: number }>
}

/** Watch time and the audience retention curve for one video, from the YouTube Analytics API. */
export class YoutubeRetentionReader {
  constructor(
    private token: (accountId: number) => Promise<string>,
    private fetchImpl: typeof fetch = fetch,
    private base = 'https://youtubeanalytics.googleapis.com/v2/reports',
  ) {}

  private async query(accountId: number, params: Record<string, string>): Promise<number[][]> {
    const q = new URLSearchParams({ ids: 'channel==MINE', ...params })
    const res = await this.fetchImpl(`${this.base}?${q}`, { headers: { authorization: `Bearer ${await this.token(accountId)}` }, signal: AbortSignal.timeout(30_000) })
    if (res.status === 401 || res.status === 403) throw new Error('YouTube Analytics refused the request. Reconnect YouTube on the Connections screen to allow analytics.')
    if (!res.ok) throw new Error(`YouTube Analytics answered HTTP ${res.status}.`)
    return ((await res.json()) as { rows?: number[][] }).rows ?? []
  }

  async read(accountId: number, videoId: string, fromDate: string, toDate: string): Promise<RetentionData> {
    const totals = await this.query(accountId, { metrics: 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage', filters: `video==${videoId}`, startDate: fromDate, endDate: toDate })
    let curve: RetentionData['curve'] = []
    try {
      // Not every video has a curve yet (new or very small videos). That is not an error.
      const rows = await this.query(accountId, { dimensions: 'elapsedVideoTimeRatio', metrics: 'audienceWatchRatio', filters: `video==${videoId}`, startDate: fromDate, endDate: toDate })
      curve = rows.map((r) => ({ t: r[0] ?? 0, watch: r[1] ?? 0 }))
    } catch (e) {
      if (/refused/.test((e as Error).message)) throw e
    }
    const t = totals[0]
    return { minutesWatched: t?.[0] ?? null, avgViewSeconds: t?.[1] ?? null, avgViewPercent: t?.[2] ?? null, curve }
  }
}
