/** One comment on one of our posts, from any platform. */
export interface RawComment {
  id: string
  text: string
  author: string
  createdUtc: string
  /** Extra data a platform needs to reply (for example a Bluesky content id). */
  meta?: Record<string, string>
}

/** A posted video on a platform that can have comments. */
export interface PostedRef {
  brandId: number
  platform: string
  /** The platform's id for the video or post. */
  externalId: string
  accountId: number | null
  episodeId: string | null
  /** Anything saved when it was posted (for example the Bluesky cid). */
  state: Record<string, string>
}

export interface CommentSource {
  readonly platform: string
  list(ref: PostedRef): Promise<RawComment[]>
  reply(ref: PostedRef, comment: RawComment, text: string): Promise<string>
  /** Hides or reports obvious spam where the platform's API allows it. */
  hide?(ref: PostedRef, comment: RawComment): Promise<void>
}

/** Mock mode and tests: comments are in memory, and replies are recorded. */
export class MockCommentSource implements CommentSource {
  comments = new Map<string, RawComment[]>()
  replies: Array<{ platform: string; to: string; text: string }> = []
  hidden: string[] = []
  private n = 0
  constructor(readonly platform: string) {}

  add(externalId: string, c: Omit<RawComment, 'createdUtc'> & { createdUtc?: string }): void {
    const list = this.comments.get(externalId) ?? []
    list.push({ createdUtc: new Date().toISOString(), ...c })
    this.comments.set(externalId, list)
  }

  async list(ref: PostedRef): Promise<RawComment[]> {
    return this.comments.get(ref.externalId) ?? []
  }

  async reply(_ref: PostedRef, comment: RawComment, text: string): Promise<string> {
    this.replies.push({ platform: this.platform, to: comment.id, text })
    return `mock-reply-${++this.n}`
  }

  async hide(_ref: PostedRef, comment: RawComment): Promise<void> {
    this.hidden.push(comment.id)
  }
}
