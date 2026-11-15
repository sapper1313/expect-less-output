import type { Account } from '@shared/types'
import type { GraphClient } from '../meta/graph'
import type { BlueskyClient } from '../studio/social/bluesky'

/** One comment read through ELO's own login, in the shape Upload-Post gives them. */
export interface OwnComment {
  id: string
  text: string
  at: string | null
  userId: string
  username: string
}

export interface OwnEngageDeps {
  graph: GraphClient
  /** The saved Meta token for a Facebook Page or Instagram account. Throws a plain message when there is none. */
  tokenFor: (account: Account | null) => string
  accountFor: (brandId: number, platform: 'facebook' | 'instagram', accountId: number | null) => Account | null
  youtube: {
    postComment(accountId: number, videoId: string, text: string): Promise<string>
    listComments(accountId: number, videoId: string): Promise<Array<{ id: string; text: string; author: string; publishedAt: string }>>
    replyToComment(accountId: number, parentId: string, text: string): Promise<string>
  }
  bluesky: (brandId: number) => BlueskyClient
}

/**
 * ELO's own way to comment, read comments, reply and send Instagram messages. It is only used after Upload-Post has
 * failed, as the backup. Each method says plainly when ELO has no way for a platform (it returns null or false).
 */
export class OwnEngage {
  constructor(private d: OwnEngageDeps) {}

  /** A new top level comment on one of our posts. False when ELO has no way for that platform. */
  async postComment(i: {
    platform: string
    brandId: number
    accountId: number | null
    externalId: string
    externalUrl: string | null
    text: string
  }): Promise<boolean> {
    if (i.platform === 'youtube') {
      if (!i.accountId) return false
      await this.d.youtube.postComment(i.accountId, i.externalId, i.text)
      return true
    }
    if (i.platform === 'facebook') {
      const acct = this.d.accountFor(i.brandId, 'facebook', i.accountId)
      if (!acct) return false
      await this.d.graph.post(`/${i.externalId}/comments`, { message: i.text }, this.d.tokenFor(acct))
      return true
    }
    if (i.platform === 'bluesky') {
      const c = this.d.bluesky(i.brandId)
      const ref = await c.refFor(i.externalId.startsWith('at://') ? i.externalId : (i.externalUrl ?? i.externalId))
      await c.replyText(i.text, ref, ref)
      return true
    }
    return false
  }

  /** Top level comments on one video. Null when ELO has no way for that platform. */
  async listComments(i: { platform: string; brandId: number; accountId: number | null; externalId: string }): Promise<OwnComment[] | null> {
    if (i.platform === 'youtube') {
      if (!i.accountId) return null
      return (await this.d.youtube.listComments(i.accountId, i.externalId)).map((c) => ({
        id: c.id,
        text: c.text,
        at: c.publishedAt || null,
        userId: '',
        username: c.author,
      }))
    }
    if (i.platform === 'facebook' || i.platform === 'instagram') {
      const acct = this.d.accountFor(i.brandId, i.platform, i.accountId)
      if (!acct) return null
      const token = this.d.tokenFor(acct)
      if (i.platform === 'facebook') {
        const r = await this.d.graph.get<{ data?: Array<{ id: string; message?: string; from?: { id?: string; name?: string }; created_time?: string }> }>(
          `/${i.externalId}/comments`,
          { fields: 'id,message,from,created_time', order: 'reverse_chronological', limit: 50 },
          token,
        )
        return (r.data ?? []).map((c) => ({ id: c.id, text: c.message ?? '', at: c.created_time ?? null, userId: c.from?.id ?? '', username: c.from?.name ?? '' }))
      }
      const r = await this.d.graph.get<{ data?: Array<{ id: string; text?: string; username?: string; timestamp?: string }> }>(
        `/${i.externalId}/comments`,
        { fields: 'id,text,username,timestamp', limit: 50 },
        token,
      )
      return (r.data ?? []).map((c) => ({ id: c.id, text: c.text ?? '', at: c.timestamp ?? null, userId: '', username: c.username ?? '' }))
    }
    return null
  }

  /** A reply to a comment. False when ELO has no way for that platform. */
  async reply(i: { platform: string; brandId: number; accountId: number | null; commentId: string; text: string }): Promise<boolean> {
    if (i.platform === 'youtube') {
      if (!i.accountId) return false
      await this.d.youtube.replyToComment(i.accountId, i.commentId, i.text)
      return true
    }
    if (i.platform === 'facebook' || i.platform === 'instagram') {
      const acct = this.d.accountFor(i.brandId, i.platform, i.accountId)
      if (!acct) return false
      const path = i.platform === 'facebook' ? `/${i.commentId}/comments` : `/${i.commentId}/replies`
      await this.d.graph.post(path, { message: i.text }, this.d.tokenFor(acct))
      return true
    }
    return false
  }

  /** Instagram message conversations through Meta, in the shape Upload-Post gives them. Needs Meta's message permission. */
  async dmConversations(brandId: number): Promise<any[] | null> {
    const acct = this.d.accountFor(brandId, 'instagram', null)
    if (!acct?.externalId) return null
    const r = await this.d.graph.get<{ data?: any[] }>(
      `/${acct.externalId}/conversations`,
      { platform: 'instagram', fields: 'id,participants,messages.limit(15){id,created_time,from,message}', limit: 25 },
      this.d.tokenFor(acct),
    )
    return r.data ?? []
  }

  /** Sends an Instagram message through Meta. False when ELO has no Instagram login for the channel. */
  async sendDm(brandId: number, recipientId: string, text: string): Promise<boolean> {
    const acct = this.d.accountFor(brandId, 'instagram', null)
    if (!acct?.externalId) return false
    await this.d.graph.post(
      `/${acct.externalId}/messages`,
      { recipient: JSON.stringify({ id: recipientId }), message: JSON.stringify({ text }) },
      this.d.tokenFor(acct),
    )
    return true
  }
}
