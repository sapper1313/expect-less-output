/** Comments and messages from Upload-Post, shown in the Inbox. */

export type CommentStatus = 'new' | 'replied' | 'done' | 'mine'

export interface InboxComment {
  id: number
  brandId: number
  brandName: string
  brandColor: string
  platform: string
  postId: number | null
  /** The title of the video the comment is on. */
  postTitle: string
  commentId: string
  author: string
  text: string
  atUtc: string | null
  status: CommentStatus
  replyText: string | null
  repliedAtUtc: string | null
}

export interface CommentFilter {
  brandId?: number | null
  platform?: string | null
  /** open: new comments. all: everything including replied and done. */
  show?: 'open' | 'all'
}

export interface CommentSyncResult {
  checked: number
  added: number
  problems: string[]
}

export interface DmMessage {
  id: string
  atUtc: string
  fromName: string
  /** True when the channel sent it. */
  mine: boolean
  text: string
}

export interface DmConversation {
  id: string
  /** The other person. */
  withName: string
  withId: string
  lastAtUtc: string
  messages: DmMessage[]
  /** True while the other person wrote in the last 24 hours. Instagram only allows a reply inside that window. */
  canReply: boolean
}

export interface DmChannel {
  brandId: number
  brandName: string
  conversations: DmConversation[]
  /** Why there is nothing to show, for example no Instagram ticked. Null when it loaded. */
  problem: string | null
}

/** Account level numbers for one channel on one platform, as the platform reports them through Upload-Post. */
export interface AccountStatRow {
  brandId: number
  brandName: string
  brandColor: string
  platform: string
  fetchedAtUtc: string
  /** Every number Upload-Post sent, by its name (followers, views, impressions, reach, likes, and anything else). */
  numbers: Record<string, number>
  /** The same numbers a week or more ago, for the change. Null when there is no older reading yet. */
  before: Record<string, number> | null
  /** Watch time in minutes when the platform gave it (YouTube). */
  watchMinutes: number | null
  /** Reach per day, oldest first, when the platform gave it. */
  series: Array<{ date: string; value: number }>
  /** Why there are no numbers, for example the platform needs reconnecting. */
  error: string | null
}

export interface AccountAudience {
  brandId: number
  brandName: string
  platform: string
  fetchedAtUtc: string
  /** The audience answer as Upload-Post sent it (countries, ages, genders, hours online, followers per day, profile taps). */
  data: {
    range?: { start_date: string; end_date: string }
    audience?: {
      countries?: Array<{ country: string; percentage: number }>
      cities?: Array<{ city: string; percentage: number }>
      ages?: Array<{ age: string; percentage: number }>
      genders?: Array<{ gender: string; percentage: number }>
    }
    activity_by_hour?: Array<{ hour: string; followers_online: number }>
    followers_daily?: Array<{ date: string; total: number | null; new: number | null; lost: number | null }>
    profile_actions?: Record<string, number | null>
    bio_description?: string | null
  }
}

export interface AccountStatsView {
  rows: AccountStatRow[]
  audience: AccountAudience[]
  /** True when no channel has a platform ticked on the Upload-Post card. */
  nothingTicked: boolean
}

export interface AccountSyncResult {
  channels: number
  platforms: number
  problems: string[]
}

/** The Home widget: each channel's platforms added together. */
export interface ChannelTotals {
  id: number
  name: string
  color: string
  platforms: string[]
  followers: number | null
  views: number | null
  likes: number | null
  shares: number | null
  comments: number | null
  impressions: number | null
  /** Watch time in hours, from the platform when it gave it, otherwise YouTube's own numbers saved by ELO. */
  watchHours: number | null
}

export interface HomeAccountTotals {
  updatedAt: string | null
  channels: ChannelTotals[]
  total: Omit<ChannelTotals, 'id' | 'name' | 'color' | 'platforms'>
}
