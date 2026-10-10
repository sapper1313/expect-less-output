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
