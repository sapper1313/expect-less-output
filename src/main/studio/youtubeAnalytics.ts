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
