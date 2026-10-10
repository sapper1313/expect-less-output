export interface TitleIdea {
  title: string
  why: string
}

export interface TitleLabResult {
  topic: string
  suggestions: string[]
  topVideos: Array<{ title: string; channel: string; views: number | null }>
  titles: TitleIdea[]
  tags: string[]
  note: string
}

export interface CompetitorVideo {
  id: string
  title: string
  publishedAt: string | null
  views: number | null
}

export interface CompetitorView {
  id: number
  brandId: number
  handle: string
  title: string
  subscribers: number | null
  checkedUtc: string | null
  videos: CompetitorVideo[]
  /** Average views of the recent videos, to spot the ones that did much better. */
  averageViews: number | null
}

export interface TrendVideo {
  id: string
  title: string
  channel: string
  views: number | null
}

export interface RetentionView {
  postId: number
  platform: string
  videoId: string
  fetchedUtc: string
  minutesWatched: number | null
  avgViewSeconds: number | null
  avgViewPercent: number | null
  /** Share of viewers still watching, at each point of the video (t from 0 to 1, watch around 0 to 1). */
  curve: Array<{ t: number; watch: number }>
}
