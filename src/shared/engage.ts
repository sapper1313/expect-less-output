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
