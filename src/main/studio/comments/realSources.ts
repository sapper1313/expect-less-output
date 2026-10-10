import type { Account } from '@shared/types'
import type { GraphClient } from '../../meta/graph'
import type { BlueskyClient } from '../social/bluesky'
import type { ThreadsClient } from '../social/threads'
import type { CommentSource, PostedRef, RawComment } from './sources'

/** YouTube comments through the Data API (commentThreads.list and comments.insert). */
export interface YoutubeCommentsApi {
  listComments(accountId: number, videoId: string): Promise<Array<{ id: string; text: string; author: string; publishedAt: string }>>
  replyToComment(accountId: number, parentId: string, text: string): Promise<string>
  rejectComment?(accountId: number, commentId: string): Promise<void>
}

export class YoutubeCommentSource implements CommentSource {
  readonly platform = 'youtube'
  constructor(private api: YoutubeCommentsApi) {}
  async list(ref: PostedRef): Promise<RawComment[]> {
    if (ref.accountId === null) return []
    return (await this.api.listComments(ref.accountId, ref.externalId)).map((c) => ({ id: c.id, text: c.text, author: c.author, createdUtc: c.publishedAt }))
  }
  async reply(ref: PostedRef, c: RawComment, text: string): Promise<string> {
    return this.api.replyToComment(ref.accountId as number, c.id, text)
  }
  async hide(ref: PostedRef, c: RawComment): Promise<void> {
    if (ref.accountId !== null) await this.api.rejectComment?.(ref.accountId, c.id)
  }
}

/** Facebook Page video comments and Instagram media comments through the Graph API. */
export class MetaCommentSource implements CommentSource {
  constructor(
    readonly platform: 'facebook' | 'instagram',
    private graph: GraphClient,
    private tokenFor: (account: Account | null) => string,
    private account: (ref: PostedRef) => Account | null,
  ) {}

  async list(ref: PostedRef): Promise<RawComment[]> {
    const token = this.tokenFor(this.account(ref))
    if (this.platform === 'facebook') {
      const r = await this.graph.get<{ data?: Array<{ id: string; message?: string; from?: { name?: string }; created_time?: string }> }>(`/${ref.externalId}/comments`, { fields: 'id,message,from,created_time', order: 'reverse_chronological', limit: 50 }, token)
      return (r.data ?? []).map((c) => ({ id: c.id, text: c.message ?? '', author: c.from?.name ?? '', createdUtc: c.created_time ?? '' }))
    }
    const r = await this.graph.get<{ data?: Array<{ id: string; text?: string; username?: string; timestamp?: string }> }>(`/${ref.externalId}/comments`, { fields: 'id,text,username,timestamp', limit: 50 }, token)
    return (r.data ?? []).map((c) => ({ id: c.id, text: c.text ?? '', author: c.username ?? '', createdUtc: c.timestamp ?? '' }))
  }

  async reply(ref: PostedRef, c: RawComment, text: string): Promise<string> {
    const token = this.tokenFor(this.account(ref))
    const path = this.platform === 'facebook' ? `/${c.id}/comments` : `/${c.id}/replies`
    const r = await this.graph.post<{ id: string }>(path, { message: text }, token)
    return r.id
  }

  async hide(ref: PostedRef, c: RawComment): Promise<void> {
    const token = this.tokenFor(this.account(ref))
    await this.graph.post(`/${c.id}`, this.platform === 'facebook' ? { is_hidden: true } : { hide: true }, token)
  }
}

export class ThreadsCommentSource implements CommentSource {
  readonly platform = 'threads'
  constructor(
    private clientFor: (brandId: number) => ThreadsClient,
    private userId: (brandId: number) => string | null,
  ) {}
  async list(ref: PostedRef): Promise<RawComment[]> {
    return (await this.clientFor(ref.brandId).listReplies(ref.externalId)).map((r) => ({ id: r.id, text: r.text, author: r.username, createdUtc: r.at }))
  }
  async reply(ref: PostedRef, c: RawComment, text: string): Promise<string> {
    const client = this.clientFor(ref.brandId)
    const uid = this.userId(ref.brandId) ?? (await client.me()).id
    return client.reply(uid, c.id, text)
  }
  async hide(ref: PostedRef, c: RawComment): Promise<void> {
    await this.clientFor(ref.brandId).hideReply(c.id, true)
  }
}

export class BlueskyCommentSource implements CommentSource {
  readonly platform = 'bluesky'
  constructor(private clientFor: (brandId: number) => BlueskyClient) {}
  async list(ref: PostedRef): Promise<RawComment[]> {
    return (await this.clientFor(ref.brandId).listReplies(ref.externalId)).map((r) => ({ id: r.uri, text: r.text, author: r.username, createdUtc: r.at, meta: { cid: r.cid } }))
  }
  async reply(ref: PostedRef, c: RawComment, text: string): Promise<string> {
    const root = { uri: ref.externalId, cid: ref.state.bskyCid ?? '' }
    const parent = { uri: c.id, cid: c.meta?.cid ?? '' }
    return (await this.clientFor(ref.brandId).replyText(text, root, parent)).uri
  }
}
